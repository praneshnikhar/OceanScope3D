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
}) {
  const timeLabel = sliceInfo?.time ? String(sliceInfo.time).slice(0, 16).replace('T', ' ') : '—'

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

      <div className="field">
        <span>
          Vertical exaggeration <em>{exaggeration}×</em>
        </span>
        <input
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={exaggeration}
          onChange={(e) => onExaggeration(+e.target.value)}
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

      <div className="status">
        <div>{sliceInfo ? `${sliceInfo.long_name} @ ${timeLabel} / ${sliceInfo.depth} m` : 'loading…'}</div>
      </div>
    </aside>
  )
}
