import { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import Badge from '../components/ui/Badge.jsx';

export default function CostAnalytics() {
  const [activeSubTab, setActiveSubTab] = useState('overview'); // 'overview' | 'calls' | 'margins'
  const [startDate, setStartDate] = useState('2026-07-01');
  const [endDate, setEndDate] = useState('2026-07-31');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getAdminAnalytics(startDate, endDate);
      setData(res);
    } catch (err) {
      console.error('Failed to load cost analytics:', err);
      setError('Failed to retrieve platform cost metrics. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading && !data) {
    return <div className="text-center py-20 font-body text-gray-500">Loading cost analytics platform...</div>;
  }

  const aggregates = data?.aggregates || {
    total_spend: 0,
    total_calls: 0,
    avg_cost: 0,
    avg_duration: 0,
    total_stt: 0,
    total_tts: 0,
    total_llm_in: 0,
    total_llm_out: 0,
    total_telephony: 0,
    total_other: 0,
    total_llm_in_tokens: 0,
    total_llm_out_tokens: 0,
    total_tts_chars: 0,
    total_credits_billed: 0,
  };

  const breakdowns = data?.breakdowns || [];
  const margins = data?.margins || [];

  // Calculate percentages for custom CSS donut chart
  const stt = parseFloat(aggregates.total_stt || 0);
  const tts = parseFloat(aggregates.total_tts || 0);
  const llmIn = parseFloat(aggregates.total_llm_in || 0);
  const llmOut = parseFloat(aggregates.total_llm_out || 0);
  const tel = parseFloat(aggregates.total_telephony || 0);
  const other = parseFloat(aggregates.total_other || 0);
  const total = stt + tts + llmIn + llmOut + tel + other || 1;

  const pctSTT = Math.round((stt / total) * 100);
  const pctTTS = Math.round((tts / total) * 100);
  const pctLLMIn = Math.round((llmIn / total) * 100);
  const pctLLMOut = Math.round((llmOut / total) * 100);
  const pctTel = Math.round((tel / total) * 100);
  const pctOther = Math.max(0, 100 - pctSTT - pctTTS - pctLLMIn - pctLLMOut - pctTel);

  const sttEnd = pctSTT;
  const ttsEnd = sttEnd + pctTTS;
  const llmInEnd = ttsEnd + pctLLMIn;
  const llmOutEnd = llmInEnd + pctLLMOut;
  const telEnd = llmOutEnd + pctTel;

  const donutGradient = {
    background: `conic-gradient(
      #00355f 0% ${sttEnd}%,
      #0f4c81 ${sttEnd}% ${ttsEnd}%,
      #2d6197 ${ttsEnd}% ${llmInEnd}%,
      #a0c9ff ${llmInEnd}% ${llmOutEnd}%,
      #505f76 ${llmOutEnd}% ${telEnd}%,
      #c2c7d1 ${telEnd}% 100%
    )`
  };

  return (
    <div className="flex-1 w-full space-y-6">
      {/* Page Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b pb-6 border-gray-200">
        <div>
          <h2 className="text-3xl font-bold mb-2 text-[#1e293b]">Cost Analytics</h2>
          <p className="text-sm text-[#64748b]">Detailed per-call cost breakdown across STT, TTS, LLM, Telephony & WhatsApp.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent border-none text-xs font-semibold text-gray-700 focus:ring-0 p-0 w-28 cursor-pointer"
            />
            <span className="text-gray-400 mx-2 text-xs">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent border-none text-xs font-semibold text-gray-700 focus:ring-0 p-0 w-28 cursor-pointer"
            />
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 bg-[#0f4c81] text-white px-4 py-2 rounded-lg font-semibold text-sm hover:bg-[#0c3e69] transition-colors shadow-sm disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">refresh</span>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-4 text-center text-sm">{error}</div>
      )}

      {/* Summary Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Spend */}
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm flex flex-col justify-between h-[130px]">
          <div className="flex justify-between items-start">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Spend</p>
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-[#0f4c81]">
              <span className="material-symbols-outlined text-[18px]">payments</span>
            </div>
          </div>
          <p className="text-2xl font-bold text-[#1e293b]">₹ {parseFloat(aggregates.total_spend || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>

        {/* Total Calls */}
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm flex flex-col justify-between h-[130px]">
          <div className="flex justify-between items-start">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Calls</p>
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-[#0f4c81]">
              <span className="material-symbols-outlined text-[18px]">call</span>
            </div>
          </div>
          <p className="text-2xl font-bold text-[#1e293b]">{parseInt(aggregates.total_calls || 0).toLocaleString()}</p>
        </div>

        {/* Avg Cost / Call */}
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm flex flex-col justify-between h-[130px]">
          <div className="flex justify-between items-start">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Avg Cost / Call</p>
            <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center text-orange-700">
              <span className="material-symbols-outlined text-[18px]">calculate</span>
            </div>
          </div>
          <p className="text-2xl font-bold text-[#1e293b]">₹ {parseFloat(aggregates.avg_cost || 0).toFixed(2)}</p>
        </div>

        {/* Avg Duration */}
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm flex flex-col justify-between h-[130px]">
          <div className="flex justify-between items-start">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Avg Duration</p>
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600">
              <span className="material-symbols-outlined text-[18px]">timer</span>
            </div>
          </div>
          <p className="text-2xl font-bold text-[#1e293b]">{Math.round(aggregates.avg_duration || 0)}s</p>
        </div>
      </section>

      {/* Tab Bar */}
      <div className="border-b border-gray-200 flex gap-6">
        <button
          onClick={() => setActiveSubTab('overview')}
          className={`flex items-center gap-1.5 pb-3 font-semibold text-sm transition-all border-b-2 ${
            activeSubTab === 'overview' ? 'text-[#0f4c81] border-[#0f4c81]' : 'text-gray-500 hover:text-[#0f4c81] border-transparent'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">pie_chart</span>
          Overview
        </button>
        <button
          onClick={() => setActiveSubTab('calls')}
          className={`flex items-center gap-1.5 pb-3 font-semibold text-sm transition-all border-b-2 ${
            activeSubTab === 'calls' ? 'text-[#0f4c81] border-[#0f4c81]' : 'text-gray-500 hover:text-[#0f4c81] border-transparent'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">bar_chart</span>
          Call Details
        </button>
        <button
          onClick={() => setActiveSubTab('margins')}
          className={`flex items-center gap-1.5 pb-3 font-semibold text-sm transition-all border-b-2 ${
            activeSubTab === 'margins' ? 'text-[#0f4c81] border-[#0f4c81]' : 'text-gray-500 hover:text-[#0f4c81] border-transparent'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">receipt_long</span>
          Margins
        </button>
      </div>

      {/* Overview Content */}
      {activeSubTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column (Breakdown) */}
          <div className="lg:col-span-7 bg-white rounded-xl p-6 border border-gray-200 shadow-sm flex flex-col min-h-[400px]">
            <h3 className="font-bold text-sm text-[#1e293b] mb-6">Cost Breakdown</h3>
            <div className="flex-1 flex flex-col items-center justify-center">
              {/* Donut Chart Visualization */}
              <div className="w-[180px] h-[180px] rounded-full flex items-center justify-center relative shadow-sm" style={donutGradient}>
                <div className="w-[130px] h-[130px] rounded-full bg-white flex flex-col items-center justify-center">
                  <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Total Cost</span>
                  <span className="text-lg font-bold text-[#1e293b] mt-1">₹{parseFloat(aggregates.total_spend || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                </div>
              </div>

              {/* Legend */}
              <div className="w-full grid grid-cols-2 sm:grid-cols-3 gap-4 mt-8 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#00355f]"></div>
                  <span className="text-xs text-gray-500 font-medium">STT ({pctSTT}%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#0f4c81]"></div>
                  <span className="text-xs text-gray-500 font-medium">TTS ({pctTTS}%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#2d6197]"></div>
                  <span className="text-xs text-gray-500 font-medium">LLM In ({pctLLMIn}%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#a0c9ff]"></div>
                  <span className="text-xs text-gray-500 font-medium">LLM Out ({pctLLMOut}%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#505f76]"></div>
                  <span className="text-xs text-gray-500 font-medium">Telephony ({pctTel}%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#c2c7d1]"></div>
                  <span className="text-xs text-gray-500 font-medium">Other ({pctOther}%)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            {/* Top Cost Components */}
            <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm flex-1">
              <h3 className="font-bold text-sm text-[#1e293b] mb-4">Top Cost Components</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-[#1e293b]">Speech-to-Text (STT)</span>
                    <span className="text-gray-500">₹ {parseFloat(aggregates.total_stt || 0).toFixed(2)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-[#00355f] h-2 rounded-full" style={{ width: `${pctSTT}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-[#1e293b]">Text-to-Speech (TTS)</span>
                    <span className="text-gray-500">₹ {parseFloat(aggregates.total_tts || 0).toFixed(2)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-[#0f4c81] h-2 rounded-full" style={{ width: `${pctTTS}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-[#1e293b]">LLM Cost (In & Out)</span>
                    <span className="text-gray-500">₹ {(parseFloat(aggregates.total_llm_in || 0) + parseFloat(aggregates.total_llm_out || 0)).toFixed(2)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-[#2d6197] h-2 rounded-full" style={{ width: `${pctLLMIn + pctLLMOut}%` }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-[#1e293b]">Telephony lines</span>
                    <span className="text-gray-500">₹ {parseFloat(aggregates.total_telephony || 0).toFixed(2)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-[#505f76] h-2 rounded-full" style={{ width: `${pctTel}%` }}></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Usage Stats Grid */}
            <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
              <h3 className="font-bold text-sm text-[#1e293b] mb-4">Usage Statistics</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">LLM Input Tokens</p>
                  <p className="text-base font-bold text-[#1e293b]">{(aggregates.total_llm_in_tokens / 1000).toFixed(1)}k</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">LLM Output Tokens</p>
                  <p className="text-base font-bold text-[#1e293b]">{(aggregates.total_llm_out_tokens / 1000).toFixed(1)}k</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">TTS Characters</p>
                  <p className="text-base font-bold text-[#1e293b]">{(aggregates.total_tts_chars / 1000).toFixed(1)}k</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Credits Billed</p>
                  <p className="text-base font-bold text-[#1e293b]">{parseFloat(aggregates.total_credits_billed || 0).toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Call Details Table Tab */}
      {activeSubTab === 'calls' && (
        <div className="bg-white border border-gray-200 shadow-sm rounded-lg overflow-hidden">
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Phone / Clinic</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Duration</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">STT Cost</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">TTS Cost</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">LLM Cost</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Tel. Cost</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Credits Billed</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Total Cost</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Margin</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-[#1e293b]">
                {breakdowns.map((b) => {
                  const billed = parseFloat(b.credits_billed || 0) * 5.0; // 1 credit = 5 Rupees
                  const cost = parseFloat(b.total_cost || 0);
                  const marginVal = billed - cost;
                  const marginPct = billed > 0 ? ((marginVal / billed) * 100) : 0;
                  return (
                    <tr key={b.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="font-semibold text-[#1e293b]">{b.phone_number}</span>
                          <span className="text-gray-400 text-[11px] font-medium">{b.clinic_name}</span>
                        </div>
                      </td>
                      <td className="p-4 text-right text-gray-700 font-medium">
                        {Math.round(b.duration_seconds)}s
                      </td>
                      <td className="p-4 text-right text-gray-500">₹{parseFloat(b.stt_cost || 0).toFixed(4)}</td>
                      <td className="p-4 text-right text-gray-500">₹{parseFloat(b.tts_cost || 0).toFixed(4)}</td>
                      <td className="p-4 text-right text-gray-500">₹{(parseFloat(b.llm_in_cost || 0) + parseFloat(b.llm_out_cost || 0)).toFixed(4)}</td>
                      <td className="p-4 text-right text-gray-500">₹{parseFloat(b.telephony_cost || 0).toFixed(4)}</td>
                      <td className="p-4 text-right font-bold text-[#0f4c81]">
                        {parseFloat(b.credits_billed || 0).toFixed(0)}
                      </td>
                      <td className="p-4 text-right font-bold text-gray-800">
                        ₹{parseFloat(b.total_cost || 0).toFixed(4)}
                      </td>
                      <td className={`p-4 text-right font-bold ${marginVal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        ₹{marginVal.toFixed(4)}
                      </td>
                      <td className="p-4 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${marginVal >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {marginPct.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {breakdowns.length === 0 && (
                  <tr>
                    <td colSpan="10" className="p-8 text-center text-gray-400 italic">No cost analytics logs loaded in the system database.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Margins Tab */}
      {activeSubTab === 'margins' && (
        <div className="bg-white border border-gray-200 shadow-sm rounded-lg overflow-hidden">
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Clinic Name</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Total Calls</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Credits Billed</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Platform AI Cost</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Gross Margin</th>
                  <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-[#1e293b]">
                {margins.map((m, idx) => {
                  const billed = parseFloat(m.credits_billed || 0) * 5.0; // 1 credit = 5 Rupees
                  const cost = parseFloat(m.total_cost || 0);
                  const marginVal = billed - cost;
                  const marginPct = billed > 0 ? ((marginVal / billed) * 100) : 0;
                  return (
                    <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                      <td className="p-4 font-semibold text-[#1e293b]">{m.clinic_name}</td>
                      <td className="p-4 text-right text-gray-700 font-medium">{m.call_count}</td>
                      <td className="p-4 text-right text-gray-700">₹{billed.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="p-4 text-right text-gray-500">₹{cost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className={`p-4 text-right font-bold ${marginVal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        ₹{marginVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="p-4 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${marginVal >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {marginPct.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {margins.length === 0 && (
                  <tr>
                    <td colSpan="6" className="p-8 text-center text-gray-400 italic">No margin breakdown data currently computed.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
