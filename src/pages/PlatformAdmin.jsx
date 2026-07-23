import { useState, useEffect } from 'react'
import Button from '../components/ui/Button.jsx'
import Badge from '../components/ui/Badge.jsx'
import { api } from '../services/api.js'
import PlatformUsersPanel from '../components/admin/PlatformUsersPanel.jsx'

function formatDuration(seconds) {
  if (!seconds) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function PlatformAdmin() {
  const [clinics, setClinics] = useState([])
  const [selectedClinic, setSelectedClinic] = useState(null)
  const [selectedClinicDetails, setSelectedClinicDetails] = useState(null)
  const [callLogs, setCallLogs] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [activityLogs, setActivityLogs] = useState([])
  const [creditTransactions, setCreditTransactions] = useState([])
  
  const [mainTab, setMainTab] = useState('clinics') // 'clinics' | 'users'
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('settings') // 'settings' | 'calls' | 'audit' | 'activity' | 'credits'
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
        const [details, calls, audits, activities, credits] = await Promise.all([
          api.getAdminClinic(selectedClinic),
          api.getAdminClinicCalls(selectedClinic),
          api.getAdminClinicAuditLogs(selectedClinic),
          api.getAdminClinicActivityLogs(selectedClinic),
          api.getAdminClinicCreditTransactions(selectedClinic)
        ])
        setSelectedClinicDetails(details)
        setCallLogs(calls)
        setAuditLogs(audits)
        setActivityLogs(activities)
        setCreditTransactions(credits)
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
    <div className="flex flex-col gap-6 pb-12 w-full">
      <div className="border-b pb-6 border-gray-200">
        <h2 className="text-3xl font-bold mb-2 text-[#1e293b]">Platform Administration</h2>
        <p className="text-sm text-[#64748b]">Super Admin Console to configure tenant clinics, credentials, and review platform-wide logs.</p>
        
        <div className="flex gap-4 mt-6">
          <button
            onClick={() => setMainTab('clinics')}
            className={`px-4 py-2 font-semibold text-sm rounded-lg transition-colors ${
              mainTab === 'clinics' ? 'bg-[#0f4c81] text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Clinics
          </button>
          <button
            onClick={() => setMainTab('users')}
            className={`px-4 py-2 font-semibold text-sm rounded-lg transition-colors ${
              mainTab === 'users' ? 'bg-[#0f4c81] text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Users
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center">{error}</div>
      )}

      {mainTab === 'users' ? (
        <PlatformUsersPanel />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter items-start">
        
        {/* Left Column - Clinic List Selection */}
        <aside className="lg:col-span-4 flex flex-col bg-white border border-gray-200 shadow-sm rounded-lg overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-white">
            <h3 className="font-semibold text-[#1e293b] mb-3 text-lg">Clinics</h3>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">
                search
              </span>
              <input
                placeholder="Search clinics..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all"
              />
            </div>
          </div>

          <div className="overflow-y-auto max-h-[550px] p-3 bg-white space-y-2">
            {filteredClinics.map(c => {
              const isActive = selectedClinic === c.id;
              const statusActive = c.status === 'active';
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedClinic(c.id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors flex flex-col gap-1 border ${
                    isActive
                      ? 'bg-[#0f4c81] text-white border-[#0f4c81]'
                      : 'bg-white hover:bg-gray-50 border-transparent text-[#1e293b]'
                  }`}
                >
                  <div className="flex justify-between items-start w-full">
                    <span className="font-semibold text-sm truncate pr-2">{c.name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                      isActive 
                        ? (statusActive ? 'bg-blue-100 text-blue-800' : 'bg-gray-100/20 text-white')
                        : (statusActive ? 'bg-blue-50 text-blue-800' : 'bg-gray-100 text-gray-600')
                    }`}>
                      {c.status}
                    </span>
                  </div>
                  <div className={`flex justify-between items-center text-xs w-full ${isActive ? 'text-blue-200' : 'text-[#64748b]'}`}>
                    <span>{c.city}, {c.state}</span>
                    <span className="font-medium">{c.credits !== undefined ? c.credits : 0} credits</span>
                  </div>
                </button>
              );
            })}
            {filteredClinics.length === 0 && (
              <p className="text-center text-sm text-[#64748b] italic py-4">
                No clinics match filter
              </p>
            )}
          </div>
        </aside>

        {/* Right Column - Clinic Configurations and Logs */}
        <section className="lg:col-span-8 flex flex-col bg-white border border-gray-200 shadow-sm rounded-lg overflow-hidden min-h-[500px]">
          {loadingDetails || !selectedClinicDetails ? (
            <div className="p-12 text-center text-sm text-[#64748b] py-24">
              Loading clinic details...
            </div>
          ) : (
            <div className="flex flex-col h-full w-full">
              {/* Detail Header */}
              <div className="p-6 border-b border-gray-100 bg-white flex justify-between items-center flex-wrap gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-[#1e293b] mb-1">{selectedClinicDetails.name}</h2>
                  <p className="text-sm text-[#64748b] font-mono">ID: {selectedClinicDetails.id}</p>
                </div>
                <div className="flex bg-gray-100 p-1 rounded-lg flex-wrap gap-1">
                  <button
                    onClick={() => setActiveTab('settings')}
                    className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                      activeTab === 'settings' ? 'bg-[#0f4c81] text-white shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                    }`}
                  >
                    Settings
                  </button>
                  <button
                    onClick={() => setActiveTab('calls')}
                    className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                      activeTab === 'calls' ? 'bg-[#0f4c81] text-white shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                    }`}
                  >
                    Call Logs
                  </button>
                  <button
                    onClick={() => setActiveTab('activity')}
                    className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                      activeTab === 'activity' ? 'bg-[#0f4c81] text-white shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                    }`}
                  >
                    Activity Logs
                  </button>
                  <button
                    onClick={() => setActiveTab('credits')}
                    className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                      activeTab === 'credits' ? 'bg-[#0f4c81] text-white shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                    }`}
                  >
                    Credit History
                  </button>
                  <button
                    onClick={() => setActiveTab('audit')}
                    className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                      activeTab === 'audit' ? 'bg-[#0f4c81] text-white shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
                    }`}
                  >
                    Audit Trail
                  </button>
                </div>
              </div>

              {/* Tab 1: Clinic Settings Form */}
              {activeTab === 'settings' && (
                <form onSubmit={handleSaveSettings} className="p-6 flex flex-col gap-6 bg-white">
                  {saveSuccess && (
                    <div className="bg-[#e2f0d9] border border-[#a9d18e] text-[#385723] rounded-lg p-sm text-center font-semibold text-sm">
                      {saveSuccess}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#475569] mb-1">Clinic Name</label>
                      <input
                        required
                        value={selectedClinicDetails.name || ''}
                        onChange={(e) => handleInputChange('name', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg p-2 text-sm text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all bg-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#475569] mb-1">Slug / URL ID</label>
                      <input
                        required
                        value={selectedClinicDetails.slug || ''}
                        onChange={(e) => handleInputChange('slug', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg p-2 text-sm text-[#64748b] bg-gray-50 focus:outline-none cursor-not-allowed"
                        readOnly
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#475569] mb-1">Contact Phone</label>
                      <input
                        value={selectedClinicDetails.phone || ''}
                        onChange={(e) => handleInputChange('phone', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg p-2 text-sm text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all bg-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#475569] mb-1">Billing Email</label>
                      <input
                        type="email"
                        value={selectedClinicDetails.billing_email || ''}
                        onChange={(e) => handleInputChange('billing_email', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg p-2 text-sm text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all bg-transparent"
                      />
                    </div>
                    <div className="col-span-2 grid grid-cols-4 gap-4">
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-[#475569] mb-1">Address</label>
                        <input
                          value={selectedClinicDetails.address || ''}
                          onChange={(e) => handleInputChange('address', e.target.value)}
                          className="w-full border border-gray-200 rounded-lg p-2 text-sm text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all bg-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#475569] mb-1">City</label>
                        <input
                          value={selectedClinicDetails.city || ''}
                          onChange={(e) => handleInputChange('city', e.target.value)}
                          className="w-full border border-gray-200 rounded-lg p-2 text-sm text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all bg-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#475569] mb-1">State</label>
                        <input
                          value={selectedClinicDetails.state || ''}
                          onChange={(e) => handleInputChange('state', e.target.value)}
                          className="w-full border border-gray-200 rounded-lg p-2 text-sm text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all bg-transparent"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Integration Credentials Section */}
                  <div className="border-t border-gray-100 pt-6">
                    <h3 className="text-base font-semibold text-[#0f4c81] mb-4 flex items-center gap-2">
                      Integration Credentials
                    </h3>
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-xs font-semibold text-[#475569] mb-1">Razorpay Key ID</label>
                        <input
                          value={selectedClinicDetails.razorpay_key_id || ''}
                          onChange={(e) => handleInputChange('razorpay_key_id', e.target.value)}
                          className="w-full border border-gray-200 rounded-lg p-2 text-sm font-mono text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all bg-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#475569] mb-1">Razorpay Key Secret</label>
                        <input
                          type="password"
                          value={selectedClinicDetails.razorpay_key_secret || ''}
                          onChange={(e) => handleInputChange('razorpay_key_secret', e.target.value)}
                          className="w-full border border-gray-200 rounded-lg p-2 text-sm font-mono text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all bg-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#475569] mb-1">WhatsApp Sender Business Number ID</label>
                        <input
                          value={selectedClinicDetails.whatsapp_sender_id || ''}
                          onChange={(e) => handleInputChange('whatsapp_sender_id', e.target.value)}
                          className="w-full border border-gray-200 rounded-lg p-2 text-sm font-mono text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all bg-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#475569] mb-1">SMS Header/Sender ID</label>
                        <input
                          value={selectedClinicDetails.sms_sender_id || ''}
                          onChange={(e) => handleInputChange('sms_sender_id', e.target.value)}
                          className="w-full border border-gray-200 rounded-lg p-2 text-sm font-mono text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all bg-transparent uppercase"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Outreach & Billing Section */}
                  <div className="border-t border-gray-100 pt-6">
                    <h3 className="text-base font-semibold text-[#0f4c81] mb-4 flex items-center gap-2">
                      Outreach & Billing Parameters
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                      <div>
                        <label className="block text-xs font-semibold text-[#475569] mb-1">Max Concurrent Lines</label>
                        <input
                          type="number"
                          value={selectedClinicDetails.max_concurrent_calls || 5}
                          onChange={(e) => handleInputChange('max_concurrent_calls', parseInt(e.target.value))}
                          className="w-full border border-gray-200 rounded-lg p-2 text-sm text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all bg-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#475569] mb-1">Max Retry Attempts</label>
                        <input
                          type="number"
                          value={selectedClinicDetails.max_retry_attempts || 3}
                          onChange={(e) => handleInputChange('max_retry_attempts', parseInt(e.target.value))}
                          className="w-full border border-gray-200 rounded-lg p-2 text-sm text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all bg-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#475569] mb-1">Credit Balance</label>
                        <input
                          type="number"
                          value={selectedClinicDetails.credits !== undefined ? selectedClinicDetails.credits : 0}
                          onChange={(e) => handleInputChange('credits', parseInt(e.target.value) || 0)}
                          className="w-full border border-gray-200 rounded-lg p-2 text-sm text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all bg-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#475569] mb-1">Status</label>
                        <select
                          value={selectedClinicDetails.status || 'active'}
                          onChange={(e) => handleInputChange('status', e.target.value)}
                          className="w-full border border-gray-200 rounded-lg p-2 text-sm text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all bg-transparent cursor-pointer"
                        >
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-6 border-t border-gray-100">
                    <button
                      type="submit"
                      className="inline-flex items-center gap-2 bg-[#0f4c81] hover:bg-[#0c3e69] text-white font-semibold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">save</span>
                      Save Settings
                    </button>
                  </div>
                </form>
              )}

              {/* Tab 2: Call Logs */}
              {activeTab === 'calls' && (
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Patient</th>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Campaign</th>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Duration</th>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Credits Billed</th>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Outcome</th>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm text-[#1e293b]">
                      {callLogs.map((call) => (
                        <tr key={call.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="p-4">
                            <div className="flex flex-col">
                              <span className="font-semibold text-sm text-[#1e293b]">{call.customer_name}</span>
                              <span className="text-gray-400 text-xs">{call.customer_phone}</span>
                            </div>
                          </td>
                          <td className="p-4 text-gray-500 font-body-sm max-w-[150px] truncate">{call.campaign_name}</td>
                          <td className="p-4 text-right text-gray-700 font-medium">{formatDuration(call.duration_seconds)}</td>
                          <td className="p-4 text-right text-[#0f4c81] font-bold">{parseFloat(call.credits_billed || 0).toFixed(2)}</td>
                          <td className="p-4 text-right">
                            <Badge variant={call.outcome === 'paid_now' ? 'primary' : 'secondary'}>
                              {call.outcome ? call.outcome.replace('_', ' ') : 'None'}
                            </Badge>
                          </td>
                          <td className="p-4 text-right text-gray-500 font-medium">
                            {call.call_status}
                          </td>
                        </tr>
                      ))}
                      {callLogs.length === 0 && (
                        <tr>
                          <td colSpan="6" className="p-4 text-center text-gray-400 italic">No call logs registered for this clinic.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 2a: Activity Logs */}
              {activeTab === 'activity' && (
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Event Type</th>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Description</th>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Created At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-[#1e293b]">
                      {activityLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="p-4 font-semibold text-[#0f4c81]">{log.event_type}</td>
                          <td className="p-4 text-gray-700">{log.title}</td>
                          <td className="p-4 text-right text-gray-500 font-medium">{new Date(log.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                      {activityLogs.length === 0 && (
                        <tr>
                          <td colSpan="3" className="p-4 text-center text-gray-400 italic">No activity logs recorded.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 2b: Credit History */}
              {activeTab === 'credits' && (
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Reference / ID</th>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Credits Change</th>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Amount (INR)</th>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Status</th>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-[#1e293b]">
                      {creditTransactions.map((tx) => (
                        <tr key={tx.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="p-4">
                            <div className="flex flex-col">
                              <span className="font-semibold text-gray-700 text-xs truncate max-w-[150px]">{tx.payment_id || tx.id}</span>
                              {tx.description && <span className="text-gray-400 text-[10px]">{tx.description}</span>}
                            </div>
                          </td>
                          <td className={`p-4 text-right font-bold ${tx.credits >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {tx.credits >= 0 ? `+${tx.credits}` : tx.credits}
                          </td>
                          <td className="p-4 text-right text-gray-700">₹{parseFloat(tx.amount || 0).toFixed(2)}</td>
                          <td className="p-4 text-right">
                            <Badge variant={tx.status?.toLowerCase() === 'success' ? 'primary' : 'neutral'}>
                              {tx.status}
                            </Badge>
                          </td>
                          <td className="p-4 text-right text-gray-500 font-medium">{new Date(tx.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                      {creditTransactions.length === 0 && (
                        <tr>
                          <td colSpan="5" className="p-4 text-center text-gray-400 italic">No credit transactions ledger found.</td>
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
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Action</th>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">User</th>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Target Entity</th>
                        <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm text-[#1e293b]">
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="p-4">
                            <span className="font-semibold text-xs text-[#1e293b] bg-gray-100 px-2 py-0.5 rounded">
                              {log.action}
                            </span>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-col">
                              <span className="font-medium text-[#1e293b]">{log.user_name || 'System'}</span>
                              {log.user_email && <span className="text-gray-400 text-xs">{log.user_email}</span>}
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex gap-2 items-center text-xs">
                              <span className="text-gray-500 capitalize">{log.entity_type}:</span>
                              <span className="font-mono text-gray-400">{log.entity_id ? log.entity_id.substring(0, 8) : 'N/A'}</span>
                            </div>
                          </td>
                          <td className="p-4 text-right text-gray-500 font-medium">
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
        </section>

      </div>
      )}
    </div>
  )
}
