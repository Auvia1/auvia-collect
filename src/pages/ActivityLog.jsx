import { useState, useEffect, useMemo, useCallback } from 'react'
import { api } from '../services/api.js'
import CustomDropdown from '../components/ui/CustomDropdown.jsx'
import Badge from '../components/ui/Badge.jsx'

// ── Category config ──────────────────────────────────────────────────────────
const CATEGORIES = [
  { value: 'all',       label: 'All Activity',     icon: 'timeline' },
  { value: 'campaign',  label: 'Campaigns',          icon: 'campaign' },
  { value: 'calls',     label: 'Calls',              icon: 'call' },
  { value: 'callback',  label: 'Callbacks',           icon: 'schedule' },
  { value: 'billing',   label: 'Billing & Credits',  icon: 'payments' },
  { value: 'settings',  label: 'Settings',            icon: 'settings' },
  { value: 'general',   label: 'General',             icon: 'info' },
]

const CATEGORY_META = {
  campaign: { color: 'text-primary',              bg: 'bg-primary-fixed/30',        icon: 'campaign' },
  calls:    { color: 'text-[#16a34a]',            bg: 'bg-[#dcfce7]',              icon: 'call' },
  callback: { color: 'text-[#d97706]',            bg: 'bg-[#fef3c7]',              icon: 'schedule' },
  billing:  { color: 'text-[#7c3aed]',            bg: 'bg-[#f3e8ff]',              icon: 'payments' },
  settings: { color: 'text-on-surface-variant',   bg: 'bg-surface-container-low',  icon: 'settings' },
  general:  { color: 'text-secondary',            bg: 'bg-secondary-container/40', icon: 'info' },
}

function getCategoryMeta(cat) {
  return CATEGORY_META[cat] || CATEGORY_META.general
}

