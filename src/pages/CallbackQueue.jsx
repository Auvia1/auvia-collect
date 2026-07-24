import { useState, useEffect, useMemo, useCallback } from 'react'
import { api } from '../services/api.js'
import CustomDropdown from '../components/ui/CustomDropdown.jsx'

function cleanName(raw) {
  return raw ? raw.replace(/\*/g, '').replace(/_/g, '').trim() : '\u2014'
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
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [calling, setCalling] = useState({}) // rowId → true while bot spawning
  const [calledRows, setCalledRows] = useState({}) // rowId → true when call initiated
  const [toast, setToast] = useState(null)
  
  // Search & Filter State
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all') // 'all' or 'my'
  const [statusFilter, setStatusFilter] = useState('all') // 'all', 'today_overdue', 'today', 'overdue', 'future'
  const [sortBy, setSortBy] = useState('soonest') // 'soonest', 'amount_high', 'amount_low'

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
      showToast(`Outbound call placed successfully for ${cleanName(row.name)}!`, 'success')
      setCalledRows(prev => ({ ...prev, [row.id]: true }))
      // Log the manual call
      api.logActivity({ action: 'Manual Call Placed', category: 'callback',
        description: `Call placed to ${cleanName(row.name)} (${row.phone})`,
        metadata: { callId: row.id, phone: row.phone } }).catch(() => {})
      setTimeout(() => {
        setQueue(prev => prev.filter(item => item.id !== row.id))
      }, 1500)
    } catch (err) {
      showToast(`Failed to start call: ${err.message}`, 'error')
    } finally {
      setCalling((prev) => ({ ...prev, [row.id]: false }))
    }
  }

  // Parse date string as LOCAL date (avoids UTC midnight timezone shift from Postgres DATE fields)
  const parseLocalDate = (dateStr) => {
    if (!dateStr) return null
    // '2026-07-23' → treat as local midnight, not UTC midnight
    const [y, m, d] = String(dateStr).split('T')[0].split('-').map(Number)
    return new Date(y, m - 1, d)
  }

  // Helper date metrics
  const stats = useMemo(() => {
    let total = queue.length
    let todayCount = 0
    let overdueCount = 0

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const tomorrowStart = new Date(todayStart)
    tomorrowStart.setDate(todayStart.getDate() + 1)

    queue.forEach(item => {
      if (item.rawDate) {
        const itemDate = parseLocalDate(item.rawDate)
        if (!itemDate) return
        if (itemDate >= todayStart && itemDate < tomorrowStart) {
          todayCount++
        } else if (itemDate < todayStart) {
          overdueCount++
        }
      }
    })

    return { total, todayCount, overdueCount }
  }, [queue])

  // Get callback urgency classification
  const getCallbackUrgency = (item) => {
    if (!item.rawDate) return 'future'
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const tomorrowStart = new Date(todayStart)
    tomorrowStart.setDate(todayStart.getDate() + 1)

    const itemDate = parseLocalDate(item.rawDate)
    if (!itemDate) return 'future'

    if (itemDate >= todayStart && itemDate < tomorrowStart) {
      return 'today'
    } else if (itemDate < todayStart) {
      return 'overdue'
    }
    return 'future'
  }

  // Filter & Sort computation
  const filteredAndSortedQueue = useMemo(() => {
    let result = [...queue]

    // 1. Search Query
    const query = search.trim().toLowerCase()
    if (query) {
      result = result.filter(
        item =>
          item.name.toLowerCase().includes(query) ||
          item.phone.includes(query) ||
          item.context.toLowerCase().includes(query)
      )
    }

    // 2. Dropdown Status Filter
    if (statusFilter === 'today_overdue') {
      result = result.filter(item => {
        const urgency = getCallbackUrgency(item)
        return urgency === 'today' || urgency === 'overdue'
      })
    } else if (statusFilter === 'today') {
      result = result.filter(item => getCallbackUrgency(item) === 'today')
    } else if (statusFilter === 'overdue') {
      result = result.filter(item => getCallbackUrgency(item) === 'overdue')
    } else if (statusFilter === 'future') {
      result = result.filter(item => getCallbackUrgency(item) === 'future')
    }

    // 3. Sorting
    if (sortBy === 'soonest') {
      result.sort((a, b) => {
        const ad = a.rawDate ? new Date(a.rawDate).getTime() : Infinity
        const bd = b.rawDate ? new Date(b.rawDate).getTime() : Infinity
        return ad - bd
      })
    } else if (sortBy === 'amount_high') {
      result.sort((a, b) => b.amount - a.amount)
    } else if (sortBy === 'amount_low') {
      result.sort((a, b) => a.amount - b.amount)
    }

    return result
  }, [queue, search, statusFilter, sortBy])

  if (loading) return (
    <div className="flex items-center justify-center py-24 gap-3 text-on-surface-variant">
      <span className="material-symbols-outlined animate-spin">progress_activity</span>
      <span>Loading callback queue...</span>
    </div>
  )

  if (error) return (
    <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-xl p-md text-center text-sm">
      {error}
    </div>
  )

  return (
    <div className="flex flex-col gap-md pb-12">
      {/* Header Section */}
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-headline-xl text-primary font-bold">Callback Queue</h2>
        {/* Summary Strip */}
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-soft border border-outline-variant/20 flex items-center gap-md flex-wrap">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-headline-xl text-primary font-bold">{stats.total}</span>
            <span className="font-body-lg text-body-lg text-on-surface font-medium">Total Scheduled</span>
          </div>
          <div className="h-8 w-px bg-outline-variant hidden sm:block"></div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              <span className="font-body-md text-body-md text-on-surface-variant">{stats.todayCount} due today</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-error animate-pulse"></span>
              <span className="font-body-md text-body-md text-on-surface-variant">{stats.overdueCount} overdue</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter / Sort Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 bg-surface-container-lowest p-sm rounded-xl shadow-soft border border-outline-variant/20">
        <div className="flex items-center gap-sm flex-1 flex-wrap sm:flex-nowrap">
          {/* Toggle */}
          <div className="flex bg-surface-container-low p-1 rounded-lg">
            <button
              onClick={() => setFilterType('all')}
              className={`px-4 py-1.5 rounded-md font-label-md text-label-md transition-colors whitespace-nowrap ${
                filterType === 'all'
                  ? 'bg-surface-container-lowest shadow-sm text-primary font-bold'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              All Callbacks
            </button>
            <button
              onClick={() => setFilterType('my')}
              className={`px-4 py-1.5 rounded-md font-label-md text-label-md transition-colors whitespace-nowrap ${
                filterType === 'my'
                  ? 'bg-surface-container-lowest shadow-sm text-primary font-bold'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              My Queue
            </button>
          </div>
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[20px]">search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-3 py-1.5 bg-surface-container-low border border-transparent rounded-lg font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:bg-surface-container-lowest transition-colors"
              placeholder="Search customer or context..."
              type="text"
            />
          </div>
        </div>

        <div className="flex items-center gap-sm flex-wrap sm:flex-nowrap">
          {/* Filter Dropdown */}
          <CustomDropdown
            value={statusFilter}
            options={[
              { value: 'all', label: 'All Dates' },
              { value: 'today_overdue', label: 'Today & Overdue' },
              { value: 'today', label: 'Today only' },
              { value: 'overdue', label: 'Overdue only' },
              { value: 'future', label: 'Upcoming callbacks' }
            ]}
            onChange={setStatusFilter}
            icon="event"
            minWidthClass="w-full sm:w-auto min-w-[170px]"
          />

          <CustomDropdown
            value={sortBy}
            options={[
              { value: 'soonest', label: 'Soonest Callback' },
              { value: 'amount_high', label: 'Highest Amount Due' },
              { value: 'amount_low', label: 'Lowest Amount Due' }
            ]}
            onChange={setSortBy}
            icon="sort"
            minWidthClass="w-full sm:w-auto min-w-[180px]"
          />
        </div>
      </div>

      {/* Task Table Card */}
      <div className="bg-surface-container-lowest rounded-2xl shadow-soft overflow-hidden border border-outline-variant/20">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant/30">
                <th className="font-label-sm text-label-sm uppercase text-on-surface-variant px-6 py-4 font-semibold">Customer Name</th>
                <th className="font-label-sm text-label-sm uppercase text-on-surface-variant px-6 py-4 font-semibold">Phone Number</th>
                <th className="font-label-sm text-label-sm uppercase text-on-surface-variant px-6 py-4 font-semibold">Amount Due</th>
                <th className="font-label-sm text-label-sm uppercase text-on-surface-variant px-6 py-4 font-semibold">Callback Date</th>
                <th className="font-label-sm text-label-sm uppercase text-on-surface-variant px-6 py-4 font-semibold">Time</th>
                <th className="font-label-sm text-label-sm uppercase text-on-surface-variant px-6 py-4 font-semibold">Original Call</th>
                <th className="font-label-sm text-label-sm uppercase text-on-surface-variant px-6 py-4 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              {filteredAndSortedQueue.length === 0 ? (
                <tr>
                  <td colSpan="7" className="p-8 text-center text-on-surface-variant">No callbacks scheduled matching filters.</td>
                </tr>
              ) : (
                filteredAndSortedQueue.map((row) => {
                  const urgency = getCallbackUrgency(row)
                  const isCalling = calling[row.id]
                  const hasBeenCalled = calledRows[row.id]
                  const name = cleanName(row.name)

                  // Account number derived from contactId last 6 chars
                  const acctNo = row.contactId ? row.contactId.substring(row.contactId.length - 6).toUpperCase() : '000000'

                  // original date formatting
                  const originalDateStr = row.originalCallDate
                    ? new Date(row.originalCallDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : '\u2014'

                  let borderClass = 'border-l-4 border-transparent'
                  let bgClass = 'hover:bg-surface-container-low/30'
                  let badgeClass = ''

                  if (urgency === 'overdue') {
                    borderClass = 'border-l-4 border-error'
                    bgClass = 'bg-[#fef2f2]/10 hover:bg-surface-container-low/50'
                    badgeClass = 'bg-error/10 text-error font-bold'
                  } else if (urgency === 'today') {
                    borderClass = 'border-l-4 border-amber-500'
                    bgClass = 'bg-[#fffbeb]/40 hover:bg-surface-container-low/50'
                    badgeClass = 'bg-[#ffdcc4] text-[#6f3800] font-bold'
                  }

                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors border-b border-outline-variant/10 ${borderClass} ${bgClass} ${
                        hasBeenCalled ? 'opacity-40 translate-x-2' : ''
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-label-md text-label-md text-on-surface font-semibold">{name}</span>
                          <span className="font-body-sm text-body-sm text-on-surface-variant">Acct: #{acctNo}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-body-md text-body-md text-on-surface">{row.phone}</td>
                      <td className="px-6 py-4 font-label-md text-label-md text-on-surface font-bold">₹{row.amount.toFixed(2)}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full font-label-sm text-label-sm gap-1 ${badgeClass || 'bg-surface-container-highest text-on-surface-variant'}`}>
                          <span className="material-symbols-outlined text-[14px]">
                            {urgency === 'overdue' ? 'warning' : urgency === 'today' ? 'schedule' : 'event'}
                          </span>
                          {row.rawDate ? (
                            parseLocalDate(row.rawDate)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          ) : (
                            'Scheduled'
                          )}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-body-md text-body-md text-on-surface">{row.time || '10:00 AM'}</td>
                      <td className="px-6 py-4 font-body-sm text-body-sm text-on-surface-variant">{originalDateStr}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleCallNow(row)}
                          disabled={isCalling || hasBeenCalled}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
                            hasBeenCalled
                              ? 'bg-[#16a34a] text-white shadow-none cursor-default'
                              : isCalling
                              ? 'bg-surface-container text-on-surface-variant cursor-not-allowed'
                              : 'bg-primary text-on-primary hover:bg-primary/90 active:scale-95 shadow-sm'
                          }`}
                        >
                          <span className="material-symbols-outlined text-sm">
                            {hasBeenCalled ? 'check_circle' : isCalling ? 'hourglass_top' : 'call'}
                          </span>
                          {hasBeenCalled ? 'Calling...' : isCalling ? 'Starting...' : 'Call Now'}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="px-6 py-4 border-t border-outline-variant/20 flex items-center justify-between bg-surface-container-lowest">
          <span className="font-body-sm text-body-sm text-on-surface-variant">
            Showing 1-{filteredAndSortedQueue.length} of {filteredAndSortedQueue.length} callbacks
          </span>
          <div className="flex gap-2">
            <button className="p-1 rounded text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50" disabled>
              <span className="material-symbols-outlined text-[20px]">chevron_left</span>
            </button>
            <button className="p-1 rounded text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50" disabled>
              <span className="material-symbols-outlined text-[20px]">chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
