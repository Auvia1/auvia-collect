import { Outlet, Navigate } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import MobileHeader from './MobileHeader.jsx'
import Footer from './Footer.jsx'
import { api } from '../../services/api.js'

export default function DashboardLayout() {
  const token = localStorage.getItem('auvia_token')

  if (!token) {
    return <Navigate to="/login" replace />
  }

  // Platform admins have their own separate portal — redirect them out of clinic pages
  const user = api.getCurrentUser()
  if (user && user.platformRole === 'platform_admin') {
    return <Navigate to="/admin" replace />
  }

  return (
    <div className="min-h-screen flex bg-background text-on-surface font-body">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileHeader />
        <main className="flex-grow w-full max-w-[1440px] mx-auto px-margin-mobile md:px-margin-desktop py-lg">
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  )
}
