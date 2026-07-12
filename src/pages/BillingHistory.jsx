import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import Button from '../components/ui/Button.jsx'
import Badge from '../components/ui/Badge.jsx'
import { api } from '../services/api.js'

export default function BillingHistory() {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedTx, setSelectedTx] = useState(null)
  const [showDrawer, setShowDrawer] = useState(false)

  useEffect(() => {
    async function loadHistory() {
      try {
        const data = await api.getBillingHistory()
        setTransactions(data)
      } catch (err) {
        console.error('Error fetching billing history:', err)
        setError('Failed to load transaction history.')
      } finally {
        setLoading(false)
      }
    }
    loadHistory()
  }, [])

  const stats = useMemo(() => {
    const successTxs = transactions.filter((tx) => tx.status === 'Success')
    const totalSpent = successTxs.reduce((sum, tx) => sum + parseFloat(tx.total), 0)
    const totalCredits = successTxs.reduce((sum, tx) => sum + parseInt(tx.credits), 0)
    const lastPaymentDate = successTxs.length > 0 
      ? new Date(successTxs[0].createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : 'No payments'

    return {
      totalSpent,
      totalCredits,
      lastPaymentDate,
      invoiceNumber: successTxs.length > 0 ? `INV-${new Date(successTxs[0].createdAt).getFullYear()}-${successTxs[0].paymentId.substring(6, 12).toUpperCase()}` : ''
    }
  }, [transactions])

  const filteredTransactions = useMemo(() => {
    const query = search.trim().toLowerCase()
    return transactions.filter((tx) => {
      const matchesSearch = !query || tx.paymentId.toLowerCase().includes(query)
      const matchesStatus = !statusFilter || tx.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [transactions, search, statusFilter])

  function openDrawer(tx) {
    setSelectedTx(tx)
    setShowDrawer(true)
  }

  function closeDrawer() {
    setSelectedTx(null)
    setShowDrawer(false)
  }

  function handleDownloadInvoice(tx) {
    alert(`Mock invoice download initiated for Payment ID: ${tx.paymentId}`);
  }

  if (loading) {
    return <div className="text-center py-20 font-body text-on-surface-variant">Loading transaction history...</div>
  }

  return (
    <div className="flex flex-col gap-md pb-12">
      {/* Messages */}
      {error && (
        <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center">{error}</div>
      )}

      {/* Header */}
      <div>
        <h1 className="font-display text-headline-xl text-primary font-bold">Payment History</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-xs">
          View your credit top-ups, receipts, and invoices.
        </p>
      </div>

      {/* Stat Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter mt-sm">
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-ambient border border-outline-variant/20 flex flex-col justify-between min-h-[120px]">
          <div className="flex items-center gap-xs text-on-surface-variant font-label-md text-label-md uppercase tracking-wider">
            <span className="material-symbols-outlined text-[20px]">payments</span>
            Total Spent
          </div>
          <div className="font-display text-headline-lg font-bold text-on-surface mt-sm">
            ₹{stats.totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-md shadow-ambient border border-outline-variant/20 flex flex-col justify-between min-h-[120px]">
          <div className="flex items-center gap-xs text-on-surface-variant font-label-md text-label-md uppercase tracking-wider">
            <span className="material-symbols-outlined text-[20px]">stars</span>
            Credits Purchased
          </div>
          <div className="font-display text-headline-lg font-bold text-on-surface mt-sm">
            {stats.totalCredits.toLocaleString()}
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-md shadow-ambient border border-outline-variant/20 flex flex-col justify-between min-h-[120px]">
          <div className="flex items-center gap-xs text-on-surface-variant font-label-md text-label-md uppercase tracking-wider">
            <span className="material-symbols-outlined text-[20px]">event</span>
            Last Payment
          </div>
          <div>
            <div className="font-display text-headline-md font-bold text-on-surface mt-sm">
              {stats.lastPaymentDate}
            </div>
            {stats.invoiceNumber && (
              <div className="font-body-sm text-body-sm text-on-surface-variant mt-1">Invoice #{stats.invoiceNumber}</div>
            )}
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="bg-surface-container-lowest p-sm rounded-t-xl border-x border-t border-outline-variant/30 flex flex-col md:flex-row gap-sm items-center justify-between shadow-ambient mt-md">
        <div className="relative w-full md:w-72">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-outline-variant rounded-lg font-body-sm text-body-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary bg-transparent text-on-surface"
            placeholder="Search by Payment ID..."
            type="text"
          />
        </div>

        <div className="flex gap-sm w-full md:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-outline-variant rounded-lg px-3 py-2 text-body-sm text-on-surface-variant bg-surface-container-lowest focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer w-full md:w-44"
          >
            <option value="">All Statuses</option>
            <option value="Success">Success</option>
            <option value="Pending">Pending</option>
            <option value="Failed">Failed</option>
          </select>
        </div>
      </section>

      {/* Data Table */}
      <section className="bg-surface-container-lowest border-x border-b border-outline-variant/30 rounded-b-xl shadow-ambient overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[700px]">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant/30">
              <th className="p-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Date</th>
              <th className="p-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Package / Credits</th>
              <th className="p-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider text-right">Base Amount</th>
              <th className="p-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider text-right">GST (18%)</th>
              <th className="p-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider text-right">Total Paid</th>
              <th className="p-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Payment ID</th>
              <th className="p-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider text-center">Status</th>
            </tr>
          </thead>
          <tbody className="font-body-sm text-body-sm text-on-surface">
            {filteredTransactions.length === 0 ? (
              <tr>
                <td colSpan="7" className="p-8 text-center text-on-surface-variant">No transactions found matching your filters.</td>
              </tr>
            ) : (
              filteredTransactions.map((tx) => (
                <tr
                  key={tx.id}
                  onClick={() => openDrawer(tx)}
                  className="border-b border-outline-variant/20 hover:bg-surface-container-low/50 cursor-pointer transition-colors"
                >
                  <td className="p-4">
                    {new Date(tx.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="p-4 font-semibold">{tx.credits.toLocaleString()} Credits Pack</td>
                  <td className="p-4 text-right">₹{parseFloat(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="p-4 text-right">₹{parseFloat(tx.gst).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="p-4 text-right font-bold text-primary">₹{parseFloat(tx.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="p-4 text-on-surface-variant font-mono text-xs">{tx.paymentId}</td>
                  <td className="p-4 text-center">
                    <Badge
                      variant={
                        tx.status === 'Success' ? 'success' : tx.status === 'Pending' ? 'warning' : 'error'
                      }
                    >
                      {tx.status}
                    </Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* Detail Drawer Overlay */}
      {showDrawer && selectedTx && (
        <div
          className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-sm z-40"
          onClick={closeDrawer}
        ></div>
      )}

      {/* Detail Drawer */}
      <div
        className={`fixed right-0 top-0 h-full w-full max-w-md bg-surface-container-lowest shadow-floating z-50 flex flex-col transform transition-transform duration-300 ease-in-out border-l border-outline-variant/30 ${
          showDrawer && selectedTx ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {selectedTx && (
          <>
            <div className="p-md border-b border-outline-variant/30 flex justify-between items-center bg-surface">
              <h2 className="font-display text-headline-md font-bold text-on-surface">Payment Details</h2>
              <button
                className="p-1.5 text-on-surface-variant hover:text-on-surface rounded-full hover:bg-surface-container-low transition-colors"
                onClick={closeDrawer}
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-md overflow-y-auto flex-1 space-y-md">
              {/* Header Info */}
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider mb-xs">Status</div>
                  <Badge variant={selectedTx.status === 'Success' ? 'success' : selectedTx.status === 'Pending' ? 'warning' : 'error'}>
                    {selectedTx.status}
                  </Badge>
                </div>
                <div className="text-right">
                  <div className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider mb-xs">Total Paid</div>
                  <div className="font-display text-headline-md font-bold text-primary">
                    ₹{parseFloat(selectedTx.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              <hr className="border-outline-variant/20" />

              {/* Transaction Details */}
              <div>
                <h3 className="font-label-md text-label-md font-bold text-on-surface mb-sm">Transaction Info</h3>
                <div className="space-y-xs font-body-sm text-body-sm">
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Payment ID</span>
                    <span className="font-mono text-on-surface">{selectedTx.paymentId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Order ID</span>
                    <span className="font-mono text-on-surface">order_{selectedTx.id.substring(0, 8)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Date &amp; Time</span>
                    <span className="text-on-surface">
                      {new Date(selectedTx.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Method</span>
                    <span className="text-on-surface flex items-center gap-xs">
                      <span className="material-symbols-outlined text-sm">credit_card</span>
                      UPI / Digital Net Banking
                    </span>
                  </div>
                </div>
              </div>

              <hr className="border-outline-variant/20" />

              {/* Item Details */}
              <div>
                <h3 className="font-label-md text-label-md font-bold text-on-surface mb-sm">Purchase Breakdown</h3>
                <div className="bg-surface-container-low rounded-xl p-md space-y-xs font-body-sm text-body-sm border border-outline-variant/30">
                  <div className="flex justify-between font-semibold text-on-surface">
                    <span>{selectedTx.credits.toLocaleString()} Credits Pack</span>
                    <span>₹{parseFloat(selectedTx.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-on-surface-variant">
                    <span>Base Amount</span>
                    <span>₹{parseFloat(selectedTx.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-on-surface-variant">
                    <span>GST (18%)</span>
                    <span>₹{parseFloat(selectedTx.gst).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between font-bold text-on-surface pt-xs border-t border-outline-variant/20 mt-xs">
                    <span>Total</span>
                    <span>₹{parseFloat(selectedTx.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-md flex gap-sm">
                <Button
                  className="flex-1 justify-center"
                  icon="download"
                  onClick={() => handleDownloadInvoice(selectedTx)}
                >
                  Download Invoice
                </Button>
                <Button
                  variant="secondary"
                  icon="mail"
                  onClick={() => alert(`Receipt emailed for Payment ID: ${selectedTx.paymentId}`)}
                  title="Email Receipt"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
