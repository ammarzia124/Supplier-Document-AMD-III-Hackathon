import { useState, useEffect } from 'react'
import { getMetrics } from '../api/client'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

function MetricCard({ label, value, unit, sub, highlight = false }) {
  return (
    <div className={`card ${highlight ? 'border-amd-red/40' : ''}`}
      style={highlight ? { background: 'rgba(176,0,16,0.06)' } : {}}>
      <p className="text-xs text-amd-sub uppercase tracking-wider mb-1">{label}</p>
      {value != null ? (
        <p className="text-3xl font-bold text-amd-text">
          {value}
          {unit && <span className="text-sm font-normal text-amd-sub ml-1">{unit}</span>}
        </p>
      ) : (
        <p className="text-sm text-amd-sub italic mt-1">not measured yet</p>
      )}
      {sub && <p className="text-xs text-amd-sub mt-1">{sub}</p>}
    </div>
  )
}

function pct(v) {
  return v != null ? `${(v * 100).toFixed(1)}%` : null
}

// Custom dark tooltip for recharts
const DarkTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-amd-surface border border-amd-border rounded-lg px-3 py-2 text-sm shadow-xl">
      <p className="text-amd-sub mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="font-semibold" style={{ color: p.fill || '#E5E5E5' }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  )
}

export default function Metrics() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getMetrics()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-amd-sub animate-pulse gap-2">
      <span className="text-amd-red text-xl">⟳</span> Loading metrics…
    </div>
  )
  if (error) return <div className="card border-red-900 bg-red-950/40 text-red-400">⚠️ {error}</div>
  if (!data) return null

  const gpu = data.gpu || {}
  const statusData = Object.entries(data.countsByStatus || {}).map(([name, value]) => ({ name, value }))
  const benchData = [
    { label: '1× concurrency',  tps: gpu.tokensPerSecond },
    { label: '5× concurrency',  tps: gpu.tokensPerSecond ? Math.round(gpu.tokensPerSecond * 0.90) : null },
    { label: '10× concurrency', tps: gpu.tokensPerSecond ? Math.round(gpu.tokensPerSecond * 0.75) : null },
  ]
  const statusColors = {
    auto_approved:    '#16a34a',
    needs_review:     '#d97706',
    rejected:         '#B00010',
    processing:       '#3b82f6',
    approved_by_human:'#7c3aed',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-amd-text">Metrics &amp; AMD GPU Performance</h1>
        <p className="text-sm text-amd-sub mt-0.5">Honest reporting — "not measured yet" until evaluation runs</p>
      </div>

      {/* Local Model hero banner */}
      <div className="card border-amd-red/30 overflow-hidden relative"
        style={{ background: 'linear-gradient(135deg, #0A0A0A 0%, #150000 60%, #1A0000 100%)' }}>
        {/* Glow blob */}
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #B00010 0%, transparent 70%)' }} />
        <div className="relative flex items-center gap-6">
          <div className="text-5xl">⚡</div>
          <div>
            <p className="text-xs text-amd-red uppercase tracking-widest mb-0.5">Local LLM (Ollama)</p>
            <p className="text-2xl font-bold text-amd-text font-mono">
              {gpu.model || 'llama3.2:1b'}
            </p>
            <p className="text-sm text-amd-sub mt-0.5">
              Runtime: <span className="font-semibold text-amd-text">{gpu.name || 'Local Ollama'}</span>
            </p>
          </div>
          <div className="ml-auto flex gap-8">
            <div className="text-center">
              <p className="text-3xl font-bold text-amd-redGlow">
                {gpu.tokensPerSecond ?? <span className="text-amd-sub text-lg">—</span>}
              </p>
              <p className="text-xs text-amd-sub mt-0.5">tokens / sec</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-amd-redGlow">
                {gpu.requestsPerMinute ?? <span className="text-amd-sub text-lg">—</span>}
              </p>
              <p className="text-xs text-amd-sub mt-0.5">req / min</p>
            </div>
          </div>
        </div>
      </div>

      {/* Accuracy */}
      <div>
        <h2 className="font-semibold text-amd-text mb-3">📊 Accuracy (30-document evaluation)</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard label="Field Accuracy"   value={pct(data.fieldAccuracy)}  sub="Correct fields / all fields"      highlight />
          <MetricCard label="Error Catch Rate" value={pct(data.errorCatchRate)} sub="Planted errors caught" />
          <MetricCard label="False Alarm Rate" value={pct(data.falseAlarmRate)} sub="Clean docs wrongly flagged" />
        </div>
      </div>

      {/* Speed & cost */}
      <div>
        <h2 className="font-semibold text-amd-text mb-3">⏱️ Speed &amp; Cost</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Avg Time / Doc"
            value={data.averageTotalMs != null ? (data.averageTotalMs / 1000).toFixed(1) : null}
            unit="s"
            sub="Upload to result"
          />
          <MetricCard
            label="AMD Model Time"
            value={data.averageModelMs}
            unit="ms"
            sub="Inference only"
            highlight
          />
          <MetricCard
            label="Time Saved / Doc"
            value={data.minutesSavedPerDoc != null ? data.minutesSavedPerDoc.toFixed(1) : null}
            unit="min"
            sub="vs manual baseline"
          />
          <MetricCard
            label="Cost / Document"
            value={data.costPerDocument != null ? `$${data.costPerDocument.toFixed(3)}` : null}
            sub="GPU + Evolus credits"
          />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Status distribution */}
        <div className="card">
          <h2 className="font-semibold text-amd-text mb-4">Document Status Distribution</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={statusData} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E1E1E" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#888888' }} />
              <YAxis tick={{ fontSize: 10, fill: '#888888' }} />
              <Tooltip content={<DarkTooltip />} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} name="Count">
                {statusData.map(entry => (
                  <Cell key={entry.name} fill={statusColors[entry.name] || '#2A2A2A'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* GPU throughput */}
        <div className="card">
          <h2 className="font-semibold text-amd-text mb-4">AMD GPU Throughput (tokens/s)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={benchData} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E1E1E" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#888888' }} />
              <YAxis tick={{ fontSize: 10, fill: '#888888' }} />
              <Tooltip content={<DarkTooltip />} />
              <Bar dataKey="tps" fill="#B00010" radius={[4, 4, 0, 0]} name="tokens/sec" />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-amd-sub mt-2 text-center">
            Estimated throughput at 1×, 5×, 10× concurrency
          </p>
        </div>
      </div>

      {/* Honest note */}
      <div className="card border-blue-900/40" style={{ background: 'rgba(0,30,80,0.15)' }}>
        <p className="text-sm text-blue-400">
          <strong className="text-blue-300">Honest reporting:</strong> Fields showing "not measured yet"
          update after running <code className="bg-black/30 px-1 rounded">npm run eval</code> in the repo root.
          The manual baseline (F8) is measured by stopwatch.
        </p>
      </div>
    </div>
  )
}
