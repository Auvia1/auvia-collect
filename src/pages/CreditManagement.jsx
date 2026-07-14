import { useState, useEffect, useMemo } from 'react'
import Badge from '../components/ui/Badge.jsx'
import { api } from '../services/api.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function fmtDate(date) {
  if (!date) return '—'
  return new Date(date).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtShortDate(date) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function StatCard({ icon, label, value, sub, accent = '#0f4c81', bg = '#eff6ff' }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4 shadow-sm">
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: bg }}
      >
        <span className="material-symbols-outlined text-[22px]" style={{ color: accent }}>
          {icon}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide truncate">{label}</p>
        <p className="text-2xl font-bold text-[#1e293b] leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'calls', label: 'Call Credits', icon: 'phone_in_talk' },
  { id: 'payments', label: 'Payment Transactions', icon: 'receipt_long' },
]

export default function CreditManagement() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [section, setSection] = useState('overview')

  // Filters
  const [clinicFilter, setClinicFilter] = useState('')
  const [callSearch, setCallSearch] = useState('')
  const [paySearch, setPaySearch] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await api.getAdminCredits()
        setData(res)
      } catch (err) {
        setError(err.message || 'Failed to load credit data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Derived stats from overview
  const stats = useMemo(() => {
    if (!data) return null
    const clinics = data.clinics || []
    const totalBalance = clinics.reduce((s, c) => s + (parseInt(c.credits) || 0), 0)
    const totalPurchased = (data.payments || [])
      .filter((p) => (parseInt(p.credits) || 0) > 0)
      .reduce((s, p) => s + (parseInt(p.credits) || 0), 0)
    const totalConsumed = (data.calls || []).reduce(
      (s, c) => s + (parseFloat(c.credits_billed) || 0),
      0
    )
    const lastRecharge = (data.payments || []).find((p) => parseInt(p.credits) > 0)
    return {
      totalBalance,
      totalPurchased,
      totalConsumed: totalConsumed.toFixed(1),
      lastRecharge: lastRecharge ? fmtShortDate(lastRecharge.created_at) : 'Never',
      activeClinics: clinics.filter((c) => c.status === 'active').length,
      totalClinics: clinics.length,
    }
  }, [data])

  // Filtered calls
  const filteredCalls = useMemo(() => {
    const calls = data?.calls || []
    const q = callSearch.trim().toLowerCase()
    const cf = clinicFilter.trim().toLowerCase()
    return calls.filter((c) => {
      const matchQ =
        !q ||
        (c.customer_name || '').toLowerCase().includes(q) ||
        (c.customer_phone || '').toLowerCase().includes(q) ||
        (c.campaign_name || '').toLowerCase().includes(q)
      const matchC = !cf || (c.clinic_name || '').toLowerCase().includes(cf)
      return matchQ && matchC
    })
  }, [data, callSearch, clinicFilter])

  // Filtered payments
  const filteredPayments = useMemo(() => {
    const payments = data?.payments || []
    const q = paySearch.trim().toLowerCase()
    const cf = clinicFilter.trim().toLowerCase()
    return payments.filter((p) => {
      const matchQ =
        !q ||
        (p.payment_id || p.id || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      const matchC = !cf || (p.clinic_name || '').toLowerCase().includes(cf)
      return matchQ && matchC
    })
  }, [data, paySearch, clinicFilter])

  // Unique clinic names for filter
  const clinicNames = useMemo(() => {
    if (!data) return []
    const names = new Set()
    ;(data.clinics || []).forEach((c) => names.add(c.name))
    return Array.from(names).sort()
  }, [data])

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-4 border-[#0f4c81] border-t-transparent animate-spin" />
          <p className="text-sm text-gray-500 font-medium">Loading credit data…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto mt-20 bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <span className="material-symbols-outlined text-4xl text-red-400 mb-2 block">error</span>
        <p className="text-red-700 font-semibold">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 pb-12 w-full">
      {/* Page Header */}
      <div className="border-b pb-6 border-gray-200">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-lg bg-[#eff6ff] flex items-center justify-center">
            <span className="material-symbols-outlined text-[20px] text-[#0f4c81]">credit_score</span>
          </div>
          <h2 className="text-3xl font-bold text-[#1e293b]">Credit Management</h2>
        </div>
        <p className="text-sm text-[#64748b] ml-12">
          Platform-wide credit balances, call consumption, and payment history across all clinics.
        </p>

        {/* Section tabs */}
        <div className="flex gap-2 mt-6 flex-wrap">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
                section === s.id
                  ? 'bg-[#0f4c81] text-white shadow-sm'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-[#0f4c81] hover:text-[#0f4c81]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{s.icon}</span>
              {s.label}
            </button>
          ))}

          {/* Clinic filter (shared) */}
          <div className="ml-auto">
            <select
              value={clinicFilter}
              onChange={(e) => setClinicFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-[#1e293b] bg-white focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] cursor-pointer"
            >
              <option value="">All Clinics</option>
              {clinicNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── OVERVIEW SECTION ─────────────────────────────────────────────── */}
      {section === 'overview' && stats && (
        <div className="flex flex-col gap-6">
          {/* Summary stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon="account_balance_wallet"
              label="Total Credit Balance"
              value={stats.totalBalance.toLocaleString()}
              sub={`Across ${stats.totalClinics} clinics`}
              accent="#0f4c81"
              bg="#eff6ff"
            />
            <StatCard
              icon="add_card"
              label="Total Purchased"
              value={Number(stats.totalPurchased).toLocaleString()}
              sub="All time credit purchases"
              accent="#15803d"
              bg="#f0fdf4"
            />
            <StatCard
              icon="call"
              label="Total Consumed"
              value={Number(stats.totalConsumed).toLocaleString()}
              sub="Credits used on calls"
              accent="#b45309"
              bg="#fffbeb"
            />
            <StatCard
              icon="event"
              label="Last Recharge"
              value={stats.lastRecharge}
              sub={`${stats.activeClinics} active clinics`}
              accent="#7c3aed"
              bg="#f5f3ff"
            />
          </div>

          {/* Per-clinic breakdown table */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center gap-3">
              <span className="material-symbols-outlined text-[20px] text-[#0f4c81]">table_chart</span>
              <h3 className="font-bold text-[#1e293b]">Credit Balance by Clinic</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Clinic</th>
                    <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Balance (Credits)</th>
                    <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Total Calls</th>
                    <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Credits Consumed</th>
                    <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Last Recharged</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-[#1e293b]">
                  {(data.clinics || [])
                    .filter((c) =>
                      !clinicFilter || c.name.toLowerCase().includes(clinicFilter.toLowerCase())
                    )
                    .map((clinic) => (
                      <tr key={clinic.id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="font-semibold">{clinic.name}</span>
                            <span className="text-gray-400 text-xs">{clinic.city}, {clinic.state}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                              clinic.status === 'active'
                                ? 'bg-green-100 text-green-700'
                                : clinic.status === 'trial'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {clinic.status}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <span
                            className={`font-bold text-base ${
                              parseInt(clinic.credits) > 50
                                ? 'text-green-600'
                                : parseInt(clinic.credits) > 10
                                ? 'text-amber-600'
                                : 'text-red-600'
                            }`}
                          >
                            {parseInt(clinic.credits) || 0}
                          </span>
                        </td>
                        <td className="p-4 text-right text-gray-600 font-medium">
                          {parseInt(clinic.call_count) || 0}
                        </td>
                        <td className="p-4 text-right text-[#b45309] font-semibold">
                          {parseFloat(clinic.credits_consumed || 0).toFixed(1)}
                        </td>
                        <td className="p-4 text-right text-gray-500 text-xs">
                          {clinic.last_recharged ? fmtShortDate(clinic.last_recharged) : '—'}
                        </td>
                      </tr>
                    ))}
                  {(data.clinics || []).length === 0 && (
                    <tr>
                      <td colSpan="6" className="p-8 text-center text-gray-400 italic">
                        No clinics found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── CALLS SECTION ────────────────────────────────────────────────── */}
      {section === 'calls' && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[20px] text-[#0f4c81]">phone_in_talk</span>
              <h3 className="font-bold text-[#1e293b]">Call Credit Consumption</h3>
              <span className="text-xs text-gray-400 font-medium">({filteredCalls.length} records)</span>
            </div>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[16px]">
                search
              </span>
              <input
                placeholder="Search patient, campaign…"
                value={callSearch}
                onChange={(e) => setCallSearch(e.target.value)}
                className="pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] w-56"
              />
            </div>
          </div>

          {/* Summary row */}
          <div className="flex gap-6 px-5 py-3 bg-[#eff6ff] border-b border-blue-100 text-sm flex-wrap">
            <span className="text-[#0f4c81] font-semibold">
              Total Credits Consumed:{' '}
              <strong>
                {filteredCalls.reduce((s, c) => s + (parseFloat(c.credits_billed) || 0), 0).toFixed(2)}
              </strong>
            </span>
            <span className="text-gray-500 hidden sm:block">|</span>
            <span className="text-gray-600">
              Completed:{' '}
              <strong>{filteredCalls.filter((c) => c.call_status === 'completed').length}</strong>
            </span>
            <span className="text-gray-500 hidden sm:block">|</span>
            <span className="text-gray-600">
              Avg Duration:{' '}
              <strong>
                {filteredCalls.length > 0
                  ? formatDuration(
                      Math.round(
                        filteredCalls.reduce((s, c) => s + (parseInt(c.duration_seconds) || 0), 0) /
                          filteredCalls.length
                      )
                    )
                  : '—'}
              </strong>
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Patient</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Clinic</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Campaign</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Duration</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Credits Used</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Outcome</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Status</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-[#1e293b]">
                {filteredCalls.map((call) => (
                  <tr key={call.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span className="font-semibold text-sm">{call.customer_name || '—'}</span>
                        <span className="text-gray-400 text-xs">{call.customer_phone}</span>
                      </div>
                    </td>
                    <td className="p-4 text-gray-600 text-xs font-medium">{call.clinic_name || '—'}</td>
                    <td className="p-4 text-gray-500 max-w-[140px] truncate text-xs">{call.campaign_name}</td>
                    <td className="p-4 text-right text-gray-700 font-medium">{formatDuration(call.duration_seconds)}</td>
                    <td className="p-4 text-right">
                      <span className="font-bold text-[#b45309] text-sm">
                        {parseFloat(call.credits_billed || 0).toFixed(2)}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <Badge variant={call.outcome === 'paid_now' ? 'primary' : 'secondary'}>
                        {call.outcome ? call.outcome.replace(/_/g, ' ') : 'None'}
                      </Badge>
                    </td>
                    <td className="p-4 text-right">
                      <span
                        className={`text-xs font-semibold uppercase ${
                          call.call_status === 'completed'
                            ? 'text-green-600'
                            : call.call_status === 'failed'
                            ? 'text-red-600'
                            : 'text-gray-400'
                        }`}
                      >
                        {call.call_status}
                      </span>
                    </td>
                    <td className="p-4 text-right text-gray-400 text-xs whitespace-nowrap">{fmtDate(call.created_at)}</td>
                  </tr>
                ))}
                {filteredCalls.length === 0 && (
                  <tr>
                    <td colSpan="8" className="p-8 text-center text-gray-400 italic">
                      No call records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── PAYMENTS SECTION ──────────────────────────────────────────────── */}
      {section === 'payments' && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[20px] text-[#0f4c81]">receipt_long</span>
              <h3 className="font-bold text-[#1e293b]">Credit Payment Transactions</h3>
              <span className="text-xs text-gray-400 font-medium">({filteredPayments.length} records)</span>
            </div>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[16px]">
                search
              </span>
              <input
                placeholder="Search payment ID, note…"
                value={paySearch}
                onChange={(e) => setPaySearch(e.target.value)}
                className="pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] w-56"
              />
            </div>
          </div>

          {/* Summary row */}
          <div className="flex gap-6 px-5 py-3 bg-[#f0fdf4] border-b border-green-100 text-sm flex-wrap">
            <span className="text-green-700 font-semibold">
              Total Credits Purchased:{' '}
              <strong>
                {filteredPayments
                  .filter((p) => parseInt(p.credits) > 0)
                  .reduce((s, p) => s + (parseInt(p.credits) || 0), 0)
                  .toLocaleString()}
              </strong>
            </span>
            <span className="text-gray-500 hidden sm:block">|</span>
            <span className="text-gray-600">
              Total Amount:{' '}
              <strong>
                ₹
                {filteredPayments
                  .filter((p) => (p.status || '').toLowerCase() === 'success')
                  .reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
                  .toFixed(2)}
              </strong>
            </span>
            <span className="text-gray-500 hidden sm:block">|</span>
            <span className="text-gray-600">
              Successful:{' '}
              <strong>
                {filteredPayments.filter((p) => (p.status || '').toLowerCase() === 'success').length}
              </strong>
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Reference</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Clinic</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Credits</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Amount (INR)</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Status</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-[#1e293b]">
                {filteredPayments.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span className="font-semibold text-xs font-mono text-gray-700 truncate max-w-[160px]">
                          {tx.payment_id || tx.id}
                        </span>
                        {tx.description && (
                          <span className="text-gray-400 text-[10px] truncate max-w-[160px]">{tx.description}</span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-gray-600 text-xs font-medium">{tx.clinic_name || '—'}</td>
                    <td className="p-4 text-right">
                      <span
                        className={`font-bold text-sm ${
                          parseInt(tx.credits) >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {parseInt(tx.credits) >= 0 ? `+${tx.credits}` : tx.credits}
                      </span>
                    </td>
                    <td className="p-4 text-right text-gray-700 font-semibold">
                      ₹{parseFloat(tx.amount || 0).toFixed(2)}
                    </td>
                    <td className="p-4 text-right">
                      <Badge
                        variant={
                          (tx.status || '').toLowerCase() === 'success' ? 'primary' : 'neutral'
                        }
                      >
                        {tx.status || 'Unknown'}
                      </Badge>
                    </td>
                    <td className="p-4 text-right text-gray-400 text-xs whitespace-nowrap">
                      {fmtDate(tx.created_at)}
                    </td>
                  </tr>
                ))}
                {filteredPayments.length === 0 && (
                  <tr>
                    <td colSpan="6" className="p-8 text-center text-gray-400 italic">
                      No payment transactions found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
