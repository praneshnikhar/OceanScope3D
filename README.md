# OceanScope 3D

Browser-native 3D ocean data visualization system — co-visualizes ocean model fields
(temperature, salinity, currents) with in-situ instrument observations (Argo floats,
gliders) in a single interactive web environment. Built for the INCOIS problem
statement. 100% open source.

## Quickstart (local)

```bash
# 1. Backend — generate sample data + start API
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
.venv/bin/python backend/scripts/make_sample_data.py
cd backend && ../.venv/bin/uvicorn app.main:app --port 8000

# 2. Frontend — new terminal
cd frontend && npm install && npm run dev
# open http://localhost:5173
```

## Quickstart (docker compose)

```bash
docker compose up          # API on :8000, UI on :5173
```

The API auto-discovers every `.zarr` / `.nc` file dropped into `backend/data/` — no
code changes needed to add a dataset.

## Architecture

| Layer | Stack |
|---|---|
| 3D rendering | Three.js (WebGL2): depth-slice planes, colormap textures, current-vector quivers, vertical exaggeration |
| UI | React + Vite: variable/time/depth controls, colorbar editor, palette switcher |
| API | FastAPI: `/api/datasets`, `/slice`, `/profile`, `/vector-field` |
| Data core | xarray + Zarr (+ NetCDF4): CF-convention aware, chunked reads |
| Plugin system | `backend/app/adapters/base.py` — one subclass per new source |

Roadmap and full design notes live in the project planning doc; phases:

- [x] **Phase 1** — FastAPI adapter registry + Zarr serving; Three.js depth-slice viewer over Bay of Bengal volume; vector overlay; colorbar editing
- [ ] **Phase 2** — Argo/Glider markers via ERDDAP (`argopy`), click-to-profile charts, time-step animation
- [ ] **Phase 3** — isosurface extraction (marching cubes), GPU particle advection, fly-through camera, model-vs-obs difference layer

## Sample data

`backend/scripts/make_sample_data.py` generates a CF-annotated synthetic Bay of Bengal
volume (30 days × 15 depth levels × 0.25° grid: temperature, salinity, u/v currents)
so the whole pipeline runs offline. Swap in real HYCOM/GLORYS/Copernicus subsets or
INCOIS model output by dropping files into `backend/data/`.

## License

MIT — see LICENSE.
