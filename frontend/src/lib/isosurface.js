/**
 * Isosurface extraction via naive surface nets.
 *
 * `data` is a Float32Array laid out [i * ny * nz + j * nz + k] with logical
 * dims [nx, ny, nz] (i → depth rows, j → lat rows, k → lon columns).
 *
 * extractIsosurface() returns positions in grid-index space plus quad-derived
 * triangle indices. toWorldGeometry() maps vertices through axis-wise linear
 * mappers and computes smooth normals in world space.
 */

const CUBE_EDGES = new Int32Array([
  0, 1, 0, 2, 0, 4, 1, 3, 1, 5, 2, 3, 2, 6, 3, 7, 4, 5, 4, 6, 5, 7, 6, 7,
])

const EDGE_TABLE = (() => {
  // For each corner mask, which of the 12 cube edges cross the level
  // (exactly one endpoint above).
  const t = new Int32Array(256)
  for (let m = 0; m < 256; ++m) {
    let em = 0
    for (let e = 0; e < 12; ++e) {
      const aIn = m & (1 << CUBE_EDGES[2 * e])
      const cIn = m & (1 << CUBE_EDGES[2 * e + 1])
      if (!aIn !== !cIn) em |= 1 << e
    }
    t[m] = em
  }
  return t
})()

export function extractIsosurface(data, dims, level) {
  const [nx, ny, nz] = dims
  const strideJ = nz
  const strideI = ny * nz
  const nCell = Math.max(0, (nx - 1) * (ny - 1) * (nz - 1))
  const cellVert = new Int32Array(nCell).fill(-1)
  const posList = []
  const grid = new Float32Array(8)

  const cornerVal = (i, j, k, b) =>
    data[(i + (b & 1)) * strideI + (j + ((b >> 1) & 1)) * strideJ + k + ((b >> 2) & 1)]

  for (let i = 0; i < nx - 1; ++i) {
    for (let j = 0; j < ny - 1; ++j) {
      for (let k = 0; k < nz - 1; ++k) {
        let mask = 0
        for (let b = 0; b < 8; ++b) {
          grid[b] = cornerVal(i, j, k, b)
          if (grid[b] > level) mask |= 1 << b
        }
        if (mask === 0 || mask === 255) continue

        let px = 0
        let py = 0
        let pz = 0
        let cnt = 0
        const em = EDGE_TABLE[mask]
        for (let e = 0; e < 12; ++e) {
          if (!(em & (1 << e))) continue
          const a = CUBE_EDGES[2 * e]
          const c = CUBE_EDGES[2 * e + 1]
          const t = (level - grid[a]) / (grid[c] - grid[a])
          px += (a & 1) + ((c & 1) - (a & 1)) * t
          py += ((a >> 1) & 1) + (((c >> 1) & 1) - ((a >> 1) & 1)) * t
          pz += ((a >> 2) & 1) + (((c >> 2) & 1) - ((a >> 2) & 1)) * t
          cnt++
        }
        cellVert[i * (ny - 1) * (nz - 1) + j * (nz - 1) + k] = posList.length / 3
        posList.push(i + px / cnt, j + py / cnt, k + pz / cnt)
      }
    }
  }

  const vertAt = (i, j, k) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) return -1
    return cellVert[i * (ny - 1) * (nz - 1) + j * (nz - 1) + k]
  }

  const indices = []
  for (let i = 0; i < nx - 1; ++i) {
    for (let j = 0; j < ny - 1; ++j) {
      for (let k = 0; k < nz - 1; ++k) {
        const cv = vertAt(i, j, k)
        if (cv < 0) continue

        let mask = 0
        for (let b = 0; b < 8; ++b) if (cornerVal(i, j, k, b) > level) mask |= 1 << b

        // one axis edge per d, rooted at corner 0 of this cell
        for (let d = 0; d < 3; ++d) {
          const insideA = mask & 1
          const insideB =
            d === 0 ? mask & 2 : d === 1 ? mask & 4 : mask & 8
          if (!insideA === !insideB) continue

          const u = (d + 1) % 3
          const w = (d + 2) % 3
          const cu = [i, j, k]
          const lu = cu[u] > 0 ? cu[u] - 1 : cu[u]
          const lw = cu[w] > 0 ? cu[w] - 1 : cu[w]
          const mk = (a, b) => {
            const c = [i, j, k]
            c[u] = a
            c[w] = b
            return vertAt(c[0], c[1], c[2])
          }
          const q = [mk(lu, lw), mk(lu + 1, lw), mk(lu + 1, lw + 1), mk(lu, lw + 1)]
          if (q.some((x) => x < 0)) continue
          if (!insideA) indices.push(q[0], q[2], q[1], q[0], q[3], q[2])
          else indices.push(q[0], q[1], q[2], q[0], q[2], q[3])
        }
      }
    }
  }

  return { positions: new Float32Array(posList), indices: new Uint32Array(indices) }
}

