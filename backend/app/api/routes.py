import json
import struct

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from ..adapters.observations import PROVIDER
from ..registry import REGISTRY, discover

discover()

router = APIRouter(prefix="/api")

OBS_VAR_MAP = {"temperature": "temp", "salinity": "psal"}


def get_adapter(ds_id: str):
    ad = REGISTRY.get(ds_id)
    if ad is None:
        raise HTTPException(status_code=404, detail=f"dataset '{ds_id}' not found")
    return ad


def clean(arr: np.ndarray):
    arr = np.asarray(arr, dtype="float64")
    return np.where(np.isfinite(arr), arr, None).tolist()


@router.get("/health")
def health():
    return {"status": "ok", "datasets": len(REGISTRY)}


@router.get("/datasets")
def list_datasets():
    return [ad.summary() for ad in REGISTRY.values()]


@router.get("/datasets/{ds_id}")
def dataset_detail(ds_id: str):
    return get_adapter(ds_id).summary()


@router.get("/datasets/{ds_id}/slice")
def slice_dataset(
    ds_id: str,
    var: str = Query(...),
    t: int = Query(0, ge=0),
    z: int = Query(0, ge=0),
):
    ad = get_adapter(ds_id)
    ds = ad.ds
    if var not in ds.data_vars:
        raise HTTPException(404, f"variable '{var}' not in dataset '{ds_id}'")
    da = ds[var]
    t = min(t, da.sizes.get("time", 1) - 1)
    z = min(z, da.sizes.get("depth", 1) - 1)
    field = ad.slice(var, t, z)

    lo, hi = ad.var_range(var)
    pad = max((hi - lo) * 0.02, 1e-6)
    p_lo = float(np.nanpercentile(field.values, 2))
    p_hi = float(np.nanpercentile(field.values, 98))

    return {
        "var": var,
        "long_name": da.attrs.get("long_name", var),
        "units": da.attrs.get("units", ""),
        "time_index": int(t),
        "time": str(ds.time.values[t]) if "time" in da.dims else None,
        "depth_index": int(z),
        "depth": float(ds.depth.values[z]) if "depth" in da.dims else None,
        "lat": clean(ds.lat.values),
        "lon": clean(ds.lon.values),
        "values": clean(field.values),
        "range": {"global_min": lo, "global_max": hi},
        "slice_range": {"p2": p_lo, "p98": p_hi},
    }


@router.get("/datasets/{ds_id}/profile")
def profile_dataset(
    ds_id: str,
    var: str = Query(...),
    lat: float = Query(...),
    lon: float = Query(...),
    t: int = Query(0, ge=0),
):
    ad = get_adapter(ds_id)
    if var not in ad.ds.data_vars:
        raise HTTPException(404, f"variable '{var}' not in dataset '{ds_id}'")
    depth, values, snapped = ad.profile(var, lat, lon, t)
    return {
        "var": var,
        "units": ad.ds[var].attrs.get("units", ""),
        "requested": {"lat": lat, "lon": lon},
        "snapped": {"lat": snapped[0], "lon": snapped[1]},
        "depth": clean(depth),
        "values": clean(values),
    }


@router.get("/datasets/{ds_id}/vector-field")
def vector_field(
    ds_id: str,
    u_var: str = Query("u"),
    v_var: str = Query("v"),
    t: int = Query(0, ge=0),
    z: int = Query(0, ge=0),
    stride: int = Query(3, ge=1),
):
    ad = get_adapter(ds_id)
    ds = ad.ds
    missing = [v for v in (u_var, v_var) if v not in ds.data_vars]
    if missing:
        raise HTTPException(404, f"variables {missing} not in dataset '{ds_id}'")
    uu = ad.slice(u_var, t, z).values[::stride, ::stride]
    vv = ad.slice(v_var, t, z).values[::stride, ::stride]
    mag = np.hypot(uu, vv)
    angle = np.arctan2(vv, uu)
    return {
        "lat": clean(ds.lat.values[::stride]),
        "lon": clean(ds.lon.values[::stride]),
        "magnitude": clean(mag),
        "direction_rad": clean(angle),
    }


# ---------------------------------------------------------------------------
# In-situ observations (Argo floats / gliders)
# ---------------------------------------------------------------------------

