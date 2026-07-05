import { useMemo, useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Button from '../components/ui/Button.jsx'
import Badge from '../components/ui/Badge.jsx'
import { api } from '../services/api.js'

const CALL_STATUS_VARIANT = {
  Completed: 'success',
  'Not Answered': 'neutral',
  Failed: 'error',
}

const PAYMENT_STATUS_VARIANT = {
  Paid: 'success',
  Unpaid: 'neutral',
  'Payment Link Sent': 'warning',
}

export default function CallLog() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  
  const [calls, setCalls] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [search, setSearch] = useState('')
  const [campaignFilter, setCampaignFilter] = useState(searchParams.get('campaignId') || '')
  const [callStatusFilter, setCallStatusFilter] = useState('')
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('')
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const cId = searchParams.get('campaignId')
    if (cId) {
      setCampaignFilter(cId)
    }
  }, [searchParams])

  useEffect(() => {
    async function loadData() {
      try {
        const [callsData, campaignsData] = await Promise.all([
          api.getCalls(),
          api.getCampaigns()
        ]);
        setCalls(callsData);
        setCampaigns(campaignsData);
      } catch (err) {
        console.error('Error loading call logs:', err);
        setError(err.message || 'Failed to load call log details.');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return calls.filter((row) => {
      const matchesSearch =
        !query || row.name.toLowerCase().includes(query) || row.phone.includes(query)
      const matchesCampaign = !campaignFilter || row.campaignId === campaignFilter
      const matchesCallStatus = !callStatusFilter || row.callStatus === callStatusFilter
      const matchesPaymentStatus = !paymentStatusFilter || row.paymentStatus === paymentStatusFilter
      return matchesSearch && matchesCampaign && matchesCallStatus && matchesPaymentStatus
    })
  }, [search, campaignFilter, callStatusFilter, paymentStatusFilter, calls])

  function handleExport() {
    const csvRows = [
      ['Customer Name', 'Phone', 'Amount Due', 'Call Status', 'Payment Status', 'Duration', 'AI Summary']
    ]
    filteredRows.forEach((row) => {
      csvRows.push([
        `"${row.name.replace(/"/g, '""')}"`,
        `"${row.phone}"`,
        row.amount.toFixed(2),
        row.callStatus,
        row.paymentStatus,
        `"${row.duration}"`,
        `"${(row.summary || '').replace(/"/g, '""')}"`
      ])
    })
    const csvContent = 'data:text/csv;charset=utf-8,' + csvRows.map((e) => e.join(',')).join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `call_logs_export_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (loading) {
    return <div className="text-center py-20 font-body text-on-surface-variant">Loading calling records...</div>;
  }

  if (error) {
    return <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center">{error}</div>;
  }

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-sm">
        <div>
          <h1 className="font-display text-headline-lg-mobile md:text-headline-lg text-on-surface mb-xs">Call Log</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Detailed record of every call, its outcome, and payment status.
          </p>
        </div>
        <div className="flex gap-sm w-full md:w-auto">
          <Button icon="download" onClick={handleExport}>Export</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-surface-container-lowest rounded-xl shadow-ambient p-sm flex flex-wrap gap-sm items-center border border-outline-variant/30">
        <div className="relative flex-grow max-w-sm">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-sm">search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers or numbers..."
            className="w-full pl-10 pr-4 py-2 border border-outline-variant rounded-lg text-body-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors text-on-surface"
          />
        </div>

        <select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          className="border border-outline-variant rounded-lg px-3 py-2 text-body-sm text-on-surface-variant bg-transparent focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer"
        >
          <option value="">Campaign: All</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          value={callStatusFilter}
          onChange={(e) => setCallStatusFilter(e.target.value)}
          className="border border-outline-variant rounded-lg px-3 py-2 text-body-sm text-on-surface-variant bg-transparent focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer"
        >
          <option value="">Call Status: All</option>
          <option>Completed</option>
          <option>Not Answered</option>
          <option>Failed</option>
        </select>

        <select
          value={paymentStatusFilter}
          onChange={(e) => setPaymentStatusFilter(e.target.value)}
          className="border border-outline-variant rounded-lg px-3 py-2 text-body-sm text-on-surface-variant bg-transparent focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer"
        >
          <option value="">Payment: All</option>
          <option>Paid</option>
          <option>Unpaid</option>
          <option>Payment Link Sent</option>
        </select>

        {(search || campaignFilter || callStatusFilter || paymentStatusFilter) && (
          <button
            onClick={() => {
              setSearch('')
              setCampaignFilter('')
              setCallStatusFilter('')
              setPaymentStatusFilter('')
            }}
            className="font-label-sm text-label-sm text-primary hover:underline ml-auto"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-ambient overflow-hidden border border-outline-variant/20">
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead>
              <tr className="bg-surface-bright text-on-surface-variant text-label-sm font-label-sm uppercase tracking-wider">
                <th className="px-md py-sm font-medium">Customer</th>
                <th className="px-md py-sm font-medium">Campaign</th>
                <th className="px-md py-sm font-medium">Amount Due</th>
                <th className="px-md py-sm font-medium">Call Status</th>
                <th className="px-md py-sm font-medium">Payment Status</th>
                <th className="px-md py-sm font-medium">Duration</th>
                <th className="px-md py-sm font-medium">Feedback / Summary</th>
                <th className="px-md py-sm font-medium text-center">Action</th>
              </tr>
            </thead>
            <tbody className="text-body-sm font-body-sm divide-y divide-surface-container-high">
              {filteredRows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-bright transition-colors">
                  <td className="px-md py-sm">
                    <div className="font-medium text-on-surface">{row.name}</div>
                    <div className="text-on-surface-variant text-xs">{row.phone}</div>
                  </td>
                  <td className="px-md py-sm">
                    <button
                      onClick={() => setCampaignFilter(row.campaignId)}
                      className="text-on-surface-variant hover:text-primary hover:underline transition-colors text-left"
                      title="Filter call log by this campaign"
                    >
                      {row.campaignName}
                    </button>
                  </td>
                  <td className="px-md py-sm text-on-surface">${row.amount.toFixed(2)}</td>
                  <td className="px-md py-sm">
                    <Badge variant={CALL_STATUS_VARIANT[row.callStatus]}>{row.callStatus}</Badge>
                  </td>
                  <td className="px-md py-sm">
                    <Badge variant={PAYMENT_STATUS_VARIANT[row.paymentStatus]}>{row.paymentStatus}</Badge>
                  </td>
                  <td className="px-md py-sm text-on-surface-variant">{row.duration}</td>
                  <td className="px-md py-sm">
                    <div className="flex items-center gap-2 max-w-xs text-on-surface-variant">
                      <button
                        disabled={!row.hasRecording}
                        className={row.hasRecording ? 'text-primary hover:opacity-80' : 'text-outline/50 cursor-not-allowed'}
                        aria-label="Play recording"
                      >
                        <span className="material-symbols-outlined text-[18px]">play_circle</span>
                      </button>
                      <span className={`truncate ${!row.hasRecording ? 'italic text-outline' : ''}`} title={row.summary}>
                        {row.summary}
                      </span>
                    </div>
                  </td>
                  <td className="px-md py-sm text-center">
                    <button
                      onClick={() => navigate(`/call-log/${row.id}`)}
                      className="text-outline hover:text-primary transition-colors"
                      aria-label={`View details for ${row.name}`}
                    >
                      <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                    </button>
                  </td>
                </tr>
              ))}

              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-md py-lg text-center text-on-surface-variant">
                    No calls match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-surface-container-high px-md py-sm flex items-center justify-between bg-surface-container-lowest">
          <span className="text-body-sm text-on-surface-variant">
            Showing {filteredRows.length} of {calls.length} results
          </span>
          <div className="flex gap-2">
            <button className="px-3 py-1 border border-outline-variant rounded text-label-sm text-on-surface-variant disabled:opacity-50" disabled>
              Prev
            </button>
            <button className="px-3 py-1 border border-outline-variant rounded text-label-sm text-on-surface-variant hover:bg-surface-bright transition-colors">
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
