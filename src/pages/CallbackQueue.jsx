import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api.js'

// Strip any accidental markdown formatting (asterisks/underscores) from names
function cleanName(raw) {
  return raw ? raw.replace(/\*/g, '').replace(/_/g, '').trim() : '\u2014'
}

function InitialsAvatar({ name }) {
  const clean = cleanName(name)
  const initials = clean.split(' ').map((w) => w[0] || '').slice(0, 2).join('').toUpperCase()
  const palette = [
    'bg-primary text-on-primary',
    'bg-secondary text-on-secondary',
    'bg-tertiary text-on-tertiary',
    'bg-error text-on-error',
  ]
  const color = palette[clean.charCodeAt(0) % palette.length]
  return (
    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${color}`}>
      {initials || '?'}
    </div>
  )
}

function Toast({ message, type = 'info', onClose }) {
  const bg = type === 'success' ? 'bg-[#16a34a]' : type === 'error' ? 'bg-error' : 'bg-primary'
  return (
    <div className={`fixed bottom-6 right-6 z-50 ${bg} text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 max-w-sm`}>
      <span className="material-symbols-outlined text-lg">
        {type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info'}
      </span>
      <span className="text-sm flex-1">{message}</span>
      <button onClick={onClose} className="opacity-70 hover:opacity-100">
        <span className="material-symbols-outlined text-base">close</span>
      </button>
    </div>
  )
}

export default function CallbackQueue() {
  const [queue, setQueue]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [calling, setCalling] = useState({}) // rowId \u2192 true while bot spawning
  const [toast, setToast]     = useState(null)

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  useEffect(() => {
    api.getCallbackQueue()
      .then(setQueue)
      .catch((err) => setError(err.message || 'Failed to load callback queue'))
      .finally(() => setLoading(false))
  }, [])

  async function handleCallNow(row) {
    if (calling[row.id]) return
    setCalling((prev) => ({ ...prev, [row.id]: true }))
    try {
      await api.startVoiceBot(row.campaignId || row.id, row.contactId)
      showToast(`Bot started for ${cleanName(row.name)} \u2014 opening call UI\u2026`, 'success')
      setTimeout(() => window.open('http://localhost:7860', '_blank'), 800)
    } catch (err) {
      showToast(`Failed to start call: ${err.message}`, 'error')
    } finally {
      setCalling((prev) => ({ ...prev, [row.id]: false }))
    }
  }

  const dueToday = queue.filter((c) => c.callbackTime?.includes('Today')).length

  if (loading) return (
    <div className="flex items-center justify-center py-24 gap-3 text-on-surface-variant">
      <span className="material-symbols-outlined animate-spin">progress_activity</span>
      <span>Loading callback queue\u2026</span>
    </div>
  )

  if (error) return (
    <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-xl p-md text-center text-sm">
      {error}
    </div>
  )

  return (
    <div className="flex flex-col gap-md pb-12">
      <div>
        <h1 className="font-display text-headline-xl text-on-surface">Callback Queue</h1>
        <p className="text-body-md text-on-surface-variant mt-xs">
          Customers who asked to be called back at a specific date and time.
        </p>
      </div>

      {dueToday > 0 && (
        <div className="bg-primary-fixed border border-primary-fixed-dim rounded-lg p-sm flex items-center gap-sm">
          <span className="material-symbols-outlined text-on-primary-fixed-variant">info</span>
          <span className="text-sm text-on-primary-fixed-variant">
            <strong>{dueToday}</strong> callback{dueToday !== 1 ? 's' : ''} scheduled for today.
          </span>
        </div>
      )}

      <div className="bg-surface-container-lowest rounded-xl shadow-ambient overflow-hidden border border-outline-variant/20">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-on-surface-variant">
            <span className="material-symbols-outlined text-5xl opacity-30">event_available</span>
            <p>No callbacks scheduled at this time.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap">
              <thead>
                <tr className="bg-surface-bright text-on-surface-variant text-xs uppercase tracking-wider">
                  <th className="px-md py-sm font-medium">Customer</th>
                  <th className="px-md py-sm font-medium">Amount Due</th>
                  <th className="px-md py-sm font-medium">Payment Context</th>
                  <th className="px-md py-sm font-medium">Callback Target</th>
                  <th className="px-md py-sm font-medium">Call Notes</th>
                  <th className="px-md py-sm font-medium text-center">Action</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-surface-container-high">
                {queue.map((row) => {
                  const isToday  = row.callbackTime?.includes('Today')
                  const isCalling = calling[row.id]
                  const name     = cleanName(row.name)
                  return (
                    <tr key={row.id} className="hover:bg-surface-bright transition-colors">
                      <td className="px-md py-sm">
                        <div className="flex items-center gap-sm">
                          <InitialsAvatar name={name} />
                          <div>
                            <div className="font-medium text-on-surface">{name}</div>
                            <div className="text-on-surface-variant text-xs">{row.phone}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-md py-sm text-on-surface font-semibold">
                        ${Number(row.amount).toFixed(2)}
                      </td>
                      <td className="px-md py-sm text-on-surface-variant capitalize">
                        {row.context || '\u2014'}
                      </td>
                      <td className="px-md py-sm">
                        <span className={`inline-flex items-center gap-1 font-medium ${isToday ? 'text-primary' : 'text-on-surface-variant'}`}>
                          <span className="material-symbols-outlined text-sm">{isToday ? 'today' : 'calendar_month'}</span>
                          {row.callbackTime}
                        </span>
                      </td>
                      <td className="px-md py-sm text-on-surface-variant max-w-[220px] truncate" title={row.notes}>
                        {row.notes || '\u2014'}
                      </td>
                      <td className="px-md py-sm text-center">
                        <button
                          id={`callback-call-${row.id}`}
                          onClick={() => handleCallNow(row)}
                          disabled={isCalling}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150
                            ${isCalling
                              ? 'bg-surface-container text-on-surface-variant cursor-not-allowed'
                              : 'bg-primary text-on-primary hover:bg-primary/90 active:scale-95 shadow-sm hover:shadow-md'
                            }`}
                        >
                          <span className="material-symbols-outlined text-sm">
                            {isCalling ? 'hourglass_top' : 'call'}
                          </span>
                          {isCalling ? 'Starting\u2026' : 'Call Now'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
