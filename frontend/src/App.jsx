import { useEffect, useMemo, useState } from 'react'
import OceanScene from './components/OceanScene'
import ControlPanel from './components/ControlPanel'
import LegendBar from './components/LegendBar'
import { fetchDatasets, fetchSlice, fetchVectorField } from './lib/api'
import { PALETTE_NAMES } from './lib/colormap'

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
  }, [])

  useEffect(() => {
    const m = datasets.find((d) => d.id === dsId)
    if (!m) return
    setMeta(m)
    setZIdx(0)
    setTIdx(0)
    setRangeOverride(null)
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

  const range = useMemo(() => {
    if (rangeOverride) return rangeOverride
    if (!slice) return { min: 0, max: 1 }
    if (autoMode === 'slice') return { min: slice.slice_range.p2, max: slice.slice_range.p98 }
    return { min: slice.range.global_min, max: slice.range.global_max }
  }, [slice, autoMode, rangeOverride])

  const variables = meta?.variables ?? []

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
        timeCount={meta?.dims?.time ?? 1}
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
        autoRange={(mode) => {
          setRangeOverride(null)
          setAutoMode(mode)
        }}
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
        <div className="hud">
          <span>{meta?.title}</span>
          <span>{varName}</span>
          <span>{slice ? `${slice.time?.slice(0, 10)} · −${slice.depth} m` : ''}</span>
          <span>{exaggeration}× vertical</span>
        </div>
      </main>
    </div>
  )
}
