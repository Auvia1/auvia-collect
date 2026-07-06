import { useState, useEffect, useCallback } from 'react'
import { api } from '../../services/api.js'

/**
 * VoiceCallBanner — Floating voice session indicator shown on the Live Campaign page.
 * Shows whether the Pipecat WebRTC bot is running and lets the user open / stop it.
 */
export default function VoiceCallBanner({ campaignId }) {
  const [status, setStatus] = useState(null)   // null | { running, url, startedAt }
  const [loading, setLoading] = useState(false)
  const [stopping, setStopping] = useState(false)

  const fetchStatus = useCallback(async () => {
    if (!campaignId) return
    try {
      const s = await api.getVoiceBotStatus(campaignId)
      setStatus(s)
    } catch (_) {
      // silently ignore — bot may not be running
    }
  }, [campaignId])

  // Poll status every 5 seconds
  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  async function handleStop() {
    setStopping(true)
    try {
      await api.stopVoiceBot(campaignId)
      await fetchStatus()
    } catch (_) {}
    setStopping(false)
  }

  function openVoiceUI() {
    window.open('http://localhost:7860', '_blank', 'noopener,noreferrer')
  }

  if (!status?.running) return null

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3
                 bg-gradient-to-r from-primary to-[#6366f1] text-white rounded-2xl
                 shadow-2xl border border-white/20 backdrop-blur-sm
                 animate-in slide-in-from-bottom-4 duration-300"
      style={{ minWidth: '280px' }}
    >
      {/* Pulsing mic icon */}
      <div className="relative flex-shrink-0">
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
          <span className="material-symbols-outlined text-white text-[22px]">mic</span>
        </div>
        {/* Pulse ring */}
        <span className="absolute inset-0 rounded-full bg-white/30 animate-ping" />
      </div>

      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <p className="font-semibold text-sm text-white leading-tight">Voice Session Active</p>
        <p className="text-xs text-white/70 truncate">Pipecat WebRTC bot is live</p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Open UI button */}
        <button
          onClick={openVoiceUI}
          title="Open Pipecat Voice UI"
          className="w-9 h-9 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center
                     transition-colors border border-white/20"
        >
          <span className="material-symbols-outlined text-white text-[18px]">open_in_new</span>
        </button>

        {/* Stop bot button */}
        <button
          onClick={handleStop}
          disabled={stopping}
          title="Stop voice bot"
          className="w-9 h-9 rounded-xl bg-red-500/80 hover:bg-red-400 flex items-center justify-center
                     transition-colors border border-white/20 disabled:opacity-50"
        >
          {stopping
            ? <span className="material-symbols-outlined text-white text-[16px] animate-spin">progress_activity</span>
            : <span className="material-symbols-outlined text-white text-[18px]">stop</span>
          }
        </button>
      </div>
    </div>
  )
}
