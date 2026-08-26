from pathlib import Path

import xarray as xr

from .base import BaseAdapter


class ZarrAdapter(BaseAdapter):
    def __init__(self, path: Path):
        super().__init__()
        self.path = Path(path)
        self.dataset_id = self.path.name
        self.title = self.dataset_id.replace(".zarr", "").replace("_", " ").title()

    def _open_raw(self) -> xr.Dataset:
        try:
            return xr.open_zarr(self.path, consolidated=True)
        except (ValueError, KeyError):
            return xr.open_zarr(self.path, consolidated=False)
