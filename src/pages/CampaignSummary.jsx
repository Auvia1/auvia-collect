import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import StatCard from '../components/ui/StatCard.jsx'
import { api } from '../services/api.js'

export default function CampaignSummary() {
  const navigate = useNavigate()
  const { id: campaignId } = useParams()
  
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadSummary() {
      try {
        const data = await api.getCampaignSummary(campaignId)
        setSummary(data)
      } catch (err) {
        setError(err.message || 'Failed to fetch summary statistics')
      } finally {
        setLoading(false)
      }
    }
    loadSummary()
  }, [campaignId])

  async function handleStart() {
    setStarting(true)
    setError('')
    try {
      // 1. Start the DB simulation (marks campaign active)
      await api.startCampaign(campaignId)

      // 2. Spawn the Pipecat voice bot in the background
      try {
        await api.startVoiceBot(campaignId)
      } catch (voiceErr) {
        console.warn('Could not start voice bot:', voiceErr.message)
        // Non-fatal — campaign can still proceed in simulation mode
      }

      // 3. Navigate to live dashboard (No window.open needed for Vobiz Outbound calls!)
      navigate(`/campaigns/${campaignId}/live`)
    } catch (err) {
      setError(err.message || 'Failed to launch campaign')
      setStarting(false)
    }
  }

  if (loading) {
    return <div className="text-center py-20 font-body text-on-surface-variant">Estimating calling duration and stats...</div>;
  }

  if (error && !summary) {
    return <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center">{error}</div>;
  }

  // Calculate estimated completion time
  const completionTime = new Date();
  completionTime.setMinutes(completionTime.getMinutes() + (summary?.estimatedDurationMinutes || 0));
  const formatTime = completionTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const stats = [
    { label: 'Total Contacts', value: String(summary.totalContacts), icon: 'groups' },
    { label: 'Selected Contacts', value: String(summary.selectedContacts), icon: 'group_add' },
    { label: 'Total Amount to Collect', value: `₹${summary.totalAmountDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: 'payments', valueClassName: 'text-primary' },
    { label: 'Estimated Duration', value: `${summary.estimatedDurationMinutes} minutes`, icon: 'timer' },
    { label: 'Average Outstanding', value: `₹${summary.averageBill.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: 'receipt' },
    { label: 'Estimated Completion', value: `Today, ${formatTime}`, icon: 'event_available' },
  ];

  return (
    <div className="flex flex-col gap-xl">
      <div className="flex flex-col items-center text-center gap-base">
        <p className="font-label-md text-label-md text-secondary uppercase tracking-wider">{summary.campaignName}</p>
        <h1 className="font-display text-headline-xl text-primary">Campaign Summary</h1>
        <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl">
          Review your campaign details before launching the automated calling dialer.
        </p>
      </div>

      {error && (
        <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center max-w-2xl mx-auto w-full">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      <div className="flex flex-col items-center justify-center gap-md pt-lg pb-xl border-t border-outline-variant/30">
        <button
          onClick={handleStart}
          disabled={starting}
          className={`${
            starting ? 'bg-outline' : 'bg-primary hover:bg-primary-container'
          } text-on-primary font-label-md text-label-md py-4 px-12 rounded-lg shadow-md transition-all flex items-center gap-sm`}
        >
          <span className="material-symbols-outlined filled">rocket_launch</span>
          {starting ? 'Launching Dialer...' : 'Start Campaign'}
        </button>
        <button
          onClick={() => navigate(-1)}
          disabled={starting}
          className="font-label-md text-label-md text-secondary hover:text-primary transition-colors flex items-center gap-xs"
        >
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          Back to Contacts
        </button>
      </div>
    </div>
  )
}
