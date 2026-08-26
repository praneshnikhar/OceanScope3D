# OceanScope 3D — Project Status

> Read this first in the next session. It tells you what is shipped, what
> is verified, and what is still open.

## TL;DR

Phases 1, 2, and 3 of the roadmap are all implemented and live. The
backend FastAPI service, the React/Three.js frontend, the offline
observation provider, the GPU particle system, the isosurface
extractor, the fly-through camera, and the model-vs-obs difference
layer are all wired end-to-end. The dev and production builds pass.
The app runs against the synthetic Bay of Bengal sample data with
zero network dependencies by default.

A small number of items were left open from the last session — most
notably a visual artifact on the temperature slice plane in some
browsers and a chunk-size warning from Vite. Both are documented
below under "Open issues".

## What shipped (phases 1 → 3)

### Phase 1 — existing
- FastAPI adapter registry that auto-discovers `.zarr` and `.nc`
  files in `backend/data/`.
- Three.js depth-slice viewer with the thermal / ocean / diverging
  colormaps, color-range editor, vector quiver overlay.
- Zarr-backed sample data generator for the Bay of Bengal.

### Phase 2 — new
- `backend/app/adapters/observations.py`: in-situ observation
  provider with three-tier fallback chain
  (`observations.zarr` / `observations.nc` on disk → `argopy` from
  ERDDAP → synthetic instruments sampled from a registered model
  dataset with seeded RNG, so the whole demo runs fully offline).
  The synthetic branch produces 22 Argo floats on a random-walk
  drift with 9-day cycle period and 5 gliders on basin-spanning
  sawtooth transects. Bias + Gaussian noise are added on top of
  bilinear model samples so the misfit layer is meaningful.
- `GET /api/observations` — list of platforms with full per-cycle
  tracks (time, lat, lon) for the time-animated markers.
- `GET /api/observations/{pid}` — full profile history (depth,
  temp, psal) for one platform.
- `GET /api/datasets/{ds_id}/misfit?var=&t=&z=` — per-observation
  model-vs-obs diff at the requested depth, plus aggregate
  bias / rmse / count stats. Server-side interpolation so
  observations and model values land on the same depth axis.
- Frontend: `OceanScene` was refactored into four persistent groups
  (`oceanGroup`, `dataGroup`, `obsGroup`, `volumeGroup`) all sharing
  the vertical-exaggeration transform. Observation markers are
  canvas-sprite textures (circle for Argo, triangle for glider)
  with a `Raycaster` pointer-pick flow; hover shows a tooltip,
  click opens the `ProfilePanel` with an SVG chart overlaying
  the observed profile and the colocated model profile at the
  nearest cycle to the current animation time. Time animation
  (play / pause / speed) drives `tIdx` forward on an interval;
  marker positions track `slice.time` and update per frame.

### Phase 3 — new
- `backend/app/api/routes.py` `GET /api/datasets/{ds_id}/volume?var=&t=&strides=`
  returns a single binary blob: a 4-byte little-endian header
  length, then JSON metadata `{var, long_name, units, time, shape,
  depth, lat, lon, global_range}`, then little-endian float32
  arrays for the downsampled 3-D field, lat, and lon. A
  `MAX_VOLUME_FLOATS` cap prevents runaway payloads.
- `frontend/src/lib/isosurface.js`: naive **surface nets** extractor
  (not marching cubes) with the standard 12-edge crossing table,
  canonical cell ordering around each crossed edge (avoids the
  position-dependent winding flip that the original adaptive
  ±-offset approach had), and analytic field-gradient normals
  (always exactly outward for iso-surfaces, no accumulated winding
  error). Validated on a 40³ sphere: 4634 vertices, 100% outward
  normals, ~30 ms build time.
- `frontend/src/lib/particles.js`: GPU particle system using
  half-float ping-pong render targets, a fullscreen GLSL3 advect
  pass sampling a `Data3DTexture` carrying `(u, v, |vel|)`, and a
  `THREE.Points` render pass with per-vertex speed-tinted
  color and life-based fade. GLSL3 fragments declare their own
  `layout(location = 0) out vec4 outColor;` because Three r169
  does not inject the `gl_FragColor` compatibility define when
  `glslVersion === GLSL3`. 65 536 particles, respawning from a
  hashed random when life expires or they leave the volume.
- `OceanScene` integrates the isosurface as a `MeshStandardMaterial`
  with per-vertex palette color (depth gradient) and the particles
  as a child of `volumeGroup`. A "Fly-through" toggle in the
  control panel builds a `CatmullRomCurve3` through the volume at
  the current depth and animates the camera along it while
  disabling `OrbitControls`; exit restores the saved camera pose.
  A "Model − obs difference layer" toggle re-uses the
  `misfit` endpoint and recolors the markers through the
  diverging colormap centered on zero.

## File map (this session's work)

New files:
- `backend/app/adapters/observations.py` — provider + 3-tier fallback
- `frontend/src/lib/isosurface.js` — surface nets + analytic normals
- `frontend/src/lib/particles.js` — GPU advection system
- `frontend/src/components/ProfilePanel.jsx` — SVG profile chart
- `STATUS.md` — this file

Rewritten:
- `backend/app/api/routes.py` — added `/observations`, `/observations/{pid}`,
  `/datasets/{ds_id}/misfit`, `/datasets/{ds_id}/volume`
