import { useState, useEffect } from 'react'
import Button from '../components/ui/Button.jsx'
import { api } from '../services/api.js'
import CustomDropdown from '../components/ui/CustomDropdown.jsx'

const TABS = ['Payment Integration', 'Telephony & AI Config', 'WhatsApp Integration', 'Calling Rules', 'General']

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState(TABS[0])
  const [showSecret, setShowSecret] = useState(false)
  const [showWebhookSecret, setShowWebhookSecret] = useState(false)
  const [showVobizSecret, setShowVobizSecret] = useState(false)
  const [showMetaSecret, setShowMetaSecret] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // Form states
  const [settings, setSettings] = useState({
    organizationName: '',
    razorpayKeyId: '',
    razorpayKeySecret: '',
    razorpayWebhookSecret: '',
    whatsappSenderId: '',
    metaAccessToken: '',
    metaPhoneNumberId: '',
    wabaId: '',
    maxRetryAttempts: 3,
    retryCooldownHours: 6,
    callingWindowStart: '09:00',
    callingWindowEnd: '19:00',
    maxConcurrentCalls: 5,
    vobizAuthId: '',
    vobizAuthToken: '',
    systemPrompt: '',
  })

  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await api.getSettings()
        setSettings(data)
      } catch (err) {
        console.error('Error fetching settings:', err)
        setError(err.message || 'Failed to load clinic settings')
      } finally {
        setLoading(false)
      }
    }
    loadSettings()
  }, [])

  function handleChange(field, val) {
    setSettings((prev) => ({ ...prev, [field]: val }))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await api.saveSettings(settings)
      setMessage('Settings updated successfully!')
      // Automatically clear message after 3 seconds
      setTimeout(() => setMessage(''), 3000)
    } catch (err) {
      setError(err.message || 'Failed to update settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-center py-20 font-body text-on-surface-variant">Loading settings...</div>;
  }

  return (
    <div className="flex flex-col gap-md pb-12">
      <div>
        <h1 className="font-display text-headline-xl text-on-surface">Settings</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-xs">
          Configure integrations and calling behavior for your organization.
        </p>
      </div>

      {error && (
        <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center">{error}</div>
      )}
      {message && (
        <div className="bg-[#f0fdf4] border border-[#bbf7d0] text-[#166534] rounded-lg p-md text-center">{message}</div>
      )}

      <div className="flex flex-col md:flex-row gap-md">
        <nav className="md:w-56 shrink-0 flex md:flex-col gap-xs overflow-x-auto md:overflow-visible">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`text-left px-md py-sm rounded-lg font-label-md text-label-md whitespace-nowrap transition-colors ${
                activeTab === tab
                  ? 'bg-primary-fixed text-on-primary-fixed-variant'
                  : 'text-on-surface-variant hover:bg-surface-container-low'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>

        <div className="flex-1 bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/20 p-md md:p-lg flex flex-col gap-md">
          {activeTab === 'Payment Integration' && (
            <>
              <div className="space-y-sm">
                <label className="block font-label-md text-label-md text-on-surface">Razorpay API Key</label>
                <input
                  type="text"
                  placeholder="rzp_live_xxxxxxxxxxxx"
                  value={settings.razorpayKeyId}
                  onChange={(e) => handleChange('razorpayKeyId', e.target.value)}
                  className="w-full border border-outline-variant rounded-lg px-sm py-2 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-sm">
                <label className="block font-label-md text-label-md text-on-surface">Secret Key</label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    placeholder="••••••••••••••••"
                    value={settings.razorpayKeySecret}
                    onChange={(e) => handleChange('razorpayKeySecret', e.target.value)}
                    className="w-full border border-outline-variant rounded-lg px-sm py-2 pr-10 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {showSecret ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>
              <div className="space-y-sm">
                <label className="block font-label-md text-label-md text-on-surface">Webhook Secret</label>
                <div className="relative">
                  <input
                    type={showWebhookSecret ? 'text' : 'password'}
                    placeholder="Webhook verification secret..."
                    value={settings.razorpayWebhookSecret}
                    onChange={(e) => handleChange('razorpayWebhookSecret', e.target.value)}
                    className="w-full border border-outline-variant rounded-lg px-sm py-2 pr-10 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowWebhookSecret((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {showWebhookSecret ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>
              <Button variant="secondary" className="self-start">Test Connection</Button>
            </>
          )}

          {activeTab === 'Telephony & AI Config' && (
            <>
              <div className="space-y-sm">
                <label className="block font-label-md text-label-md text-on-surface">Vobiz Auth Username/ID</label>
                <input
                  type="text"
                  placeholder="Vobiz API username/ID..."
                  value={settings.vobizAuthId}
                  onChange={(e) => handleChange('vobizAuthId', e.target.value)}
                  className="w-full border border-outline-variant rounded-lg px-sm py-2 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-sm">
                <label className="block font-label-md text-label-md text-on-surface">Vobiz Auth Secret/Token</label>
                <div className="relative">
                  <input
                    type={showVobizSecret ? 'text' : 'password'}
                    placeholder="••••••••••••••••"
                    value={settings.vobizAuthToken}
                    onChange={(e) => handleChange('vobizAuthToken', e.target.value)}
                    className="w-full border border-outline-variant rounded-lg px-sm py-2 pr-10 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowVobizSecret((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {showVobizSecret ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>
              <div className="space-y-sm">
                <label className="block font-label-md text-label-md text-on-surface">AI System Prompt (Billing Guidelines)</label>
                <textarea
                  rows={8}
                  placeholder="You are an empathetic, professional medical billing assistant..."
                  value={settings.systemPrompt}
                  onChange={(e) => handleChange('systemPrompt', e.target.value)}
                  className="w-full border border-outline-variant rounded-lg px-sm py-2 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-sans resize-y"
                />
              </div>
            </>
          )}

          {activeTab === 'WhatsApp Integration' && (
            <>
              <div className="space-y-sm">
                <label className="block font-label-md text-label-md text-on-surface">WhatsApp Sender ID</label>
                <input
                  type="text"
                  placeholder="+91 XXXXX XXXXX"
                  value={settings.whatsappSenderId}
                  onChange={(e) => handleChange('whatsappSenderId', e.target.value)}
                  className="w-full border border-outline-variant rounded-lg px-sm py-2 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-sm">
                <label className="block font-label-md text-label-md text-on-surface">Meta Access Token</label>
                <div className="relative">
                  <input
                    type={showMetaSecret ? 'text' : 'password'}
                    placeholder="EAAGxxxxxxxxxxxxxxxx"
                    value={settings.metaAccessToken}
                    onChange={(e) => handleChange('metaAccessToken', e.target.value)}
                    className="w-full border border-outline-variant rounded-lg px-sm py-2 pr-10 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMetaSecret((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {showMetaSecret ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>
              <div className="space-y-sm">
                <label className="block font-label-md text-label-md text-on-surface">Meta Phone Number ID</label>
                <input
                  type="text"
                  placeholder="Meta Phone Number ID..."
                  value={settings.metaPhoneNumberId}
                  onChange={(e) => handleChange('metaPhoneNumberId', e.target.value)}
                  className="w-full border border-outline-variant rounded-lg px-sm py-2 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-sm">
                <label className="block font-label-md text-label-md text-on-surface">WhatsApp Business Account (WABA) ID</label>
                <input
                  type="text"
                  placeholder="WABA ID..."
                  value={settings.wabaId}
                  onChange={(e) => handleChange('wabaId', e.target.value)}
                  className="w-full border border-outline-variant rounded-lg px-sm py-2 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
            </>
          )}

          {activeTab === 'Calling Rules' && (
            <>
              <div className="space-y-sm">
                <label className="block font-label-md text-label-md text-on-surface">Max Concurrent Calls</label>
                <input
                  type="number"
                  value={settings.maxConcurrentCalls}
                  onChange={(e) => handleChange('maxConcurrentCalls', e.target.value)}
                  className="w-full border border-outline-variant rounded-lg px-sm py-2 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-sm">
                <label className="block font-label-md text-label-md text-on-surface">Max Retry Attempts</label>
                <input
                  type="number"
                  value={settings.maxRetryAttempts}
                  onChange={(e) => handleChange('maxRetryAttempts', e.target.value)}
                  className="w-full border border-outline-variant rounded-lg px-sm py-2 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-sm">
                <label className="block font-label-md text-label-md text-on-surface">Retry Cooldown</label>
                <CustomDropdown
                  value={settings.retryCooldownHours}
                  options={[
                    { value: 2, label: '2 hours' },
                    { value: 6, label: '6 hours' },
                    { value: 24, label: '24 hours' }
                  ]}
                  onChange={(val) => handleChange('retryCooldownHours', val)}
                  minWidthClass="w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-sm">
                <div className="space-y-sm">
                  <label className="block font-label-md text-label-md text-on-surface">Calling Window Start</label>
                  <input
                     type="time"
                     value={settings.callingWindowStart}
                     onChange={(e) => handleChange('callingWindowStart', e.target.value)}
                     className="w-full border border-outline-variant rounded-lg px-sm py-2 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="space-y-sm">
                  <label className="block font-label-md text-label-md text-on-surface">Calling Window End</label>
                  <input
                     type="time"
                     value={settings.callingWindowEnd}
                     onChange={(e) => handleChange('callingWindowEnd', e.target.value)}
                     className="w-full border border-outline-variant rounded-lg px-sm py-2 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Calls will only be placed within this window to comply with TRAI/DND regulations.
              </p>
            </>
          )}

          {activeTab === 'General' && (
            <div className="space-y-sm">
              <label className="block font-label-md text-label-md text-on-surface">Organization Name</label>
              <input
                type="text"
                value={settings.organizationName}
                onChange={(e) => handleChange('organizationName', e.target.value)}
                className="w-full border border-outline-variant rounded-lg px-sm py-2 font-body-sm text-body-sm bg-transparent text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          <div className="pt-md mt-md border-t border-surface-variant flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
