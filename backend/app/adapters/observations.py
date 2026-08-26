"""In-situ observation providers for Argo floats and gliders.

Resolution order (first available wins):
  1. ``backend/data/observations.nc`` / ``observations.zarr`` dropped by the user
     (dims: platform/cycle/time, lat, lon, depth; vars: temp, psal).
  2. Live ERDDAP via :mod:`argopy` **if the package is installed** — results are
     cached under ``backend/data/cache/`` so restarts work offline.
  3. Synthetic instruments sampled from a registered model dataset (seeded, so
     the whole pipeline still runs fully offline with realistic model-vs-obs
     misfit structure).

All providers normalize to one schema::

    {
      "platforms": [
        {
          "id": "argo_5906001",
          "type": "argo" | "glider",
          "cycles": [
            {"time": iso-str, "lat": f, "lon": f,
             "depth": [m...], "temp": [...]|None, "psal": [...]|None},
          ],
        },
      ]
    }
"""

from pathlib import Path

import numpy as np
import xarray as xr

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
CACHE_DIR = DATA_DIR / "cache"

SEED = 42
N_ARGO = 22
N_GLIDERS = 5
ARGO_BIAS_TEMP, ARGO_NOISE_TEMP = -0.12, 0.15
ARGO_BIAS_PSAL, ARGO_NOISE_PSAL = 0.015, 0.010


def _empty():
    return {"platforms": []}


def _cycle(time, lat, lon, depth, temp=None, psal=None):
    def arr(a):
        if a is None:
            return None
        a = np.asarray(a, dtype="float64")
        return [round(float(x), 4) if np.isfinite(x) else None for x in a]

    return {
        "time": str(time),
        "lat": round(float(lat), 4),
        "lon": round(float(lon), 4),
        "depth": arr(depth),
        "temp": arr(temp),
        "psal": arr(psal),
    }


class ObservationProvider:
    """Lazy, cached view of in-situ observations."""

    def __init__(self, get_dataset):
        self._get_dataset = get_dataset  # () -> xr.Dataset | None
        self._payload = None
        self.source = None

    # -- public ------------------------------------------------------------
    @property
    def payload(self):
        if self._payload is None:
            self._payload = self._build()
        return self._payload

    def platforms(self):
        out = []
        for p in self.payload["platforms"]:
            last = p["cycles"][-1]
            out.append(
                {
                    "id": p["id"],
                    "type": p["type"],
                    "n_cycles": len(p["cycles"]),
                    "last_time": last["time"],
                    "last_lat": last["lat"],
                    "last_lon": last["lon"],
                }
            )
        return out

    def platform(self, pid: str):
        for p in self.payload["platforms"]:
            if p["id"] == pid:
                return p
        return None

    # -- builders ----------------------------------------------------------
    def _build(self):
        for builder, name in (
            (self._from_file, "file"),
            (self._from_argopy, "erddap"),
            (self._synthetic_from_model, "synthetic"),
        ):
            try:
                payload = builder()
            except Exception as exc:  # noqa: BLE001 - fallback chain by design
                print(f"[oceanscope] obs source '{name}' unavailable: {exc}")
                continue
            if payload and payload["platforms"]:
                self.source = name
                print(
                    f"[oceanscope] observations from '{name}': "
                    f"{len(payload['platforms'])} platforms"
                )
                return payload
        self.source = "none"
        return _empty()

    def _from_file(self):
        for cand in ("observations.zarr", "observations.nc"):
            path = DATA_DIR / cand
            if not path.exists():
                continue
            ds = xr.open_zarr(path) if cand.endswith("zarr") else xr.open_dataset(path)
            return _normalize_xarray_obs(ds)
        raise FileNotFoundError("no observations file in backend/data")

    def _from_argopy(self):
        import argopy  # optional dependency

        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache = CACHE_DIR / "argo_bob.nc"
        bbox = [77.0, 96.0, 3.0, 25.0, 0, 2000]
        start, end = "2026-07-01", "2026-09-01"
        if cache.exists():
            ds = xr.open_dataset(cache)
        else:
            fetcher = argopy.DataFetcher().region([*bbox, start, end])
            ds = fetcher.to_xarray()
            try:
                ds.to_netcdf(cache)
            except Exception:  # cache is best-effort
                pass
        return _normalize_xarray_obs(ds)

    def _synthetic_from_model(self):
        ds = self._get_dataset()
        if ds is None or not {"temperature", "salinity"} <= set(ds.data_vars):
            raise RuntimeError("no model dataset with temperature/salinity")
        rng = np.random.default_rng(SEED)

        lat0, lat1 = float(ds.lat.min()), float(ds.lat.max())
        lon0, lon1 = float(ds.lon.min()), float(ds.lon.max())
        times = ds.time.values
        n_t = ds.sizes.get("time", 1)
        depths = ds.depth.values.astype(float)
        prof_depths = depths[(depths >= 0)]
        temp = ds["temperature"].values
        salt = ds["salinity"].values

        platforms = []

        # Argo floats: random-walk drifters cycling every ~9 days.
        lats = rng.uniform(lat0 + 1.5, lat1 - 1.5, N_ARGO)
        lons = rng.uniform(lon0 + 1.5, lon1 - 1.5, N_ARGO)
        vlat = rng.normal(0, 0.06, N_ARGO)
        vlon = rng.normal(0.05, 0.06, N_ARGO)
        first_cycle = rng.integers(0, 9, N_ARGO)
        for i in range(N_ARGO):
            cycles, la, lo = [], float(lats[i]), float(lons[i])
            for day in range(int(first_cycle[i]), n_t, 9):
                ti = min(day, n_t - 1)
                ot, os_ = _sample_profile(temp, salt, int(ti), la, lo, prof_depths, ds)
                bt = rng.normal(ARGO_BIAS_TEMP, ARGO_NOISE_TEMP / 2)
                bp = rng.normal(ARGO_BIAS_PSAL, ARGO_NOISE_PSAL / 2)
                cycles.append(
                    _cycle(
                        times[ti],
                        la,
                        lo,
                        prof_depths,
                        ot + bt + rng.normal(0, ARGO_NOISE_TEMP, ot.shape),
                        os_ + bp + rng.normal(0, ARGO_NOISE_PSAL, os_.shape),
                    )
                )
                la += float(vlat[i]) + float(rng.normal(0, 0.03))
                lo += float(vlon[i]) + float(rng.normal(0, 0.03))
                la = min(max(la, lat0 + 0.5), lat1 - 0.5)
                lo = min(max(lo, lon0 + 0.5), lon1 - 0.5)
            if cycles:
                platforms.append({"id": f"argo_{5906000 + i}", "type": "argo", "cycles": cycles})

        # Gliders: sawtooth transects crossing the basin, daily profiles.
        for g in range(N_GLIDERS):
            frac = (g + 0.5) / N_GLIDERS
            west = (lon0 + 1.0, lat0 + frac * (lat1 - lat0))
            east = (lon1 - 1.0, lat0 + frac * (lat1 - lat0))
            start, end = (west, east) if g % 2 == 0 else (east, west)
            gd = prof_depths[prof_depths <= 1000.0]
            cycles = []
            for day in range(0, n_t, 2):
                f = day / max(n_t - 1, 1)
                la = start[1] + (end[1] - start[1]) * f
                lo = start[0] + (end[0] - start[0]) * f
                ot, os_ = _sample_profile(temp, salt, min(day, n_t - 1), la, lo, gd, ds)
                bt = rng.normal(0.08, 0.05)
                bp = rng.normal(-0.008, 0.006)
                cycles.append(
                    _cycle(
                        times[min(day, n_t - 1)],
                        la,
                        lo,
                        gd,
                        ot + bt + rng.normal(0, 0.12, ot.shape),
                        os_ + bp + rng.normal(0, 0.008, os_.shape),
                    )
                )
            if cycles:
                platforms.append({"id": f"glider_{int(rng.integers(100, 999))}_{g}", "type": "glider", "cycles": cycles})

        return {"platforms": platforms}