- `frontend/src/lib/api.js` — added `fetchObservations`,
  `fetchObservationDetail`, `fetchMisfit`, `fetchVolume` (with binary parser)
- `frontend/src/components/OceanScene.jsx` — fully restructured (groups, lights,
  markers, picking, isosurface, particles, fly-through, tooltips)
- `frontend/src/components/ControlPanel.jsx` — animation row, Analysis layers
  section (obs / diff / isosurface / particles / fly-through)
- `frontend/src/App.jsx` — all new state wiring + volume/misfit/profile caches
- `frontend/src/index.css` — styles for the new UI

Unchanged:
- `backend/app/adapters/{base,netcdf_adapter,zarr_adapter}.py`
- `backend/app/registry.py`
- `backend/scripts/make_sample_data.py`
- `docker-compose.yml`, `Dockerfile`, `requirements.txt`

## How to run

```bash
# Backend
.venv/bin/pip install -r backend/requirements.txt     # one time
.venv/bin/python backend/scripts/make_sample_data.py
cd backend && ../.venv/bin/uvicorn app.main:app --port 8000

# Frontend (new terminal)
cd frontend && npm install && npm run dev
# open http://localhost:5173
```

`argopy` is intentionally **not** a hard dependency. If you want live
ERDDAP Argo data, `pip install argopy` in the same venv and
restart the API — the provider will prefer cached results from
`backend/data/cache/argo_bob.nc` and fall back to the network.

## Verification evidence (last session)

- All backend endpoints respond with valid data:
  - `GET /api/observations` → 27 platforms (22 Argo + 5 gliders),
    source `synthetic`.
  - `GET /api/datasets/bob_synthetic.zarr/misfit?var=temperature&t=5&z=2`
    returns 27 features with `bias` ≈ -0.03 °C, sensible
    per-platform diffs in the order of 0.01–0.05 °C at 20 m.
  - `GET /api/datasets/bob_synthetic.zarr/volume?var=u&t=0`
    shape `[15, 81, 69]`, u range ±3.5 m/s.
- Surface nets validated on a 40³ sphere field: 100% outward
  analytic normals, 32 ms build.
- Headless browser render via Playwright + SwiftShader (`ANGLE /
  Vulkan / SwiftShader` GL stack) showed 27 marker sprites laid
  out over the Bay of Bengal grid; the marker click test hit
  `marker screen: {x: 661, y: 211}` and the play-button test
  advanced the time index from 1/30 to 3/30 within 3.5 s.

## Open issues (carry into next session)

1. **Slice plane reads as a flat dark surface in some browsers**
   even though the underlying `CanvasTexture` contains correctly
   filled pixels (confirmed via `getImageData`: mid-pixel
   `[252, 253, 160]`, corner `[247, 156, 29]`). The mesh is
   visible at `y = 0`, the texture is bound, the `MeshBasicMaterial`
   `map` is set, `DoubleSide` is enabled. Yet the GPU renders
   the area inside the frame as essentially black against the
   `#081120` background. To bisect next time: set
   `sliceMesh.material.map = null; material.color.set('#ff0000')`
   and re-render. If the plane turns red, the geometry and
   transforms are fine and the issue is in the
   `CanvasTexture` upload / `needsUpdate` lifecycle. If it stays
   black, something else is occluding or the mesh is being
   culled. (Note: a single round-trip `evaluate()` call that
   uses `gl.readPixels` ran out of arguments in the last session
   and needs the full 7-argument signature to actually
   bisect this — fix the readPixels call before re-bisecting.)

2. **One Vite warning** about chunk size > 500 kB (the
   Three.js + app bundle is 683 kB / 185 kB gzipped). Not
   blocking; address by code-splitting or pulling Three into
   its own manual chunk if it matters for first load.

3. **Particle shader normal `vec3` may need flipping.**
   The velocity-volume texture is laid out
   `data[i * nLat * nLon + j * nLon + k]` with `i` = depth,
   `j` = lat, `k` = lon; the shader's `uvw` is
   `(lonFrac, latFrac, depthFrac)` matching the `Data3DTexture`
   `width/height/depth` argument order. The component mapping
   `r = u, g = v, b = speed, a = 1` is set in
   `setField`. Verify the visual directionality matches the
   quiver arrows when QA-ing on a real device.

4. **Project-level `phase 45`** from the original request
   was interpreted as "phases 2, 3, 4, 5" but the README only
   defined phases 1–3. The implementation covers everything
   defined in the roadmap; nothing labelled "phase 4" or
   "phase 5" exists, so those numbers were treated as a typo
   and the session spent its effort finishing phases 2 and 3.
   If the user meant something else, ask before adding more.

5. **argopy is not in `requirements.txt`** to keep the default
   install light and fully offline. If the user wants the
   live ERDDAP path on by default, add `argopy` (and its
   transitive deps) to `backend/requirements.txt` and remove
   the lazy import.

6. **Dependency list intentionally minimal.** No new npm
   packages were added — the SVG profile chart and
   particle/iso renderers are all hand-rolled against `three`.

## Visual QA artifacts

The following screenshots were captured during the last
session's verification and are not committed (they were
`/tmp/qa1_base.png` etc. on the host). Recreate them with:

```bash
EXE="/Users/pranesh/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
node /var/folders/z3/rlq7cx6d5ml4k7yyp1gr50g80000gn/T/kilo/glqa/qa.mjs
```

(The QA script lives in the temp dir; copy it to the project
if you want it under version control.)
