import { useEffect, useMemo, useRef, useState } from 'react'
import OceanScene from './components/OceanScene'
import ControlPanel from './components/ControlPanel'
import LegendBar from './components/LegendBar'
import ProfilePanel from './components/ProfilePanel'
import {
  fetchDatasets,
  fetchSlice,
  fetchVectorField,
  fetchObservations,
  fetchObservationDetail,
  fetchMisfit,
  fetchProfile,
  fetchVolume,
} from './lib/api'
import { PALETTE_NAMES } from './lib/colormap'

function nearestCycle(cycles, isoTime) {
  if (!cycles?.length) return null
  if (!isoTime) return cycles[cycles.length - 1]
  const target = Date.parse(isoTime)
  let best = cycles[0]
  let bestD = Infinity
  for (const c of cycles) {
    const d = Math.abs(Date.parse(c.time) - target)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

export default function App() {
  const [datasets, setDatasets] = useState([])
  const [meta, setMeta] = useState(null)
  const [dsId, setDsId] = useState('')
  const [varName, setVarName] = useState('')
  const [tIdx, setTIdx] = useState(0)
  const [zIdx, setZIdx] = useState(0)
  const [exaggeration, setExaggeration] = useState(3)
  const [palette, setPalette] = useState('thermal')
  const [showVectors, setShowVectors] = useState(false)
  const [vectorData, setVectorData] = useState(null)
  const [slice, setSlice] = useState(null)
  const [rangeOverride, setRangeOverride] = useState(null)
  const [autoMode, setAutoMode] = useState('global')
  const [error, setError] = useState('')

  // phase 2: animation + observations
  const [playing, setPlaying] = useState(false)
  const [playMs, setPlayMs] = useState(1000)
  const [obsSource, setObsSource] = useState(null)
  const [obsPlatforms, setObsPlatforms] = useState([])
  const [showObs, setShowObs] = useState(true)
  const [selectedPlatform, setSelectedPlatform] = useState(null)
  const [platformDetail, setPlatformDetail] = useState(null)
  const [profileModel, setProfileModel] = useState(null)
  const [showDiff, setShowDiff] = useState(false)
  const [misfit, setMisfit] = useState(null)

  // phase 3: volume layers + camera
  const [isoEnabled, setIsoEnabled] = useState(false)
  const [isoLevel, setIsoLevel] = useState(0.62)
  const [particlesOn, setParticlesOn] = useState(false)
  const [flyActive, setFlyActive] = useState(false)
  const [volScalar, setVolScalar] = useState(null)
  const [volU, setVolU] = useState(null)
  const [volV, setVolV] = useState(null)

  const volCache = useRef(new Map())

  const variables = meta?.variables ?? []
  const timeCount = meta?.dims?.time ?? 1

  useEffect(() => {
    fetchDatasets()
      .then((list) => {
        if (!list.length) throw new Error('no datasets in backend/data — run make_sample_data.py')
        setDatasets(list)
        setDsId(list[0].id)
        const pref = list[0].variables.find((v) => v.name === 'temperature') || list[0].variables[0]
        setVarName(pref.name)
        setMeta(list[0])
      })
      .catch((e) => setError(String(e.message)))
    fetchObservations()
      .then((obs) => {
        setObsSource(obs.source)
        setObsPlatforms(obs.platforms ?? [])
        if (!obs.platforms?.length) setShowObs(false)
      })
      .catch(() => setObsSource('none'))
  }, [])

  useEffect(() => {
    const m = datasets.find((d) => d.id === dsId)
    if (!m) return
    setMeta(m)
    setZIdx(0)
    setTIdx(0)
    setRangeOverride(null)
    setSelectedPlatform(null)
    setFlyActive(false)
    if (!m.variables.some((v) => v.name === varName)) {
      const pref = m.variables.find((v) => v.name === 'temperature') || m.variables[0]
      setVarName(pref.name)
    }
  }, [dsId])

  useEffect(() => {
    if (!dsId || !varName) return
    let alive = true
    fetchSlice(dsId, varName, tIdx, zIdx)
      .then((s) => alive && setSlice(s))
      .catch((e) => alive && setError(String(e.message)))
    return () => {
      alive = false
    }
  }, [dsId, varName, tIdx, zIdx])

  useEffect(() => {
    if (!showVectors || !dsId) {
      setVectorData(null)
      return
    }
    let alive = true
    fetchVectorField(dsId, tIdx, zIdx, 4)
      .then((v) => alive && setVectorData(v))
      .catch(() => alive && setVectorData(null))
    return () => {
      alive = false
    }
  }, [showVectors, dsId, tIdx, zIdx])

  // time-step animation
  useEffect(() => {
    if (!playing || timeCount < 2) return undefined
    const iv = setInterval(() => setTIdx((t) => (t + 1) % timeCount), playMs)
    return () => clearInterval(iv)
  }, [playing, playMs, timeCount])

  // model-vs-obs misfit layer
  useEffect(() => {
    if (!showDiff || !dsId || !['temperature', 'salinity'].includes(varName)) {
      setMisfit(null)
      return
    }
    let alive = true
    fetchMisfit(dsId, varName, tIdx, zIdx)
      .then((m) => alive && setMisfit(m))
      .catch(() => alive && setMisfit(null))
    return () => {
      alive = false
    }
  }, [showDiff, dsId, varName, tIdx, zIdx])

  // click-to-profile: platform detail + colocated model profile
  useEffect(() => {
    if (!selectedPlatform) {
      setPlatformDetail(null)
      setProfileModel(null)
      return
    }
    let alive = true
    fetchObservationDetail(selectedPlatform)
      .then(async (detail) => {
        if (!alive) return
        setPlatformDetail(detail)
        const cyc = nearestCycle(detail.cycles, slice?.time)
        if (!cyc) return
        try {
          const mp = await fetchProfile(dsId, varName, cyc.lat, cyc.lon, tIdx)
          if (alive) setProfileModel(mp)
        } catch {
          if (alive) setProfileModel(null)
        }
      })
      .catch(() => alive && setSelectedPlatform(null))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlatform, dsId, varName, tIdx, slice?.time])

  // volume fetches (isosurface scalar field)
  useEffect(() => {
    if (!isoEnabled || !dsId || !varName) {
      setVolScalar(null)
      return
    }
    const key = `s|${dsId}|${varName}|${tIdx}`
    const hit = volCache.current.get(key)
    if (hit) {
      setVolScalar(hit)
      return
    }
    let alive = true
    fetchVolume(dsId, varName, tIdx, { slat: 2, slon: 2 })
      .then((v) => {
        volCache.current.set(key, v)
        if (volCache.current.size > 80) volCache.current.delete(volCache.current.keys().next().value)
        if (alive) setVolScalar(v)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [isoEnabled, dsId, varName, tIdx])

  // volume fetches (particle velocity fields)
  useEffect(() => {
    if (!particlesOn || !dsId) {
      setVolU(null)
      setVolV(null)
      return
    }
    let alive = true
    const load = async (v) => {
      const key = `s|${dsId}|${v}|${tIdx}`
      if (volCache.current.has(key)) return volCache.current.get(key)
      const vol = await fetchVolume(dsId, v, tIdx, { slat: 2, slon: 2 })
      volCache.current.set(key, vol)
      if (volCache.current.size > 80) volCache.current.delete(volCache.current.keys().next().value)
      return vol
    }
    Promise.all([load('u'), load('v')])
      .then(([u, v]) => {
        if (alive) {
          setVolU(u)
          setVolV(v)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [particlesOn, dsId, tIdx])

  const range = useMemo(() => {
    if (rangeOverride) return rangeOverride
    if (!slice) return { min: 0, max: 1 }
    if (autoMode === 'slice') return { min: slice.slice_range.p2, max: slice.slice_range.p98 }
    return { min: slice.range.global_min, max: slice.range.global_max }
  }, [slice, autoMode, rangeOverride])

  const activeCycle = platformDetail ? nearestCycle(platformDetail.cycles, slice?.time) : null
  const isoValue = volScalar
    ? volScalar.global_range[0] + isoLevel * (volScalar.global_range[1] - volScalar.global_range[0])
    : null

  return (
    <div className="app">
      <ControlPanel
        datasets={datasets}
        dsId={dsId}
        onDataset={setDsId}
        variables={variables}
        varName={varName}
        onVar={(v) => {
          setVarName(v)
          setRangeOverride(null)
        }}
        timeCount={timeCount}
        tIdx={tIdx}
        onTime={setTIdx}
        depthValues={meta?.depth_values ?? []}
        zIdx={zIdx}
        onDepth={setZIdx}
        exaggeration={exaggeration}
        onExaggeration={setExaggeration}
        palettes={PALETTE_NAMES}
        palette={palette}
        onPalette={setPalette}
        showVectors={showVectors}
        onShowVectors={setShowVectors}
        sliceInfo={slice}
        onAutoRange={(mode) => {
          setRangeOverride(null)
          setAutoMode(mode)
        }}
        playing={playing}
        onPlaying={setPlaying}
        playMs={playMs}
        onPlayMs={setPlayMs}
        obsSource={obsSource}
        showObs={showObs}
        onShowObs={setShowObs}
        showDiff={showDiff}
        onShowDiff={setShowDiff}
        misfitStats={misfit?.stats}
        isoEnabled={isoEnabled}
        onIsoEnabled={setIsoEnabled}
        isoLevel={isoLevel}
        onIsoLevel={setIsoLevel}
        isoValue={isoValue}
        particlesOn={particlesOn}
        onParticlesOn={setParticlesOn}
        flyActive={flyActive}
        onFlyActive={setFlyActive}
      />

      <main className="stage">
        {error && <div className="error-banner">{error}</div>}
        {!error && !slice && <div className="loading">loading ocean field…</div>}
        <OceanScene
          slice={slice}
          range={range}
          palette={palette}
          exaggeration={exaggeration}
          vectorData={vectorData}
          showVectors={showVectors}
          obsPlatforms={obsPlatforms}
          showObs={showObs}
          selectedPlatform={selectedPlatform}
          onPickPlatform={setSelectedPlatform}
          diffFeatures={misfit?.features}
          showDiff={showDiff}
          volScalar={volScalar}
          isoEnabled={isoEnabled}
          isoLevel={isoLevel}
          volU={volU}
          volV={volV}
          particlesOn={particlesOn}
          flyActive={flyActive}
          onFlyExit={() => setFlyActive(false)}
        />
        {slice && (
          <div className="legend-dock">
            <LegendBar
              palette={palette}
              min={range.min}
              max={range.max}
              units={slice.units}
              onChange={setRangeOverride}
            />
          </div>
        )}
        {selectedPlatform && (
          <ProfilePanel
            platform={platformDetail}
            cycle={activeCycle}
            model={profileModel}
            varName={varName}
            onClose={() => setSelectedPlatform(null)}
          />
        )}
        <div className="hud">
          <span>{meta?.title}</span>
          <span>{varName}</span>
          <span>{slice ? `${slice.time?.slice(0, 10)} · −${slice.depth} m` : ''}</span>
          <span>{exaggeration}× vertical</span>
          {flyActive && <span className="hud-fly">FLY-THROUGH</span>}
          {playing && <span className="hud-play">▶ animating</span>}
        </div>
      </main>
    </div>
  )
}
