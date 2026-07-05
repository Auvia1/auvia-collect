import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import StatCard from '../components/ui/StatCard.jsx'
import Button from '../components/ui/Button.jsx'
import { api } from '../services/api.js'

export default function CampaignReport() {
  const { id: campaignId } = useParams()
  const navigate = useNavigate()
  
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadReport() {
      try {
        const reportData = await api.getCampaignReport(campaignId)
        setData(reportData)
      } catch (err) {
        console.error('Error fetching campaign report:', err)
        setError(err.message || 'Failed to load campaign report')
      } finally {
        setLoading(false)
      }
    }
    loadReport()
  }, [campaignId])

  if (loading) {
    return <div className="text-center py-20 font-body text-on-surface-variant">Generating campaign summary reports...</div>;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-md items-center py-10">
        <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center w-full max-w-2xl">{error || 'Failed to load report'}</div>
        <Button onClick={() => navigate('/campaigns')}>Back to Campaigns</Button>
      </div>
    );
  }

  const { campaignName, status, completedDate, stats, outcomes, sentiment } = data;
  const remainingAmount = stats.totalBilled - stats.totalCollected;

  function handleExportCSV() {
    if (!data) return;
    let csv = "Metric,Value\n";
    csv += `Campaign Name,${campaignName}\n`;
    csv += `Completed Date,${new Date(completedDate).toLocaleDateString()}\n`;
    csv += `Total Billed,${stats.totalBilled}\n`;
    csv += `Total Collected,${stats.totalCollected}\n`;
    csv += `Remaining Outstanding,${stats.totalBilled - stats.totalCollected}\n`;
    csv += `Success Rate,${stats.successRate}%\n`;
    csv += `Total Selected,${stats.totalCalls}\n`;
    csv += `Calls Connected,${stats.answeredCalls}\n`;
    csv += `Not Answered,${stats.totalCalls - stats.answeredCalls}\n`;
    csv += `Paid Now,${outcomes.paidNow}\n`;
    csv += `Link Sent,${outcomes.linkSent}\n`;
    csv += `Call Later,${outcomes.callLater}\n`;
    csv += `Already Paid,${outcomes.alreadyPaid}\n`;
    csv += `Not Interested,${outcomes.notInterested}\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${campaignName.replace(/\s+/g, '_')}_report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleExportExcel() {
    if (!data) return;
    let xls = "Metric\tValue\n";
    xls += `Campaign Name\t${campaignName}\n`;
    xls += `Completed Date\t${new Date(completedDate).toLocaleDateString()}\n`;
    xls += `Total Billed\t${stats.totalBilled}\n`;
    xls += `Total Collected\t${stats.totalCollected}\n`;
    xls += `Remaining Outstanding\t${stats.totalBilled - stats.totalCollected}\n`;
    xls += `Success Rate\t${stats.successRate}%\n`;
    xls += `Total Selected\t${stats.totalCalls}\n`;
    xls += `Calls Connected\t${stats.answeredCalls}\n`;
    xls += `Not Answered\t${stats.totalCalls - stats.answeredCalls}\n`;
    xls += `Paid Now\t${outcomes.paidNow}\n`;
    xls += `Link Sent\t${outcomes.linkSent}\n`;
    xls += `Call Later\t${outcomes.callLater}\n`;
    xls += `Already Paid\t${outcomes.alreadyPaid}\n`;
    xls += `Not Interested\t${outcomes.notInterested}\n`;

    const blob = new Blob([xls], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${campaignName.replace(/\s+/g, '_')}_report.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleExportPDF() {
    window.print();
  }

  const SUMMARY_STATS = [
    { label: 'Total Selected', value: String(stats.totalCalls), icon: 'groups', valueClassName: 'text-primary' },
    { label: 'Calls Connected', value: String(stats.answeredCalls), icon: 'call', valueClassName: 'text-primary' },
    { label: 'Not Answered', value: String(stats.totalCalls - stats.answeredCalls), icon: 'phone_missed' },
    { label: 'Payments Completed', value: String(outcomes.paidNow + outcomes.alreadyPaid), icon: 'check_circle', valueClassName: 'text-primary' },
    { label: 'Payment Links Sent', value: String(outcomes.linkSent), icon: 'link', valueClassName: 'text-primary' },
    { label: 'Scheduled Callback', value: String(outcomes.callLater), icon: 'schedule' },
    { label: 'Already Paid', value: String(outcomes.alreadyPaid), icon: 'task_alt' },
    { label: 'Refused / Dispute', value: String(outcomes.notInterested), icon: 'thumb_down' },
    { label: 'Avg Call Time', value: stats.avgCallDuration, icon: 'timer' },
    { label: 'Success Rate', value: `${stats.successRate}%`, icon: 'insights', valueClassName: 'text-primary' },
  ];

  return (
    <div className="flex flex-col gap-lg pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-sm border-b border-surface-variant pb-md">
        <div>
          <button
            onClick={() => navigate('/campaigns')}
            className="inline-flex items-center text-body-sm font-body-sm text-secondary hover:text-primary mb-2 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px] mr-1">arrow_back</span>
            Back to Campaigns
          </button>
          <h1 className="font-display text-headline-xl text-on-surface">
            {campaignName} — Report
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {status === 'paused' ? 'Stopped' : 'Completed'} on {new Date(completedDate).toLocaleDateString()}
          </p>
        </div>
        <span className={`${status === 'paused' ? 'bg-error/10 text-error border border-error/20' : 'bg-secondary-container text-on-secondary-container'} px-sm py-xs rounded-full font-label-sm text-label-sm uppercase tracking-wider`}>
          {status === 'paused' ? 'Stopped' : 'Completed'}
        </span>
      </div>

      <section className="bg-surface-container-lowest rounded-xl p-lg shadow-ambient border border-surface-container-low">
        <h2 className="font-display text-headline-lg text-on-surface mb-lg text-center md:text-left">
          Financial Summary
        </h2>
        <div className="flex flex-col md:flex-row items-center gap-xl">
          <div className="flex-grow grid grid-cols-1 md:grid-cols-3 gap-lg w-full">
            <div className="flex flex-col gap-xs p-md bg-surface rounded-lg border border-surface-variant">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">
                Total Billed
              </span>
              <span className="font-display text-headline-lg text-on-surface">
                ${stats.totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex flex-col gap-xs p-md bg-primary-container rounded-lg border border-primary-container">
              <span className="font-label-md text-label-md text-on-primary-container uppercase tracking-wider">
                Total Collected
              </span>
              <span className="font-display text-headline-lg text-on-primary-container">
                ${stats.totalCollected.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex flex-col gap-xs p-md bg-surface rounded-lg border border-surface-variant">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">
                Remaining Outstanding
              </span>
              <span className="font-display text-headline-lg text-on-surface">
                ${remainingAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <div className="shrink-0 flex flex-col items-center justify-center p-md bg-surface rounded-full w-48 h-48 border-[8px] border-surface-variant relative shadow-inner">
            <div
              className="absolute inset-0 rounded-full border-[8px] border-primary"
              style={{
                clipPath: 'polygon(50% 50%, 50% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 50%, 50% 50%)',
                transform: `rotate(${Math.round(stats.successRate * 3.6)}deg)`,
              }}
            />
            <div className="bg-surface-container-lowest w-36 h-36 rounded-full absolute flex flex-col items-center justify-center z-10">
              <span className="font-display text-headline-xl text-primary">{stats.successRate}%</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">Collected</span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
        <div className="lg:col-span-2 bg-surface-container-lowest rounded-2xl shadow-ambient border border-outline-variant/20 p-md flex flex-col gap-base">
          <h2 className="font-display text-headline-sm text-on-surface">Call Performance Metrics</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-sm">
            {SUMMARY_STATS.map((s, idx) => (
              <StatCard key={idx} label={s.label} value={s.value} icon={s.icon} valueClassName={s.valueClassName} />
            ))}
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-2xl shadow-ambient border border-outline-variant/20 p-md flex flex-col gap-base">
          <h2 className="font-display text-headline-sm text-on-surface">Sentiment Breakdown</h2>
          <div className="space-y-sm my-auto">
            {Object.entries(sentiment).map(([key, val]) => {
              const maxVal = Math.max(...Object.values(sentiment)) || 1
              const percentage = Math.round((val / maxVal) * 100)
              return (
                <div key={key} className="space-y-xs">
                  <div className="flex justify-between text-body-sm font-body-sm">
                    <span className="capitalize text-on-surface">{key}</span>
                    <span className="font-medium text-on-surface-variant">{val} calls</span>
                  </div>
                  <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden">
                    <div className="bg-primary h-full rounded-full" style={{ width: `${percentage}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <section className="flex flex-col md:flex-row justify-end items-center gap-md pt-lg pb-xl border-t border-surface-variant">
        <span className="font-body-md text-body-md text-on-surface-variant mr-auto">
          Download comprehensive reports:
        </span>
        <Button variant="secondary" icon="table_chart" onClick={handleExportCSV}>Export CSV</Button>
        <Button variant="secondary" icon="description" onClick={handleExportExcel}>Export Excel</Button>
        <Button icon="picture_as_pdf" onClick={handleExportPDF}>Export PDF</Button>
      </section>
    </div>
  )
}
