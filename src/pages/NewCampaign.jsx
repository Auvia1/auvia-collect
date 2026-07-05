import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/ui/Button.jsx'
import { api } from '../services/api.js'

export default function NewCampaign() {
  const navigate = useNavigate()
  const [campaignName, setCampaignName] = useState('')
  const [fileUploaded, setFileUploaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')
  const [uploadedContacts, setUploadedContacts] = useState([])
  const fileInputRef = useRef(null)

  function handleDownloadTemplate(e) {
    e.preventDefault()
    const headers = 'Name,Phone,Amount,Payment Context\n'
    const rows = [
      'Eleanor Rigby,+919999999991,125.00,consultation_fee',
      'Desmond Jones,+919999999992,45.00,other',
      'Molly Jones,+919999999993,350.75,lab_charges'
    ].join('\n')
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', 'auvia_roster_template.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target.result
      const lines = text.split(/\r?\n/)
      const parsed = []
      let duplicates = 0;
      let invalid = 0;

      // Assume headers: Name, Phone, Amount, Payment Context
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
      const nameIdx = headers.indexOf('name')
      const phoneIdx = headers.indexOf('phone')
      const amountIdx = headers.indexOf('amount')
      const contextIdx = headers.indexOf('payment context')

      const seenPhones = new Set()

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        const cells = line.split(',').map((c) => c.trim())
        if (cells.length < 2) continue

        const name = cells[nameIdx !== -1 ? nameIdx : 0] || 'Unknown Patient'
        let phone = cells[phoneIdx !== -1 ? phoneIdx : 1] || ''
        const amountVal = cells[amountIdx !== -1 ? amountIdx : 2] || '0'
        const context = cells[contextIdx !== -1 ? contextIdx : 3] || 'other'

        // Clean & validate phone numbers
        if (!phone || phone.length < 8) {
          invalid++
          continue
        }
        if (!phone.startsWith('+')) {
          phone = '+' + phone.replace(/\D/g, '')
        }

        if (seenPhones.has(phone)) {
          duplicates++
          continue
        }
        seenPhones.add(phone)

        parsed.push({
          name,
          phone,
          amount: parseFloat(amountVal) || 0.0,
          context: context.toLowerCase().replace(' ', '_'),
        })
      }

      if (parsed.length === 0) {
        setError('No valid patient rows found in CSV file.')
        setFileUploaded(false)
        return
      }

      setUploadedContacts(parsed)
      setFileUploaded(true)
      setError('')
      setSummary({
        contactsCount: parsed.length,
        duplicatesCount: duplicates,
        invalidCount: invalid,
      })
    }
    reader.readAsText(file)
  }

  async function handleContinue() {
    if (!campaignName || !fileUploaded || uploadedContacts.length === 0) return
    setLoading(true)
    setError('')
    try {
      // 1. Create campaign
      const camp = await api.createCampaign(campaignName)

      // 2. Upload roster contacts
      await api.uploadContacts(camp.id, uploadedContacts, 'patient_roster.csv')

      // 3. Navigate to roster review page
      navigate(`/campaigns/${camp.id}/contacts`)
    } catch (err) {
      setError(err.message || 'Failed to create campaign roster')
      setLoading(false)
    }
  }


  return (
    <div className="flex justify-center">
      <div className="w-full max-w-2xl bg-surface-container-lowest rounded-card p-md md:p-xl shadow-ambient border border-surface-variant/50">
        <div className="mb-lg">
          <h1 className="font-display text-headline-lg-mobile md:text-headline-lg text-on-surface mb-xs">
            Create New Campaign
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Initialize a new patient collection drive by importing your contact roster.
          </p>
        </div>

        <form className="space-y-lg flex flex-col" onSubmit={(e) => e.preventDefault()}>
          <div className="space-y-sm">
            <label className="block font-label-md text-label-md text-on-surface" htmlFor="campaignName">
              Campaign Name
            </label>
            <input
              id="campaignName"
              type="text"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="July 2026 Collection Drive"
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg py-sm px-md font-body-md text-body-md text-on-surface placeholder:text-outline focus:border-primary focus:ring-1 focus:ring-primary transition-colors outline-none"
            />
          </div>

          <div className="space-y-base">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".csv"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-outline-variant hover:border-primary bg-surface-container-low/50 rounded-lg p-xl flex flex-col items-center justify-center text-center cursor-pointer transition-colors group"
            >
              <div className="w-12 h-12 rounded-full bg-secondary-container flex items-center justify-center mb-md group-hover:bg-primary-container transition-colors">
                <span className="material-symbols-outlined text-primary group-hover:text-on-primary">cloud_upload</span>
              </div>
              <h3 className="font-label-md text-label-md text-on-surface mb-xs">Drag &amp; drop your CSV file here</h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant mb-md">
                Upload CSV with Name, Phone, Amount, Payment Context
              </p>
              <span className="border border-outline-variant bg-surface-container-lowest text-on-surface font-label-md text-label-md py-sm px-md rounded-lg inline-block">
                Browse Files
              </span>
            </button>

            <div className="flex justify-end">
              <a
                className="font-label-sm text-label-sm text-primary hover:underline flex items-center gap-xs"
                href="#"
                onClick={handleDownloadTemplate}
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                Download sample CSV template
              </a>
            </div>
          </div>

          {error && (
            <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center">
              {error}
            </div>
          )}

          {fileUploaded && summary && (
            <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg p-md flex items-start gap-sm">
              <span className="material-symbols-outlined text-[#166534] mt-0.5">check_circle</span>
              <div>
                <h4 className="font-label-md text-label-md text-[#166534] mb-xs">Validation Summary</h4>
                <p className="font-body-sm text-body-sm text-[#14532d]">
                  {summary.contactsCount} contacts found, {summary.duplicatesCount} duplicate(s) skipped, {summary.invalidCount} invalid number(s).
                </p>
              </div>
            </div>
          )}

          <div className="pt-md mt-md border-t border-surface-variant flex justify-end">
            <Button
              type="button"
              variant={fileUploaded && campaignName && !loading ? 'primary' : 'disabled'}
              disabled={!(fileUploaded && campaignName) || loading}
              onClick={handleContinue}
            >
              {loading ? 'Creating Campaign...' : 'Continue'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
