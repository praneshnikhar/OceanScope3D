import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { colorFor } from '../lib/colormap'

const DEG = 12
const DEPTH_SCALE = 0.055

export default function OceanScene({ slice, range, palette, exaggeration, vectorData, showVectors }) {
  const mountRef = useRef(null)
  const sceneRef = useRef(null)
  const [webglOk, setWebglOk] = useState(null)

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

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, -25, 0)
    controls.maxDistance = 700
    controls.minDistance = 40

    const oceanGroup = new THREE.Group()
    scene.add(oceanGroup)

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

    const quiverMat = new THREE.LineBasicMaterial({ color: '#86e3ff', transparent: true, opacity: 0.85 })
    let quiverLines = new THREE.LineSegments(new THREE.BufferGeometry(), quiverMat)

    scene.add(sliceMesh)
    scene.add(quiverLines)

    sceneRef.current = { scene, camera, renderer, controls, oceanGroup, gridMat, frameMat, floorMat, sliceMesh, sliceCanvas, sliceTexture, quiverLines }

    let raf
    const animate = () => {
      raf = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      sliceTexture.dispose()
      sliceMat.dispose()
      sliceMesh.geometry.dispose()
      quiverMat.dispose()
      quiverLines.geometry.dispose()
      gridMat.dispose()
      frameMat.dispose()
      floorMat.dispose()
      oceanGroup.traverse((o) => o.geometry && o.geometry.dispose())
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      sceneRef.current = null
    }
  }, [])

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
    const stepLon = Math.max(1, Math.round(lons.length / 10))
    const stepLat = Math.max(1, Math.round(lats.length / 10))
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

  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx) return
    ctx.oceanGroup.scale.y = exaggeration
  }, [exaggeration])

  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx) return
    const { quiverLines } = ctx
    quiverLines.geometry.dispose()
    if (!showVectors || !vectorData) return

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
        const x = lons[i] * DEG - W / 2
        const z = -(lats[j] * DEG - H / 2)
        const y = -((vectorData.depth ?? 0) * DEPTH_SCALE) + 1.2
        verts.push(x, y, z, x + u * 14, y, z + v * 14)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    quiverLines.geometry = geo
  }, [vectorData, showVectors])

  if (webglOk === false) {
    return (
      <div className="webgl-fallback">
        WebGL is unavailable in this browser, so the 3D scene cannot render.
        Data and controls still work through the API.
      </div>
    )
  }

  return <div ref={mountRef} className="scene-mount" />
}
