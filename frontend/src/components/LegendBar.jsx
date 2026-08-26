import { useRef, useEffect } from 'react'
import { samplePalette } from '../lib/colormap'

export default function LegendBar({ palette, min, max, units, onChange }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const w = canvas.width
    for (let x = 0; x < w; x++) {
      const [r, g, b] = samplePalette(palette, x / (w - 1))
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillRect(x, 0, 1, canvas.height)
    }
  }, [palette])

  return (
    <div className="legend">
      <div className="legend-inputs">
        <input
          type="number"
          value={Number.isFinite(min) ? Number(min.toFixed(2)) : ''}
          step={(max - min) / 100 || 0.1}
          onChange={(e) => onChange({ min: parseFloat(e.target.value), max })}
        />
        <span className="units">{units}</span>
        <input
          type="number"
          value={Number.isFinite(max) ? Number(max.toFixed(2)) : ''}
          step={(max - min) / 100 || 0.1}
          onChange={(e) => onChange({ min, max: parseFloat(e.target.value) })}
        />
      </div>
      <canvas ref={canvasRef} width={256} height={12} className="legend-gradient" />
    </div>
  )
}
