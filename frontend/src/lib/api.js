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
