import { useState, useEffect, useCallback } from 'react'
import { GoogleMap, useJsApiLoader, Marker, InfoWindow } from '@react-google-maps/api'
import { api } from '../services/api.js'


// ── City → LatLng lookup for Indian cities ──────────────────────────────────
const CITY_COORDS = {
  'hyderabad':    { lat: 17.3850, lng: 78.4867 },
  'bengaluru':    { lat: 12.9716, lng: 77.5946 },
  'bangalore':    { lat: 12.9716, lng: 77.5946 },
  'mumbai':       { lat: 19.0760, lng: 72.8777 },
  'delhi':        { lat: 28.7041, lng: 77.1025 },
  'new delhi':    { lat: 28.6139, lng: 77.2090 },
  'chennai':      { lat: 13.0827, lng: 80.2707 },
  'kolkata':      { lat: 22.5726, lng: 88.3639 },
  'pune':         { lat: 18.5204, lng: 73.8567 },
  'ahmedabad':    { lat: 23.0225, lng: 72.5714 },
  'jaipur':       { lat: 26.9124, lng: 75.7873 },
  'nagpur':       { lat: 21.1458, lng: 79.0882 },
  'indore':       { lat: 22.7196, lng: 75.8577 },
  'bhopal':       { lat: 23.2599, lng: 77.4126 },
  'visakhapatnam':{ lat: 17.6868, lng: 83.2185 },
  'vizag':        { lat: 17.6868, lng: 83.2185 },
  'patna':        { lat: 25.5941, lng: 85.1376 },
  'vadodara':     { lat: 22.3072, lng: 73.1812 },
  'lucknow':      { lat: 26.8467, lng: 80.9462 },
  'surat':        { lat: 21.1702, lng: 72.8311 },
  'nashik':       { lat: 19.9975, lng: 73.7898 },
  'kanpur':       { lat: 26.4499, lng: 80.3319 },
  'agra':         { lat: 27.1767, lng: 78.0081 },
  'rajkot':       { lat: 22.3039, lng: 70.8022 },
  'varanasi':     { lat: 25.3176, lng: 82.9739 },
  'chandigarh':   { lat: 30.7333, lng: 76.7794 },
  'coimbatore':   { lat: 11.0168, lng: 76.9558 },
  'madurai':      { lat:  9.9252, lng: 78.1198 },
  'vijayawada':   { lat: 16.5062, lng: 80.6480 },
  'jodhpur':      { lat: 26.2389, lng: 73.0243 },
  'raipur':       { lat: 21.2514, lng: 81.6296 },
  'kochi':        { lat:  9.9312, lng: 76.2673 },
  'trivandrum':   { lat:  8.5241, lng: 76.9366 },
  'thiruvananthapuram': { lat: 8.5241, lng: 76.9366 },
  'mysore':       { lat: 12.2958, lng: 76.6394 },
  'hubli':        { lat: 15.3647, lng: 75.1240 },
  'solapur':      { lat: 17.6599, lng: 75.9064 },
  'warangal':     { lat: 17.9784, lng: 79.5941 },
  'nellore':      { lat: 14.4426, lng: 79.9865 },
  'guntur':       { lat: 16.3067, lng: 80.4365 },
  'tirupati':     { lat: 13.6288, lng: 79.4192 },
  'karimnagar':   { lat: 18.4386, lng: 79.1288 },
  'rajahmundry':  { lat: 17.0005, lng: 81.8040 },
  'anantapur':    { lat: 14.6819, lng: 77.6006 },
  'kurnool':      { lat: 15.8281, lng: 78.0373 },
  'nizamabad':    { lat: 18.6726, lng: 78.0941 },
  'khammam':      { lat: 17.2473, lng: 80.1514 },
  'nalgonda':     { lat: 17.0575, lng: 79.2677 },
  'mahabubnagar': { lat: 16.7488, lng: 77.9862 },
  'patancheru':   { lat: 17.5348, lng: 78.2632 },
  'manikonda':    { lat: 17.4062, lng: 78.3905 },
  'secunderabad': { lat: 17.4399, lng: 78.4983 },
  'amritsar':     { lat: 31.6340, lng: 74.8723 },
  'ludhiana':     { lat: 30.9010, lng: 75.8573 },
  'guwahati':     { lat: 26.1445, lng: 91.7362 },
  'jabalpur':     { lat: 23.1815, lng: 79.9864 },
  'gwalior':      { lat: 26.2183, lng: 78.1828 },
  'kota':         { lat: 25.2138, lng: 75.8648 },
  'allahabad':    { lat: 25.4358, lng: 81.8463 },
  'prayagraj':    { lat: 25.4358, lng: 81.8463 },
  'aurangabad':   { lat: 19.8762, lng: 75.3433 },
  'thane':        { lat: 19.2183, lng: 72.9781 },
  'meerut':       { lat: 28.9845, lng: 77.7064 },
  'faridabad':    { lat: 28.4089, lng: 77.3178 },
  'ghaziabad':    { lat: 28.6692, lng: 77.4538 },
}

