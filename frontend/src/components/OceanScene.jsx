import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { colorFor, samplePalette } from '../lib/colormap'
import { extractIsosurface, toWorldGeometry } from '../lib/isosurface'
import { ParticleSystem } from '../lib/particles'

export const DEG = 12
export const DEPTH_SCALE = 0.055

function markerTexture(kind, { selected = false, color = null } = {}) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const main = color || (kind === 'argo' ? '#4fc3f7' : '#ffb74d')
  g.lineWidth = selected ? 7 : 4.5
  g.strokeStyle = selected ? '#ffe082' : main
  g.fillStyle = selected ? 'rgba(255,224,130,0.30)' : kind === 'argo' ? 'rgba(79,195,247,0.22)' : 'rgba(255,183,77,0.20)'
  g.beginPath()
  if (kind === 'argo') {
    g.arc(32, 32, 17, 0, Math.PI * 2)
  } else {
    g.moveTo(32, 10)
    g.lineTo(52, 50)
    g.lineTo(12, 50)
    g.closePath()
  }
  g.fill()
  g.stroke()
  g.fillStyle = main
  g.beginPath()
  g.arc(32, 32, 4.5, 0, Math.PI * 2)
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const texCache = new Map()
function getMarkerTex(key, build) {
  if (!texCache.has(key)) texCache.set(key, build())
  return texCache.get(key)
}

function disposeTexCache() {
  for (const t of texCache.values()) t.dispose()
  texCache.clear()
}

