import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getDocument, submitDecision } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import { IssueCard } from '../components/IssueBadge'
import ConfidenceBar from '../components/ConfidenceBar'

const POLL_MS = 2000

function Field({ label, value, confidence }) {
  const display = value == null
    ? <span className="text-amd-border italic">null</span>
    : String(value)
  return (
    <div className="py-2 border-b border-amd-border last:border-0">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-xs text-amd-sub font-medium uppercase tracking-wide">{label}</span>
        {confidence != null && (
          <div className="w-32"><ConfidenceBar value={confidence} /></div>
        )}
      </div>
      <span className="text-sm text-amd-text font-mono break-all">{display}</span>
    </div>
  )
}

function LineTable({ lines }) {
  if (!lines?.length) return <p className="text-sm text-amd-sub italic">No line items</p>
  return (
    <table className="w-full text-xs">
      <thead className="text-amd-sub uppercase">
        <tr>
          <th className="text-left py-1">Description</th>
          <th className="text-right py-1">Qty</th>
          <th className="text-right py-1">Unit Price</th>
          <th className="text-right py-1">Line Total</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-amd-border">
        {lines.map((l, i) => (
          <tr key={i}>
            <td className="py-1 text-amd-text">{l.description ?? '—'}</td>
            <td className="py-1 text-right text-amd-sub">{l.qty ?? '—'}</td>
            <td className="py-1 text-right text-amd-sub">{l.unitPrice?.toFixed(2) ?? '—'}</td>
            <td className="py-1 text-right font-semibold text-amd-text">{l.lineTotal?.toFixed(2) ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function DocumentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [doc, setDoc] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deciding, setDeciding] = useState(false)
  const [note, setNote] = useState('')
  const [decisionDone, setDecisionDone] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await getDocument(id)
      setDoc(d)
      return d
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    let timer
    load().then(d => {
      if (d?.status === 'processing') {
        timer = setInterval(async () => {
          const updated = await load()
          if (updated?.status !== 'processing') clearInterval(timer)
        }, POLL_MS)
      }
    })
    return () => clearInterval(timer)
  }, [load])

  async function decide(action) {
    setDeciding(true)
    try {
      await submitDecision(id, action, note)
      setDecisionDone(true)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setDeciding(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-amd-sub animate-pulse gap-2">
      <span className="text-amd-red text-xl">⟳</span> Loading document…
    </div>
  )
  if (error) return <div className="card border-red-900 bg-red-950/40 text-red-400">⚠️ {error}</div>
  if (!doc) return <div className="card text-amd-sub">Document not found.</div>

  const ext = doc.extracted
  const conf = doc.confidence || {}
  const isProcessing = doc.status === 'processing'
  const canDecide = ['needs_review', 'rejected'].includes(doc.status) && !decisionDone
  const langFlag = { en: '🇬🇧', it: '🇮🇹', de: '🇩🇪', fr: '🇫🇷', es: '🇪🇸', ar: '🇸🇦' }[doc.language] || '🌐'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="mb-1">
            <Link to="/" className="text-xs text-amd-sub hover:text-amd-text transition-colors">← Dashboard</Link>
          </div>
          <h1 className="text-xl font-bold text-amd-text flex items-center gap-2">
            📄 {doc.fileName}
          </h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <StatusBadge status={doc.status} />
            <span className="text-xs text-amd-sub">{doc.supplierName}</span>
            <span className="badge bg-blue-950 text-blue-400 border border-blue-900">{langFlag} {doc.language?.toUpperCase()}</span>
            <span className="badge bg-amd-muted text-amd-sub border border-amd-border">
              {doc.type === 'invoice' ? '🧾 Invoice' : '📦 Delivery Note'}
            </span>
            <span className="text-xs text-amd-sub">{new Date(doc.uploadedAt).toLocaleString()}</span>
          </div>
        </div>

        {/* Timing & Model telemetry chips */}
        {doc.timing && (
          <div className="flex gap-2 shrink-0 flex-wrap justify-end">
            <div className="card py-2 px-3 text-center">
              <p className="text-xs text-amd-sub">Total</p>
              <p className="text-lg font-bold text-amd-text">{doc.timing.totalMs} ms</p>
            </div>
            <div className="card py-2 px-3 text-center border-amd-red/30"
              style={{ background: 'rgba(176,0,16,0.08)' }}>
              <p className="text-xs text-amd-red">Model Latency</p>
              <p className="text-lg font-bold text-amd-redGlow">{doc.timing.modelMs} ms</p>
            </div>
            {doc.tokensPerSecond != null && (
              <div className="card py-2 px-3 text-center border-purple-900/50"
                style={{ background: 'rgba(80,0,120,0.10)' }}>
                <p className="text-xs text-purple-400">Tokens / sec</p>
                <p className="text-lg font-bold text-purple-300">{doc.tokensPerSecond}</p>
              </div>
            )}
            {doc.localModel && (
              <div className="card py-2 px-3 text-center border-amd-red/40"
                style={{ background: 'rgba(176,0,16,0.12)' }}>
                <p className="text-xs text-amd-red">Local Model</p>
                <p className="text-sm font-bold text-amd-text font-mono">{doc.localModel}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Processing banner */}
      {isProcessing && (
        <div className="card border-blue-900/60 bg-blue-950/20 text-blue-400 flex items-center gap-3">
          <span className="text-2xl animate-spin">⟳</span>
          <div>
            <p className="font-medium">Processing in progress…</p>
            <p className="text-xs opacity-75">The AMD model is checking this document. Auto-refreshing every 2 s.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: Extracted fields + Issues */}
        <div className="space-y-5">
          <div className="card">
            <h2 className="font-semibold text-amd-text mb-3">Extracted Fields</h2>
            {ext ? (
              <div>
                <Field label="Invoice Number" value={ext.invoiceNumber} confidence={conf.invoiceNumber} />
                <Field label="Date"           value={ext.date}          confidence={conf.date} />
                <Field label="Currency"       value={ext.currency}      confidence={conf.currency} />
                <Field label="PO Number"      value={ext.poNumber}      confidence={conf.poNumber} />
                <Field label="Bank Account"   value={ext.bankAccount}   confidence={conf.bankAccount} />
                <div className="pt-3 mt-3 border-t border-amd-border">
                  <h3 className="text-xs text-amd-sub uppercase tracking-wide mb-2">Line Items</h3>
                  <LineTable lines={ext.lines} />
                </div>
                <div className="pt-3 mt-3 border-t border-amd-border space-y-1.5">
                  {[
                    ['Subtotal', ext.subtotal],
                    ['Tax', ext.tax],
                  ].map(([lbl, val]) => (
                    <div key={lbl} className="flex justify-between text-sm">
                      <span className="text-amd-sub">{lbl}</span>
                      <span className="font-mono text-amd-text">{ext.currency} {val?.toFixed(2) ?? '—'}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm font-bold border-t border-amd-border pt-2">
                    <span className="text-amd-text">Total</span>
                    <span className="font-mono text-amd-redGlow">{ext.currency} {ext.total?.toFixed(2) ?? '—'}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-amd-sub italic">Fields not yet extracted</p>
            )}
          </div>

          {/* Issues */}
          <div className="card">
            <h2 className="font-semibold text-amd-text mb-3">
              Issues{' '}
              {doc.issues?.length > 0 && (
                <span className="text-amd-red">({doc.issues.length})</span>
              )}
            </h2>
            {doc.issues?.length > 0 ? (
              <div className="space-y-2">
                {doc.issues.map((issue, i) => <IssueCard key={i} issue={issue} />)}
              </div>
            ) : (
              <p className="text-sm text-green-400">✅ No issues found</p>
            )}
          </div>
        </div>

        {/* Right: Explanation + Reply + Decision */}
        <div className="space-y-5">
          {(doc.ruleExplanation || doc.explanation) && (
            <div className="card">
              <h2 className="font-semibold text-amd-text mb-3">🤖 AI Explanation</h2>
              {doc.ruleExplanation && (
                <div className="mb-3">
                  <p className="text-xs text-amd-sub uppercase tracking-wide mb-1">Rules Engine (exact)</p>
                  <p className="text-sm text-amd-text bg-black/40 rounded-lg p-3 font-mono leading-relaxed border border-amd-border">
                    {doc.ruleExplanation}
                  </p>
                </div>
              )}
              {doc.explanation && (
                <div>
                  <p className="text-xs text-amd-sub uppercase tracking-wide mb-1">
                    AMD Model — Plain Language
                  </p>
                  <p className="text-sm text-amd-text rounded-lg p-3 leading-relaxed border border-amd-red/30"
                    style={{ background: 'rgba(176,0,16,0.06)' }}>
                    {doc.explanation}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Supplier reply */}
          {doc.supplierReplyDraft && (
            <div className="card">
              <h2 className="font-semibold text-amd-text mb-3">
                ✉️ Supplier Reply Draft
                <span className="ml-2 text-xs font-normal text-amd-sub">(in supplier's language)</span>
              </h2>
              <pre className="text-sm text-amd-text whitespace-pre-wrap font-sans bg-black/30 rounded-lg p-3 border border-amd-border leading-relaxed">
                {doc.supplierReplyDraft}
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(doc.supplierReplyDraft)}
                className="btn-secondary mt-2 text-xs"
              >
                📋 Copy
              </button>
            </div>
          )}

          {/* Redacted file */}
          {doc.redactedFileUrl && (
            <div className="card border-green-900/50" style={{ background: 'rgba(0,100,0,0.06)' }}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔏</span>
                <div>
                  <p className="text-sm font-medium text-green-400">Personal data redacted</p>
                  <a href={doc.redactedFileUrl} target="_blank" rel="noreferrer"
                    className="text-xs text-green-600 hover:text-green-400 transition-colors">
                    View redacted PDF ↗
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Decision */}
          {canDecide && (
            <div className="card border-amber-900/50" style={{ background: 'rgba(120,80,0,0.08)' }}>
              <h2 className="font-semibold text-amber-400 mb-3">👤 Human Decision Required</h2>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Optional note for the audit log…"
                rows={2}
                className="input mb-3 resize-none"
              />
              <div className="flex gap-2">
                <button onClick={() => decide('approve')}      disabled={deciding} className="btn-success flex-1 justify-center">
                  ✅ Approve
                </button>
                <button onClick={() => decide('ask_supplier')} disabled={deciding} className="btn-secondary flex-1 justify-center">
                  ✉️ Ask Supplier
                </button>
                <button onClick={() => decide('reject')}       disabled={deciding} className="btn-danger flex-1 justify-center">
                  ❌ Reject
                </button>
              </div>
            </div>
          )}

          {decisionDone && (
            <div className="card border-green-900/50 text-green-400 text-sm font-medium"
              style={{ background: 'rgba(0,100,0,0.06)' }}>
              ✅ Decision recorded.{' '}
              <Link to="/" className="underline hover:text-green-300 transition-colors">Back to dashboard</Link>
            </div>
          )}

          {/* Audit log */}
          {doc.auditLog?.length > 0 && (
            <div className="card">
              <h2 className="font-semibold text-amd-text mb-2">Audit Log</h2>
              <div className="space-y-1">
                {doc.auditLog.map((entry, i) => (
                  <div key={i} className="text-xs text-amd-sub flex gap-2">
                    <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                    <span className="font-medium capitalize text-amd-text">{entry.action}</span>
                    {entry.note && <span>— {entry.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