function getCityCoords(city) {
  if (!city) return { lat: 20.5937, lng: 78.9629 }
  const key = city.toLowerCase().trim()
  if (CITY_COORDS[key]) return CITY_COORDS[key]
  for (const [k, v] of Object.entries(CITY_COORDS)) {
    if (key.includes(k) || k.includes(key)) return v
  }
  return { lat: 20.5937, lng: 78.9629 }
}

const STATUS_COLOR = {
  active:    '#16a34a',
  trial:     '#ea580c',
  suspended: '#94a3b8',
}

const MAP_CONTAINER = { width: '100%', height: '390px' }
const INDIA_CENTER  = { lat: 20.5937, lng: 78.9629 }

const MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#e8edf2' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#4a5568' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f7f9fb' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#b3cde3' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e2e8f0' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#a0aec0' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#1e293b' }] },
  { featureType: 'administrative.province', elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]

// ── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-ambient p-6 flex items-start justify-between hover:shadow-lg transition-shadow duration-300">
      <div className="flex flex-col gap-1 flex-1">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{label}</p>
        <p className="text-[42px] font-bold text-[#1e293b] leading-none mt-1">{value ?? '—'}</p>
        <p className="text-xs text-gray-400 mt-2">{sub}</p>
      </div>
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ml-4"
        style={{ background: `${color}18` }}
      >
        <span className="material-symbols-outlined text-[22px]" style={{ color }}>{icon}</span>
      </div>
    </div>
  )
}

