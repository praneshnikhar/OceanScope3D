import math

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from ..registry import REGISTRY, discover

discover()

router = APIRouter(prefix="/api")


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
