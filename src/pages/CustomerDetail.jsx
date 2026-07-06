import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import Button from '../components/ui/Button.jsx'
import { api } from '../services/api.js'

export default function CustomerDetail() {
  const { customerId } = useParams()
  const navigate = useNavigate()
  
  const [customer, setCustomer] = useState(null)
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  
  const audioRef = useRef(null)

  useEffect(() => {
    async function loadCallDetails() {
      try {
        const data = await api.getCall(customerId)
        setCustomer(data)
        setNote(data.notes || '')
      } catch (err) {
        console.error('Error fetching call details:', err)
        setError(err.message || 'Failed to load call details.')
      } finally {
        setLoading(false)
      }
    }
    loadCallDetails()
  }, [customerId])

  // Cleanup audio
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    }
  }, []);

  function handlePlayToggle() {
    if (!customer?.recordingUrl) return;

    if (!audioRef.current) {
      // Convert absolute localhost URL to relative path (Vite proxy handles it)
      const url = customer.recordingUrl.replace(/^https?:\/\/localhost:\d+/, '');
      audioRef.current = new Audio(url);
      audioRef.current.addEventListener('ended', () => setPlaying(false));
    }

    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play().catch(e => console.error('Audio play error:', e));
      setPlaying(true);
    }
  }

  async function handleSaveNote() {
    if (!customer) return;
    setSavingNote(true);
    try {
      await api.saveCallFeedback(customerId, { notes: note });
      // Update local state
      setCustomer(prev => ({ ...prev, notes: note }));
      alert('Note saved successfully!');
    } catch (err) {
      alert(err.message || 'Failed to save note');
    } finally {
      setSavingNote(false);
    }
  }

  function handleExportDetails() {
    if (!customer) return;
    let report = `AUVIA COLLECT - CALL LOG DETAIL REPORT\n`;
    report += `======================================\n\n`;
    report += `Patient Name: ${customer.name}\n`;
    report += `Phone: ${customer.phone}\n`;
    report += `Status: ${customer.paymentStatus}\n`;
    report += `Pending Amount: $${customer.amount.toFixed(2)}\n`;
    report += `Call Duration: ${customer.duration}\n`;
    report += `Call Status: ${customer.callStatus}\n`;
    report += `AI Summary: ${customer.summary || 'N/A'}\n`;
    report += `Notes: ${customer.notes || 'No manual notes.'}\n\n`;
    report += `TRANSCRIPT:\n`;
    report += `-----------\n`;
    if (customer.transcript.length === 0) {
      report += `No transcript available for this call.\n`;
    } else {
      customer.transcript.forEach(msg => {
        const who = msg.from === 'agent' ? 'Auvia Assistant' : customer.name;
        report += `[0:${msg.at_seconds ? msg.at_seconds.toString().padStart(2, '0') : '00'}] ${who}: ${msg.text}\n`;
      });
    }

    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${customer.name.replace(/\s+/g, '_')}_call_details.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <div className="text-center py-20 font-body text-on-surface-variant">Loading call records...</div>;
  }

  if (error || !customer) {
    return (
      <div className="flex flex-col gap-md items-center py-10">
        <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center w-full max-w-2xl">{error || 'Record not found'}</div>
        <Button onClick={() => navigate('/call-log')}>Back to Call Log</Button>
      </div>
    );
  }

  const initials = customer.name
    .split(' ')
    .map((n) => n[0])
    .join('')

  return (
    <div className="flex flex-col gap-lg pb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-md">
        <div>
          <button
            onClick={() => navigate('/call-log')}
            className="inline-flex items-center text-body-sm font-body-sm text-secondary hover:text-primary mb-2 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px] mr-1">arrow_back</span>
            Back to Call Log
          </button>
          <h1 className="font-display text-headline-lg text-on-surface">{customer.name} — Call Details</h1>
        </div>
        <div className="flex gap-sm">
          <Button variant="secondary" icon="download" onClick={handleExportDetails}>Export</Button>
          <Button icon="call" onClick={() => navigate('/callback-queue')}>Callback Queue</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
        {/* Left column */}
        <div className="lg:col-span-4 flex flex-col gap-gutter">
          <div className="bg-surface-container-lowest rounded-2xl shadow-ambient p-md border border-surface-variant flex flex-col h-full">
            <div className="flex justify-between items-start mb-xl">
              <div className="w-16 h-16 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-headline-md font-display font-bold">
                {initials}
              </div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-label-sm bg-[#e8f5e9] text-[#1b5e20] font-medium border border-[#c8e6c9]">
                {customer.paymentStatus}
              </span>
            </div>
            <h2 className="font-display text-headline-md text-on-surface mb-1">{customer.name}</h2>
            <div className="text-body-md font-body-md text-on-surface-variant flex items-center gap-2 mb-lg">
              <span className="material-symbols-outlined text-[18px]">phone</span>
              {customer.phone}
            </div>
            <div className="mt-auto space-y-4">
              <div className="border-t border-outline-variant/30 pt-4">
                <span className="block text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider mb-1">
                  Pending Amount
                </span>
                <span className="text-headline-lg font-display text-on-surface">${customer.amount.toFixed(2)}</span>
              </div>
              <div className="border-t border-outline-variant/30 pt-4">
                <span className="block text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider mb-1">
                  Call Duration
                </span>
                <span className="text-body-md font-body-md text-on-surface font-medium">{customer.duration}</span>
              </div>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-2xl shadow-ambient p-md border border-surface-variant">
            <h3 className="text-body-lg font-body-lg font-semibold text-on-surface mb-4">Call History</h3>
            <ul className="space-y-4 relative before:absolute before:inset-y-0 before:left-2.5 before:w-px before:bg-outline-variant/40">
              <li className="relative pl-8">
                <div className="absolute left-1.5 top-1.5 w-2 h-2 rounded-full bg-primary ring-4 ring-surface-container-lowest" />
                <div className="text-label-sm font-label-sm text-on-surface-variant mb-0.5">Attempt #1</div>
                <div className="text-body-sm font-body-sm text-on-surface font-medium">{customer.callStatus}</div>
              </li>
            </ul>
          </div>
        </div>

        {/* Right column */}
        <div className="lg:col-span-8 flex flex-col gap-gutter">
          {/* Audio player */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-ambient p-md border border-surface-variant">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-body-lg font-body-lg font-semibold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">graphic_eq</span>
                Recording
              </h3>
              <span className="text-label-sm font-label-sm font-mono text-on-surface-variant bg-surface-container-low px-2 py-1 rounded">
                {customer.duration}
              </span>
            </div>
            {customer.hasRecording ? (
              <div className="flex items-center gap-4 bg-surface-container-low rounded-lg p-sm border border-outline-variant/30">
                <button
                  aria-label={playing ? "Pause" : "Play"}
                  onClick={handlePlayToggle}
                  className="w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center hover:bg-on-primary-fixed-variant transition-colors shrink-0 shadow-sm"
                >
                  <span className="material-symbols-outlined filled">{playing ? 'pause' : 'play_arrow'}</span>
                </button>
                <div className="flex-grow h-10 flex items-center gap-1">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-1 rounded-full ${playing && i % 3 === 0 ? 'bg-primary animate-pulse' : 'bg-outline-variant'}`}
                      style={{ height: `${8 + ((i * 7) % 32)}px` }}
                    />
                  ))}
                </div>
                <button className="text-on-surface-variant hover:text-primary transition-colors" aria-label="Volume">
                  <span className="material-symbols-outlined text-[20px]">volume_up</span>
                </button>
              </div>
            ) : (
              <p className="font-body-sm text-body-sm text-on-surface-variant italic">No recording available for this call.</p>
            )}
          </div>

          {/* Transcript */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-ambient flex flex-col border border-surface-variant overflow-hidden h-[420px]">
            <div className="p-4 border-b border-outline-variant/30 bg-surface flex justify-between items-center">
              <h3 className="text-body-md font-body-md font-semibold text-on-surface">AI Conversation Transcript</h3>
              <span className="text-label-sm font-label-sm uppercase tracking-wider text-secondary">Sentiment: {customer.sentiment}</span>
            </div>
            <div className="flex-grow p-md overflow-y-auto space-y-6 scrollbar-hide">
              {customer.transcript.length === 0 ? (
                <div className="text-center py-20 text-on-surface-variant italic">No transcript transcript for unanswered/failed calls.</div>
              ) : (
                customer.transcript.map((msg, i) => (
                  <div key={i} className={`flex gap-4 max-w-[85%] ${msg.from === 'customer' ? 'ml-auto flex-row-reverse' : ''}`}>
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 font-bold text-sm ${
                        msg.from === 'agent' ? 'bg-primary-container text-on-primary-container' : 'bg-secondary-container text-on-secondary-container'
                      }`}
                    >
                      {msg.from === 'agent' ? (
                        <span className="material-symbols-outlined text-[16px]">smart_toy</span>
                      ) : (
                        initials
                      )}
                    </div>
                    <div className={msg.from === 'customer' ? 'text-right' : ''}>
                      <div className={`flex items-baseline gap-2 mb-1 ${msg.from === 'customer' ? 'justify-end' : ''}`}>
                        <span className="text-label-sm font-label-sm font-semibold text-on-surface">
                          {msg.from === 'agent' ? 'Auvia Assistant' : customer.name.split(' ')[0]}
                        </span>
                        <span className="text-[10px] text-on-surface-variant">0:{msg.at_seconds ? msg.at_seconds.toString().padStart(2, '0') : '00'}</span>
                      </div>
                      <div
                        className={`text-body-md font-body-md p-3 rounded-2xl inline-block text-left ${
                          msg.from === 'agent'
                            ? 'bg-surface-container-low text-on-surface rounded-tl-sm'
                            : 'bg-primary text-on-primary rounded-tr-sm'
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-ambient p-md border border-surface-variant">
            <h3 className="text-body-lg font-body-lg font-semibold text-on-surface mb-4">Follow-up Notes</h3>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full h-28 p-3 rounded-lg border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary bg-surface-container-lowest text-body-md font-body-md text-on-surface resize-none transition-colors"
              placeholder="Add manual notes regarding this interaction..."
            />
            <div className="flex justify-end mt-4">
              <Button onClick={handleSaveNote} disabled={savingNote}>
                {savingNote ? 'Saving...' : 'Save Note'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