// ── Clinic row for sidebar panel ─────────────────────────────────────────────
function ClinicRow({ clinic, onClick, isSelected }) {
  const color = STATUS_COLOR[clinic.status] || '#94a3b8'
  return (
    <button
      onClick={() => onClick(clinic)}
      className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors ${
        isSelected ? 'bg-[#d2e4ff]' : 'hover:bg-gray-50'
      }`}
    >
      <div className="w-8 h-8 rounded-lg bg-[#d2e4ff] flex items-center justify-center shrink-0">
        <span className="material-symbols-outlined text-[16px] text-[#0f4c81]">local_hospital</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#1e293b] truncate">{clinic.name}</p>
        <p className="text-xs text-gray-400 truncate">
          {clinic.status} • {clinic.phone || '—'}
        </p>
      </div>
      <span
        className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 border"
        style={{
          background: `${color}18`,
          color,
          borderColor: `${color}40`,
        }}
      >
        {clinic.status}
      </span>
    </button>
  )
}

// ── Main Dashboard Component ─────────────────────────────────────────────────
export default function AdminDashboard() {
  const [data, setData]                     = useState(null)
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState('')
  const [search, setSearch]                 = useState('')
  const [selectedClinic, setSelectedClinic] = useState(null)
  const [mapRef, setMapRef]                 = useState(null)
  const [refreshing, setRefreshing]         = useState(false)

  const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: MAPS_KEY,
    id: 'auvia-gmap-script',
  })

  async function loadDashboard() {
    try {
      const res = await api.getAdminDashboard()
      const clinicsWithCoords = res.clinics.map(c => ({
        ...c,
        // Use real DB coordinates if available, fall back to city-name lookup
        coords:
          c.latitude != null && c.longitude != null
            ? { lat: parseFloat(c.latitude), lng: parseFloat(c.longitude) }
            : getCityCoords(c.city),
      }))
      setData({ ...res, clinics: clinicsWithCoords })
    } catch (err) {
      setError(err.message || 'Failed to load dashboard')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { loadDashboard() }, [])

  function handleRefresh() {
    setRefreshing(true)
    setError('')
    loadDashboard()
  }

  const handleMapLoad = useCallback(map => setMapRef(map), [])

  function handleClinicClick(clinic) {
    setSelectedClinic(clinic)
    if (mapRef && clinic.coords) {
      mapRef.panTo(clinic.coords)
      mapRef.setZoom(11)
    }
  }

  const filteredClinics = (data?.clinics || []).filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.city || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search)
  )

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <span
            className="material-symbols-outlined text-[#0f4c81] text-[40px]"
            style={{ animation: 'spin 1.2s linear infinite' }}
          >
            progress_activity
          </span>
          <p className="text-sm text-gray-500 font-medium">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-8 text-center">
        <span className="material-symbols-outlined text-[36px] mb-2 block">error</span>
        <p className="font-semibold">{error}</p>
        <button
          onClick={handleRefresh}
          className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-semibold transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  const { stats, clinics } = data

  return (
    <div className="flex flex-col gap-6 pb-12 w-full">

      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-[#1e293b]">Dashboard</h2>
          <p className="text-sm text-gray-500 mt-0.5">Platform overview — Auvia Admin Network</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-60 shadow-sm"
        >
          <span
            className="material-symbols-outlined text-[18px]"
            style={refreshing ? { animation: 'spin 0.8s linear infinite' } : {}}
          >
            refresh
          </span>
          Refresh
        </button>
      </div>

      {/* ── Stat Cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon="corporate_fare"
          label="Total Clinics"
          value={stats.totalClinics}
          sub="Registered clinics"
          color="#0f4c81"
        />
        <StatCard
          icon="call"
          label="Total Phone Numbers"
          value={stats.totalPhones}
          sub="Across all clinics"
          color="#7c3aed"
        />
        <StatCard
          icon="verified_user"
          label="Active Clinics"
          value={stats.activeClinics}
          sub="All clinics using our product"
          color="#16a34a"
        />
      </div>

      {/* ── Map + Recent Clinics ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">

        {/* ── Map Panel ─────────────────────────────────────────────────── */}
        <div
          className="lg:col-span-8 bg-white rounded-xl border border-gray-200 shadow-ambient overflow-hidden flex flex-col"
          style={{ minHeight: 480 }}
        >
          {/* Map Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <h3 className="font-bold text-[#1e293b]">Clinic Locations</h3>
              <p className="text-xs text-gray-400 mt-0.5">All registered clinics on the map</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-400 rounded-full" style={{ animation: 'pulse 2s infinite' }}></span>
              <span className="text-xs font-bold text-green-600 uppercase tracking-wide">LIVE</span>
            </div>
          </div>

          {/* Map — explicit pixel height so GoogleMap renders correctly */}
          <div className="relative" style={{ height: 390 }}>
            {!MAPS_KEY ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 gap-4 p-8">
                <span className="material-symbols-outlined text-[52px] text-[#0f4c81]/30">map</span>
                <div className="text-center">
                  <p className="font-bold text-[#1e293b] text-sm">Google Maps API Key Not Set</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Add <code className="bg-white border border-gray-200 px-1 py-0.5 rounded text-[11px]">VITE_GOOGLE_MAPS_API_KEY</code> to your{' '}
                    <code className="bg-white border border-gray-200 px-1 py-0.5 rounded text-[11px]">.env</code> file
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 w-full max-w-sm mt-2">
                  {clinics.slice(0, 4).map(c => (
                    <div key={c.id} className="bg-white rounded-lg border border-gray-200 p-3">
                      <p className="text-xs font-semibold text-[#1e293b] truncate">{c.name}</p>
                      <p className="text-[11px] text-gray-400">{c.city || '—'}, {c.state || '—'}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : loadError ? (
              <div className="absolute inset-0 flex items-center justify-center bg-red-50">
                <p className="text-red-600 text-sm font-medium">Failed to load Google Maps</p>
              </div>
            ) : !isLoaded ? (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                <span
                  className="material-symbols-outlined text-[36px] text-gray-300"
                  style={{ animation: 'spin 1.2s linear infinite' }}
                >
                  progress_activity
                </span>
              </div>
            ) : (
              <GoogleMap
                mapContainerStyle={MAP_CONTAINER}
                center={INDIA_CENTER}
                zoom={5}
                onLoad={handleMapLoad}
                options={{
                  styles: MAP_STYLES,
                  zoomControl: true,
                  mapTypeControl: false,
                  streetViewControl: false,
                  fullscreenControl: true,
                  restriction: {
                    latLngBounds: { north: 37, south: 6, west: 66, east: 98 },
                    strictBounds: false,
                  },
                }}
              >
                {clinics.map(clinic =>
                  clinic.coords && (
                    <Marker
                      key={clinic.id}
                      position={clinic.coords}
                      title={clinic.name}
                      onClick={() => handleClinicClick(clinic)}
                      icon={{
                        path: window.google.maps.SymbolPath.CIRCLE,
                        scale: 11,
                        fillColor: STATUS_COLOR[clinic.status] || '#94a3b8',
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 2.5,
                      }}
                    />
                  )
                )}

                {selectedClinic && selectedClinic.coords && (
                  <InfoWindow
                    position={selectedClinic.coords}
                    onCloseClick={() => setSelectedClinic(null)}
                  >
                    <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 150 }}>
                      <p style={{ fontWeight: 700, color: '#1e293b', fontSize: 13, marginBottom: 3 }}>
                        {selectedClinic.name}
                      </p>
                      <p style={{ color: '#64748b', fontSize: 11 }}>
                        {selectedClinic.city}, {selectedClinic.state}
                      </p>
                      <p style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                        {selectedClinic.phone || 'No phone'}
                      </p>
                      <span style={{
                        display: 'inline-block', marginTop: 6,
                        padding: '2px 8px', borderRadius: 9999,
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                        background: `${STATUS_COLOR[selectedClinic.status]}20`,
                        color: STATUS_COLOR[selectedClinic.status],
                      }}>
                        {selectedClinic.status}
                      </span>
                    </div>
                  </InfoWindow>
                )}
              </GoogleMap>
            )}

            {/* Clinic count badge */}
            {MAPS_KEY && isLoaded && (
              <div className="absolute top-3 left-3 bg-white/95 rounded-full px-3 py-1.5 flex items-center gap-1.5 shadow-sm border border-gray-200 pointer-events-none">
                <span className="material-symbols-outlined text-[14px] text-[#0f4c81]">location_on</span>
                <span className="text-xs font-bold text-[#1e293b]">{clinics.length} clinics mapped</span>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-6 flex-wrap">
            {Object.entries(STATUS_COLOR).map(([status, color]) => (
              <div key={status} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ background: color }}></div>
                <span className="text-xs text-gray-500 capitalize">{status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Recent Clinics Panel ───────────────────────────────────────── */}
        <div
          className="lg:col-span-4 bg-white rounded-xl border border-gray-200 shadow-ambient overflow-hidden flex flex-col"
          style={{ minHeight: 480 }}
        >
          {/* Panel Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="text-xs font-bold text-[#1e293b] uppercase tracking-widest">Recent Clinics</h3>
            <span className="material-symbols-outlined text-[20px] text-gray-400 cursor-pointer hover:text-gray-600 transition-colors">settings</span>
          </div>

          {/* Search */}
          <div className="px-4 pt-3 pb-1">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[17px]">search</span>
              <input
                type="text"
                placeholder="Search recent clinics"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1e293b] bg-gray-50 focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81] transition-all"
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
            {filteredClinics.length === 0 ? (
              <p className="text-center text-sm text-gray-400 italic py-10">No clinics found</p>
            ) : (
              filteredClinics.map(clinic => (
                <ClinicRow
                  key={clinic.id}
                  clinic={clinic}
                  onClick={handleClinicClick}
                  isSelected={selectedClinic?.id === clinic.id}
                />
              ))
            )}
          </div>

          {/* Footer refresh */}
          <div className="border-t border-gray-100 p-3">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="w-full py-2 text-[11px] font-bold uppercase tracking-widest text-gray-400 hover:text-[#0f4c81] hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-60"
            >
              {refreshing ? 'Refreshing...' : 'Refresh Dashboard Data'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
