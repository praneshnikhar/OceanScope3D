const BASE = '/api'

async function get(path) {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}

export const fetchHealth = () => get('/health')
export const fetchDatasets = () => get('/datasets')
export const fetchSlice = (ds, varName, t, z) =>
  get(`/datasets/${ds}/slice?var=${encodeURIComponent(varName)}&t=${t}&z=${z}`)
export const fetchProfile = (ds, varName, lat, lon, t) =>
  get(`/datasets/${ds}/profile?var=${encodeURIComponent(varName)}&lat=${lat}&lon=${lon}&t=${t}`)
export const fetchVectorField = (ds, t, z, stride = 4) =>
  get(`/datasets/${ds}/vector-field?t=${t}&z=${z}&stride=${stride}`)

export const fetchObservations = () => get('/observations')
export const fetchObservationDetail = (pid) => get(`/observations/${encodeURIComponent(pid)}`)
export const fetchMisfit = (ds, varName, t, z) =>
  get(`/datasets/${ds}/misfit?var=${encodeURIComponent(varName)}&t=${t}&z=${z}`)

/** Parses the binary volume blob: [u32 json_len][json][f32 field][f32 lat][f32 lon]. */
function parseVolume(buffer) {
  const view = new DataView(buffer)
  const n = view.getUint32(0, true)
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, n)))
  const [d, la, lo] = meta.shape
  let off = 4 + n
  const field = new Float32Array(buffer.slice(off, (off += d * la * lo * 4)))
  meta.data = field
  meta.lat = new Float32Array(buffer.slice(off, (off += la * 4)))
  meta.lon = new Float32Array(buffer.slice(off, (off += lo * 4)))
  return meta
}

export async function fetchVolume(ds, varName, t, strides = {}) {
  const q = new URLSearchParams({ var: varName, t: String(t) })
  if (strides.sd) q.set('sd', String(strides.sd))
  if (strides.slat) q.set('slat', String(strides.slat))
  if (strides.slon) q.set('slon', String(strides.slon))
  const res = await fetch(`${BASE}/datasets/${ds}/volume?${q}`)
  if (!res.ok) throw new Error(`volume: ${res.status}`)
  return parseVolume(await res.arrayBuffer())
}
