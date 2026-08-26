import math
from pathlib import Path

import numpy as np
import xarray as xr

OUT = Path(__file__).resolve().parents[1] / "data" / "bob_synthetic.zarr"

LON = np.arange(78.0, 95.01, 0.25)
LAT = np.arange(4.0, 24.01, 0.25)
DEPTH = np.array([0, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000], dtype=float)
TIME = np.arange(30)

LON_G, LAT_G = np.meshgrid(LON, LAT)


def temperature(day):
    surf = 27.5 + 2.0 * np.exp(-((LAT_G - 10.0) ** 2) / 60.0) - 0.06 * np.abs(LON_G - 86.0)
    surf += 0.4 * np.sin(2 * math.pi * day / 30.0)
    strat = 1.0 - np.exp(-DEPTH[:, None, None] / 140.0)
    t = surf[None, :, :] - (surf[None, :, :] - 14.0) * strat
    r2 = ((LON_G - 87.0) ** 2 + (LAT_G - 14.0) ** 2) / 12.0
    eddy = 1.8 * np.exp(-r2) * np.cos(2 * math.pi * day / 15.0)
    t += eddy[None, :, :] * np.exp(-DEPTH[:, None, None] / 220.0)
    return t.astype("float32")


def salinity():
    plume_r2 = ((LON_G - 88.5) ** 2 + (LAT_G - 20.5) ** 2) / 9.0
    surf = 35.0 - 2.2 * np.exp(-plume_r2)
    strat = np.exp(-DEPTH[:, None, None] / 90.0)
    s = surf[None, :, :] - (surf[None, :, :] - 34.6) * (1.0 - strat)
    return s.astype("float32")


def current(day, sign):
    cx, cy = 86.5, 13.0
    phase = 2 * math.pi * day / 30.0
    dx = LON_G - cx
    dy = LAT_G - cy
    r2 = dx**2 + dy**2
    strength = (1.1 + 0.35 * np.sin(phase)) * np.exp(-r2 / 55.0)
    base = (-dy if sign < 0 else dx) * strength
    return (base[None, :, :] * np.exp(-DEPTH[:, None, None] / 320.0)).astype("float32")


def main():
    temp = np.stack([temperature(d) for d in TIME])
    salt = np.broadcast_to(salinity(), temp.shape).astype("float32")
    u = np.stack([current(d, -1) for d in TIME])
    v = np.stack([current(d, +1) for d in TIME])

    ds = xr.Dataset(
        {
            "temperature": (("time", "depth", "lat", "lon"), temp),
            "salinity": (("time", "depth", "lat", "lon"), salt),
            "u": (("time", "depth", "lat", "lon"), u),
            "v": (("time", "depth", "lat", "lon"), v),
        },
        coords={
            "time": ("time", np.arange(
                np.datetime64("2026-08-01", "D"), np.datetime64("2026-08-31", "D")
            ).astype("datetime64[ns]")),
            "depth": ("depth", DEPTH, {"units": "m", "positive": "down", "long_name": "depth below sea surface"}),
            "lat": ("lat", LAT, {"units": "degrees_north", "long_name": "latitude"}),
            "lon": ("lon", LON, {"units": "degrees_east", "long_name": "longitude"}),
        },
        attrs={
            "Conventions": "CF-1.10",
            "title": "Synthetic Bay of Bengal ocean volume (hackathon demo)",
            "source": "OceanScope sample generator",
        },
    )
    ds["temperature"].attrs = {"long_name": "sea water temperature", "units": "degree_C"}
    ds["salinity"].attrs = {"long_name": "practical salinity", "units": "1e-3"}
    ds["u"].attrs = {"long_name": "eastward sea water velocity", "units": "m s-1"}
    ds["v"].attrs = {"long_name": "northward sea water velocity", "units": "m s-1"}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    ds.to_zarr(OUT, mode="w", consolidated=True)
    print(f"wrote {OUT}")
    print(f"vars={list(ds.data_vars)} sizes={dict(ds.sizes)}")


if __name__ == "__main__":
    main()
