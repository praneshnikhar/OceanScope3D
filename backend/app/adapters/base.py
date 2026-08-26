from abc import ABC, abstractmethod
from pathlib import Path

import xarray as xr

CANONICAL_DIMS = {
    "latitude": "lat",
    "longitude": "lon",
    "lev": "depth",
    "level": "depth",
    "levels": "depth",
    "depth_levels": "depth",
    "pres": "depth",
    "pressure": "depth",
    "valid_time": "time",
    "datetime": "time",
}


class BaseAdapter(ABC):
    """A data source plugin.

    Subclasses implement ``_open_raw()`` returning an xarray Dataset whose dims
    are normalized to (time, depth, lat, lon). Dropping a new source into the
    registry is all that is needed to expose it through the REST API.
    """

    dataset_id: str = ""
    title: str = ""
    description: str = ""

    def __init__(self):
        self._ds = None

    @abstractmethod
    def _open_raw(self) -> xr.Dataset: ...

    @property
    def ds(self) -> xr.Dataset:
        if self._ds is None:
            ds = self._open_raw()
            renames = {}
            for d in ds.dims:
                target = CANONICAL_DIMS.get(str(d))
                if target and target in ds.sizes:
                    continue
                if target:
                    renames[d] = target
            ds = ds.rename(renames) if renames else ds
            if "time" in ds.sizes:
                ds = ds.sortby("time")
            if "depth" in ds.sizes:
                ds = ds.sortby("depth")
            self._ds = ds
        return self._ds

    def variables(self):
        out = []
        for name, da in self.ds.data_vars.items():
            out.append(
                {
                    "name": str(name),
                    "long_name": str(da.attrs.get("long_name", name)),
                    "units": str(da.attrs.get("units", "")),
                }
            )
        return out

    def summary(self):
        ds = self.ds
        info = {
            "id": self.dataset_id,
            "title": self.title,
            "description": self.description,
            "variables": self.variables(),
            "dims": {str(k): int(v) for k, v in ds.sizes.items()},
        }
        if "time" in ds.coords:
            t = ds["time"].values
            info["time"] = {
                "start": str(t[0]),
                "end": str(t[-1]),
                "count": int(ds.sizes["time"]),
            }
        if "depth" in ds.coords:
            info["depth_values"] = [float(x) for x in ds["depth"].values]
        if "lat" in ds.coords and "lon" in ds.coords:
            info["bbox"] = {
                "lat": [float(ds.lat.min()), float(ds.lat.max())],
                "lon": [float(ds.lon.min()), float(ds.lon.max())],
            }
        return info

    def nearest_index(self, coord: str, value: float) -> int:
        c = self.ds[coord].values
        return int(abs(c - value).argmin())

    def slice(self, var: str, t: int = 0, z: int = 0):
        da = self.ds[var].isel(time=t, depth=z) if "time" in self.ds[var].dims else self.ds[var].isel(depth=z)
        da = da.transpose("lat", "lon")
        return da

    def profile(self, var: str, lat: float, lon: float, t: int = 0):
        iy = self.nearest_index("lat", lat)
        ix = self.nearest_index("lon", lon)
        da = self.ds[var].isel(time=t) if "time" in self.ds[var].dims else self.ds[var]
        prof = da.isel(lat=iy, lon=ix)
        return self.ds.depth.values, prof.values, (
            float(self.ds.lat[iy]),
            float(self.ds.lon[ix]),
        )

    def var_range(self, var: str) -> tuple:
        cache = getattr(self, "_range_cache", {})
        if var not in cache:
            da = self.ds[var]
            vals = np_finite(da.values)
            lo, hi = (float(vals.min()), float(vals.max())) if vals.size else (0.0, 1.0)
            cache[var] = (lo, hi)
            self._range_cache = cache
        return cache[var]


def np_finite(arr):
    import numpy as np

    return arr[np.isfinite(arr)]
