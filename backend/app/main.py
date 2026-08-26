from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .registry import discover
from .api.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    datasets = discover()
    print(f"[oceanscope] serving datasets: {sorted(datasets.keys()) or '(none found in backend/data)'}")
    yield


app = FastAPI(title="OceanScope 3D API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
