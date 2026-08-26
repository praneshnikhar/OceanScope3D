from pathlib import Path

import xarray as xr

from .base import BaseAdapter


class NetCDFAdapter(BaseAdapter):
    def __init__(self, path: Path):
        super().__init__()
        self.path = Path(path)
        self.dataset_id = self.path.stem
        self.title = self.path.stem.replace("_", " ").title()

    def _open_raw(self) -> xr.Dataset:
        return xr.open_dataset(self.path, engine="netcdf4")