export default function OceanScene({
  slice,
  range,
  palette,
  exaggeration,
  vectorData,
  showVectors,
  obsPlatforms,
  showObs,
  selectedPlatform,
  onPickPlatform,
  diffFeatures,
  showDiff,
  volScalar,
  isoEnabled,
  isoLevel,
  volU,
  volV,
  particlesOn,
  flyActive,
  onFlyExit,
}) {
  const mountRef = useRef(null)
  const sceneRef = useRef(null)
  const markersRef = useRef(new Map())
  const [webglOk, setWebglOk] = useState(null)
  const [hover, setHover] = useState(null)

  // -- one-time scene setup -------------------------------------------------
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#081120')
    scene.fog = new THREE.Fog('#081120', 420, 900)

    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 2000)
    camera.position.set(0, 95, 215)

    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch (e) {
      setWebglOk(false)
      return
    }
    setWebglOk(true)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight('#8fb8d8', 1.1))
    const dir = new THREE.DirectionalLight('#ffffff', 1.5)
    dir.position.set(120, 180, 90)
    scene.add(dir)
    const dir2 = new THREE.DirectionalLight('#5f8fc9', 0.7)
    dir2.position.set(-140, -60, -110)
    scene.add(dir2)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, -25, 0)
    controls.maxDistance = 700
    controls.minDistance = 40

    const oceanGroup = new THREE.Group()
    const dataGroup = new THREE.Group()
    const obsGroup = new THREE.Group()
    const volumeGroup = new THREE.Group()
    scene.add(oceanGroup, dataGroup, obsGroup, volumeGroup)

    const gridMat = new THREE.LineBasicMaterial({ color: '#24405c', transparent: true, opacity: 0.55 })
    const frameMat = new THREE.LineBasicMaterial({ color: '#3f6f9c' })
    const floorMat = new THREE.MeshBasicMaterial({ color: '#10233a', transparent: true, opacity: 0.92 })

    const sliceCanvas = document.createElement('canvas')
    sliceCanvas.width = 2
    sliceCanvas.height = 2
    const sliceTexture = new THREE.CanvasTexture(sliceCanvas)
    sliceTexture.magFilter = THREE.LinearFilter
    sliceTexture.minFilter = THREE.LinearFilter
    const sliceMat = new THREE.MeshBasicMaterial({ map: sliceTexture, side: THREE.DoubleSide, toneMapped: false })
    const sliceMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sliceMat)
    dataGroup.add(sliceMesh)

    const quiverMat = new THREE.LineBasicMaterial({ color: '#86e3ff', transparent: true, opacity: 0.85 })
    const quiverLines = new THREE.LineSegments(new THREE.BufferGeometry(), quiverMat)
    dataGroup.add(quiverLines)

    const isoMat = new THREE.MeshStandardMaterial({
      color: '#bde8ff',
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      roughness: 0.55,
      metalness: 0.1,
      depthWrite: false,
    })
    const isoMesh = new THREE.Mesh(new THREE.BufferGeometry(), isoMat)
    isoMesh.visible = false
    volumeGroup.add(isoMesh)

    let particles = null
    try {
      particles = new ParticleSystem(renderer, { res: 256 })
      volumeGroup.add(particles.points)
    } catch (e) {
      particles = null
    }

    // fly-through state
    const fly = { active: false, t: 0, curve: null, savedCam: null, savedTarget: null }

    sceneRef.current = {
      scene, camera, renderer, controls,
      oceanGroup, dataGroup, obsGroup, volumeGroup,
      gridMat, frameMat, floorMat,
      sliceMesh, sliceCanvas, sliceTexture, quiverLines,
      isoMesh, particles, fly,
    }

    const clock = new THREE.Clock()
    let raf
    const animate = () => {
      raf = requestAnimationFrame(animate)
      const dt = clock.getDelta()

      if (fly.active && fly.curve) {
        fly.t = (fly.t + dt * 0.03) % 1
        const p = fly.curve.getPointAt(fly.t)
        const ahead = fly.curve.getPointAt((fly.t + 0.02) % 1)
        camera.position.copy(p)
        ahead.y -= 14
        camera.lookAt(ahead)
      } else {
        controls.update()
      }
      if (particles && particles.points.visible) particles.update(dt)
      renderer.render(scene, camera)
    }
    animate()

    const dom = renderer.domElement
    let downXY = null

    const pick = (ev) => {
      const r = dom.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        -((ev.clientY - r.top) / r.height) * 2 + 1
      )
      const rc = new THREE.Raycaster()
      rc.params.Points = { threshold: 6 }
      rc.setFromCamera(ndc, camera)
      const sprites = [...markersRef.current.values()]
      const hits = rc.intersectObjects(sprites, false)
      return hits.length ? hits[0].object.userData.pid : null
    }

    const onDown = (ev) => { downXY = [ev.clientX, ev.clientY] }
    const onUp = (ev) => {
      if (!downXY) return
      const moved = Math.hypot(ev.clientX - downXY[0], ev.clientY - downXY[1])
      downXY = null
      if (moved > 6) return
      onPickPlatform?.(pick(ev))
    }
    const onMove = (ev) => {
      const pid = pick(ev)
      dom.style.cursor = pid ? 'pointer' : 'default'
      if (pid) {
        const plat = markersRef.current.get(pid)
        if (plat) {
          const p = plat.position.clone().project(camera)
          const r = dom.getBoundingClientRect()
          setHover({
            pid,
            x: ((p.x + 1) / 2) * r.width,
            y: ((-p.y + 1) / 2) * r.height,
          })
          return
        }
      }
      setHover(null)
    }
    dom.addEventListener('pointerdown', onDown)
    dom.addEventListener('pointerup', onUp)
    dom.addEventListener('pointermove', onMove)

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      if (particles) particles.pointsMat.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('pointerup', onUp)
      dom.removeEventListener('pointermove', onMove)
      controls.dispose()
      particles?.dispose()
      sliceTexture.dispose()
      sliceMat.dispose()
      sliceMesh.geometry.dispose()
      quiverMat.dispose()
      quiverLines.geometry.dispose()
      isoMat.dispose()
      isoMesh.geometry.dispose()
      gridMat.dispose()
      frameMat.dispose()
      floorMat.dispose()
      oceanGroup.traverse((o) => o.geometry && o.geometry.dispose())
      disposeTexCache()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      sceneRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -- slice plane / static box ---------------------------------------------
  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx || !slice) return
    const { oceanGroup } = ctx

    oceanGroup.traverse((o) => {
      if (o.userData.isStatic) o.geometry.dispose()
    })
    oceanGroup.clear()

    const lons = slice.lon
    const lats = slice.lat
    const lonSpan = lons[lons.length - 1] - lons[0]
    const latSpan = lats[lats.length - 1] - lats[0]
    const W = lonSpan * DEG
    const H = latSpan * DEG

    const points = []
    for (let j = 0; j <= 10; j++) {
      const lat = lats[0] + (latSpan * j) / 10
      points.push([-W / 2, 0, -((lat - lats[0]) * DEG - H / 2)], [W / 2, 0, -((lat - lats[0]) * DEG - H / 2)])
    }
    for (let i = 0; i <= 10; i++) {
      const lon = lons[0] + (lonSpan * i) / 10
      points.push([(lon - lons[0]) * DEG - W / 2, 0, -H / 2], [(lon - lons[0]) * DEG - W / 2, 0, H / 2])
    }
    const gridGeo = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)))
    const grid = new THREE.LineSegments(gridGeo, ctx.gridMat)
    grid.userData.isStatic = true
    oceanGroup.add(grid)

    const frameGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-W / 2, 0, -H / 2),
      new THREE.Vector3(W / 2, 0, -H / 2),
      new THREE.Vector3(W / 2, 0, H / 2),
      new THREE.Vector3(-W / 2, 0, H / 2),
      new THREE.Vector3(-W / 2, 0, -H / 2),
    ])
    const frame = new THREE.Line(frameGeo, ctx.frameMat)
    frame.userData.isStatic = true
    oceanGroup.add(frame)

    const maxDepth = slice.depth !== null ? slice.depth : 0
    const floorDepth = Math.max(maxDepth, 2000)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), ctx.floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, -floorDepth * DEPTH_SCALE, 0)
    floor.userData.isStatic = true
    oceanGroup.add(floor)

    const nLat = lats.length
    const nLon = lons.length
    const canvas = ctx.sliceCanvas
    canvas.width = nLon
    canvas.height = nLat
    const cctx = canvas.getContext('2d')
    const img = cctx.createImageData(nLon, nLat)
    for (let j = 0; j < nLat; j++) {
      const rowY = nLat - 1 - j
      for (let i = 0; i < nLon; i++) {
        const rgb = colorFor(palette, slice.values[j][i], range.min, range.max)
        const idx = (rowY * nLon + i) * 4
        if (rgb === null) {
          img.data[idx] = 8
          img.data[idx + 1] = 17
          img.data[idx + 2] = 32
          img.data[idx + 3] = 255
        } else {
          img.data[idx] = rgb[0]
          img.data[idx + 1] = rgb[1]
          img.data[idx + 2] = rgb[2]
          img.data[idx + 3] = 255
        }
      }
    }
    cctx.putImageData(img, 0, 0)
    ctx.sliceTexture.needsUpdate = true

    ctx.sliceMesh.geometry.dispose()
    ctx.sliceMesh.geometry = new THREE.PlaneGeometry(W, H)
    ctx.sliceMesh.rotation.x = -Math.PI / 2
    ctx.sliceMesh.position.set(0, -(slice.depth ?? 0) * DEPTH_SCALE, 0)
  }, [slice, range.min, range.max, palette])

  // -- vertical exaggeration --------------------------------------------------
  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx) return
    ctx.oceanGroup.scale.y = exaggeration
    ctx.dataGroup.scale.y = exaggeration
    ctx.obsGroup.scale.y = exaggeration
    ctx.volumeGroup.scale.y = exaggeration
  }, [exaggeration])

  // -- current vectors ---------------------------------------------------------
  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx) return
    const { quiverLines } = ctx
    quiverLines.geometry.dispose()
    if (!showVectors || !vectorData) {
      quiverLines.geometry = new THREE.BufferGeometry()
      return
    }

    const lats = vectorData.lat
    const lons = vectorData.lon
    const lonSpan = lons[lons.length - 1] - lons[0]
    const latSpan = lats[lats.length - 1] - lats[0]
    const W = lonSpan * DEG
    const H = latSpan * DEG
    const verts = []
    for (let j = 0; j < lats.length; j++) {
      for (let i = 0; i < lons.length; i++) {
        const u = vectorData.magnitude[j][i] * Math.cos(vectorData.direction_rad[j][i])
        const v = vectorData.magnitude[j][i] * Math.sin(vectorData.direction_rad[j][i])
        const x = (lons[i] - lons[0]) * DEG - W / 2
        const z = -(lats[j] - lats[0]) * DEG + H / 2
        const y = -((vectorData.depth ?? 0) * DEPTH_SCALE) + 1.2
        verts.push(x, y, z, x + u * 14, y, z + v * 14)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    quiverLines.geometry = geo
  }, [vectorData, showVectors])

  // -- observation markers ------------------------------------------------------
  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx) return
    const { obsGroup } = ctx

    for (const s of markersRef.current.values()) {
      obsGroup.remove(s)
      s.material.dispose()
    }
    markersRef.current.clear()
    if (!showObs || !obsPlatforms?.length) return

    const diffById = new Map((diffFeatures ?? []).map((f) => [f.id, f]))
    const maxAbs = Math.max(
      1e-6,
      ...(diffFeatures ?? []).map((f) => Math.abs(f.diff))
    )

    for (const p of obsPlatforms) {
      const feat = showDiff ? diffById.get(p.id) : null
      let color = null
      if (feat) {
        const frac = 0.5 + feat.diff / (2 * maxAbs)
        const [r, g, b] = samplePalette('diverging', frac)
        color = `rgb(${r},${g},${b})`
      }
      const key = `${p.type}|${selectedPlatform === p.id}|${color ?? 'base'}`
      const mat = new THREE.SpriteMaterial({
        map: getMarkerTex(key, () => markerTexture(p.type, { selected: selectedPlatform === p.id, color })),
        transparent: true,
        depthTest: false,
      })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.setScalar(selectedPlatform === p.id ? 9 : 7)
      sprite.userData.pid = p.id
      sprite.userData.platform = p
      markersRef.current.set(p.id, sprite)
      obsGroup.add(sprite)
    }
  }, [obsPlatforms, showObs, selectedPlatform, diffFeatures, showDiff])

  // marker positions track animation time
  useEffect(() => {
    if (!slice) return
    const when = slice.time ? Date.parse(slice.time) : NaN
    for (const [, sprite] of markersRef.current) {
      const p = sprite.userData.platform
      let cyc = p.track[0]
      if (!Number.isNaN(when)) {
        for (const c of p.track) {
          if (Date.parse(c.time) <= when) cyc = c
          else break
        }
      }
      const lonSpan = slice.lon[slice.lon.length - 1] - slice.lon[0]
      const latSpan = slice.lat[slice.lat.length - 1] - slice.lat[0]
      const W = lonSpan * DEG
      const H = latSpan * DEG
      sprite.position.set(
        (cyc.lon - slice.lon[0]) * DEG - W / 2,
        2.5,
        -(cyc.lat - slice.lat[0]) * DEG + H / 2
      )
      sprite.visible = true
    }
  }, [slice, obsPlatforms, showObs, markersRef])

  // -- isosurface ----------------------------------------------------------------
  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx || !volScalar) return
    const { isoMesh } = ctx

    if (!isoEnabled) {
      isoMesh.visible = false
      return
    }
    const timer = setTimeout(() => {
      const [d, la, lo] = volScalar.shape
      const data = volScalar.data
      const [gmin, gmax] = volScalar.global_range
      const level = gmin + isoLevel * (gmax - gmin)
      const raw = extractIsosurface(data, [d, la, lo], level)
      if (!raw.positions.length) {
        isoMesh.visible = false
        return
      }
      const W = (volScalar.lon[lo - 1] - volScalar.lon[0]) * DEG
      const H = (volScalar.lat[la - 1] - volScalar.lat[0]) * DEG
      const fx = (k) => (k / (lo - 1)) * W - W / 2
      const fy = (i) => -volScalar.depth[Math.round(Math.min(d - 1, i))] * DEPTH_SCALE
      const fz = (j) => -(j / (la - 1)) * H + H / 2
      const built = toWorldGeometry(raw, fx, fy, fz, { data, dims: [d, la, lo] })

      const colors = new Float32Array(built.world.length)
      const dmax = Math.max(volScalar.depth[d - 1], 1)
      for (let v = 0; v < built.world.length / 3; ++v) {
        const depthVal = -built.world[v * 3 + 1] / DEPTH_SCALE
        const [r, g, b] = samplePalette(palette, 1 - depthVal / dmax)
        colors[v * 3] = r / 255
        colors[v * 3 + 1] = g / 255
        colors[v * 3 + 2] = b / 255
      }

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(built.world, 3))
      geo.setAttribute('normal', new THREE.BufferAttribute(built.normals, 3))
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      geo.setIndex(new THREE.BufferAttribute(built.indices, 1))

      isoMesh.geometry.dispose()
      isoMesh.geometry = geo
      isoMesh.visible = true
    }, 120)
    return () => clearTimeout(timer)
  }, [volScalar, isoEnabled, isoLevel, palette])

  // -- GPU particles -----------------------------------------------------------
  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx || !ctx.particles) return
    const ps = ctx.particles
    if (!particlesOn || !volU || !volV) {
      ps.points.visible = false
      return
    }
    ps.setField(volU, volV, {
      W: (volU.lon[volU.lon.length - 1] - volU.lon[0]) * DEG,
      H: (volU.lat[volU.lat.length - 1] - volU.lat[0]) * DEG,
      maxDepthWorld: Math.max(...volU.depth) * DEPTH_SCALE,
    })
    ps.points.visible = true
  }, [volU, volV, particlesOn])

  // -- fly-through camera ---------------------------------------------------------
  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx || !slice) return
    const { fly, camera, controls } = ctx

    if (flyActive) {
      const lonSpan = slice.lon[slice.lon.length - 1] - slice.lon[0]
      const latSpan = slice.lat[slice.lat.length - 1] - slice.lat[0]
      const W = lonSpan * DEG
      const H = latSpan * DEG
      const y = -(slice.depth != null ? Math.max(slice.depth, 60) : 60) * DEPTH_SCALE
      fly.curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-W * 0.46, y, -H * 0.28),
        new THREE.Vector3(-W * 0.18, y * 0.55, H * 0.22),
        new THREE.Vector3(W * 0.16, y * 0.85, -H * 0.26),
        new THREE.Vector3(W * 0.44, y * 0.45, H * 0.24),
      ], true, 'catmullrom', 0.6)
      if (!fly.active) {
        fly.savedCam = camera.position.clone()
        fly.savedTarget = controls.target.clone()
      }
      fly.active = true
      fly.t = 0
      controls.enabled = false
    } else if (fly.active) {
      fly.active = false
      controls.enabled = true
      if (fly.savedCam) {
        camera.position.copy(fly.savedCam)
        controls.target.copy(fly.savedTarget)
      }
      onFlyExit?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyActive, slice])

  const hoverPlat = hover && obsPlatforms?.find((p) => p.id === hover.pid)
  const hoverFeat = hover && diffFeatures?.find((f) => f.id === hover.pid)

  if (webglOk === false) {
    return (
      <div className="webgl-fallback">
        WebGL is unavailable in this browser, so the 3D scene cannot render.
        Data and controls still work through the API.
      </div>
    )
  }

  return (
    <>
      <div ref={mountRef} className="scene-mount" />
      {hoverPlat && (
        <div className="marker-tip" style={{ left: hover.x, top: hover.y }}>
          <div className="tip-id">{hoverPlat.id}</div>
          <div className="tip-kind">{hoverPlat.type}</div>
          {hoverFeat && (
            <div className="tip-diff">
              obs {hoverFeat.obs} · model {hoverFeat.model}
              <br />
              Δ {hoverFeat.diff > 0 ? '+' : ''}{hoverFeat.diff}
            </div>
          )}
          {!hoverFeat && <div className="tip-hint">click for profile</div>}
        </div>
      )}
    </>
  )
}
