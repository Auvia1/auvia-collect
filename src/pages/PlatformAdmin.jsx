import { useState, useEffect } from 'react'
import Button from '../components/ui/Button.jsx'
import Badge from '../components/ui/Badge.jsx'
import { api } from '../services/api.js'

export default function PlatformAdmin() {
  const [clinics, setClinics] = useState([])
  const [selectedClinic, setSelectedClinic] = useState(null)
  const [selectedClinicDetails, setSelectedClinicDetails] = useState(null)
  const [callLogs, setCallLogs] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('settings') // 'settings' | 'calls' | 'audit'
  const [loading, setLoading] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [error, setError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState('')

  // Load all clinics on mount
  useEffect(() => {
    async function loadClinics() {
      try {
        const data = await api.getAdminClinics()
        setClinics(data)
        if (data.length > 0) {
          setSelectedClinic(data[0].id)
        }
      } catch (err) {
        setError(err.message || 'Failed to load clinics')
      } finally {
        setLoading(false)
      }
    }
    loadClinics()
  }, [])

  // Load selected clinic details whenever selectedClinic changes
  useEffect(() => {
    if (!selectedClinic) return
    async function loadClinicDetails() {
      setLoadingDetails(true)
      setSaveSuccess('')
      try {
        const [details, calls, audits] = await Promise.all([
          api.getAdminClinic(selectedClinic),
          api.getAdminClinicCalls(selectedClinic),
          api.getAdminClinicAuditLogs(selectedClinic)
        ])
        setSelectedClinicDetails(details)
        setCallLogs(calls)
        setAuditLogs(audits)
      } catch (err) {
        setError(err.message || 'Failed to load clinic details')
      } finally {
        setLoadingDetails(false)
      }
    }
    loadClinicDetails()
  }, [selectedClinic])

  const filteredClinics = clinics.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.city.toLowerCase().includes(search.toLowerCase())
  )

  async function handleSaveSettings(e) {
    e.preventDefault()
    setSaveSuccess('')
    try {
      const updated = await api.updateAdminClinic(selectedClinic, selectedClinicDetails)
      setSelectedClinicDetails(updated)
      // Update in the side list
      setClinics(prev => prev.map(c => c.id === selectedClinic ? { ...c, ...updated } : c))
      setSaveSuccess('Clinic settings saved successfully!')
    } catch (err) {
      alert(err.message || 'Failed to save settings')
    }
  }

  function handleInputChange(field, value) {
    setSelectedClinicDetails(prev => ({
      ...prev,
      [field]: value
    }))
  }

  if (loading) {
    return <div className="text-center py-20 font-body text-on-surface-variant">Loading platform dashboard...</div>;
  }

  return (
    <div className="flex flex-col gap-lg pb-12">
      <header className="border-b border-surface-variant pb-md">
        <h1 className="font-display text-headline-xl text-on-surface">Platform Administration</h1>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Super Admin Console to configure tenant clinics, credentials, and review platform-wide logs.
        </p>
      </header>

      {error && (
        <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
        
        {/* Left Column - Clinic List Selection */}
        <div className="lg:col-span-4 flex flex-col gap-md">
          <div className="bg-surface-container-lowest shadow-ambient border border-outline-variant/20 rounded-xl p-md flex flex-col gap-sm">
            <h2 className="font-display text-headline-sm text-on-surface">Clinics</h2>
            
            <div className="relative">
              <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant text-opacity-70 pointer-events-none">
                search
              </span>
              <input
                placeholder="Search clinics..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-xl pr-sm py-xs bg-surface-container-low border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all placeholder:text-outline text-on-surface"
              />
            </div>

            <div className="flex flex-col gap-xs mt-sm max-h-[500px] overflow-y-auto pr-xs">
              {filteredClinics.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedClinic(c.id)}
                  className={`text-left p-sm rounded-lg border transition-all flex flex-col gap-xxs ${
                    selectedClinic === c.id
                      ? 'bg-primary-container border-primary'
                      : 'bg-surface hover:bg-surface-container-low border-outline-variant/30'
                  }`}
                >
                  <div className="flex justify-between items-center w-full">
                    <span className="font-label-md text-label-md text-on-surface truncate pr-sm">{c.name}</span>
                    <Badge variant={c.status === 'active' ? 'primary' : 'neutral'}>
                      {c.status}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center text-body-xs font-body-xs text-secondary mt-1">
                    <span>{c.city}, {c.state}</span>
                    <span>{c.campaign_count} campaigns</span>
                  </div>
                </button>
              ))}
              {filteredClinics.length === 0 && (
                <p className="text-center font-body-md text-body-md text-on-surface-variant italic py-4">
                  No clinics match filter
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right Column - Clinic Configurations and Logs */}
        <div className="lg:col-span-8">
          {loadingDetails || !selectedClinicDetails ? (
            <div className="bg-surface-container-lowest shadow-ambient border border-outline-variant/20 rounded-xl p-xl text-center font-body text-on-surface-variant py-24">
              Loading clinic details...
            </div>
          ) : (
            <div className="bg-surface-container-lowest shadow-ambient border border-outline-variant/20 rounded-xl overflow-hidden flex flex-col h-full">
              {/* Top Banner details */}
              <div className="p-md bg-surface-container-low border-b border-surface-container-highest flex flex-col sm:flex-row justify-between items-start sm:items-center gap-md">
                <div>
                  <h2 className="font-display text-headline-md text-on-surface">{selectedClinicDetails.name}</h2>
                  <p className="font-body-sm text-body-sm text-secondary mt-xxs">ID: {selectedClinicDetails.id}</p>
                </div>
                <div className="flex gap-sm border border-outline-variant/30 bg-surface rounded-lg p-xs">
                  <button
                    onClick={() => setActiveTab('settings')}
                    className={`px-sm py-1.5 rounded font-label-md text-label-md transition-all ${
                      activeTab === 'settings' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'
                    }`}
                  >
                    Settings
                  </button>
                  <button
                    onClick={() => setActiveTab('calls')}
                    className={`px-sm py-1.5 rounded font-label-md text-label-md transition-all ${
                      activeTab === 'calls' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'
                    }`}
                  >
                    Call Logs
                  </button>
                  <button
                    onClick={() => setActiveTab('audit')}
                    className={`px-sm py-1.5 rounded font-label-md text-label-md transition-all ${
                      activeTab === 'audit' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'
                    }`}
                  >
                    Audit Trail
                  </button>
                </div>
              </div>

              {/* Tab 1: Clinic Settings Form */}
              {activeTab === 'settings' && (
                <form onSubmit={handleSaveSettings} className="p-md flex flex-col gap-md">
                  {saveSuccess && (
                    <div className="bg-[#e8f5e9] border border-[#c8e6c9] text-[#1b5e20] rounded-lg p-sm text-center font-body-md text-body-md">
                      {saveSuccess}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                    <div className="flex flex-col gap-xxs">
                      <label className="font-label-sm text-label-sm text-secondary">Clinic Name</label>
                      <input
                        required
                        value={selectedClinicDetails.name || ''}
                        onChange={(e) => handleInputChange('name', e.target.value)}
                        className="p-sm bg-surface border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                      />
                    </div>
                    <div className="flex flex-col gap-xxs">
                      <label className="font-label-sm text-label-sm text-secondary">Slug / URL ID</label>
                      <input
                        required
                        value={selectedClinicDetails.slug || ''}
                        onChange={(e) => handleInputChange('slug', e.target.value)}
                        className="p-sm bg-surface border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                      />
                    </div>
                    <div className="flex flex-col gap-xxs">
                      <label className="font-label-sm text-label-sm text-secondary">Contact Phone</label>
                      <input
                        value={selectedClinicDetails.phone || ''}
                        onChange={(e) => handleInputChange('phone', e.target.value)}
                        className="p-sm bg-surface border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                      />
                    </div>
                    <div className="flex flex-col gap-xxs">
                      <label className="font-label-sm text-label-sm text-secondary">Billing Email</label>
                      <input
                        type="email"
                        value={selectedClinicDetails.billing_email || ''}
                        onChange={(e) => handleInputChange('billing_email', e.target.value)}
                        className="p-sm bg-surface border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                      />
                    </div>
                    <div className="flex flex-col gap-xxs">
                      <label className="font-label-sm text-label-sm text-secondary">Address</label>
                      <input
                        value={selectedClinicDetails.address || ''}
                        onChange={(e) => handleInputChange('address', e.target.value)}
                        className="p-sm bg-surface border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                      />
                    </div>
                    <div className="flex grid grid-cols-2 gap-xs">
                      <div className="flex flex-col gap-xxs">
                        <label className="font-label-sm text-label-sm text-secondary">City</label>
                        <input
                          value={selectedClinicDetails.city || ''}
                          onChange={(e) => handleInputChange('city', e.target.value)}
                          className="p-sm bg-surface border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                        />
                      </div>
                      <div className="flex flex-col gap-xxs">
                        <label className="font-label-sm text-label-sm text-secondary">State</label>
                        <input
                          value={selectedClinicDetails.state || ''}
                          onChange={(e) => handleInputChange('state', e.target.value)}
                          className="p-sm bg-surface border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-outline-variant/30 my-sm pt-sm">
                    <h3 className="font-display text-headline-sm text-primary mb-md">Integration Credentials</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                      <div className="flex flex-col gap-xxs">
                        <label className="font-label-sm text-label-sm text-secondary">Razorpay Key ID</label>
                        <input
                          value={selectedClinicDetails.razorpay_key_id || ''}
                          onChange={(e) => handleInputChange('razorpay_key_id', e.target.value)}
                          className="p-sm bg-surface border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                        />
                      </div>
                      <div className="flex flex-col gap-xxs">
                        <label className="font-label-sm text-label-sm text-secondary">Razorpay Key Secret</label>
                        <input
                          type="password"
                          value={selectedClinicDetails.razorpay_key_secret || ''}
                          onChange={(e) => handleInputChange('razorpay_key_secret', e.target.value)}
                          className="p-sm bg-surface border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                        />
                      </div>
                      <div className="flex flex-col gap-xxs">
                        <label className="font-label-sm text-label-sm text-secondary">WhatsApp Sender Business Number ID</label>
                        <input
                          value={selectedClinicDetails.whatsapp_sender_id || ''}
                          onChange={(e) => handleInputChange('whatsapp_sender_id', e.target.value)}
                          className="p-sm bg-surface border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                        />
                      </div>
                      <div className="flex flex-col gap-xxs">
                        <label className="font-label-sm text-label-sm text-secondary">SMS Header/Sender ID</label>
                        <input
                          value={selectedClinicDetails.sms_sender_id || ''}
                          onChange={(e) => handleInputChange('sms_sender_id', e.target.value)}
                          className="p-sm bg-surface border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-outline-variant/30 my-sm pt-sm">
                    <h3 className="font-display text-headline-sm text-primary mb-md">Outreach Parameters</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
                      <div className="flex flex-col gap-xxs">
                        <label className="font-label-sm text-label-sm text-secondary">Max Concurrent Lines</label>
                        <input
                          type="number"
                          value={selectedClinicDetails.max_concurrent_calls || 5}
                          onChange={(e) => handleInputChange('max_concurrent_calls', parseInt(e.target.value))}
                          className="p-sm bg-surface border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                        />
                      </div>
                      <div className="flex flex-col gap-xxs">
                        <label className="font-label-sm text-label-sm text-secondary">Max Retry Attempts</label>
                        <input
                          type="number"
                          value={selectedClinicDetails.max_retry_attempts || 3}
                          onChange={(e) => handleInputChange('max_retry_attempts', parseInt(e.target.value))}
                          className="p-sm bg-surface border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                        />
                      </div>
                      <div className="flex flex-col gap-xxs">
                        <label className="font-label-sm text-label-sm text-secondary">Status</label>
                        <select
                          value={selectedClinicDetails.status || 'active'}
                          onChange={(e) => handleInputChange('status', e.target.value)}
                          className="p-sm bg-surface border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary text-on-surface"
                        >
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-sm border-t border-outline-variant/30">
                    <Button icon="save" type="submit">Save Settings</Button>
                  </div>
                </form>
              )}

              {/* Tab 2: Call Logs */}
              {activeTab === 'calls' && (
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-surface-container-low border-b border-surface-container-highest">
                      <tr>
                        <th className="p-md font-label-sm text-label-sm text-secondary uppercase tracking-wider">Patient</th>
                        <th className="p-md font-label-sm text-label-sm text-secondary uppercase tracking-wider">Campaign</th>
                        <th className="p-md font-label-sm text-label-sm text-secondary uppercase tracking-wider text-right">Outcome</th>
                        <th className="p-md font-label-sm text-label-sm text-secondary uppercase tracking-wider text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container-highest font-body text-body-md">
                      {callLogs.map((call) => (
                        <tr key={call.id} className="hover:bg-surface-bright transition-colors">
                          <td className="p-md">
                            <div className="flex flex-col">
                              <span className="font-label-md text-label-md text-on-surface">{call.customer_name}</span>
                              <span className="text-secondary text-body-sm">{call.customer_phone}</span>
                            </div>
                          </td>
                          <td className="p-md text-on-surface-variant font-body-sm max-w-[150px] truncate">{call.campaign_name}</td>
                          <td className="p-md text-right">
                            <Badge variant={call.outcome === 'paid_now' ? 'primary' : 'secondary'}>
                              {call.outcome ? call.outcome.replace('_', ' ') : 'None'}
                            </Badge>
                          </td>
                          <td className="p-md text-right text-secondary font-medium">
                            {call.call_status}
                          </td>
                        </tr>
                      ))}
                      {callLogs.length === 0 && (
                        <tr>
                          <td colSpan="4" className="p-md text-center text-on-surface-variant italic">No call logs registered for this clinic.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 3: Audit Trails */}
              {activeTab === 'audit' && (
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-surface-container-low border-b border-surface-container-highest">
                      <tr>
                        <th className="p-md font-label-sm text-label-sm text-secondary uppercase tracking-wider">Action</th>
                        <th className="p-md font-label-sm text-label-sm text-secondary uppercase tracking-wider">User</th>
                        <th className="p-md font-label-sm text-label-sm text-secondary uppercase tracking-wider">Target Entity</th>
                        <th className="p-md font-label-sm text-label-sm text-secondary uppercase tracking-wider text-right">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container-highest font-body-sm text-body-sm">
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-surface-bright transition-colors">
                          <td className="p-md">
                            <span className="font-label-md text-label-md text-on-surface bg-surface-container-high px-sm py-xxs rounded">
                              {log.action}
                            </span>
                          </td>
                          <td className="p-md">
                            <div className="flex flex-col">
                              <span className="font-medium text-on-surface">{log.user_name || 'System'}</span>
                              {log.user_email && <span className="text-secondary text-body-xs">{log.user_email}</span>}
                            </div>
                          </td>
                          <td className="p-md">
                            <div className="flex gap-xs items-center">
                              <span className="text-secondary capitalize">{log.entity_type}:</span>
                              <span className="font-mono text-body-xs">{log.entity_id ? log.entity_id.substring(0, 8) : 'N/A'}</span>
                            </div>
                          </td>
                          <td className="p-md text-right text-secondary font-medium">
                            {new Date(log.created_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                      {auditLogs.length === 0 && (
                        <tr>
                          <td colSpan="4" className="p-md text-center text-on-surface-variant italic">No audit log history tracked.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

            </div>
          )}
        </div>

      </div>
    </div>
  )
}
