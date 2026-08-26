interface SeriesChartProps {
  label: string
  unit: string
  xs: number[]
  ys: Array<number | null>
  color?: string
  invertYLabel?: boolean
  area?: boolean
  formatY?: (value: number) => string
}

export function SeriesChart({
  label,
  unit,
  xs,
  ys,
  color = '#0d9488',
  invertYLabel,
  area = false,
  formatY,
}: SeriesChartProps) {
  const validPairs = xs
    .map((x, i) => ({ x, y: ys[i] }))
    .filter((pair): pair is { x: number; y: number } => pair.y !== null && Number.isFinite(pair.y))

  if (validPairs.length < 2) {
    return <div className="chart-empty">{label}: keine Daten</div>
  }

  const width = 640
  const height = 190
  const padding = { top: 14, right: 14, bottom: 26, left: 54 }

  const xMin = xs[0] ?? 0
  const xMax = xs[xs.length - 1] ?? 1
  const yValues = validPairs.map((p) => p.y)
  const yMin = Math.min(...yValues)
  const yMax = Math.max(...yValues)
  const ySpan = Math.max(yMax - yMin, 1e-9)
  const xSpan = Math.max(xMax - xMin, 1e-9)

  const toPx = (x: number, y: number): [number, number] => [
    padding.left + ((x - xMin) / xSpan) * (width - padding.left - padding.right),
    height - padding.bottom - ((y - yMin) / ySpan) * (height - padding.top - padding.bottom),
  ]

  let linePath = ''
  let firstX = 0
  let lastX = 0
  let started = false
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i]
    if (y === null || !Number.isFinite(y)) continue
    const [px, py] = toPx(xs[i], y)
    if (!started) {
      firstX = px
      started = true
    }
    lastX = px
    linePath += (linePath === '' ? 'M' : 'L') + `${px.toFixed(1)} ${py.toFixed(1)}`
  }
  const baseY = height - padding.bottom
  const areaPath =
    area && linePath !== ''
      ? `${linePath}L${lastX.toFixed(1)} ${baseY}L${firstX.toFixed(1)} ${baseY}Z`
      : ''

  const fmt = formatY ?? ((v: number) => v.toFixed(1))
  const id = `grad-${color.replace('#', '')}`

  return (
    <div className="chart">
      <div className="chart-title">
        {label} <span style={{ opacity: 0.65 }}>({unit})</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ width: '100%' }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
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
                stroke="#e2e8ec"
                strokeDasharray="4 5"
              />
              <text x={padding.left - 7} y={py + 4} textAnchor="end" className="chart-axis">
                {fmt(yValue)}
              </text>
            </g>
          )
        })}
        {area ? <path d={areaPath} fill={`url(#${id})`} /> : null}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <text
            key={fraction}
            x={padding.left + fraction * (width - padding.left - padding.right)}
            y={height - 7}
            textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}
            className="chart-axis"
          >
            {(xMin + fraction * xSpan).toFixed(fraction % 0.5 === 0 ? 0 : 1)}
          </text>
        ))}
      </svg>
      {invertYLabel ? <div className="muted hint">kleinere Werte = schneller</div> : null}
    </div>
  )
}
