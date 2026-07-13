import { Outlet, Navigate, NavLink } from 'react-router-dom'
import { api } from '../../services/api.js'

export default function AdminLayout() {
  const token = localStorage.getItem('auvia_token')
  if (!token) return <Navigate to="/login" replace />

  const user = api.getCurrentUser()
  // Only platform_admin can access this layout
  if (!user || user.platformRole !== 'platform_admin') {
    return <Navigate to="/campaigns" replace />
  }

  const initials = user.fullName
    ? user.fullName.split(' ').map((n) => n[0]).join('').toUpperCase()
    : 'SA'

  return (
    <div className="min-h-screen flex bg-[#f7f9fb] text-[#1e293b] font-sans">
      {/* Left Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 shrink-0 flex flex-col h-screen sticky top-0">
        {/* Header / Brand */}
        <div className="h-16 flex items-center px-6 border-b border-gray-200 gap-3">
          <div className="w-8 h-8 rounded bg-[#0f4c81] flex items-center justify-center text-white">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="lucide lucide-shield w-5 h-5"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path></svg>
          </div>
          <div>
            <h1 className="font-bold text-sm leading-tight text-[#0f4c81]">NexovAI</h1>
            <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">Platform Admin</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex-1 p-4 space-y-2 overflow-y-auto">
          <NavLink
            to="/admin"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
                isActive
                  ? 'bg-[#0f4c81] text-white shadow-sm'
                  : 'text-gray-500 hover:text-[#0f4c81] hover:bg-gray-50'
              }`
            }
          >
            <span className="material-symbols-outlined text-[20px]">medical_services</span>
            Clinic Configs
          </NavLink>
          <NavLink
            to="/admin/users"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
                isActive
                  ? 'bg-[#0f4c81] text-white shadow-sm'
                  : 'text-gray-500 hover:text-[#0f4c81] hover:bg-gray-50'
              }`
            }
          >
            <span className="material-symbols-outlined text-[20px]">group</span>
            Users
          </NavLink>
          <NavLink
            to="/admin/analytics"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
                isActive
                  ? 'bg-[#0f4c81] text-white shadow-sm'
                  : 'text-gray-500 hover:text-[#0f4c81] hover:bg-gray-50'
              }`
            }
          >
            <span className="material-symbols-outlined text-[20px]">analytics</span>
            Cost Analytics
          </NavLink>
        </div>

        {/* Bottom User Area */}
        <div className="p-4 border-t border-gray-200 bg-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white text-xs font-bold uppercase">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-[#1e293b] truncate">{user.fullName}</p>
              <p className="text-[10px] text-gray-400 truncate">Super Admin</p>
            </div>
          </div>
          <button
            onClick={() => api.logout()}
            className="w-full flex items-center justify-center gap-2 text-gray-500 hover:text-red-600 hover:bg-red-50 text-sm px-3 py-2 rounded-lg border border-gray-200 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="lucide lucide-log-out w-4 h-4"><path d="m16 17 5-5-5-5"></path><path d="M21 12H9"></path><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path></svg>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Canvas split */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        <main className="flex-1 p-8">
          <Outlet />
        </main>
        
        {/* Footer */}
        <footer className="py-4 px-8 border-t border-gray-200 bg-white flex flex-col sm:flex-row justify-between items-center gap-4 text-center sm:text-left text-xs text-gray-400">
          <p>
            © 2026 Auvia Collect. All rights reserved. Powered by NexovAI.
          </p>
          <div className="flex items-center gap-6">
            <a className="hover:text-[#0f4c81] transition-colors" href="#">Privacy Policy</a>
            <a className="hover:text-[#0f4c81] transition-colors" href="#">Terms</a>
            <a className="hover:text-[#0f4c81] transition-colors flex items-center gap-1" href="#">
              <span className="material-symbols-outlined text-[14px]">verified_user</span>
              HIPAA Compliance
            </a>
          </div>
        </footer>
      </div>
    </div>
  )
}
