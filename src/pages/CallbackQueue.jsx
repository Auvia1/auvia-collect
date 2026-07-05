import { useState, useEffect } from 'react'
import Button from '../components/ui/Button.jsx'
import { api } from '../services/api.js'

export default function CallbackQueue() {
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadQueue() {
      try {
        const data = await api.getCallbackQueue()
        setQueue(data)
      } catch (err) {
        console.error('Error loading callback queue:', err)
        setError(err.message || 'Failed to load callback queue')
      } finally {
        setLoading(false)
      }
    }
    loadQueue()
  }, [])

  const dueToday = queue.filter((c) => c.callbackTime.includes('Today')).length

  if (loading) {
    return <div className="text-center py-20 font-body text-on-surface-variant">Loading callback queue...</div>;
  }

  if (error) {
    return <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center">{error}</div>;
  }

  return (
    <div className="flex flex-col gap-md pb-12">
      <div>
        <h1 className="font-display text-headline-xl text-on-surface">Callback Queue</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-xs">
          Customers who asked to be called back at a specific date and time.
        </p>
      </div>

      <div className="bg-primary-fixed border border-primary-fixed-dim rounded-lg p-sm flex items-center gap-sm">
        <span className="material-symbols-outlined text-on-primary-fixed-variant">info</span>
        <span className="font-body-sm text-body-sm text-on-primary-fixed-variant">
          {dueToday} callbacks scheduled for today.
        </span>
      </div>

      <div className="bg-surface-container-lowest rounded-xl shadow-ambient overflow-hidden border border-outline-variant/20">
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead>
              <tr className="bg-surface-bright text-on-surface-variant text-label-sm font-label-sm uppercase tracking-wider">
                <th className="px-md py-sm font-medium">Customer</th>
                <th className="px-md py-sm font-medium">Amount Due</th>
                <th className="px-md py-sm font-medium">Payment Context</th>
                <th className="px-md py-sm font-medium">Callback Target</th>
                <th className="px-md py-sm font-medium">Call Notes</th>
                <th className="px-md py-sm font-medium text-center">Action</th>
              </tr>
            </thead>
            <tbody className="text-body-sm font-body-sm divide-y divide-surface-container-high">
              {queue.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-md py-lg text-center text-on-surface-variant italic">
                    No callbacks scheduled at this time.
                  </td>
                </tr>
              ) : (
                queue.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-bright transition-colors">
                    <td className="px-md py-sm">
                      <div className="font-medium text-on-surface">{row.name}</div>
                      <div className="text-on-surface-variant text-xs">{row.phone}</div>
                    </td>
                    <td className="px-md py-sm text-on-surface font-medium">${row.amount.toFixed(2)}</td>
                    <td className="px-md py-sm text-on-surface-variant capitalize">{row.context}</td>
                    <td className="px-md py-sm text-primary font-medium">{row.callbackTime}</td>
                    <td className="px-md py-sm text-on-surface-variant max-w-xs truncate" title={row.notes}>{row.notes}</td>
                    <td className="px-md py-sm text-center">
                      <Button icon="call" className="!py-1.5 !px-3 !text-xs">Call Now</Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