// ── Date formatting ──────────────────────────────────────────────────────────
function formatRelative(dateStr) {
  if (!dateStr) return '—'
  const now  = new Date()
  const date = new Date(dateStr)
  const diffMs  = now - date
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr  = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1)  return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr  < 24) return `${diffHr}h ago`
  if (diffDay < 7)  return `${diffDay}d ago`
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatFull(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

// ── Individual log row ───────────────────────────────────────────────────────
function LogRow({ log }) {
  const meta = getCategoryMeta(log.category)
  // user_name comes either as a direct alias from the query or inside metadata JSONB
  const displayUser = log.user_name || log.metadata?.user_name || null
  return (
    <div className="flex gap-md py-sm px-md group hover:bg-surface-container-low/40 transition-colors rounded-lg">
      {/* Icon bubble */}
      <div className={`w-9 h-9 rounded-full ${meta.bg} ${meta.color} flex items-center justify-center shrink-0 mt-0.5`}>
        <span className="material-symbols-outlined text-[18px]">{meta.icon}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-xs">
          <span className="font-label-md text-label-md text-on-surface">{log.action}</span>
          {displayUser && (
            <span className="font-body-sm text-body-sm text-on-surface-variant">
              by <span className="font-medium text-on-surface">{displayUser}</span>
            </span>
          )}
        </div>
        {log.description && (
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 truncate max-w-xl">
            {log.description}
          </p>
        )}
      </div>

      {/* Time */}
      <div className="shrink-0 flex flex-col items-end gap-xs">
        <span
          className="font-body-sm text-body-sm text-on-surface-variant whitespace-nowrap"
          title={formatFull(log.created_at)}
        >
          {formatRelative(log.created_at)}
        </span>
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
          {log.category}
        </span>
      </div>
    </div>
  )
}

// ── Day group divider ────────────────────────────────────────────────────────
function DayDivider({ label }) {
  return (
    <div className="flex items-center gap-sm px-md py-xs">
      <div className="flex-1 h-px bg-outline-variant/40" />
      <span className="font-label-sm text-label-sm text-on-surface-variant whitespace-nowrap text-[11px] uppercase tracking-wider">
        {label}
      </span>
      <div className="flex-1 h-px bg-outline-variant/40" />
    </div>
  )
}

function getDayLabel(dateStr) {
  if (!dateStr) return 'Unknown'
  const date  = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const itemDay = new Date(date)
  itemDay.setHours(0, 0, 0, 0)

  if (itemDay.getTime() === today.getTime()) return 'Today'
  if (itemDay.getTime() === yesterday.getTime()) return 'Yesterday'
  return date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
}

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, colorClass }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-md shadow-ambient border border-outline-variant/20 flex flex-col justify-between min-h-[100px]">
      <div className={`flex items-center gap-xs font-label-md text-label-md uppercase tracking-wider ${colorClass || 'text-on-surface-variant'}`}>
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
        {label}
      </div>
      <div>
        <div className="font-display text-headline-lg font-bold text-on-surface mt-sm">{value}</div>
        {sub && <div className="font-body-sm text-body-sm text-on-surface-variant">{sub}</div>}
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function ActivityLog() {
  const [logs,        setLogs]        = useState([])
  const [total,       setTotal]       = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [category,    setCategory]    = useState('all')
  const [search,      setSearch]      = useState('')
  const [page,        setPage]        = useState(0)
  const PAGE_SIZE = 50

  const fetchLogs = useCallback(async (cat, pg) => {
    setLoading(true)
    setError('')
    try {
      const data = await api.getActivityLogs({ category: cat, limit: PAGE_SIZE, offset: pg * PAGE_SIZE })
      setLogs(data.logs || [])
      setTotal(data.total || 0)
    } catch (err) {
      setError(err.message || 'Failed to load activity logs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs(category, page)
  }, [category, page, fetchLogs])

  // Client-side search filter on loaded logs
  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return logs
    return logs.filter(l =>
      l.action.toLowerCase().includes(q) ||
      (l.description || '').toLowerCase().includes(q) ||
      (l.user_name || '').toLowerCase().includes(q)
    )
  }, [logs, search])

  // Stats derived from current page
  const stats = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayLogs = logs.filter(l => new Date(l.created_at) >= today)
    const byCategory = {}
    logs.forEach(l => { byCategory[l.category] = (byCategory[l.category] || 0) + 1 })
    const topCat = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0]
    return { todayCount: todayLogs.length, topCat: topCat ? topCat[0] : '—' }
  }, [logs])

  // Group logs by day
  const groupedLogs = useMemo(() => {
    const groups = []
    let lastDay = null
    filteredLogs.forEach(log => {
      const dayLabel = getDayLabel(log.created_at)
      if (dayLabel !== lastDay) {
        groups.push({ type: 'divider', label: dayLabel })
        lastDay = dayLabel
      }
      groups.push({ type: 'log', log })
    })
    return groups
  }, [filteredLogs])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-md pb-12">

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-md">
        <div>
          <p className="font-label-md text-label-md text-secondary uppercase tracking-wider mb-xs">Audit Trail</p>
          <h1 className="font-display text-headline-xl text-on-surface font-bold">Activity Log</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-xs">
            Full history of every action taken — settings changes, campaigns, calls, billing, and more.
          </p>
        </div>
        <button
          onClick={() => fetchLogs(category, page)}
          className="flex items-center gap-xs px-md py-sm border border-outline-variant rounded-lg font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-low hover:text-primary transition-colors self-start md:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">refresh</span>
          Refresh
        </button>
      </div>

      {/* ── Stat Cards ── */}
      <section className="grid grid-cols-2 md:grid-cols-3 gap-gutter">
        <StatCard
          icon="timeline"
          label="Total Events"
          value={total.toLocaleString()}
          sub="all time"
        />
        <StatCard
          icon="today"
          label="Today"
          value={stats.todayCount}
          sub="events this page"
          colorClass="text-primary"
        />
        <StatCard
          icon="star"
          label="Top Category"
          value={stats.topCat === '—' ? '—' : stats.topCat.charAt(0).toUpperCase() + stats.topCat.slice(1)}
          sub="most frequent"
          colorClass="text-[#7c3aed]"
        />
      </section>

      {/* ── Filter bar ── */}
      <section className="bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/20 p-sm flex flex-wrap gap-sm items-center">
        {/* Search */}
        <div className="relative flex-grow max-w-sm">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-sm">search</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search action, user, or description..."
            className="w-full pl-10 pr-4 py-2 border border-outline-variant rounded-lg text-body-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors text-on-surface bg-transparent"
          />
        </div>

        {/* Category dropdown */}
        <CustomDropdown
          value={category}
          options={CATEGORIES.map(c => ({ value: c.value, label: c.label }))}
          onChange={val => { setCategory(val); setPage(0) }}
          icon="filter_alt"
          minWidthClass="min-w-[170px]"
        />

        {/* Clear */}
        {(search || category !== 'all') && (
          <button
            onClick={() => { setSearch(''); setCategory('all'); setPage(0) }}
            className="flex items-center gap-xs px-sm py-2 text-body-sm text-on-surface-variant hover:text-error transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
            Clear
          </button>
        )}

        <div className="ml-auto font-body-sm text-body-sm text-on-surface-variant">
          {filteredLogs.length} of {total} events
        </div>
      </section>

      {/* ── Log Feed ── */}
      <section className="bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/20 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-sm py-16 text-on-surface-variant">
            <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
            <span className="font-body-md">Loading activity log...</span>
          </div>
        ) : error ? (
          <div className="p-md text-center">
            <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md inline-block">
              {error}
            </div>
          </div>
        ) : groupedLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-sm text-on-surface-variant">
            <span className="material-symbols-outlined text-[48px] opacity-30">history</span>
            <p className="font-body-md text-body-md">No activity found</p>
            <p className="font-body-sm text-body-sm opacity-70">
              {search ? 'Try a different search term' : 'Actions will appear here as your team uses the platform'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/20 py-xs">
            {groupedLogs.map((item, i) =>
              item.type === 'divider'
                ? <DayDivider key={`div-${i}`} label={item.label} />
                : <LogRow key={item.log.id} log={item.log} />
            )}
          </div>
        )}
      </section>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-xs">
          <span className="font-body-sm text-body-sm text-on-surface-variant">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-sm">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-xs px-md py-sm rounded-lg border border-outline-variant font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-low disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">chevron_left</span>
              Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="flex items-center gap-xs px-md py-sm rounded-lg border border-outline-variant font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-low disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