/**
 * Builds a world-space geometry: maps each grid-index position through
 * mi/mj/mk (index float → world coordinate). When `grad` ({data, dims}) is
 * supplied, normals are analytic field gradients (outward = toward lower
 * values); otherwise face-accumulated smooth normals are used.
 */
export function toWorldGeometry(extracted, mi, mj, mk, grad) {
  const { positions, indices } = extracted
  const n = positions.length / 3
  const world = new Float32Array(n * 3)
  for (let v = 0; v < n; ++v) {
    world[v * 3] = mi(positions[v * 3])
    world[v * 3 + 1] = mj(positions[v * 3 + 1])
    world[v * 3 + 2] = mk(positions[v * 3 + 2])
  }

  if (!grad) {
    const normals = new Float32Array(n * 3)
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3
      const b = indices[t + 1] * 3
      const c = indices[t + 2] * 3
      const cbx = world[c] - world[b],
        cby = world[c + 1] - world[b + 1],
        cbz = world[c + 2] - world[b + 2]
      const abx = world[a] - world[b],
        aby = world[a + 1] - world[b + 1],
        abz = world[a + 2] - world[b + 2]
      const nxv = cby * abz - cbz * aby
      const nyv = cbz * abx - cbx * abz
      const nzv = cbx * aby - cby * abx
      for (const o of [a, b, c]) {
        normals[o] += nxv
        normals[o + 1] += nyv
        normals[o + 2] += nzv
      }
    }
    for (let v = 0; v < n; ++v) {
      const l = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1
      normals[v * 3] /= l
      normals[v * 3 + 1] /= l
      normals[v * 3 + 2] /= l
    }
    return { world, normals, indices }
  }

  const [nx, ny, nz] = grad.dims
  const { data } = grad
  const smp = (i, j, k) => {
    const ci = Math.min(nx - 1, Math.max(0, Math.round(i)))
    const cj = Math.min(ny - 1, Math.max(0, Math.round(j)))
    const ck = Math.min(nz - 1, Math.max(0, Math.round(k)))
    return data[ci * ny * nz + cj * nz + ck]
  }
  const ai = mi(1) - mi(0) || 1
  const aj = mj(1) - mj(0) || 1
  const ak = mk(1) - mk(0) || 1
  const normals = new Float32Array(n * 3)
  for (let v = 0; v < n; ++v) {
    const x = positions[v * 3]
    const y = positions[v * 3 + 1]
    const z = positions[v * 3 + 2]
    const gx = (smp(x + 1, y, z) - smp(x - 1, y, z)) / (2 * ai)
    const gy = (smp(x, y + 1, z) - smp(x, y - 1, z)) / (2 * aj)
    const gz = (smp(x, y, z + 1) - smp(x, y, z - 1)) / (2 * ak)
    const l = Math.hypot(gx, gy, gz) || 1
    normals[v * 3] = -gx / l
    normals[v * 3 + 1] = -gy / l
    normals[v * 3 + 2] = -gz / l
  }
  return { world, normals, indices }
}
