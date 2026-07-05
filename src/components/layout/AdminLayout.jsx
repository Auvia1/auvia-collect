import { Outlet, Navigate } from 'react-router-dom'
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
    <div className="min-h-screen flex flex-col bg-[#0a0f1e] text-white font-body">
      {/* Top bar */}
      <header className="h-16 flex items-center justify-between px-6 border-b border-white/10 shrink-0 bg-[#0d1428]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-3">
          {/* NexoVAI logo mark */}
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <span className="material-symbols-outlined text-white text-[20px]">shield_person</span>
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-bold text-white text-[15px] tracking-tight">NexoVAI</span>
            <span className="text-[11px] text-violet-400 font-medium tracking-widest uppercase">Platform Admin</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-white/70 text-sm">
            <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-xs font-bold text-white uppercase">
              {initials}
            </div>
            <span className="hidden sm:inline">{user.fullName}</span>
          </div>
          <button
            onClick={() => api.logout()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/60 hover:bg-white/10 hover:text-white transition-all text-sm"
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 md:px-8 py-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-4 text-center text-white/30 text-xs">
        NexoVAI Platform Console · All data is confidential
      </footer>
    </div>
  )
}
