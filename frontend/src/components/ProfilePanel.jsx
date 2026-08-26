import { useMemo } from 'react'

const W = 300
const H = 240
const PAD = { l: 44, r: 14, t: 30, b: 26 }

function niceTicks(min, max, n = 4) {
  if (!(max > min)) return [min]
  const step = (max - min) / n
  return Array.from({ length: n + 1 }, (_, i) => min + i * step)
}

/** Vertical profile chart: observed profile vs model profile at the same cast. */
export default function ProfilePanel({ platform, cycle, model, varName, onClose }) {
  const series = useMemo(() => {
    if (!cycle) return null
    const pairs = (arr) =>
      (cycle.depth ?? [])
        .map((d, i) => ({ d, v: arr?.[i] }))
        .filter((p) => p.d != null && p.v != null && Number.isFinite(p.v))

    const obsArr = varName === 'salinity' ? cycle.psal : cycle.temp
    const obs = pairs(obsArr)
    const modelPairs = model
      ? model.depth
          .map((d, i) => ({ d, v: model.values[i] }))
          .filter((p) => p.v != null && Number.isFinite(p.v))
      : []
    return { obs, model: modelPairs }
  }, [cycle, model, varName])

  if (!platform || !series || !series.obs.length) return null

  const all = [...series.obs, ...series.model]
  const dMax = Math.max(...all.map((p) => p.d), 10)
  let vMin = Math.min(...all.map((p) => p.v))
  let vMax = Math.max(...all.map((p) => p.v))
  const pad = (vMax - vMin) * 0.12 || 0.5
  vMin -= pad
  vMax += pad

  const x = (v) => PAD.l + ((v - vMin) / (vMax - vMin)) * (W - PAD.l - PAD.r)
  const y = (d) => PAD.t + (d / dMax) * (H - PAD.t - PAD.b)

  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.v).toFixed(1)},${y(p.d).toFixed(1)}`).join('')

  const units = model?.units ?? ''
  const obsLabel = varName === 'salinity' ? 'psal' : 'temp'

  return (
    <div className="profile-panel">
      <div className="pp-head">
        <div>
          <span className="pp-title">{platform.id}</span>
          <span className="pp-sub">
            {platform.type} · cycle {String(cycle.time).slice(0, 10)} ·{' '}
            {cycle.lat.toFixed(2)}°{cycle.lat >= 0 ? 'N' : 'S'} {cycle.lon.toFixed(2)}°
            {cycle.lon >= 0 ? 'E' : 'W'}
          </span>
        </div>
        <button className="pp-close" onClick={onClose} aria-label="close">
          ✕
        </button>
      </div>
      <svg width={W} height={H} className="pp-svg">
        {niceTicks(vMin, vMax).map((t, i) => (
          <g key={i}>
            <line x1={x(t)} y1={PAD.t} x2={x(t)} y2={H - PAD.b} stroke="#1c3049" strokeWidth="1" />
            <text x={x(t)} y={H - PAD.b + 14} fill="#5f7d99" fontSize="9" textAnchor="middle">
              {t.toFixed(t > 50 ? 0 : 1)}
            </text>
          </g>
        ))}
        {niceTicks(0, dMax, 3).map((t, i) => (
          <text key={i} x={PAD.l - 8} y={y(t) + 3} fill="#5f7d99" fontSize="9" textAnchor="end">
            {Math.round(t)}
          </text>
        ))}
        <text x={PAD.l / 2} y={PAD.t - 12} fill="#8fb0cf" fontSize="9" textAnchor="middle">
          depth m
        </text>

        {series.model.length > 0 && (
          <path d={path(series.model)} fill="none" stroke="#4fc3f7" strokeWidth="1.6" strokeDasharray="5 3" />
        )}
        <path d={path(series.obs)} fill="none" stroke="#ffd166" strokeWidth="1.6" />
        {series.obs.map((p, i) => (
          <circle key={i} cx={x(p.v)} cy={y(p.d)} r="2.4" fill="#ffd166" />
        ))}
      </svg>
      <div className="pp-legend">
        <span className="lg lg-obs">in-situ {obsLabel}</span>
        <span className="lg lg-model">model {varName}</span>
        {units && <span className="lg-units">{units}</span>}
      </div>
    </div>
  )
}
