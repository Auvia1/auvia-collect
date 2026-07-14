import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardLayout from './components/layout/DashboardLayout.jsx'
import AdminLayout from './components/layout/AdminLayout.jsx'
import { api } from './services/api.js'

import Login from './pages/Login.jsx'
import Campaigns from './pages/Campaigns.jsx'
import NewCampaign from './pages/NewCampaign.jsx'
import ReviewContacts from './pages/ReviewContacts.jsx'
import CampaignSummary from './pages/CampaignSummary.jsx'
import LiveCampaign from './pages/LiveCampaign.jsx'
import CallLog from './pages/CallLog.jsx'
import CustomerDetail from './pages/CustomerDetail.jsx'
import CampaignReport from './pages/CampaignReport.jsx'
import CallbackQueue from './pages/CallbackQueue.jsx'
import SettingsPage from './pages/Settings.jsx'
import PlatformAdmin from './pages/PlatformAdmin.jsx'
import PlatformUsers from './pages/PlatformUsers.jsx'
import CostAnalytics from './pages/CostAnalytics.jsx'
import BuyCredits from './pages/BuyCredits.jsx'
import BillingHistory from './pages/BillingHistory.jsx'
import CreditManagement from './pages/CreditManagement.jsx'

// Smart root redirect: send admin users to /admin, clinic users to /campaigns
function RootRedirect() {
  const token = localStorage.getItem('auvia_token')
  if (!token) return <Navigate to="/login" replace />
  const user = api.getCurrentUser()
  if (user && (user.userType === 'admin' || user.platformRole === 'platform_admin')) {
    return <Navigate to="/admin" replace />
  }
  return <Navigate to="/campaigns" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Standalone login page */}
        <Route path="/login" element={<Login />} />

        {/* ── PLATFORM ADMIN PORTAL (NexoVAI only) ── */}
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<PlatformAdmin />} />
          <Route path="/admin/users" element={<PlatformUsers />} />
          <Route path="/admin/analytics" element={<CostAnalytics />} />
          <Route path="/admin/credits" element={<CreditManagement />} />
        </Route>

        {/* ── CLINIC DASHBOARD (Resplice, Auvia Medical, etc.) ── */}
        <Route element={<DashboardLayout />}>
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/new" element={<NewCampaign />} />
          <Route path="/campaigns/:id/contacts" element={<ReviewContacts />} />
          <Route path="/campaigns/:id/summary" element={<CampaignSummary />} />
          <Route path="/campaigns/:id/live" element={<LiveCampaign />} />
          <Route path="/campaigns/:id/report" element={<CampaignReport />} />
          <Route path="/call-log" element={<CallLog />} />
          <Route path="/call-log/:customerId" element={<CustomerDetail />} />
          <Route path="/callback-queue" element={<CallbackQueue />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/buy-credits" element={<BuyCredits />} />
          <Route path="/billing-history" element={<BillingHistory />} />
        </Route>

        {/* Smart root + catch-all */}
        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </BrowserRouter>
  )
}
