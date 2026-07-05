import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Button from '../components/ui/Button.jsx'
import ProgressBar from '../components/ui/ProgressBar.jsx'
import Badge from '../components/ui/Badge.jsx'
import { api } from '../services/api.js'

const STATUS_CONFIG = {
  active: { label: 'Active', variant: 'primary', pulse: true },
  completed: { label: 'Completed', variant: 'secondary', pulse: false },
  draft: { label: 'Draft', variant: 'neutral', pulse: false },
  paused: { label: 'Stopped', variant: 'neutral', pulse: false },
}

function CampaignCard({ campaign, onDelete }) {
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const status = STATUS_CONFIG[campaign.status] || { label: campaign.status, variant: 'neutral', pulse: false }
  const isDraft = campaign.status === 'draft'

  function handleClick() {
    if (confirmDelete) return // don't navigate if confirm is open
    if (campaign.status === 'completed' || campaign.status === 'paused') navigate(`/campaigns/${campaign.id}/report`)
    else if (campaign.status === 'active') navigate(`/campaigns/${campaign.id}/live`)
    else navigate(`/campaigns/${campaign.id}/contacts`)
  }

  return (
    <div
      onClick={handleClick}
      className={`text-left bg-surface-container-lowest rounded-xl p-md shadow-ambient border ${
        isDraft ? 'border-dashed border-outline-variant' : 'border-outline-variant'
      } hover:shadow-md cursor-pointer transition-all flex flex-col h-full relative overflow-hidden group`}
    >
      {campaign.status === 'active' && <div className="absolute top-0 left-0 w-full h-1 bg-primary" />}

      {/* Inline delete confirmation overlay */}
      {confirmDelete && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 bg-error-container/95 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-md p-md rounded-xl"
        >
          <span className="material-symbols-outlined text-error text-[36px]">delete_forever</span>
          <p className="font-label-md text-label-md text-on-error-container text-center">
            Delete <strong>"{campaign.name}"</strong>?<br />
            <span className="font-body-sm text-body-sm opacity-70">This cannot be undone.</span>
          </p>
          <div className="flex gap-sm">
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }}
              className="px-md py-xs rounded-lg border border-outline-variant font-label-md text-label-md text-on-surface-variant hover:bg-surface transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete?.(campaign.id) }}
              className="px-md py-xs rounded-lg bg-error font-label-md text-label-md text-on-error hover:bg-error/80 transition-colors flex items-center gap-xs"
            >
              <span className="material-symbols-outlined text-[16px]">delete</span>
              Yes, Delete
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-between items-start mb-md">
        <h3 className="font-display text-headline-md-mobile md:text-headline-md text-on-surface pr-sm group-hover:text-primary transition-colors">
          {campaign.name}
        </h3>
        <div className="flex items-center gap-xs">
          {isDraft && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setConfirmDelete(true)
              }}
              className="text-outline hover:text-error transition-colors p-1 rounded-full hover:bg-error/10 flex items-center justify-center"
              title="Delete draft"
              aria-label="Delete draft"
            >
              <span className="material-symbols-outlined text-[20px]">delete</span>
            </button>
          )}
          <Badge variant={status.variant} icon={status.pulse ? undefined : campaign.status === 'completed' ? 'check_circle' : campaign.status === 'paused' ? 'block' : 'edit_document'}>
            {status.pulse && <span className="w-2 h-2 rounded-full bg-primary animate-pulse inline-block mr-1" />}
            {status.label}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-sm mb-md flex-grow">
        <div>
          <p className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider mb-xs">Created</p>
          <p className="font-body-md text-body-md text-on-surface">{campaign.createdDate}</p>
        </div>
        <div>
          <p className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider mb-xs">Contacts</p>
          <p className={`font-body-md text-body-md ${campaign.contacts ? 'text-on-surface' : 'text-on-surface-variant italic'}`}>
            {campaign.contacts ?? 'Pending'}
          </p>
        </div>
      </div>

      <div className={`mt-auto ${isDraft ? 'opacity-60' : ''}`}>
        <div className="flex justify-between items-center mb-xs">
          <span className="font-label-sm text-label-sm text-on-surface-variant">
            {isDraft ? 'Setup Progress' : 'Outreach Progress'}
          </span>
          <span className="font-label-md text-label-md text-on-surface">{campaign.collectionPercent}%</span>
        </div>
        <ProgressBar percent={campaign.collectionPercent} colorClass={campaign.status === 'draft' ? 'bg-outline' : 'bg-primary'} />
      </div>
    </div>
  )
}

export default function Campaigns() {
  const navigate = useNavigate()
  const [campaigns, setCampaigns] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadCampaigns() {
      try {
        const data = await api.getCampaigns()
        setCampaigns(data)
      } catch (err) {
        setError(err.message || 'Failed to load campaigns')
      } finally {
        setLoading(false)
      }
    }
    loadCampaigns()
  }, [])

  async function handleDeleteCampaign(id) {
    try {
      await api.deleteCampaign(id)
      setCampaigns((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      setError(err.message || 'Failed to delete campaign')
    }
  }

  const filtered = campaigns.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col gap-lg pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-md">
        <div>
          <h1 className="font-display text-headline-xl text-on-surface">Campaigns</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-xs">
            Manage and monitor your collection outreach efforts.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row w-full md:w-auto gap-sm">
          <div className="relative w-full sm:w-64">
            <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant text-opacity-70 pointer-events-none">
              search
            </span>
            <input
              placeholder="Search campaigns..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-xl pr-sm py-sm bg-surface-container-lowest border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all placeholder:text-outline text-on-surface"
            />
          </div>
          <Button icon="add" onClick={() => navigate('/campaigns/new')}>
            New Campaign
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 font-body text-on-surface-variant">Loading campaigns...</div>
      ) : error ? (
        <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-outline-variant rounded-2xl bg-surface-container-lowest">
          <span className="material-symbols-outlined text-outline text-[48px] mb-sm block">campaign</span>
          <h3 className="font-display text-headline-sm text-on-surface mb-xs">No campaigns found</h3>
          <p className="font-body-md text-body-md text-on-surface-variant mb-md">Get started by creating your first outreach drive.</p>
          <Button icon="add" onClick={() => navigate('/campaigns/new')} className="mx-auto">New Campaign</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md">
          {filtered.map((c) => (
            <CampaignCard key={c.id} campaign={c} onDelete={handleDeleteCampaign} />
          ))}
        </div>
      )}
    </div>
  )
}
