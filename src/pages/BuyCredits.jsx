import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Button from '../components/ui/Button.jsx'
import { api } from '../services/api.js'

const PACKAGES = [
  { name: 'Starter', price: 500, credits: 100, description: 'Perfect for testing.', popular: false },
  { name: 'Growth', price: 2500, credits: 500, description: 'For scaling clinics.', popular: true },
  { name: 'Pro', price: 5000, credits: 1000, description: 'High volume users.', popular: false },
  { name: 'Enterprise', price: 25000, credits: 5000, description: 'Maximum efficiency.', popular: false },
]

export default function BuyCredits() {
  const [credits, setCredits] = useState(0)
  const [loading, setLoading] = useState(true)
  const [recharging, setRecharging] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [selectedPackage, setSelectedPackage] = useState(null)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    async function loadCredits() {
      try {
        const data = await api.getSettings()
        setCredits(data.credits || 0)
      } catch (err) {
        console.error('Error loading settings/credits:', err)
        setError('Failed to fetch credit balance.')
      } finally {
        setLoading(false)
      }
    }
    loadCredits()
  }, [])

  function openConfirmModal(pkg) {
    setSelectedPackage(pkg)
    setShowModal(true)
  }

  function closeConfirmModal() {
    setSelectedPackage(null)
    setShowModal(false)
  }

  async function handlePaySecurely() {
    if (!selectedPackage) return
    setRecharging(true)
    setError('')
    setSuccessMsg('')
    try {
      const res = await api.rechargeCredits(selectedPackage.credits, selectedPackage.price)
      setCredits(res.newBalance)
      setSuccessMsg(`Successfully purchased ${selectedPackage.credits} credits!`)
      closeConfirmModal()
      // Clear success message after 5 seconds
      setTimeout(() => setSuccessMsg(''), 5000)
    } catch (err) {
      console.error('Recharge failed:', err)
      setError(err.message || 'Payment processing failed.')
    } finally {
      setRecharging(false)
    }
  }

  if (loading) {
    return <div className="text-center py-20 font-body text-on-surface-variant">Loading credit balance...</div>
  }

  const isLowBalance = credits < 500
  const gst = selectedPackage ? selectedPackage.price * 0.18 : 0
  const total = selectedPackage ? selectedPackage.price + gst : 0

  return (
    <div className="flex flex-col gap-md pb-12">
      {/* Messages */}
      {error && (
        <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center">{error}</div>
      )}
      {successMsg && (
        <div className="bg-[#f0fdf4] border border-[#bbf7d0] text-[#166534] rounded-lg p-md text-center">{successMsg}</div>
      )}

      {/* Page Header & Balance Card */}
      <section className="flex flex-col md:flex-row justify-between items-start md:items-center gap-stack-md">
        <div>
          <h2 className="font-display text-headline-xl text-primary font-bold">Buy Credits</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-xs">
            Recharge your account to continue making AI voice calls.
          </p>
        </div>
        <div className={`bg-surface-container-lowest rounded-xl p-md shadow-ambient border flex flex-col items-end min-w-[250px] ${isLowBalance ? 'border-error/20' : 'border-outline-variant/30'}`}>
          <div className="flex items-center gap-xs">
            <span className={`material-symbols-outlined text-sm font-bold ${isLowBalance ? 'text-error animate-pulse' : 'text-primary'}`}>
              {isLowBalance ? 'warning' : 'check_circle'}
            </span>
            <span className={`font-label-sm text-label-sm px-2 py-0.5 rounded-full uppercase font-bold ${isLowBalance ? 'bg-error/10 text-error' : 'bg-primary-fixed text-on-primary-fixed-variant'}`}>
              {isLowBalance ? 'Low Balance' : 'Active Balance'}
            </span>
          </div>
          <div className="font-display text-[48px] font-bold text-on-surface leading-none mt-sm">{credits}</div>
          <div className="font-label-md text-label-md text-on-surface-variant mt-xs">Current Credits</div>
        </div>
      </section>

      {/* Packages Grid */}
      <section className="mt-md">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter items-stretch">
          {PACKAGES.map((pkg) => (
            <div
              key={pkg.name}
              className={`bg-surface-container-lowest rounded-xl p-md shadow-ambient border flex flex-col justify-between hover:border-primary transition-all ${
                pkg.popular
                  ? 'border-2 border-primary relative transform md:-translate-y-2'
                  : 'border-outline-variant/30'
              }`}
            >
              {pkg.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-primary text-on-primary px-3 py-1 rounded-full font-label-sm text-label-sm font-bold uppercase tracking-wider shadow-sm">
                  Most Popular
                </div>
              )}
              <div className={pkg.popular ? 'mt-xs' : ''}>
                <h3 className="font-display text-headline-md font-bold text-on-surface">{pkg.name}</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-xs">{pkg.description}</p>
              </div>
              <div className="my-md">
                <div className="font-display text-headline-lg font-bold text-primary">
                  {pkg.credits.toLocaleString()} <span className="font-body-sm text-body-sm text-on-surface-variant font-normal">credits</span>
                </div>
                <div className="font-body-lg text-body-lg font-bold text-on-surface mt-xs">₹{pkg.price.toLocaleString()}</div>
                <div className="font-label-sm text-label-sm text-on-surface-variant mt-2">₹{(pkg.price / pkg.credits).toFixed(2)}/credit</div>
              </div>
              <button
                onClick={() => openConfirmModal(pkg)}
                className={`w-full font-label-md text-label-md py-3 rounded-lg font-semibold transition-all border ${
                  pkg.popular
                    ? 'bg-primary text-on-primary border-primary hover:bg-primary/95 shadow-md'
                    : 'bg-transparent text-primary border-primary hover:bg-surface-container-low'
                }`}
              >
                Buy Now
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Info Strip */}
      <section className="bg-surface-container-low rounded-xl p-md flex items-start md:items-center gap-sm border border-outline-variant/30 mt-lg">
        <span className="material-symbols-outlined text-on-surface-variant">info</span>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          <strong>Did you know?</strong> 1 credit ≈ 1 minute of AI voice call time. Credits never expire.
        </p>
      </section>

      {/* Payment Confirmation Modal */}
      {showModal && selectedPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 backdrop-blur-sm px-4">
          <div className="bg-surface-container-lowest w-full max-w-md rounded-2xl shadow-floating flex flex-col overflow-hidden border border-outline-variant/30">
            <div className="flex justify-between items-center p-md border-b border-outline-variant/30">
              <h3 class="font-display text-headline-md font-bold text-on-surface">Confirm Purchase</h3>
              <button
                className="text-on-surface-variant hover:text-on-surface rounded-full p-1.5 hover:bg-surface-container-low transition-colors"
                onClick={closeConfirmModal}
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            
            <div className="p-md flex flex-col gap-md">
              <div className="bg-surface-container-low rounded-xl p-md border border-outline-variant/30">
                <div className="flex justify-between items-center">
                  <span className="font-body-md text-body-md text-on-surface-variant">{selectedPackage.name} Package</span>
                  <span className="font-label-md text-label-md text-on-surface font-bold">{selectedPackage.credits.toLocaleString()} credits</span>
                </div>
              </div>

              <div className="flex flex-col gap-xs font-body-sm text-body-sm">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Base Amount</span>
                  <span className="text-on-surface font-medium">₹{selectedPackage.price.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">GST (18%)</span>
                  <span className="text-on-surface font-medium">₹{gst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="border-t border-outline-variant/30 my-xs"></div>
                <div className="flex justify-between items-center">
                  <span className="font-label-md text-label-md text-on-surface font-bold">Total Payable</span>
                  <span className="font-display text-headline-md text-primary font-bold">₹{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            <div className="p-md border-t border-outline-variant/30 bg-surface-bright flex justify-end gap-sm">
              <button
                className="font-label-md text-label-md text-on-surface-variant hover:underline px-md py-2 font-medium"
                onClick={closeConfirmModal}
              >
                Cancel
              </button>
              <button
                disabled={recharging}
                onClick={handlePaySecurely}
                className="bg-primary text-on-primary font-label-md text-label-md px-md py-2 rounded-lg hover:bg-primary/95 transition-all flex items-center gap-xs font-semibold shadow-md disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">lock</span>
                {recharging ? 'Processing...' : 'Pay Securely'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
