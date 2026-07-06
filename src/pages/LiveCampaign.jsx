import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import StatCard from '../components/ui/StatCard.jsx'
import ProgressBar from '../components/ui/ProgressBar.jsx'
import Badge from '../components/ui/Badge.jsx'
import VoiceCallBanner from '../components/ui/VoiceCallBanner.jsx'
import { api } from '../services/api.js'

const STATUS_ICON = {
  completed: { icon: 'check_circle', className: 'text-secondary', label: 'Completed' },
  Completed: { icon: 'check_circle', className: 'text-secondary', label: 'Completed' },
  in_progress: { icon: null, className: 'text-primary font-medium', label: 'In Progress' },
  'In Progress': { icon: null, className: 'text-primary font-medium', label: 'In Progress' },
  queued: { icon: null, className: 'text-outline font-medium animate-pulse', label: 'Queued' },
  not_answered: { icon: 'voicemail', className: 'text-on-surface-variant', label: 'Not Answered' },
  failed: { icon: 'cancel', className: 'text-error', label: 'Failed' },
}

const OUTCOME_VARIANT = {
  paid_now: 'primary',
  link_sent: 'secondary',
  call_later: 'neutral',
  already_paid: 'primary',
  not_interested: 'neutral',
  other: 'secondary',
}

function formatOutcome(outcome) {
  if (!outcome) return 'Pending';
  return outcome.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function LiveCampaign() {
  const navigate = useNavigate()
  const { id: campaignId } = useParams()
  
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmStop, setConfirmStop] = useState(false)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    async function fetchLiveStatus() {
      try {
        const liveData = await api.getLiveCampaign(campaignId)
        setData(liveData)
        setError('')
      } catch (err) {
        console.error('Error fetching live campaign status:', err);
        setError(err.message || 'Failed to update live dashboard');
      } finally {
        setLoading(false);
      }
    }

    fetchLiveStatus();
    
    // Set up polling every 3 seconds
    const interval = setInterval(fetchLiveStatus, 3000);
    return () => clearInterval(interval);
  }, [campaignId]);

  async function handleStopCampaign() {
    setStopping(true)
    try {
      await api.stopCampaign(campaignId)
      navigate(`/campaigns/${campaignId}/report`)
    } catch (err) {
      setError(err.message || 'Failed to stop campaign')
      setStopping(false)
      setConfirmStop(false)
    }
  }

  if (loading && !data) {
    return <div className="text-center py-20 font-body text-on-surface-variant">Connecting to live dialer dashboard...</div>;
  }

  if (error && !data) {
    return <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center">{error}</div>;
  }

  const { campaignName, status, stats, liveLines, recentCalls } = data;
  const isCompleted = status === 'completed' || status === 'paused';

  // Calculate completion percentage based on dialed calls
  const dialedCalls = stats.completedCalls + stats.failedCalls;
  const progressPercent = stats.totalCalls > 0 ? Math.round((dialedCalls / stats.totalCalls) * 100) : 0;

  return (
    <div className="flex flex-col gap-lg pb-12">
      {/* Floating voice session banner — shows when Pipecat bot is running */}
      <VoiceCallBanner campaignId={campaignId} />
      <header className="flex justify-between items-start flex-wrap gap-md">
        <div className="flex flex-col gap-xs">
          <div className="flex items-center gap-sm">
            <div className={`w-2 h-2 rounded-full ${isCompleted ? 'bg-outline' : 'bg-primary animate-pulse'}`} />
            <span className={`font-label-md text-label-md ${isCompleted ? 'text-on-surface-variant' : 'text-primary'}`}>
              {status === 'paused' ? 'Campaign Stopped' : isCompleted ? 'Campaign Finished' : 'Live Monitoring'}
            </span>
          </div>
          <h1 className="font-display text-headline-xl text-on-surface">
            {campaignName}
          </h1>
        </div>
        {isCompleted ? (
          <button
            onClick={() => navigate(`/campaigns/${campaignId}/report`)}
            className="bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md py-3 px-8 rounded-lg shadow-md transition-all flex items-center gap-sm"
          >
            <span className="material-symbols-outlined">summarize</span>
            View Final Report
          </button>
        ) : (
          <button
            onClick={() => setConfirmStop(true)}
            className="bg-error hover:opacity-90 text-on-primary font-label-md text-label-md py-3 px-8 rounded-lg shadow-md transition-all flex items-center gap-sm"
          >
            <span className="material-symbols-outlined">stop</span>
            Stop Campaign
          </button>
        )}
      </header>

      {/* Inline stop confirmation modal */}
      {confirmStop && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-md">
          <div className="bg-surface-container-lowest rounded-2xl shadow-xl border border-outline-variant/20 p-xl max-w-sm w-full flex flex-col gap-md items-center text-center">
            <div className="w-16 h-16 rounded-full bg-error-container flex items-center justify-center">
              <span className="material-symbols-outlined text-error text-[32px]">stop_circle</span>
            </div>
            <div>
              <h2 className="font-display text-headline-md text-on-surface mb-xs">Stop Campaign?</h2>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Active dialing will be terminated and the campaign will be marked as <strong>Stopped</strong>. This cannot be undone.
              </p>
            </div>
            {error && (
              <p className="text-error font-body-sm text-body-sm bg-error-container px-sm py-xs rounded-lg w-full">{error}</p>
            )}
            <div className="flex gap-sm w-full">
              <button
                onClick={() => { setConfirmStop(false); setError('') }}
                disabled={stopping}
                className="flex-1 py-sm rounded-lg border border-outline-variant font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-low transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleStopCampaign}
                disabled={stopping}
                className="flex-1 py-sm rounded-lg bg-error font-label-md text-label-md text-on-error hover:opacity-90 transition-all flex items-center justify-center gap-xs"
              >
                {stopping ? (
                  <><span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span> Stopping...</>
                ) : (
                  <><span className="material-symbols-outlined text-[16px]">stop</span> Yes, Stop It</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-5 gap-md">
        <StatCard label="Total Selected" value={String(stats.totalCalls)} icon="groups" />
        <StatCard label="Connected & Talked" value={String(stats.completedCalls)} icon="done_all" />
        <StatCard label="Live Line Calls" value={String(stats.activeCalls)} icon="sync" />
        <StatCard label="Failed / No Answer" value={String(stats.failedCalls)} icon="error" valueClassName="text-error" />
        <StatCard label="Collected Now" value={`$${stats.amountCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} icon="payments" valueClassName="text-primary" />
      </section>

      <section className="bg-surface-container-lowest shadow-ambient rounded-xl p-md flex flex-col gap-sm">
        <div className="flex justify-between items-end mb-xs">
          <h2 className="font-display text-headline-md text-on-surface">Outreach Progress</h2>
          <span className="font-display text-headline-md text-primary">{progressPercent}%</span>
        </div>
        <ProgressBar percent={progressPercent} shimmer={!isCompleted} />
        <div className="flex justify-between mt-xs">
          <span className="font-label-sm text-label-sm text-secondary">Dialed: {dialedCalls} / {stats.totalCalls}</span>
          <span className="font-label-sm text-label-sm text-secondary">
            {isCompleted ? 'Completed' : 'Estimated Completion: Today'}
          </span>
        </div>
      </section>

      {/* Active Dialer lines section */}
      {!isCompleted && (
        <section className="bg-surface-container-lowest border border-primary/20 shadow-ambient rounded-xl p-md flex flex-col gap-md">
          <h2 className="font-display text-headline-md text-primary flex items-center gap-xs">
            <span className="material-symbols-outlined animate-spin text-[24px]">ring_volume</span>
            Active Dialer Lines (Concurrent Channels)
          </h2>
          {liveLines.length === 0 ? (
            <p className="font-body-md text-body-md text-on-surface-variant italic py-2">
              Waiting to lock next lines in queue...
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-sm">
              {liveLines.map(line => (
                <div key={line.id} className="bg-surface-container-low border border-outline-variant/30 rounded-lg p-sm flex items-center justify-between">
                  <div>
                    <p className="font-label-md text-label-md text-on-surface">{line.name}</p>
                    <p className="font-body-sm text-body-sm text-secondary">{line.phone}</p>
                  </div>
                  <Badge variant={line.status === 'connected' ? 'primary' : 'neutral'}>
                    {line.status === 'connected' ? `Connected ${line.duration}` : 'Dialing...'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="bg-surface-container-lowest shadow-ambient rounded-xl overflow-hidden flex flex-col">
        <div className="p-md border-b border-surface-container-highest flex justify-between items-center">
          <h2 className="font-display text-headline-md text-on-surface">Recent Call Activity</h2>
          <button
            onClick={() => navigate(`/call-log?campaignId=${campaignId}`)}
            className="flex items-center gap-xs font-label-md text-label-md text-primary hover:bg-primary-fixed p-sm rounded-lg transition-colors"
          >
            View Full Call Log
            <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
          </button>
        </div>
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container-low border-b border-surface-container-highest">
              <tr>
                <th className="p-md font-label-sm text-label-sm text-secondary uppercase tracking-wider">Customer Name</th>
                <th className="p-md font-label-sm text-label-sm text-secondary uppercase tracking-wider">Status</th>
                <th className="p-md font-label-sm text-label-sm text-secondary uppercase tracking-wider text-right">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-highest">
              {recentCalls.length === 0 ? (
                <tr>
                  <td colSpan="3" className="p-md text-center text-on-surface-variant italic">No calls completed yet.</td>
                </tr>
              ) : (
                recentCalls.map((row) => {
                  const cfg = STATUS_ICON[row.status] || STATUS_ICON.queued
                  return (
                    <tr key={row.id} className="hover:bg-surface-bright transition-colors">
                      <td className="p-md">
                        <div className="flex flex-col">
                          <span className="font-label-md text-label-md text-on-surface">{row.name}</span>
                          <span className="font-body-sm text-body-sm text-secondary">Completed at {row.time}</span>
                        </div>
                      </td>
                      <td className="p-md">
                        <div className="flex items-center gap-xs">
                          {cfg.icon && <span className={`material-symbols-outlined text-[16px] ${cfg.className}`}>{cfg.icon}</span>}
                          {!cfg.icon && <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />}
                          <span className={`font-body-md text-body-md ${cfg.className}`}>{cfg.label}</span>
                        </div>
                      </td>
                      <td className="p-md text-right">
                        <Badge variant={OUTCOME_VARIANT[row.outcome] || 'secondary'}>
                          {formatOutcome(row.outcome)}
                        </Badge>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