def _sample_profile(temp, salt, t, lat, lon, depths, ds):
    """Bilinear horizontal sample of the model at instrument positions.

    Model volumes are (time, depth, lat, lon); returns profiles interpolated
    onto ``depths``.
    """
    lats = ds.lat.values
    lons = ds.lon.values
    j = int(np.clip(np.searchsorted(lats, lat) - 1, 0, len(lats) - 2))
    i = int(np.clip(np.searchsorted(lons, lon) - 1, 0, len(lons) - 2))
    fy = float((lat - lats[j]) / (lats[j + 1] - lats[j]))
    fx = float((lon - lons[i]) / (lons[i + 1] - lons[i]))
    model_depths = ds.depth.values.astype(float)

    def sample(vol):
        cell = np.asarray(vol[t])[:, j : j + 2, i : i + 2].astype("float64")
        top = cell[:, 0, 0] * (1 - fx) + cell[:, 0, 1] * fx
        bot = cell[:, 1, 0] * (1 - fx) + cell[:, 1, 1] * fx
        prof = top * (1 - fy) + bot * fy
        return np.interp(depths, model_depths, prof)

    return sample(temp), sample(salt)


def _normalize_xarray_obs(ds):
    """Map a generic profile dataset (or argopy output) onto our schema."""
    cols = {c.lower(): c for c in ds.variables}
    plat_col = next((cols[k] for k in ("platform_number", "platform", "wmo") if k in cols), None)
    time_col = next((cols[k] for k in ("time", "juld", "date") if k in cols), None)
    lat_col = next((cols[k] for k in ("latitude", "lat") if k in cols), None)
    lon_col = next((cols[k] for k in ("longitude", "lon") if k in cols), None)
    depth_col = next((cols[k] for k in ("pres", "pressure", "depth", "lev") if k in cols), None)
    temp_col = next((cols[k] for k in ("temp", "temperature") if k in cols), None)
    psal_col = next((cols[k] for k in ("psal", "salinity") if k in cols), None)
    if not all((plat_col, time_col, lat_col, lon_col, depth_col)):
        raise ValueError("observation file missing required coordinates")

    df = ds.to_dataframe().reset_index()
    df = df.dropna(subset=[plat_col, lat_col, lon_col, depth_col])
    df[plat_col] = df[plat_col].astype(str).str.strip()

    platforms = []
    for pid, grp in df.groupby(plat_col, sort=True):
        cycles = []
        for _, row in grp.sort_values(time_col).groupby(time_col, sort=True):
            first = row.iloc[0]
            cycles.append(
                _cycle(
                    first[time_col],
                    first[lat_col],
                    first[lon_col],
                    row[depth_col].values,
                    row[temp_col].values if temp_col else None,
                    row[psal_col].values if psal_col else None,
                )
            )
        kind = "glider" if str(pid).lower().startswith(("glider", "sg")) else "argo"
        safe = "".join(ch if ch.isalnum() else "_" for ch in str(pid))
        platforms.append({"id": f"{kind}_{safe}", "type": kind, "cycles": cycles})
    return {"platforms": platforms}


PROVIDER = ObservationProvider(lambda: _default_model_dataset())


def _default_model_dataset():
    from ..registry import REGISTRY, discover

    discover()

    for ad in REGISTRY.values():
        try:
            if {"temperature", "salinity"} <= set(ad.ds.data_vars):
                return ad.ds
        except Exception:
            continue
    return None