def _nearest_cycle(platform, when):
    cycles = platform.get("cycles") or []
    if not cycles:
        return None
    try:
        target = np.datetime64(when)
        times = [np.datetime64(c["time"]) for c in cycles]
        return cycles[int(np.abs(np.array(times) - target).argmin())]
    except Exception:
        return cycles[len(cycles) // 2]


def _model_time(ad, t: int):
    if "time" in ad.ds.sizes:
        return str(ad.ds.time.values[min(t, ad.ds.sizes["time"] - 1)])
    return None


@router.get("/observations")
def observations():
    platforms = []
    for p in PROVIDER.payload["platforms"]:
        platforms.append(
            {
                "id": p["id"],
                "type": p["type"],
                "n_cycles": len(p["cycles"]),
                "track": [
                    {"time": c["time"], "lat": c["lat"], "lon": c["lon"]} for c in p["cycles"]
                ],
            }
        )
    return {"source": PROVIDER.source, "platforms": platforms}


@router.get("/observations/{pid}")
def observation_detail(pid: str):
    p = PROVIDER.platform(pid)
    if p is None:
        raise HTTPException(404, f"observation platform '{pid}' not found")
    return p


@router.get("/datasets/{ds_id}/misfit")
def misfit(
    ds_id: str,
    var: str = Query("temperature"),
    t: int = Query(0, ge=0),
    z: int = Query(0, ge=0),
):
    ad = get_adapter(ds_id)
    if var not in ad.ds.data_vars or var not in OBS_VAR_MAP:
        raise HTTPException(400, f"misfit requires a model variable mapped to obs ({sorted(OBS_VAR_MAP)})")
    ov = OBS_VAR_MAP[var]

    ds = ad.ds
    t = min(t, ds.sizes.get("time", 1) - 1)
    z = min(z, ds.sizes.get("depth", 1) - 1)
    when = _model_time(ad, t)
    depth_target = float(ds.depth.values[z])
    model_depths = ds.depth.values.astype(float)

    feats = []
    for p in PROVIDER.payload["platforms"]:
        cyc = _nearest_cycle(p, when) if when else None
        if cyc is None or cyc.get(ov) is None:
            continue
        d = np.asarray(cyc["depth"], dtype="float64")
        o = np.asarray(cyc[ov], dtype="float64")
        ok = np.isfinite(d) & np.isfinite(o)
        if not ok.any():
            continue
        obs_z = float(np.interp(depth_target, d[ok], o[ok]))

        _, mprof, snapped = ad.profile(var, cyc["lat"], cyc["lon"], t)
        mprof = np.asarray(mprof, dtype="float64")
        mok = np.isfinite(mprof)
        if not mok.any():
            continue
        model_z = float(np.interp(depth_target, model_depths[mok], mprof[mok]))

        feats.append(
            {
                "id": p["id"],
                "type": p["type"],
                "lat": cyc["lat"],
                "lon": cyc["lon"],
                "time": cyc["time"],
                "depth": depth_target,
                "obs": round(obs_z, 4),
                "model": round(model_z, 4),
                "diff": round(model_z - obs_z, 4),
            }
        )

    diffs = np.array([f["diff"] for f in feats]) if feats else np.array([0.0])
    return {
        "var": var,
        "obs_var": ov,
        "units": ds[var].attrs.get("units", ""),
        "t": int(t),
        "z": int(z),
        "features": feats,
        "stats": {
            "count": len(feats),
            "bias": float(np.mean(diffs)),
            "rmse": float(np.sqrt(np.mean(diffs**2))),
        },
    }


# ---------------------------------------------------------------------------
# Binary volume endpoint (isosurfaces / GPU particles)
# ---------------------------------------------------------------------------

MAX_VOLUME_FLOATS = 2_500_000


@router.get("/datasets/{ds_id}/volume")
def volume(
    ds_id: str,
    var: str = Query(...),
    t: int = Query(0, ge=0),
    sd: int = Query(1, ge=1),
    slat: int = Query(1, ge=1),
    slon: int = Query(1, ge=1),
):
    """3-D field as one binary blob: [u32 json_len][json meta][f32 field][f32 lat][f32 lon]."""
    ad = get_adapter(ds_id)
    ds = ad.ds
    if var not in ds.data_vars:
        raise HTTPException(404, f"variable '{var}' not in dataset '{ds_id}'")

    da = ds[var]
    t = min(t, da.sizes.get("time", 1) - 1)
    if "time" in da.dims:
        da = da.isel(time=t)
    arr = da.transpose("depth", "lat", "lon").values[::sd, ::slat, ::slon].astype("<f4")
    lat = ds.lat.values[::slat].astype("<f4")
    lon = ds.lon.values[::slon].astype("<f4")
    if arr.size + lat.size + lon.size > MAX_VOLUME_FLOATS:
        raise HTTPException(413, "volume too large — increase strides")

    lo, hi = ad.var_range(var)
    depth_out = ds.depth.values[::sd] if "depth" in da.dims else [0.0]
    meta = {
        "var": var,
        "long_name": da.attrs.get("long_name", var),
        "units": da.attrs.get("units", ""),
        "time": _model_time(ad, t),
        "shape": list(arr.shape),
        "depth": [float(x) for x in depth_out],
        "lat": lat.tolist(),
        "lon": lon.tolist(),
        "global_range": [lo, hi],
    }
    hb = json.dumps(meta).encode()
    body = struct.pack("<I", len(hb)) + hb + arr.tobytes() + lat.tobytes() + lon.tobytes()
    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={"X-OceanScope-Volume": var},
    )
