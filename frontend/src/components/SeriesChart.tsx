interface SeriesChartProps {
  label: string
  unit: string
  xs: number[]
  ys: Array<number | null>
  color?: string
  invertYLabel?: boolean
  formatY?: (value: number) => string
}

export function SeriesChart({
  label,
  unit,
  xs,
  ys,
  color = '#38bdf8',
  invertYLabel,
  formatY,
}: SeriesChartProps) {
  const validPairs = xs
    .map((x, i) => ({ x, y: ys[i] }))
    .filter((pair): pair is { x: number; y: number } => pair.y !== null && Number.isFinite(pair.y))

  if (validPairs.length < 2) {
    return <div className="chart-empty">{label}: keine Daten</div>
  }

  const width = 600
  const height = 180
  const padding = { top: 16, right: 12, bottom: 24, left: 52 }

  const xMin = xs[0] ?? 0
  const xMax = xs[xs.length - 1] ?? 1
  const yMin = Math.min(...validPairs.map((p) => p.y))
  const yMax = Math.max(...validPairs.map((p) => p.y))
  const ySpan = Math.max(yMax - yMin, 1e-9)

  const toPx = (x: number, y: number) => ({
    px:
      padding.left +
      ((x - xMin) / Math.max(xMax - xMin, 1e-9)) * (width - padding.left - padding.right),
    py:
      height -
      padding.bottom -
      ((y - yMin) / ySpan) * (height - padding.top - padding.bottom),
  })

  let d = ''
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i]
    if (y === null || !Number.isFinite(y)) continue
    const { px, py } = toPx(xs[i], y)
    d += (d === '' ? 'M' : 'L') + `${px.toFixed(1)} ${py.toFixed(1)}`
  }

  const fmt = formatY ?? ((v: number) => v.toFixed(1))
  return (
    <div className="chart">
      <div className="chart-title">
        {label} <span className="chart-unit">({unit})</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        {[0, 0.5, 1].map((fraction) => {
          const yValue = yMin + fraction * ySpan
          const py =
            height - padding.bottom - fraction * (height - padding.top - padding.bottom)
          return (
            <g key={fraction}>
              <line
                x1={padding.left}
                y1={py}
                x2={width - padding.right}
                y2={py}
                stroke="#334155"
                strokeDasharray="4 4"
              />
              <text x={padding.left - 6} y={py + 4} textAnchor="end" className="chart-axis">
                {fmt(yValue)}
              </text>
            </g>
          )
        })}
        <path d={d} fill="none" stroke={color} strokeWidth={2} />
        <text x={padding.left} y={height - 6} className="chart-axis">
          {xMin.toFixed(1)}
        </text>
        <text x={width - padding.right} y={height - 6} textAnchor="end" className="chart-axis">
          {xMax.toFixed(1)}
        </text>
      </svg>
      {invertYLabel ? <div className="chart-hint">kleinere Werte = schneller</div> : null}
    </div>
  )
}
