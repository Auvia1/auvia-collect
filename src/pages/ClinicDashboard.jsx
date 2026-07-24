import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api.js';
import CustomDropdown from '../components/ui/CustomDropdown.jsx';

// Animated Number Counter Component
function AnimatedNumber({ value, duration = 800, format }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = parseFloat(value);
    if (isNaN(end)) {
      setDisplayValue(value);
      return;
    }

    const startTime = performance.now();
    let animationFrameId;

    const animate = (currentTime) => {
      const elapsedTime = currentTime - startTime;
      const progress = Math.min(elapsedTime / duration, 1);
      
      // easeOutQuad easing
      const easedProgress = progress * (2 - progress);
      const current = start + easedProgress * (end - start);

      setDisplayValue(current);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      } else {
        setDisplayValue(end);
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [value, duration]);

  return <span>{format ? format(displayValue) : displayValue}</span>;
}

export default function ClinicDashboard() {
  const user = api.getCurrentUser();
  const clientName = user?.fullName || 'User';
  const clinicName = user?.clinicName || 'Clinic';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [trendGranularity, setTrendGranularity] = useState('monthly'); // yearly | monthly | weekly | daily
  const [spendTrendGranularity, setSpendTrendGranularity] = useState('weekly'); // yearly | monthly | weekly | daily
  
  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [selectedCampaignFilter, setSelectedCampaignFilter] = useState('All');
  
  // Date Range and Custom Picker states - Defaulting to 'all' (All Time)
  const [timePeriod, setTimePeriod] = useState('all'); // 7 | 30 | 90 | all | custom
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Persistent list of campaign options received from API
  const [campaignOptionsList, setCampaignOptionsList] = useState([]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const campaignsPerPage = 5;

  // Hover states for tooltips
  const [hoveredTrendIndex, setHoveredTrendIndex] = useState(null);
  const [hoveredDonutSlice, setHoveredDonutSlice] = useState(null); // 'Paid' | 'Pending' | 'Unpaid'
  const [hoveredSRIndex, setHoveredSRIndex] = useState(null);
  const [hoveredOutcomeIndex, setHoveredOutcomeIndex] = useState(null);

  const navigate = useNavigate();
  const searchDebounceRef = useRef(null);

  // Load dashboard data with active filters
  async function fetchDashboardData(granularity, triggerLoading = false) {
    if (triggerLoading) setLoading(true);
    try {
      const filters = {};
      if (statusFilter !== 'All') filters.status = statusFilter;
      if (selectedCampaignFilter !== 'All') filters.campaignId = selectedCampaignFilter;
      if (paymentFilter !== 'All') filters.payment = paymentFilter;
      if (searchQuery.trim() !== '') filters.search = searchQuery.trim();
      
      filters.period = timePeriod;
      filters.spendTrend = spendTrendGranularity;

      if (timePeriod === 'custom' && customStartDate && customEndDate) {
        filters.startDate = customStartDate;
        filters.endDate = customEndDate;
      }

      const res = await api.getClinicDashboard(granularity, filters);
      setData(res);

      if (res.allCampaignsBrief) {
        setCampaignOptionsList(res.allCampaignsBrief);
      }
      
      setError('');
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setError(err.message || 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }

  // Refetch data when non-text filters or granularities change
  useEffect(() => {
    fetchDashboardData(trendGranularity, false);
    setCurrentPage(1); // Reset page to 1
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendGranularity, spendTrendGranularity, statusFilter, paymentFilter, selectedCampaignFilter, timePeriod]);

  // Refetch when custom dates change
  useEffect(() => {
    if (timePeriod === 'custom' && customStartDate && customEndDate) {
      fetchDashboardData(trendGranularity, false);
      setCurrentPage(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customStartDate, customEndDate]);

  // Debounced refetch for search query
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    searchDebounceRef.current = setTimeout(() => {
      fetchDashboardData(trendGranularity, false);
      setCurrentPage(1);
    }, 400);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Format currency in Indian Style (INR)
  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const handleExport = () => {
    if (!data || !data.campaignsList) return;

    const headers = ['Campaign', 'Contacts', 'Calls Completed', 'Amount Due', 'Amount Collected', 'Collection %', 'Credits Used', 'Status'];
    const rows = data.campaignsList.map(c => [
      `"${c.name.replace(/"/g, '""')}"`,
      c.contacts,
      c.callsCompleted,
      c.amountDue,
      c.amountCollected,
      `${c.collectionPercent}%`,
      c.creditsUsed,
      c.status
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Campaign_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Log the export
    api.logActivity({
      action: 'Report Exported',
      category: 'campaign',
      description: `Campaign performance report downloaded from Dashboard (${data.campaignsList.length} campaigns)`,
      metadata: { section: 'Dashboard', campaignCount: data.campaignsList.length }
    }).catch(() => {});
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <div className="flex flex-col items-center gap-3">
          <span className="material-symbols-outlined text-primary text-[42px] animate-spin">
            progress_activity
          </span>
          <p className="text-sm text-on-surface-variant font-medium">Loading live dashboard metrics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error-container text-on-error-container rounded-xl p-8 text-center max-w-xl mx-auto my-12 shadow-ambient">
        <span className="material-symbols-outlined text-[36px] mb-2 block">error</span>
        <p className="font-semibold">{error}</p>
        <button
          onClick={() => fetchDashboardData(trendGranularity, true)}
          className="mt-4 px-6 py-2 bg-error text-on-error rounded-full text-sm font-semibold hover:bg-red-700 transition-colors shadow-sm"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const { kpis, trendData, breakdown, campaignsList, callOutcomes, spendVsRevenue } = data;

  const outcomesList = [
    { label: 'Paid / Agreed to Pay', val: callOutcomes.paid, pct: callOutcomes.paidPercent, color: '#ef4444', colorClass: 'bg-[#ef4444]', r: 85 },
    { label: 'Request Callback', val: callOutcomes.callback, pct: callOutcomes.callbackPercent, color: '#3b82f6', colorClass: 'bg-[#3b82f6]', r: 66 },
    { label: 'No Answer / Busy', val: callOutcomes.noAnswer, pct: callOutcomes.noAnswerPercent, color: '#a855f7', colorClass: 'bg-[#a855f7]', r: 47 },
    { label: 'Refused / Wrong Number', val: callOutcomes.refused, pct: callOutcomes.refusedPercent, color: '#74777f', colorClass: 'bg-[#74777f]', r: 28 }
  ];

  // Pagination calculations
  const totalCampaigns = campaignsList.length;
  const totalPages = Math.max(1, Math.ceil(totalCampaigns / campaignsPerPage));
  const indexOfLastCampaign = currentPage * campaignsPerPage;
  const indexOfFirstCampaign = indexOfLastCampaign - campaignsPerPage;
  const currentCampaigns = campaignsList.slice(indexOfFirstCampaign, indexOfLastCampaign);

  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  // Bezier curve spline algorithms to compute smooth SVG paths
  const getBezierSplineD = (pts) => {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
    
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const curr = pts[i];
      const next = pts[i + 1];
      const cp1x = curr.x + (next.x - curr.x) / 3;
      const cp1y = curr.y;
      const cp2x = curr.x + 2 * (next.x - curr.x) / 3;
      const cp2y = next.y;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`;
    }
    return d;
  };

  const getBezierAreaD = (pts, bottomY) => {
    if (pts.length === 0) return '';
    const lineD = getBezierSplineD(pts);
    return `${lineD} L ${pts[pts.length - 1].x} ${bottomY} L ${pts[0].x} ${bottomY} Z`;
  };

  // SVG Chart Dimensions & Computations
  // 1. Revenue Trend Chart - Replaced with a smooth purple spline area chart (Overview style)
  const trendMaxVal = Math.max(...trendData.map(d => Math.max(d.collected, d.due)), 1000);
  const chartHeight = 220;
  const chartWidth = 700;
  const paddingLeft = 75; // Shunted right to fit Y-axis labels
  const paddingRight = 40;
  const usableWidth = chartWidth - paddingLeft - paddingRight;
  const colWidth = trendData.length > 0 ? usableWidth / trendData.length : usableWidth;

  const getTrendCoords = (index, value) => {
    const x = paddingLeft + index * colWidth + colWidth / 2;
    const y = chartHeight - 35 - (value / trendMaxVal) * (chartHeight - 60);
    return { x, y };
  };

  const trendRevPoints = trendData.map((d, i) => getTrendCoords(i, d.collected));
  const trendDuePoints = trendData.map((d, i) => getTrendCoords(i, d.due));

  const trendRevLineD = getBezierSplineD(trendRevPoints);
  const trendDueLineD = getBezierSplineD(trendDuePoints);

  const trendRevAreaD = getBezierAreaD(trendRevPoints, chartHeight - 35);

  // 2. Spend vs Revenue Spline Area Chart
  const maxSRVal = Math.max(...spendVsRevenue.map(d => Math.max(d.spend, d.revenue)), 1000);
  const srHeight = 150;
  const srWidth = 400;
  const srPaddingX = 40;
  const srUsableWidth = srWidth - srPaddingX * 2;
  const srColWidth = spendVsRevenue.length > 1 ? srUsableWidth / (spendVsRevenue.length - 1) : srUsableWidth;

  const getSRCoords = (index, value) => {
    const x = srPaddingX + index * srColWidth;
    const y = srHeight - 25 - (value / maxSRVal) * (srHeight - 45);
    return { x, y };
  };

  const srRevPoints = spendVsRevenue.map((d, i) => getSRCoords(i, d.revenue));
  const srSpendPoints = spendVsRevenue.map((d, i) => getSRCoords(i, d.spend));

  const srRevLinePath = getBezierSplineD(srRevPoints);
  const srSpendLinePath = getBezierSplineD(srSpendPoints);

  const srRevAreaPath = getBezierAreaD(srRevPoints, srHeight - 25);
  const srSpendAreaPath = getBezierAreaD(srSpendPoints, srHeight - 25);

  const chartTotalRevenue = spendVsRevenue.reduce((sum, d) => sum + d.revenue, 0);
  const chartTotalSpend = spendVsRevenue.reduce((sum, d) => sum + d.spend, 0);
  const localROI = chartTotalSpend > 0 ? parseFloat((chartTotalRevenue / chartTotalSpend).toFixed(1)) : 0;

  // 3. Circular/Donut Charts Calculations
  const radius = 28;
  const circumference = 2 * Math.PI * radius; // ~175.9
  const strokeDashoffset = circumference - (kpis.collectionRate / 100) * circumference;

  const donutRadius = 40;
  const donutCirc = 2 * Math.PI * donutRadius;
  const paidPct = breakdown.Paid.percent;
  const pendingPct = breakdown.Pending.percent;
  const unpaidPct = breakdown.Unpaid.percent;

  const strokePaid = (paidPct / 100) * donutCirc;
  const strokePending = (pendingPct / 100) * donutCirc;
  const strokeUnpaid = (unpaidPct / 100) * donutCirc;

  const offsetPaid = 0;
  const offsetPending = -strokePaid;
  const offsetUnpaid = -(strokePaid + strokePending);

  // Selector Options Config
  const campaignOptions = [
    { value: 'All', label: 'All' },
    ...campaignOptionsList.map(c => ({ value: c.id, label: c.name }))
  ];

  const statusOptions = [
    { value: 'All', label: 'All' },
    { value: 'Active', label: 'Active' },
    { value: 'Completed', label: 'Completed' },
    { value: 'Draft', label: 'Draft' }
  ];

  const paymentOptions = [
    { value: 'All', label: 'All' },
    { value: 'Highly Paid', label: 'Highly Paid (>= 80%)' },
    { value: 'Moderately Paid', label: 'Moderately Paid (40%-79%)' },
    { value: 'Low Collection', label: 'Low Collection (< 40%)' }
  ];

  const timePeriodOptions = [
    { value: '7', label: 'Last 7 Days' },
    { value: '30', label: 'Last 30 Days' },
    { value: '90', label: 'Last 90 Days' },
    { value: '365', label: 'Last 365 Days' },
    { value: 'all', label: 'All Time' },
    { value: 'custom', label: 'Custom Range' }
  ];

  return (
    <div className="space-y-lg p-margin-desktop max-w-7xl mx-auto font-body">
      {/* Page Header */}
      <div className="flex justify-between items-start flex-wrap gap-6 animate-in fade-in duration-300">
        {/* Welcome Back Header text (no card wrapper) */}
        <div>
          <span className="text-[10px] font-bold tracking-wider text-[#3b82f6] uppercase block mb-1">
            Organization Dashboard
          </span>
          <h1 className="font-display text-3xl md:text-4xl text-primary font-bold tracking-tight">
            Welcome back, {clientName}
          </h1>
          <p className="font-body text-body-sm text-on-surface-variant mt-1.5 font-semibold">
            {clinicName} <span className="text-outline-variant mx-1.5">•</span> Staff Access
          </p>
        </div>

        {/* Date range controls and status */}
        <div className="flex items-center gap-md flex-wrap shrink-0 mt-2">
          <div className="flex items-center gap-2 bg-surface-container-low px-3.5 py-2 rounded-full shadow-sm border border-outline-variant">
            <span className="w-2.5 h-2.5 rounded-full bg-green-600 animate-pulse"></span>
            <span className="text-[11px] font-bold text-green-700">All systems operational</span>
          </div>

          <div className="w-px h-6 bg-outline-variant hidden sm:block"></div>

          {timePeriod === 'custom' && (
            <div className="flex items-center gap-2 animate-in slide-in-from-right duration-200">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-3 py-2 border border-outline-variant rounded-xl font-body text-body-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none bg-surface-container-lowest shadow-sm"
              />
              <span className="text-on-surface-variant font-medium text-sm">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-3 py-2 border border-outline-variant rounded-xl font-body text-body-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none bg-surface-container-lowest shadow-sm"
              />
            </div>
          )}
          <CustomDropdown
            value={timePeriod}
            options={timePeriodOptions}
            onChange={setTimePeriod}
            icon="calendar_today"
          />
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-surface-container-lowest p-md rounded-xl border border-outline-variant flex flex-wrap items-center justify-between gap-md shadow-ambient">
        <div className="flex flex-wrap items-center gap-md flex-1 min-w-[300px]">
          {/* Search Input */}
          <div className="relative flex-1 max-w-xs">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px] pointer-events-none">search</span>
            <input
              className="w-full pl-10 pr-4 py-2.5 border border-outline-variant rounded-xl font-body text-body-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none bg-surface-container-lowest text-on-surface transition-all hover:border-outline shadow-sm"
              placeholder="Search campaigns..."
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Campaign Selector Dropdown */}
          <CustomDropdown
            value={selectedCampaignFilter}
            options={campaignOptions}
            onChange={setSelectedCampaignFilter}
            icon="campaign"
            labelPrefix="Campaign"
            minWidthClass="min-w-[190px]"
          />

          {/* Status Selector Dropdown */}
          <CustomDropdown
            value={statusFilter}
            options={statusOptions}
            onChange={setStatusFilter}
            icon="check_circle"
            labelPrefix="Status"
            minWidthClass="min-w-[150px]"
          />

          {/* Payment Selector Dropdown */}
          <CustomDropdown
            value={paymentFilter}
            options={paymentOptions}
            onChange={setPaymentFilter}
            icon="payments"
            labelPrefix="Payment"
            minWidthClass="min-w-[170px]"
          />
        </div>

        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-6 py-2.5 bg-secondary-container text-on-secondary-container rounded-full font-body text-label-md hover:bg-primary-fixed hover:text-primary transition-all duration-200 shadow-sm font-semibold shrink-0"
        >
          <span className="material-symbols-outlined text-[18px]">download</span>
          Export Report
        </button>
      </div>

      {/* Row 1: KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-gutter">
        {/* KPI 1: Revenue Collected */}
        <div className="bento-card p-md flex flex-col justify-between hover:scale-[1.01] transition-transform duration-200 animate-in fade-in zoom-in-95 duration-500">
          <div>
            <p className="font-body text-label-md text-on-surface-variant">Total Revenue Collected</p>
            <h2 className="font-display text-headline-lg text-primary mt-base">
              <AnimatedNumber value={kpis.totalCollected} format={(val) => formatCurrency(val)} />
            </h2>
          </div>
          <div className={`mt-md flex items-center gap-1 font-body text-label-sm ${kpis.revenueGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            <span className="material-symbols-outlined text-sm">{kpis.revenueGrowth >= 0 ? 'trending_up' : 'trending_down'}</span>
            <AnimatedNumber value={kpis.revenueGrowth} format={(val) => `${val >= 0 ? '+' : ''}${Math.round(val)}%`} /> vs last month
          </div>
        </div>

        {/* KPI 2: Total Amount Due */}
        <div className="bento-card p-md flex flex-col justify-between hover:scale-[1.01] transition-transform duration-200 animate-in fade-in zoom-in-95 duration-500">
          <div>
            <p className="font-body text-label-md text-on-surface-variant">Total Amount Due</p>
            <h2 className="font-display text-headline-lg text-primary mt-base">
              <AnimatedNumber value={kpis.totalDue} format={(val) => formatCurrency(val)} />
            </h2>
          </div>
          <p className="mt-md font-body text-body-sm text-on-surface-variant">
            Across <AnimatedNumber value={kpis.activeCampaignsCount} format={(val) => Math.round(val)} /> active campaigns
          </p>
        </div>

        {/* KPI 3: Collection Rate */}
        <div className="bento-card p-md flex items-center justify-between hover:scale-[1.01] transition-transform duration-200 animate-in fade-in zoom-in-95 duration-500">
          <div className="flex-1">
            <p className="font-body text-label-md text-on-surface-variant">Collection Rate</p>
            <h2 className="font-display text-headline-lg text-primary mt-base">
              <AnimatedNumber value={kpis.collectionRate} format={(val) => `${val.toFixed(1)}%`} />
            </h2>
          </div>
          <div className="relative w-16 h-16 flex items-center justify-center shrink-0">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                className="text-surface-container-high"
                cx="32"
                cy="32"
                fill="transparent"
                r={radius}
                stroke="currentColor"
                strokeWidth="4.5"
              />
              <circle
                className="text-primary transition-all duration-700"
                cx="32"
                cy="32"
                fill="transparent"
                r={radius}
                stroke="currentColor"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeWidth="4.5"
              />
            </svg>
          </div>
        </div>

        {/* KPI 4: Avg Credits Used per Call */}
        <div className="bento-card p-md flex flex-col justify-between hover:scale-[1.01] transition-transform duration-200 animate-in fade-in zoom-in-95 duration-500">
          <div>
            <p className="font-body text-label-md text-on-surface-variant">Avg. Credits Used / Call</p>
            <h2 className="font-display text-headline-lg text-primary mt-base">
              <AnimatedNumber value={kpis.avgCredits} format={(val) => val.toFixed(2)} />
            </h2>
          </div>
          <div className={`mt-md flex items-center gap-1 font-body text-label-sm ${kpis.creditsGrowth <= 0 ? 'text-green-600' : 'text-red-500'}`}>
            <span className="material-symbols-outlined text-sm">{kpis.creditsGrowth <= 0 ? 'trending_down' : 'trending_up'}</span>
            <AnimatedNumber value={kpis.creditsGrowth} format={(val) => `${val >= 0 ? '+' : ''}${Math.round(val)}%`} /> efficiency change
          </div>
        </div>
      </div>

      {/* Row 2: Charts */}
      <div className="grid grid-cols-12 gap-gutter">
        {/* Revenue Trend chart */}
        <div className="col-span-12 lg:col-span-8 bento-card p-md relative animate-in fade-in zoom-in-95 duration-500">
          <div className="flex justify-between items-center flex-wrap gap-4 mb-lg">
            <h3 className="font-display text-headline-md text-primary">Revenue Trend — {trendGranularity === 'monthly' ? 'Monthly' : trendGranularity === 'weekly' ? 'Weekly' : trendGranularity === 'yearly' ? 'Yearly' : 'Daily'}</h3>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5">
                <div className="w-3.5 h-1 bg-[#a855f7] rounded-full inline-block"></div>
                <span className="text-label-sm font-body text-on-surface-variant">Collected</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3.5 h-0.5 bg-[#3b82f6] border-t border-dashed border-[#3b82f6] inline-block"></div>
                <span className="text-label-sm font-body text-on-surface-variant">Due</span>
              </div>
              <div className="flex bg-surface-container-low p-1 rounded-full">
                {['yearly', 'monthly', 'weekly', 'daily'].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setTrendGranularity(mode)}
                    className={`px-4 py-1 text-label-sm font-body rounded-full transition-all capitalize ${trendGranularity === mode ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="h-64 relative border-b border-outline-variant pb-4">
            {/* Pure SVG aligned smooth spline area chart (Overview style) */}
            <svg className="w-full h-full" viewBox="0 0 700 220" preserveAspectRatio="none">
              <defs>
                <linearGradient id="trendRevGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a855f7" stopOpacity="0.45"/>
                  <stop offset="100%" stopColor="#a855f7" stopOpacity="0.0"/>
                </linearGradient>
              </defs>

              {/* Horizontal grid lines */}
              <line x1="75" y1="20" x2="670" y2="20" stroke="#f1f5f9" strokeWidth="1" />
              <line x1="75" y1="75" x2="670" y2="75" stroke="#f1f5f9" strokeWidth="1" />
              <line x1="75" y1="130" x2="670" y2="130" stroke="#f1f5f9" strokeWidth="1" />
              <line x1="75" y1="185" x2="670" y2="185" stroke="#e2e8f0" strokeWidth="1.5" />

              {/* Left Vertical Y-Axis Labels */}
              <text x="65" y="24" textAnchor="end" fill="#9ca3af" className="text-[10px] font-semibold select-none pointer-events-none font-body">{formatCurrency(trendMaxVal)}</text>
              <text x="65" y="105" textAnchor="end" fill="#9ca3af" className="text-[10px] font-semibold select-none pointer-events-none font-body">{formatCurrency(trendMaxVal * 0.5)}</text>
              <text x="65" y="189" textAnchor="end" fill="#9ca3af" className="text-[10px] font-semibold select-none pointer-events-none font-body">₹0</text>

              {/* Vertical Guide Line on Hover */}
              {hoveredTrendIndex !== null && (
                <line
                  x1={getTrendCoords(hoveredTrendIndex, 0).x}
                  y1="20"
                  x2={getTrendCoords(hoveredTrendIndex, 0).x}
                  y2="185"
                  stroke="#a855f7"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                  opacity="0.6"
                  pointerEvents="none"
                />
              )}

              {/* Dotted Vertical grid lines going down from each point to the bottom X-axis */}
              {trendRevPoints.map((pt, i) => (
                <line
                  key={`vline-${i}`}
                  x1={pt.x}
                  y1={pt.y}
                  x2={pt.x}
                  y2="185"
                  stroke="#e2e8f0"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                  pointerEvents="none"
                />
              ))}

              {/* Shaded Area Under Collected spline */}
              {trendRevAreaD && (
                <path d={trendRevAreaD} fill="url(#trendRevGrad)" pointerEvents="none" />
              )}

              {/* Collected Revenue Spline Line (Purple) */}
              {trendRevLineD && (
                <path
                  d={trendRevLineD}
                  fill="none"
                  stroke="#a855f7"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  pointerEvents="none"
                />
              )}

              {/* Outstanding Due Spline Line (Blue, dashed) */}
              {trendDueLineD && (
                <path
                  d={trendDueLineD}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="2.5"
                  strokeDasharray="4 2.5"
                  strokeLinecap="round"
                  pointerEvents="none"
                />
              )}

              {/* Node Dot Circles */}
              {trendRevPoints.map((pt, i) => (
                <circle
                  key={`dot-rev-${i}`}
                  cx={pt.x}
                  cy={pt.y}
                  r={hoveredTrendIndex === i ? '7' : '4.5'}
                  fill="#a855f7"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  className="transition-all duration-150 cursor-pointer"
                  onMouseEnter={() => setHoveredTrendIndex(i)}
                  onMouseLeave={() => setHoveredTrendIndex(null)}
                />
              ))}

              {trendDuePoints.map((pt, i) => (
                <circle
                  key={`dot-due-${i}`}
                  cx={pt.x}
                  cy={pt.y}
                  r={hoveredTrendIndex === i ? '7' : '4.5'}
                  fill="#3b82f6"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  className="transition-all duration-150 cursor-pointer"
                  onMouseEnter={() => setHoveredTrendIndex(i)}
                  onMouseLeave={() => setHoveredTrendIndex(null)}
                />
              ))}

              {/* X-Axis Labels */}
              {trendData.map((d, i) => {
                const coords = getTrendCoords(i, 0);
                return (
                  <text
                    key={`label-${i}`}
                    x={coords.x}
                    y="210"
                    textAnchor="middle"
                    fill="#42474f"
                    className="text-xs font-semibold select-none pointer-events-none"
                  >
                    {d.label}
                  </text>
                );
              })}
            </svg>

            {/* Interactive Tooltip Card Overlay */}
            {hoveredTrendIndex !== null && (() => {
              const d = trendData[hoveredTrendIndex];
              const coords = getTrendCoords(hoveredTrendIndex, Math.max(d.collected, d.due));
              const leftPercent = (coords.x / chartWidth) * 100;
              const topPx = coords.y - 12;
              return (
                <div
                  className="absolute bg-inverse-surface text-inverse-on-surface text-[11px] p-2.5 rounded-lg shadow-xl border border-outline-variant z-40 font-body pointer-events-none text-left min-w-[145px]"
                  style={{
                    left: `${leftPercent}%`,
                    top: `${topPx}px`,
                    transform: 'translate(-50%, -100%)',
                    transition: 'all 0.1s ease-out'
                  }}
                >
                  <p className="font-bold text-xs border-b border-outline-variant pb-1 mb-1 text-white">{d.label}</p>
                  <p className="flex justify-between gap-3 text-white/90">
                    <span>Collected:</span> <span className="font-semibold text-purple-300 font-mono">{formatCurrency(d.collected)}</span>
                  </p>
                  <p className="flex justify-between gap-3 text-white/90 mt-0.5">
                    <span>Due:</span> <span className="font-semibold text-blue-300 font-mono">{formatCurrency(d.due)}</span>
                  </p>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Payment Status Breakdown */}
        <div className="col-span-12 lg:col-span-4 bento-card p-md flex flex-col items-center justify-between animate-in fade-in zoom-in-95 duration-500">
          <h3 className="font-display text-headline-md text-primary self-start mb-lg">Payment Status</h3>
          
          <div className="relative w-48 h-48 my-auto">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              {/* Donut Segments with Hover Highlight */}
              <circle
                cx="50"
                cy="50"
                fill="transparent"
                r={donutRadius}
                stroke="#00355f"
                strokeDasharray={`${strokePaid} ${donutCirc}`}
                strokeDashoffset={offsetPaid}
                strokeWidth={hoveredDonutSlice === 'Paid' ? '15' : '11'}
                className="transition-all duration-200 cursor-pointer origin-center"
                onMouseEnter={() => setHoveredDonutSlice('Paid')}
                onMouseLeave={() => setHoveredDonutSlice(null)}
              />
              <circle
                cx="50"
                cy="50"
                fill="transparent"
                r={donutRadius}
                stroke="#8ebdf9"
                strokeDasharray={`${strokePending} ${donutCirc}`}
                strokeDashoffset={offsetPending}
                strokeWidth={hoveredDonutSlice === 'Pending' ? '15' : '11'}
                className="transition-all duration-200 cursor-pointer origin-center"
                onMouseEnter={() => setHoveredDonutSlice('Pending')}
                onMouseLeave={() => setHoveredDonutSlice(null)}
              />
              <circle
                cx="50"
                cy="50"
                fill="transparent"
                r={donutRadius}
                stroke="#ba1a1a"
                strokeDasharray={`${strokeUnpaid} ${donutCirc}`}
                strokeDashoffset={offsetUnpaid}
                strokeWidth={hoveredDonutSlice === 'Unpaid' ? '15' : '11'}
                className="transition-all duration-200 cursor-pointer origin-center"
                onMouseEnter={() => setHoveredDonutSlice('Unpaid')}
                onMouseLeave={() => setHoveredDonutSlice(null)}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
              {hoveredDonutSlice ? (
                <>
                  <span className="font-body text-body-sm text-on-surface-variant font-bold">{hoveredDonutSlice}</span>
                  <span className="font-display text-label-md font-extrabold text-primary">
                    {hoveredDonutSlice === 'Paid' && `${breakdown.Paid.percent}% (${breakdown.Paid.count})`}
                    {hoveredDonutSlice === 'Pending' && `${breakdown.Pending.percent}% (${breakdown.Pending.count})`}
                    {hoveredDonutSlice === 'Unpaid' && `${breakdown.Unpaid.percent}% (${breakdown.Unpaid.count})`}
                  </span>
                </>
              ) : (
                <>
                  <span className="font-body text-body-sm text-on-surface-variant">Collected</span>
                  <span className="font-display text-headline-md font-bold text-primary">
                    <AnimatedNumber value={kpis.totalCollected} format={(val) => formatCurrency(val)} />
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="w-full mt-lg grid grid-cols-3 gap-2">
            {[
              { key: 'Paid', color: 'bg-primary', label: 'Paid', value: paidPct, amt: breakdown.Paid.amount },
              { key: 'Pending', color: 'bg-[#8ebdf9]', label: 'Pending', value: pendingPct, amt: breakdown.Pending.amount },
              { key: 'Unpaid', color: 'bg-error', label: 'Unpaid', value: unpaidPct, amt: breakdown.Unpaid.amount }
            ].map((slice) => (
              <div
                key={slice.key}
                className={`flex flex-col items-center p-1.5 rounded-lg transition-all duration-150 ${
                  hoveredDonutSlice === slice.key ? 'bg-surface-container-high scale-105 shadow-sm' : ''
                }`}
                onMouseEnter={() => setHoveredDonutSlice(slice.key)}
                onMouseLeave={() => setHoveredDonutSlice(null)}
              >
                <div className="flex items-center gap-1 mb-1">
                  <div className={`w-2.5 h-2.5 rounded-full ${slice.color}`}></div>
                  <span className="font-body text-label-sm text-on-surface-variant font-medium">{slice.label}</span>
                </div>
                <span className="font-display text-label-md text-primary font-bold">{slice.value}%</span>
                <span className="text-[10px] text-on-surface-variant font-semibold mt-0.5">{formatCurrency(slice.amt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 3: Campaign Performance Table */}
      <div className="bento-card overflow-hidden shadow-ambient animate-in fade-in zoom-in-95 duration-500">
        <div className="p-md flex justify-between items-center border-b border-outline-variant flex-wrap gap-4">
          <div>
            <h3 className="font-display text-headline-md text-primary">Campaign Performance</h3>
            <p className="text-body-sm text-on-surface-variant mt-0.5">Showing {indexOfFirstCampaign + 1}-{Math.min(indexOfLastCampaign, totalCampaigns)} of {totalCampaigns} campaigns</p>
          </div>
          <button
            onClick={() => navigate('/campaigns')}
            className="text-primary font-body text-label-md flex items-center gap-1 hover:underline font-semibold"
          >
            View Detailed Campaigns <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container-low border-b border-outline-variant font-body">
              <tr>
                <th className="px-md py-4 text-label-md text-on-surface-variant">CAMPAIGN</th>
                <th className="px-md py-4 text-label-md text-on-surface-variant text-right">CONTACTS</th>
                <th className="px-md py-4 text-label-md text-on-surface-variant text-right">CALLS COMPLETED</th>
                <th className="px-md py-4 text-label-md text-on-surface-variant text-right">AMOUNT DUE</th>
                <th className="px-md py-4 text-label-md text-on-surface-variant text-right">AMOUNT COLLECTED</th>
                <th className="px-md py-4 text-label-md text-on-surface-variant">COLLECTION %</th>
                <th className="px-md py-4 text-label-md text-on-surface-variant text-right">CREDITS USED</th>
                <th className="px-md py-4 text-label-md text-on-surface-variant">STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant font-body">
              {currentCampaigns.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-md py-8 text-center text-on-surface-variant italic bg-surface-container-lowest">
                    No campaigns match the filters.
                  </td>
                </tr>
              ) : (
                currentCampaigns.map((camp) => (
                  <tr key={camp.id} className="hover:bg-surface-container-low transition-colors bg-surface-container-lowest">
                    <td
                      onClick={() => navigate(`/campaigns/${camp.id}/summary`)}
                      className="px-md py-4 text-label-md text-primary font-semibold cursor-pointer hover:underline"
                    >
                      {camp.name}
                    </td>
                    <td className="px-md py-4 text-body-sm text-right text-on-surface">{camp.contacts}</td>
                    <td className="px-md py-4 text-body-sm text-right text-on-surface">{camp.callsCompleted}</td>
                    <td className="px-md py-4 text-body-sm text-right text-on-surface font-semibold">{formatCurrency(camp.amountDue)}</td>
                    <td className="px-md py-4 text-body-sm text-right text-green-700 font-semibold">{formatCurrency(camp.amountCollected)}</td>
                    <td className="px-md py-4 w-40">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-surface-container-high rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${camp.collectionPercent}%` }}
                          ></div>
                        </div>
                        <span className="text-label-sm font-semibold text-on-surface-variant">{camp.collectionPercent}%</span>
                      </div>
                    </td>
                    <td className="px-md py-4 text-body-sm text-right text-on-surface">{camp.creditsUsed}</td>
                    <td className="px-md py-4">
                      <span className={`px-3 py-1 rounded-full text-label-sm font-semibold ${
                        camp.status === 'Active'
                          ? 'bg-primary-fixed text-on-primary-fixed'
                          : camp.status === 'Completed'
                          ? 'bg-surface-container-high text-on-surface-variant'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {camp.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Table Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-md py-4 border-t border-outline-variant bg-surface-container-lowest flex-wrap gap-4 font-body">
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1}
              className="flex items-center gap-1 px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold hover:bg-surface-container-low transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">chevron_left</span>
              Previous
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-9 h-9 rounded-xl text-sm font-semibold transition-all ${
                    currentPage === page
                      ? 'bg-primary text-on-primary shadow-sm scale-105'
                      : 'border border-outline-variant hover:bg-surface-container-low text-on-surface'
                  }`}
                >
                  {page}
                </button>
              ))}
            </div>

            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              className="flex items-center gap-1 px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold hover:bg-surface-container-low transition-colors disabled:opacity-50"
            >
              Next
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </button>
          </div>
        )}
      </div>

      {/* Row 4: Call Outcomes and Spend vs Revenue */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter">
        {/* Call Outcomes */}
        <div className="bento-card p-md flex flex-col justify-between hover:scale-[1.01] transition-transform duration-200 shadow-ambient animate-in fade-in zoom-in-95 duration-500">
          <h3 className="font-display text-headline-md text-primary mb-lg">Call Outcomes</h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-gutter items-center flex-1">
            {/* SVG Concentric progress rings on the left */}
            <div className="sm:col-span-5 flex justify-center relative">
              <svg className="w-44 h-44 shrink-0" viewBox="0 0 220 220">
                {outcomesList.map((outcome, idx) => {
                  const circumference = 2 * Math.PI * outcome.r;
                  const trackLength = 0.75 * circumference;
                  const progressLength = (outcome.pct / 100) * trackLength;
                  const strokeDasharray = `${progressLength} ${circumference - progressLength}`;
                  
                  // Calculate marker dot at the end of the arc
                  const sweepAngle = (outcome.pct / 100) * 270;
                  const endAngle = 180 + sweepAngle;
                  const markerX = 110 + outcome.r * Math.cos(endAngle * Math.PI / 180);
                  const markerY = 110 + outcome.r * Math.sin(endAngle * Math.PI / 180);
                  
                  const isHovered = hoveredOutcomeIndex === idx;
                  const isAnyHovered = hoveredOutcomeIndex !== null;
                  const opacity = isAnyHovered ? (isHovered ? 1.0 : 0.25) : 1.0;
                  const strokeWidth = isHovered ? 11.5 : 8.5;

                  return (
                    <g key={outcome.label} className="transition-all duration-200" style={{ opacity }}>
                      {/* Background track (grey) */}
                      <circle
                        cx="110"
                        cy="110"
                        r={outcome.r}
                        fill="transparent"
                        stroke="#f1f5f9"
                        strokeWidth={strokeWidth}
                        strokeDasharray={`${trackLength} ${circumference - trackLength}`}
                        strokeLinecap="round"
                        transform="rotate(180 110 110)"
                      />
                      {/* Active progress track */}
                      {progressLength > 0 && (
                        <circle
                          cx="110"
                          cy="110"
                          r={outcome.r}
                          fill="transparent"
                          stroke={outcome.color}
                          strokeWidth={strokeWidth}
                          strokeDasharray={strokeDasharray}
                          strokeLinecap="round"
                          transform="rotate(180 110 110)"
                          className="transition-all duration-300"
                        />
                      )}
                      {/* End circle marker dot */}
                      {outcome.pct > 0 && (
                        <circle
                          cx={markerX}
                          cy={markerY}
                          r={isHovered ? '6' : '4.5'}
                          fill={outcome.color}
                          stroke="#ffffff"
                          strokeWidth="1.5"
                          className="transition-all duration-200"
                        />
                      )}
                    </g>
                  );
                })}
              </svg>
              
              {/* Central Display */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                {hoveredOutcomeIndex !== null ? (
                  <>
                    <span className="font-body text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">
                      {outcomesList[hoveredOutcomeIndex].label.split(' / ')[0]}
                    </span>
                    <span className="font-display text-headline-sm font-black text-primary">
                      <AnimatedNumber value={outcomesList[hoveredOutcomeIndex].pct} format={(val) => `${Math.round(val)}%`} />
                    </span>
                    <span className="text-[10px] font-bold text-on-surface-variant">
                      (<AnimatedNumber value={outcomesList[hoveredOutcomeIndex].val} format={(val) => Math.round(val)} /> calls)
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-body text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">Total</span>
                    <span className="font-display text-headline-sm font-black text-primary">
                      <AnimatedNumber value={callOutcomes.paid + callOutcomes.callback + callOutcomes.noAnswer + callOutcomes.refused} format={(val) => Math.round(val)} />
                    </span>
                    <span className="text-[10px] font-bold text-on-surface-variant">Calls Logged</span>
                  </>
                )}
              </div>
            </div>

            {/* Legend list on the right */}
            <div className="sm:col-span-7 space-y-2">
              {outcomesList.map((outcome, idx) => {
                const isHovered = hoveredOutcomeIndex === idx;
                const isAnyHovered = hoveredOutcomeIndex !== null;
                const opacity = isAnyHovered ? (isHovered ? 'opacity-100 scale-[1.01]' : 'opacity-40') : 'opacity-100';

                return (
                  <div
                    key={outcome.label}
                    className={`p-2.5 rounded-xl border border-transparent transition-all duration-200 cursor-pointer flex items-center justify-between group ${
                      isHovered ? 'bg-surface-container-low border-outline-variant shadow-sm' : 'hover:bg-surface-container-low hover:border-outline-variant'
                    } ${opacity}`}
                    onMouseEnter={() => setHoveredOutcomeIndex(idx)}
                    onMouseLeave={() => setHoveredOutcomeIndex(null)}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: outcome.color }}></div>
                      <span className="font-body text-xs text-on-surface-variant font-semibold truncate group-hover:text-primary transition-colors">
                        {outcome.label}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-display text-xs font-bold text-primary block">
                        <AnimatedNumber value={outcome.val} format={(val) => `${Math.round(val)} calls`} />
                      </span>
                      <span className="text-[10px] font-semibold text-on-surface-variant">
                        <AnimatedNumber value={outcome.pct} format={(val) => `${Math.round(val)}%`} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Spend vs Revenue ROI chart */}
        <div className="bento-card p-md flex flex-col justify-between relative hover:scale-[1.01] transition-transform duration-200 shadow-ambient animate-in fade-in zoom-in-95 duration-500">
          <div className="flex justify-between items-start mb-lg flex-wrap gap-2">
            <div>
              <h3 className="font-display text-headline-md text-primary">Spend vs Revenue</h3>
              <p className="text-body-sm text-on-surface-variant mt-0.5">ROI: <AnimatedNumber value={localROI} format={(val) => `${val.toFixed(1)}x`} /></p>
            </div>
            
            <div className="flex items-center gap-4 flex-wrap">
              {/* Granularity Selector Toggles */}
              <div className="flex bg-surface-container-low p-1 rounded-full shrink-0">
                {['yearly', 'monthly', 'weekly', 'daily'].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSpendTrendGranularity(mode)}
                    className={`px-3 py-1 text-[11px] font-semibold font-body rounded-full transition-all capitalize ${spendTrendGranularity === mode ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>
          
          <div className="w-full mt-4">
            <div className="relative h-40 w-full">
              <svg className="w-full h-full" viewBox={`0 0 ${srWidth} ${srHeight}`} preserveAspectRatio="none">
                <defs>
                  {/* Visual Gradient Fills matching picture aesthetic */}
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35"/>
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0"/>
                  </linearGradient>
                  <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a855f7" stopOpacity="0.35"/>
                    <stop offset="100%" stopColor="#a855f7" stopOpacity="0.0"/>
                  </linearGradient>
                </defs>

                {/* Horizontal background lines */}
                <line x1={srPaddingX} y1={20} x2={srWidth - srPaddingX} y2={20} stroke="#f1f5f9" strokeWidth="1" />
                <line x1={srPaddingX} y1={60} x2={srWidth - srPaddingX} y2={60} stroke="#f1f5f9" strokeWidth="1" />
                <line x1={srPaddingX} y1={100} x2={srWidth - srPaddingX} y2={100} stroke="#f1f5f9" strokeWidth="1" />
                <line x1={srPaddingX} y1={srHeight - 25} x2={srWidth - srPaddingX} y2={srHeight - 25} stroke="#e2e8f0" strokeWidth="1.5" />

                {/* Vertical Guide Line on Hover */}
                {hoveredSRIndex !== null && (
                  <line
                    x1={getSRCoords(hoveredSRIndex, 0).x}
                    y1="20"
                    x2={getSRCoords(hoveredSRIndex, 0).x}
                    y2={srHeight - 25}
                    stroke="#3b82f6"
                    strokeWidth="1.2"
                    strokeDasharray="3 3"
                    opacity="0.6"
                    pointerEvents="none"
                  />
                )}

                {/* Filled Spline Areas */}
                {srRevAreaPath && (
                  <path d={srRevAreaPath} fill="url(#revGrad)" pointerEvents="none" />
                )}
                {srSpendAreaPath && (
                  <path d={srSpendAreaPath} fill="url(#spendGrad)" pointerEvents="none" />
                )}

                {/* Spline Lines */}
                {srRevLinePath && (
                  <path
                    d={srRevLinePath}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                )}
                {srSpendLinePath && (
                  <path
                    d={srSpendLinePath}
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth="3"
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                )}

                {/* Revenue Circular Nodes */}
                {srRevPoints.map((pt, i) => (
                  <circle
                    key={`r-${i}`}
                    cx={pt.x}
                    cy={pt.y}
                    r={hoveredSRIndex === i ? '6.5' : '4'}
                    fill="#3b82f6"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    className="transition-all duration-150 cursor-pointer"
                    onMouseEnter={() => setHoveredSRIndex(i)}
                    onMouseLeave={() => setHoveredSRIndex(null)}
                  />
                ))}
                
                {/* Spend Circular Nodes */}
                {srSpendPoints.map((pt, i) => (
                  <circle
                    key={`s-${i}`}
                    cx={pt.x}
                    cy={pt.y}
                    r={hoveredSRIndex === i ? '6.5' : '4'}
                    fill="#a855f7"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    className="transition-all duration-150 cursor-pointer"
                    onMouseEnter={() => setHoveredSRIndex(i)}
                    onMouseLeave={() => setHoveredSRIndex(null)}
                  />
                ))}
              </svg>

              {/* Spend vs Revenue Tooltip overlay card */}
              {hoveredSRIndex !== null && (
                <div
                  className="absolute bg-white/95 text-on-surface text-[11px] p-3 rounded-xl shadow-xl border border-outline-variant z-40 font-body pointer-events-none text-left min-w-[155px]"
                  style={{
                    left: '50%',
                    top: '35%',
                    transform: 'translate(-50%, -50%)',
                    transition: 'all 0.15s ease-out'
                  }}
                >
                  <p className="font-bold text-xs border-b border-outline-variant pb-1.5 mb-1.5 text-primary">
                    {spendVsRevenue[hoveredSRIndex].label}
                  </p>
                  <p className="flex justify-between gap-4">
                    <span className="text-on-surface-variant font-medium">Collected:</span>{' '}
                    <span className="font-semibold text-green-755">{formatCurrency(spendVsRevenue[hoveredSRIndex].revenue)}</span>
                  </p>
                  <p className="flex justify-between gap-4 mt-1">
                    <span className="text-on-surface-variant font-medium">Spend:</span>{' '}
                    <span className="font-semibold text-purple-755">{formatCurrency(spendVsRevenue[hoveredSRIndex].spend)}</span>
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-between font-body text-[10px] text-on-surface-variant font-bold px-4">
              {spendVsRevenue.map((d, i) => (
                <span key={i}>{d.label}</span>
              ))}
            </div>
            
            {/* Chart Legend Box */}
            <div className="mt-6 flex gap-gutter justify-center p-3 bg-surface-container-low border border-outline-variant rounded-2xl max-w-sm mx-auto shadow-sm">
              <div className="flex items-center gap-2 font-body text-label-sm font-semibold text-on-surface">
                <span className="w-3.5 h-1 bg-[#3b82f6] rounded-full inline-block"></span>
                <span>Collected Revenue</span>
              </div>
              <div className="w-px bg-outline-variant self-stretch"></div>
              <div className="flex items-center gap-2 font-body text-label-sm font-semibold text-on-surface-variant">
                <span className="w-3.5 h-1 bg-[#a855f7] rounded-full inline-block"></span>
                <span>Credits Cost (Spend)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
