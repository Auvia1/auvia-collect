import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import StatCard from '../components/ui/StatCard.jsx'
import Button from '../components/ui/Button.jsx'
import Badge from '../components/ui/Badge.jsx'
import { api, fetchRecordingBlobUrl } from '../services/api.js'

const CALL_STATUS_VARIANT = {
  Completed: 'success',
  'Not Answered': 'neutral',
  Failed: 'error',
  'In Progress': 'info',
  Queued: 'neutral',
}

const PAYMENT_STATUS_VARIANT = {
  Paid: 'success',
  Unpaid: 'neutral',
  'Payment Link Sent': 'warning',
}

const OUTCOME_BADGE_VARIANT = {
  paid_now: { variant: 'success', label: 'Paid Now' },
  already_paid: { variant: 'success', label: 'Already Paid' },
  link_sent: { variant: 'warning', label: 'Link Sent' },
  call_later: { variant: 'neutral', label: 'Call Later' },
  not_interested: { variant: 'error', label: 'Not Interested' },
  other: { variant: 'neutral', label: 'Other / Max Retries' },
  NULL: { variant: 'neutral', label: 'Not Called' },
}

export default function CampaignReport() {
  const { id: campaignId } = useParams()
  const navigate = useNavigate()
  
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Contact outcome filters state
  const [paymentFilter, setPaymentFilter] = useState('all') // 'all' | 'paid' | 'unpaid'
  const [outcomeFilter, setOutcomeFilter] = useState('all') // 'all' | 'paid_now' | 'link_sent' | 'call_later' | 'already_paid' | 'not_interested' | 'other' | 'NULL'
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedContactModal, setSelectedContactModal] = useState(null)

  const [playingCallId, setPlayingCallId] = useState(null)
  const [loadingCallId, setLoadingCallId] = useState(null)
  const audioRef = useRef(null)
  const blobUrlRef = useRef(null)

  // Cleanup audio and blob URL on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  useEffect(() => {
    async function loadReport() {
      try {
        const reportData = await api.getCampaignReport(campaignId)
        setData(reportData)
      } catch (err) {
        console.error('Error fetching campaign report:', err)
        setError(err.message || 'Failed to load campaign report')
      } finally {
        setLoading(false)
      }
    }
    loadReport()
  }, [campaignId])

  if (loading) {
    return <div className="text-center py-20 font-body text-on-surface-variant">Generating campaign summary reports...</div>;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-md items-center py-10">
        <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center w-full max-w-2xl">{error || 'Failed to load report'}</div>
        <Button onClick={() => navigate('/campaigns')}>Back to Campaigns</Button>
      </div>
    );
  }

  const { campaignName, status, completedDate, stats, outcomes, sentiment, calls, contacts = [] } = data;
  const remainingAmount = stats.totalBilled - stats.totalCollected;

  const handlePlayToggle = async (call) => {
    if (!call.hasRecording) return;

    if (playingCallId === call.id) {
      if (audioRef.current) audioRef.current.pause();
      setPlayingCallId(null);
      return;
    }

    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }

    setLoadingCallId(call.id);
    try {
      const blobUrl = await fetchRecordingBlobUrl(call.id);
      blobUrlRef.current = blobUrl;
      const audio = new Audio(blobUrl);
      audioRef.current = audio;
      audio.addEventListener('ended', () => setPlayingCallId(null));
      audio.addEventListener('error', () => setPlayingCallId(null));
      await audio.play();
      setPlayingCallId(call.id);
    } catch (e) {
      console.error('Failed to load/play recording:', e);
    } finally {
      setLoadingCallId(null);
    }
  };

  function handleExportCSV() {
    if (!data) return;
    let csv = "Metric,Value\n";
    csv += `Campaign Name,${campaignName}\n`;
    csv += `Completed Date,${new Date(completedDate).toLocaleDateString()}\n`;
    csv += `Total Billed,${stats.totalBilled}\n`;
    csv += `Total Collected,${stats.totalCollected}\n`;
    csv += `Remaining Outstanding,${stats.totalBilled - stats.totalCollected}\n`;
    csv += `Success Rate,${stats.successRate}%\n`;
    csv += `Total Selected,${stats.totalCalls}\n`;
    csv += `Calls Connected,${stats.answeredCalls}\n`;
    csv += `Not Answered,${stats.totalCalls - stats.answeredCalls}\n`;
    csv += `Paid Now,${outcomes.paidNow}\n`;
    csv += `Link Sent,${outcomes.linkSent}\n`;
    csv += `Call Later,${outcomes.callLater}\n`;
    csv += `Already Paid,${outcomes.alreadyPaid}\n`;
    csv += `Not Interested,${outcomes.notInterested}\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${campaignName.replace(/\s+/g, '_')}_report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    api.logActivity({
      action: 'Report Exported',
      category: 'campaign',
      description: `Campaign report (CSV) downloaded for "${campaignName}" from Campaign Report section`,
      metadata: { section: 'Campaign Report', campaignName, format: 'CSV' }
    }).catch(() => {});
  }

  function handleExportExcel() {
    if (!data) return;
    let xls = "Metric\tValue\n";
    xls += `Campaign Name\t${campaignName}\n`;
    xls += `Completed Date\t${new Date(completedDate).toLocaleDateString()}\n`;
    xls += `Total Billed\t${stats.totalBilled}\n`;
    xls += `Total Collected\t${stats.totalCollected}\n`;
    xls += `Remaining Outstanding\t${stats.totalBilled - stats.totalCollected}\n`;
    xls += `Success Rate\t${stats.successRate}%\n`;
    xls += `Total Selected\t${stats.totalCalls}\n`;
    xls += `Calls Connected\t${stats.answeredCalls}\n`;
    xls += `Not Answered\t${stats.totalCalls - stats.answeredCalls}\n`;
    xls += `Paid Now\t${outcomes.paidNow}\n`;
    xls += `Link Sent\t${outcomes.linkSent}\n`;
    xls += `Call Later\t${outcomes.callLater}\n`;
    xls += `Already Paid\t${outcomes.alreadyPaid}\n`;
    xls += `Not Interested\t${outcomes.notInterested}\n`;

    const blob = new Blob([xls], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${campaignName.replace(/\s+/g, '_')}_report.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    api.logActivity({
      action: 'Report Exported',
      category: 'campaign',
      description: `Campaign report (Excel) downloaded for "${campaignName}" from Campaign Report section`,
      metadata: { section: 'Campaign Report', campaignName, format: 'Excel' }
    }).catch(() => {});
  }

  function handleExportPDF() {
    window.print();
  }

  // Filter contacts based on payment status, outcome, and search
  const filteredContacts = contacts.filter((c) => {
    if (paymentFilter === 'paid' && !c.isPaid) return false;
    if (paymentFilter === 'unpaid' && c.isPaid) return false;

    if (outcomeFilter !== 'all') {
      if (outcomeFilter === 'NULL') {
        if (c.outcome && c.outcome !== 'NULL') return false;
      } else {
        if (c.outcome !== outcomeFilter) return false;
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const nameMatch = c.name.toLowerCase().includes(q);
      const phoneMatch = c.phone.toLowerCase().includes(q);
      if (!nameMatch && !phoneMatch) return false;
    }

    return true;
  });

  const paidCount = contacts.filter((c) => c.isPaid).length;
  const unpaidCount = contacts.length - paidCount;

  const SUMMARY_STATS = [
    { label: 'Total Selected', value: String(stats.totalCalls), icon: 'groups', valueClassName: 'text-primary' },
    { label: 'Calls Connected', value: String(stats.answeredCalls), icon: 'call', valueClassName: 'text-primary' },
    { label: 'Not Answered', value: String(stats.totalCalls - stats.answeredCalls), icon: 'phone_missed' },
    { label: 'Payments Completed', value: String(outcomes.paidNow + outcomes.alreadyPaid), icon: 'check_circle', valueClassName: 'text-primary' },
    { label: 'Payment Links Sent', value: String(outcomes.linkSent), icon: 'link', valueClassName: 'text-primary' },
    { label: 'Scheduled Callback', value: String(outcomes.callLater), icon: 'schedule' },
    { label: 'Already Paid', value: String(outcomes.alreadyPaid), icon: 'task_alt' },
    { label: 'Refused / Dispute', value: String(outcomes.notInterested), icon: 'thumb_down' },
    { label: 'Avg Call Time', value: stats.avgCallDuration, icon: 'timer' },
    { label: 'Success Rate', value: `${stats.successRate}%`, icon: 'insights', valueClassName: 'text-primary' },
  ];

  return (
    <div className="flex flex-col gap-lg pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-sm border-b border-surface-variant pb-md">
        <div>
          <button
            onClick={() => navigate('/campaigns')}
            className="inline-flex items-center text-body-sm font-body-sm text-secondary hover:text-primary mb-2 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px] mr-1">arrow_back</span>
            Back to Campaigns
          </button>
          <h1 className="font-display text-headline-xl text-on-surface">
            {campaignName} — Report
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {status === 'paused' ? 'Stopped' : 'Completed'} on {new Date(completedDate).toLocaleDateString()}
          </p>
        </div>
        <span className={`${status === 'paused' ? 'bg-error/10 text-error border border-error/20' : 'bg-secondary-container text-on-secondary-container'} px-sm py-xs rounded-full font-label-sm text-label-sm uppercase tracking-wider`}>
          {status === 'paused' ? 'Stopped' : 'Completed'}
        </span>
      </div>

      {/* Financial Summary */}
      <section className="bg-surface-container-lowest rounded-xl p-lg shadow-ambient border border-surface-container-low">
        <h2 className="font-display text-headline-lg text-on-surface mb-lg text-center md:text-left">
          Financial Summary
        </h2>
        <div className="flex flex-col md:flex-row items-center gap-xl">
          <div className="flex-grow grid grid-cols-1 md:grid-cols-3 gap-lg w-full">
            <div className="flex flex-col gap-xs p-md bg-surface rounded-lg border border-surface-variant">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">
                Total Billed
              </span>
              <span className="font-display text-headline-lg text-on-surface">
                ₹{stats.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex flex-col gap-xs p-md bg-primary-container rounded-lg border border-primary-container">
              <span className="font-label-md text-label-md text-on-primary-container uppercase tracking-wider">
                Total Collected
              </span>
              <span className="font-display text-headline-lg text-on-primary-container">
                ₹{stats.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex flex-col gap-xs p-md bg-surface rounded-lg border border-surface-variant">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">
                Remaining Outstanding
              </span>
              <span className="font-display text-headline-lg text-on-surface">
                ₹{remainingAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <div className="shrink-0 flex flex-col items-center justify-center p-md bg-surface rounded-full w-48 h-48 border-[8px] border-surface-variant relative shadow-inner">
            <div
              className="absolute inset-0 rounded-full border-[8px] border-primary"
              style={{
                clipPath: 'polygon(50% 50%, 50% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 50%, 50% 50%)',
                transform: `rotate(${Math.round(stats.successRate * 3.6)}deg)`,
              }}
            />
            <div className="bg-surface-container-lowest w-36 h-36 rounded-full absolute flex flex-col items-center justify-center z-10">
              <span className="font-display text-headline-xl text-primary">{stats.successRate}%</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">Collected</span>
            </div>
          </div>
        </div>
      </section>

      {/* Metrics & Sentiment */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
        <div className="lg:col-span-2 bg-surface-container-lowest rounded-2xl shadow-ambient border border-outline-variant/20 p-md flex flex-col gap-base">
          <h2 className="font-display text-headline-sm text-on-surface">Call Performance Metrics</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-sm">
            {SUMMARY_STATS.map((s, idx) => (
              <StatCard key={idx} label={s.label} value={s.value} icon={s.icon} valueClassName={s.valueClassName} />
            ))}
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-2xl shadow-ambient border border-outline-variant/20 p-md flex flex-col gap-base">
          <h2 className="font-display text-headline-sm text-on-surface">Sentiment Breakdown</h2>
          <div className="space-y-sm my-auto">
            {Object.entries(sentiment).map(([key, val]) => {
              const maxVal = Math.max(...Object.values(sentiment)) || 1
              const percentage = Math.round((val / maxVal) * 100)
              return (
                <div key={key} className="space-y-xs">
                  <div className="flex justify-between text-body-sm font-body-sm">
                    <span className="capitalize text-on-surface">{key}</span>
                    <span className="font-medium text-on-surface-variant">{val} calls</span>
                  </div>
                  <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden">
                    <div className="bg-primary h-full rounded-full" style={{ width: `${percentage}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 🚀 NEW SECTION: Selected Contacts & Payment Outcomes Card */}
      <section className="bg-surface-container-lowest rounded-2xl shadow-ambient border border-outline-variant/20 p-md flex flex-col gap-md">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-sm border-b border-surface-variant pb-sm">
          <div>
            <h2 className="font-display text-headline-sm text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">group</span>
              Selected Contacts & Payment Outcomes
            </h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
              Review who paid, who is unpaid, and view call histories for each contact in this campaign.
            </p>
          </div>
          <div className="flex items-center gap-2 font-label-md text-label-md">
            <span className="bg-surface-bright text-on-surface px-3 py-1 rounded-full border border-surface-variant">
              Total: <strong>{contacts.length}</strong>
            </span>
            <span className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
              Paid: <strong>{paidCount}</strong>
            </span>
            <span className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 px-3 py-1 rounded-full border border-amber-200 dark:border-amber-800">
              Unpaid: <strong>{unpaidCount}</strong>
            </span>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-md bg-surface-bright/50 p-sm rounded-xl border border-surface-variant">
          {/* Payment Status Buttons */}
          <div className="flex items-center gap-1 bg-surface-container-high p-1 rounded-lg">
            <button
              onClick={() => setPaymentFilter('all')}
              className={`px-3 py-1.5 rounded-md font-label-sm text-label-sm transition-all ${
                paymentFilter === 'all'
                  ? 'bg-surface-container-lowest text-primary shadow-sm font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              All ({contacts.length})
            </button>
            <button
              onClick={() => setPaymentFilter('paid')}
              className={`px-3 py-1.5 rounded-md font-label-sm text-label-sm transition-all ${
                paymentFilter === 'paid'
                  ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                  : 'text-on-surface-variant hover:text-emerald-700'
              }`}
            >
              Paid ({paidCount})
            </button>
            <button
              onClick={() => setPaymentFilter('unpaid')}
              className={`px-3 py-1.5 rounded-md font-label-sm text-label-sm transition-all ${
                paymentFilter === 'unpaid'
                  ? 'bg-amber-600 text-white shadow-sm font-semibold'
                  : 'text-on-surface-variant hover:text-amber-700'
              }`}
            >
              Unpaid ({unpaidCount})
            </button>
          </div>

          {/* Outcome Filter Dropdown & Search */}
          <div className="flex flex-wrap items-center gap-sm">
            <div className="flex items-center gap-2">
              <span className="font-label-sm text-label-sm text-on-surface-variant">Outcome:</span>
              <select
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value)}
                className="bg-surface-container-lowest border border-surface-variant rounded-lg px-3 py-1.5 text-body-sm font-body-sm text-on-surface focus:outline-none focus:border-primary"
              >
                <option value="all">All Outcomes</option>
                <option value="paid_now">paid_now (Paid Now)</option>
                <option value="link_sent">link_sent (Link Sent)</option>
                <option value="call_later">call_later (Scheduled Callback)</option>
                <option value="already_paid">already_paid (Already Paid)</option>
                <option value="not_interested">not_interested (Refused)</option>
                <option value="other">other (Max Retries / Ended)</option>
                <option value="NULL">NULL (Not Called)</option>
              </select>
            </div>

            <div className="relative flex-1 md:w-56">
              <span className="material-symbols-outlined absolute left-2.5 top-2.5 text-[18px] text-on-surface-variant">
                search
              </span>
              <input
                type="text"
                placeholder="Search contact..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-surface-container-lowest border border-surface-variant rounded-lg pl-8 pr-3 py-1.5 text-body-sm font-body-sm text-on-surface focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* Selected Contacts Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead>
              <tr className="bg-surface-bright text-on-surface-variant text-label-sm font-label-sm uppercase tracking-wider">
                <th className="px-md py-sm font-medium">Customer</th>
                <th className="px-md py-sm font-medium">Amount Due</th>
                <th className="px-md py-sm font-medium">Payment Status</th>
                <th className="px-md py-sm font-medium">Call Outcome</th>
                <th className="px-md py-sm font-medium text-center">Attempts</th>
                <th className="px-md py-sm font-medium">Latest Summary</th>
                <th className="px-md py-sm font-medium text-center">Action</th>
              </tr>
            </thead>
            <tbody className="text-body-sm font-body-sm divide-y divide-surface-container-high">
              {filteredContacts.map((contact) => {
                const outcomeInfo = OUTCOME_BADGE_VARIANT[contact.outcome] || { variant: 'neutral', label: contact.outcome };
                const contactCalls = calls ? calls.filter((c) => c.name === contact.name || c.phone === contact.phone) : [];

                return (
                  <tr key={contact.id} className="hover:bg-surface-bright/70 transition-colors">
                    <td className="px-md py-sm">
                      <div className="font-medium text-on-surface">{contact.name}</div>
                      <div className="text-on-surface-variant text-xs">{contact.phone}</div>
                    </td>
                    <td className="px-md py-sm font-medium text-on-surface">
                      ₹{contact.amount.toFixed(2)}
                    </td>
                    <td className="px-md py-sm">
                      <Badge variant={PAYMENT_STATUS_VARIANT[contact.paymentStatus] || 'neutral'}>
                        {contact.paymentStatus}
                      </Badge>
                    </td>
                    <td className="px-md py-sm">
                      <Badge variant={outcomeInfo.variant}>
                        {outcomeInfo.label}
                      </Badge>
                    </td>
                    <td className="px-md py-sm text-center">
                      <span className="bg-surface-container-high px-2 py-0.5 rounded-full text-xs font-mono font-medium text-on-surface">
                        {contact.attemptsCount} {contact.attemptsCount === 1 ? 'call' : 'calls'}
                      </span>
                    </td>
                    <td className="px-md py-sm max-w-xs truncate text-on-surface-variant" title={contact.latestSummary}>
                      {contact.latestSummary}
                    </td>
                    <td className="px-md py-sm text-center">
                      <button
                        onClick={() => setSelectedContactModal({ contact, calls: contactCalls })}
                        className="inline-flex items-center gap-1 text-primary hover:text-primary/80 font-medium text-xs bg-primary/10 hover:bg-primary/20 px-2.5 py-1 rounded-md transition-all"
                        aria-label={`View call logs for ${contact.name}`}
                      >
                        <span className="material-symbols-outlined text-[16px]">history</span>
                        View History
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredContacts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-md py-lg text-center text-on-surface-variant italic">
                    No contacts match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 🚀 MOVED TO BOTTOM: Campaign Call Logs Table */}
      <section className="bg-surface-container-lowest rounded-2xl shadow-ambient border border-outline-variant/20 p-md flex flex-col gap-base">
        <div className="flex justify-between items-center border-b border-surface-variant pb-sm">
          <div>
            <h2 className="font-display text-headline-sm text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">call_log</span>
              Campaign Call Logs History
            </h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
              Complete chronological audit trail of all automated and manual call attempts made in this campaign.
            </p>
          </div>
          <span className="text-body-sm font-medium text-on-surface-variant">
            Total Logs: {calls ? calls.length : 0}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead>
              <tr className="bg-surface-bright text-on-surface-variant text-label-sm font-label-sm uppercase tracking-wider">
                <th className="px-md py-sm font-medium">Customer</th>
                <th className="px-md py-sm font-medium">Amount Due</th>
                <th className="px-md py-sm font-medium">Call Status</th>
                <th className="px-md py-sm font-medium">Payment Status</th>
                <th className="px-md py-sm font-medium">Duration</th>
                <th className="px-md py-sm font-medium">Feedback / Summary</th>
                <th className="px-md py-sm font-medium text-center">Action</th>
              </tr>
            </thead>
            <tbody className="text-body-sm font-body-sm divide-y divide-surface-container-high">
              {calls && calls.map((row) => (
                <tr key={row.id} className="hover:bg-surface-bright transition-colors">
                  <td className="px-md py-sm">
                    <div className="font-medium text-on-surface">{row.name}</div>
                    <div className="text-on-surface-variant text-xs">{row.phone}</div>
                  </td>
                  <td className="px-md py-sm text-on-surface">₹{row.amount.toFixed(2)}</td>
                  <td className="px-md py-sm">
                    <Badge variant={CALL_STATUS_VARIANT[row.callStatus] || 'neutral'}>{row.callStatus}</Badge>
                  </td>
                  <td className="px-md py-sm">
                    <Badge variant={PAYMENT_STATUS_VARIANT[row.paymentStatus] || 'neutral'}>{row.paymentStatus}</Badge>
                  </td>
                  <td className="px-md py-sm text-on-surface-variant">{row.duration}</td>
                  <td className="px-md py-sm">
                    <div className="flex items-center gap-2 max-w-xs text-on-surface-variant">
                      <button
                        disabled={!row.hasRecording || loadingCallId === row.id}
                        onClick={() => handlePlayToggle(row)}
                        className={row.hasRecording ? 'text-primary hover:opacity-80 active:scale-90 transition-transform' : 'text-outline/50 cursor-not-allowed'}
                        aria-label={playingCallId === row.id ? 'Pause recording' : loadingCallId === row.id ? 'Loading...' : 'Play recording'}
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          {loadingCallId === row.id ? 'hourglass_top' : playingCallId === row.id ? 'pause_circle' : 'play_circle'}
                        </span>
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

              {(!calls || calls.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-md py-lg text-center text-on-surface-variant italic">
                    No call logs registered for this campaign.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Export Section */}
      <section className="flex flex-col md:flex-row justify-end items-center gap-md pt-lg pb-xl border-t border-surface-variant">
        <span className="font-body-md text-body-md text-on-surface-variant mr-auto">
          Download comprehensive reports:
        </span>
        <Button variant="secondary" icon="table_chart" onClick={handleExportCSV}>Export CSV</Button>
        <Button variant="secondary" icon="description" onClick={handleExportExcel}>Export Excel</Button>
        <Button icon="picture_as_pdf" onClick={handleExportPDF}>Export PDF</Button>
      </section>

      {/* 🚀 CONTACT CALL HISTORY MODAL */}
      {selectedContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-md">
          <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-md bg-surface-bright border-b border-surface-variant">
              <div>
                <h3 className="font-display text-headline-sm text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">person</span>
                  {selectedContactModal.contact.name}
                </h3>
                <p className="text-body-sm text-on-surface-variant">
                  Phone: {selectedContactModal.contact.phone} | Amount Due: <strong>₹{selectedContactModal.contact.amount.toFixed(2)}</strong>
                </p>
              </div>
              <button
                onClick={() => setSelectedContactModal(null)}
                className="text-on-surface-variant hover:text-on-surface p-1 rounded-full hover:bg-surface-container-high transition-colors"
                aria-label="Close modal"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-md overflow-y-auto flex-1 flex flex-col gap-md">
              <div className="flex flex-wrap items-center gap-md p-sm bg-surface rounded-xl border border-surface-variant">
                <div>
                  <span className="text-xs text-on-surface-variant block">Payment Status</span>
                  <Badge variant={PAYMENT_STATUS_VARIANT[selectedContactModal.contact.paymentStatus] || 'neutral'}>
                    {selectedContactModal.contact.paymentStatus}
                  </Badge>
                </div>
                <div>
                  <span className="text-xs text-on-surface-variant block">Latest Outcome</span>
                  <Badge variant={(OUTCOME_BADGE_VARIANT[selectedContactModal.contact.outcome] || {}).variant || 'neutral'}>
                    {(OUTCOME_BADGE_VARIANT[selectedContactModal.contact.outcome] || {}).label || selectedContactModal.contact.outcome}
                  </Badge>
                </div>
                <div>
                  <span className="text-xs text-on-surface-variant block">Total Attempts</span>
                  <span className="font-medium text-body-sm">{selectedContactModal.calls.length} calls</span>
                </div>
              </div>

              <h4 className="font-display text-title-md text-on-surface border-b border-surface-variant pb-xs">
                Call Attempt History ({selectedContactModal.calls.length})
              </h4>

              {selectedContactModal.calls.length > 0 ? (
                <div className="flex flex-col gap-sm">
                  {selectedContactModal.calls.map((call, idx) => (
                    <div key={call.id} className="p-md bg-surface-bright rounded-xl border border-surface-variant flex flex-col gap-xs">
                      <div className="flex justify-between items-center">
                        <span className="font-label-md text-label-md text-primary font-semibold">
                          Attempt #{selectedContactModal.calls.length - idx}
                        </span>
                        <div className="flex items-center gap-2">
                          <Badge variant={CALL_STATUS_VARIANT[call.callStatus] || 'neutral'}>
                            {call.callStatus}
                          </Badge>
                          <span className="text-xs text-on-surface-variant">{call.duration}</span>
                        </div>
                      </div>

                      <div className="text-body-sm text-on-surface mt-1">
                        <strong>AI Summary:</strong> {call.summary}
                      </div>

                      <div className="flex justify-between items-center mt-2 pt-2 border-t border-surface-container-high text-xs text-on-surface-variant">
                        <div className="flex items-center gap-2">
                          {call.hasRecording ? (
                            <button
                              disabled={loadingCallId === call.id}
                              onClick={() => handlePlayToggle(call)}
                              className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                {playingCallId === call.id ? 'pause_circle' : 'play_circle'}
                              </span>
                              {playingCallId === call.id ? 'Pause Audio' : 'Play Audio Recording'}
                            </button>
                          ) : (
                            <span className="italic text-outline">No Recording</span>
                          )}
                        </div>

                        <button
                          onClick={() => {
                            setSelectedContactModal(null);
                            navigate(`/call-log/${call.id}`);
                          }}
                          className="text-primary hover:underline font-medium inline-flex items-center gap-0.5"
                        >
                          Full Details
                          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-on-surface-variant italic">
                  No call attempts logged yet for this contact in this campaign.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-sm bg-surface-bright border-t border-surface-variant flex justify-end">
              <Button variant="secondary" onClick={() => setSelectedContactModal(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
