"""Auto-discovering data-source registry.

Drop any ``.zarr`` or ``.nc`` file into ``backend/data/`` and restart the
API: it shows up under ``/api/datasets`` with zero code changes.
"""

from pathlib import Path

from .adapters.netcdf_adapter import NetCDFAdapter
from .adapters.zarr_adapter import ZarrAdapter

DATA_DIR = Path(__file__).resolve().parents[1] / "data"

REGISTRY: dict = {}


def discover() -> dict:
    if DATA_DIR.exists():
        for p in sorted(DATA_DIR.glob("*.zarr")):
            if p.name not in REGISTRY:
                REGISTRY[p.name] = ZarrAdapter(p)
        for p in sorted(DATA_DIR.glob("*.nc")):
            if p.stem not in REGISTRY:
                REGISTRY[p.stem] = NetCDFAdapter(p)
    return REGISTRY
