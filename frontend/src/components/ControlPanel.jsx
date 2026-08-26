import { useState } from 'react'

const PLAY_SPEEDS = [
  { label: '0.5 s / step', ms: 500 },
  { label: '1 s / step', ms: 1000 },
  { label: '2 s / step', ms: 2000 },
]

export default function ControlPanel({
  datasets,
  dsId,
  onDataset,
  variables,
  varName,
  onVar,
  timeCount,
  tIdx,
  onTime,
  depthValues,
  zIdx,
  onDepth,
  exaggeration,
  onExaggeration,
  palettes,
  palette,
  onPalette,
  showVectors,
  onShowVectors,
  sliceInfo,
  autoRange,
  onAutoRange,
  playing,
  onPlaying,
  playMs,
  onPlayMs,
  obsSource,
  showObs,
  onShowObs,
  showDiff,
  onShowDiff,
  misfitStats,
  isoEnabled,
  onIsoEnabled,
  isoLevel,
  onIsoLevel,
  isoValue,
  particlesOn,
  onParticlesOn,
  flyActive,
  onFlyActive,
}) {
  const [advOpen, setAdvOpen] = useState(true)
  const timeLabel = sliceInfo?.time ? String(sliceInfo.time).slice(0, 16).replace('T', ' ') : '—'
  const hasObs = Boolean(obsSource) && obsSource !== 'none'

  return (
    <aside className="panel">
      <h1 className="brand">
        OceanScope<span className="brand-3d">3D</span>
      </h1>
      <p className="tagline">INCOIS model fields · in-situ overlays</p>

      <label className="field">
        <span>Dataset</span>
        <select value={dsId} onChange={(e) => onDataset(e.target.value)}>
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Variable</span>
        <select value={varName} onChange={(e) => onVar(e.target.value)}>
          {variables.map((v) => (
            <option key={v.name} value={v.name}>
              {v.long_name || v.name}
              {v.units ? ` (${v.units})` : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>
          Time <em>{tIdx + 1}/{timeCount} · {timeLabel}</em>
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(0, timeCount - 1)}
          value={tIdx}
          onChange={(e) => onTime(+e.target.value)}
        />
        <div className="anim-row">
          <button
            className={`play-btn${playing ? ' active' : ''}`}
            onClick={() => onPlaying(!playing)}
            title={playing ? 'pause animation' : 'play animation'}
          >
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <select value={playMs} onChange={(e) => onPlayMs(+e.target.value)}>
            {PLAY_SPEEDS.map((s) => (
              <option key={s.ms} value={s.ms}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <span>
          Depth <em>{sliceInfo?.depth !== null && sliceInfo?.depth !== undefined ? `−${sliceInfo.depth} m` : '—'}</em>
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(0, (depthValues?.length ?? 1) - 1)}
          value={zIdx}
          onChange={(e) => onDepth(+e.target.value)}
        />
      </div>

      <label className="field">
        <span>Colormap</span>
        <select value={palette} onChange={(e) => onPalette(e.target.value)}>
          {palettes.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>Color range</span>
        <div className="range-buttons">
          <button onClick={() => onAutoRange('global')}>Global</button>
          <button onClick={() => onAutoRange('slice')}>This slice</button>
        </div>
      </div>

      <label className="check">
        <input type="checkbox" checked={showVectors} onChange={(e) => onShowVectors(e.target.checked)} />
        Overlay current vectors
      </label>

      <section className="adv-section">
        <button className="adv-toggle" onClick={() => setAdvOpen(!advOpen)}>
          {advOpen ? '▾' : '▸'} Analysis layers
        </button>

        {advOpen && (
          <>
            <label className={`check${hasObs ? '' : ' disabled'}`}>
              <input
                type="checkbox"
                disabled={!hasObs}
                checked={showObs && hasObs}
                onChange={(e) => onShowObs(e.target.checked)}
              />
              Argo &amp; glider observations
              {hasObs && <em className="src-badge">{obsSource}</em>}
            </label>

            <label className={`check${showObs && hasObs ? '' : ' disabled'}`}>
              <input
                type="checkbox"
                disabled={!showObs || !hasObs}
                checked={showDiff}
                onChange={(e) => onShowDiff(e.target.checked)}
              />
              Model − obs difference layer
            </label>
            {showDiff && misfitStats && (
              <div className="misfit-stats">
                bias {misfitStats.bias >= 0 ? '+' : ''}
                {misfitStats.bias.toFixed(3)} · rmse {misfitStats.rmse.toFixed(3)} · n=
                {misfitStats.count}
              </div>
            )}

            <label className="check">
              <input type="checkbox" checked={isoEnabled} onChange={(e) => onIsoEnabled(e.target.checked)} />
              Isosurface
            </label>
            {isoEnabled && (
              <div className="field sub">
                <span>
                  Iso level <em>{isoValue != null ? isoValue.toFixed(2) : '—'}</em>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={isoLevel}
                  onChange={(e) => onIsoLevel(+e.target.value)}
                />
              </div>
            )}

            <label className="check">
              <input
                type="checkbox"
                checked={particlesOn}
                onChange={(e) => onParticlesOn(e.target.checked)}
              />
              Current particle advection (GPU)
            </label>

            <div className="field">
              <span>Camera</span>
              <button className={`fly-btn${flyActive ? ' active' : ''}`} onClick={() => onFlyActive(!flyActive)}>
                {flyActive ? '■ Exit fly-through' : '✈ Fly-through'}
              </button>
            </div>
          </>
        )}
      </section>

      <div className="status">
        <div>{sliceInfo ? `${sliceInfo.long_name} @ ${timeLabel} / ${sliceInfo.depth} m` : 'loading…'}</div>
      </div>
    </aside>
  )
}
