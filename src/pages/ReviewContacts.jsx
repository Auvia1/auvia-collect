import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Button from '../components/ui/Button.jsx'
import Badge from '../components/ui/Badge.jsx'
import { api } from '../services/api.js'

const CONTEXT_VARIANT = {
  consultation_fee: 'primary',
  'Consultation Visit': 'primary',
  'Annual Wellness Visit': 'primary',
  copay: 'secondary',
  Copay: 'secondary',
  lab_charges: 'tertiary',
  'Lab Fees': 'tertiary',
  'Lab Charges': 'tertiary',
  admission_charges: 'primary',
  Imaging: 'primary',
  other: 'secondary',
}

function formatContextLabel(context) {
  if (!context) return 'Other';
  return context.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export default function ReviewContacts() {
  const navigate = useNavigate()
  const { id: campaignId } = useParams()
  
  const [campaign, setCampaign] = useState(null)
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [filterContext, setFilterContext] = useState('All Contexts')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadData() {
      try {
        const campData = await api.getCampaign(campaignId)
        setCampaign(campData)
        const contactsData = await api.getContacts(campaignId)
        setRows(contactsData)
      } catch (err) {
        setError(err.message || 'Failed to load campaign data')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [campaignId])

  const selectedCount = rows.filter((r) => r.selected).length

  async function toggleRow(contactId) {
    const contact = rows.find(r => r.id === contactId);
    if (!contact) return;
    const newSelected = !contact.selected;
    
    // Optimistic update
    setRows(prev => prev.map(r => r.id === contactId ? { ...r, selected: newSelected } : r));
    
    try {
      await api.toggleContactSelection(campaignId, contactId, newSelected);
    } catch (err) {
      console.error('Failed to toggle selection in DB', err);
      // Revert on failure
      setRows(prev => prev.map(r => r.id === contactId ? { ...r, selected: !newSelected } : r));
    }
  }

  async function setAllSelection(selected) {
    // Optimistic update
    setRows(prev => prev.map(r => ({ ...r, selected })));
    
    try {
      // Bulk update (sequentially or map)
      await Promise.all(rows.map(r => api.toggleContactSelection(campaignId, r.id, selected)));
    } catch (err) {
      console.error('Failed to update bulk selection in DB', err);
      // Reload from db
      const contactsData = await api.getContacts(campaignId);
      setRows(contactsData);
    }
  }

  function selectAll() {
    setAllSelection(true);
  }

  function deselectAll() {
    setAllSelection(false);
  }

  // Filtered rows
  const filtered = rows.filter(r => {
    const matchesSearch = r.name.toLowerCase().includes(search.toLowerCase()) || r.phone.includes(search);
    const mappedContext = formatContextLabel(r.context);
    const matchesFilter = filterContext === 'All Contexts' || mappedContext === filterContext;
    return matchesSearch && matchesFilter;
  });

  // Unique contexts for filter list
  const uniqueContexts = Array.from(new Set(rows.map(r => formatContextLabel(r.context))));


  if (loading) {
    return <div className="text-center py-20 font-body text-on-surface-variant">Loading contacts roster...</div>;
  }

  if (error) {
    return <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center">{error}</div>;
  }

  return (
    <div className="flex flex-col gap-md pb-24">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-md">
        <div>
          <p className="font-label-md text-label-md text-secondary mb-xs uppercase tracking-wider">
            {campaign ? campaign.name : 'Outreach Campaign'}
          </p>
          <h1 className="font-display text-headline-xl text-on-surface">Review Contacts</h1>
        </div>
        <div className="flex flex-col sm:flex-row gap-sm items-center w-full md:w-auto">
          <div className="relative w-full sm:w-64">
            <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-outline">search</span>
            <input
              placeholder="Search contacts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg pl-10 pr-sm py-2 font-body-sm text-body-sm focus:border-primary focus:ring-1 focus:ring-primary transition-colors text-on-surface"
            />
          </div>
          <select
            value={filterContext}
            onChange={(e) => setFilterContext(e.target.value)}
            className="w-full sm:w-48 bg-surface-container-lowest border border-outline-variant rounded-lg pl-sm pr-10 py-2 font-body-sm text-body-sm text-on-surface cursor-pointer"
          >
            <option>All Contexts</option>
            {uniqueContexts.map((ctx) => (
              <option key={ctx} value={ctx}>{ctx}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl shadow-ambient flex flex-col overflow-hidden border border-surface-variant">
        <div className="flex justify-between items-center p-md border-b border-surface-variant bg-surface-bright">
          <div className="flex gap-md font-label-md text-label-md text-primary">
            <button className="hover:underline" onClick={selectAll}>Select All</button>
            <span className="text-outline-variant">|</span>
            <button className="hover:underline" onClick={deselectAll}>Deselect All</button>
          </div>
          <div className="font-body-sm text-body-sm text-secondary">
            Showing {filtered.length} of {rows.length} contacts
          </div>
        </div>

        <div className="overflow-x-auto">
          {filtered.length === 0 ? (
            <div className="text-center py-10 text-on-surface-variant italic">No contacts match filter or search settings.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-surface-variant font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                  <th className="py-sm px-md w-12 text-center"></th>
                  <th className="py-sm px-md font-semibold">Customer Name</th>
                  <th className="py-sm px-md font-semibold">Phone Number</th>
                  <th className="py-sm px-md font-semibold text-right">Amount Due</th>
                  <th className="py-sm px-md font-semibold">Payment Context</th>
                </tr>
              </thead>
              <tbody className="font-body-sm text-body-sm text-on-surface">
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-b border-surface-container-high hover:bg-surface-container-low transition-colors group ${
                      !row.selected ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="py-md px-md text-center">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={() => toggleRow(row.id)}
                        className="custom-checkbox"
                        aria-label={`Select ${row.name}`}
                      />
                    </td>
                    <td className="py-md px-md font-medium group-hover:text-primary transition-colors">{row.name}</td>
                    <td className="py-md px-md text-secondary">{row.phone}</td>
                    <td className="py-md px-md text-right font-medium text-on-surface">${row.amount.toFixed(2)}</td>
                    <td className="py-md px-md">
                      <Badge variant={CONTEXT_VARIANT[row.context] || CONTEXT_VARIANT[formatContextLabel(row.context)] || 'secondary'}>
                        {formatContextLabel(row.context)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Sticky footer bar */}
      <div className="fixed bottom-0 left-0 right-0 md:left-64 bg-surface-container-lowest border-t border-outline-variant shadow-ambient p-md z-30">
        <div className="max-w-[1440px] mx-auto flex justify-between items-center px-margin-mobile md:px-margin-desktop">
          <div className="flex items-center gap-sm font-label-md text-label-md">
            <span className="w-8 h-8 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-bold">
              {selectedCount}
            </span>
            <span className="text-on-surface-variant">of {rows.length} contacts selected</span>
          </div>
          <div className="flex gap-md">
            <Button variant="secondary" onClick={() => navigate('/campaigns')}>
              Cancel
            </Button>
            <Button icon="arrow_forward" variant={selectedCount > 0 ? 'primary' : 'disabled'} disabled={selectedCount === 0} onClick={() => navigate(`/campaigns/${campaignId}/summary`)}>
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
