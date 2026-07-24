import { NavLink } from 'react-router-dom'
import { api } from '../../services/api.js'

const NAV_ITEMS = [
  { to: '/dashboard',       label: 'Dashboard',      icon: 'dashboard' },
  { to: '/campaigns',       label: 'Campaigns',       icon: 'campaign' },
  { to: '/call-log',        label: 'Call Logs',       icon: 'call' },
  { to: '/callback-queue',  label: 'Callback Queue',  icon: 'schedule' },
  { to: '/buy-credits',     label: 'Buy Credits',     icon: 'add_shopping_cart' },
  { to: '/billing-history', label: 'Billing History', icon: 'receipt_long' },
  { to: '/activity-log',    label: 'Activity Log',    icon: 'timeline' },
  { to: '/settings',        label: 'Settings',        icon: 'settings' },
]

export default function Sidebar() {
  const user = api.getCurrentUser() || { fullName: 'Sarah Jenkins', memberRole: 'admin', platformRole: 'standard' }
  const initials = user.fullName
    ? user.fullName.split(' ').map((n) => n[0]).join('')
    : 'SJ'
  
  const roleLabel = user.memberRole === 'admin' ? 'Administrator' : 'Staff'

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col h-screen sticky top-0 bg-surface-container-lowest border-r border-outline-variant">
      {/* Brand */}
      <div className="h-16 flex items-center gap-sm px-md border-b border-outline-variant">
        <span className="material-symbols-outlined text-primary text-[28px]">monitor_heart</span>
        <span className="font-display text-headline-md font-bold text-primary tracking-tight">
          Auvia Collect
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-sm py-md space-y-xs overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-sm px-md py-sm rounded-lg font-label-md text-label-md transition-colors ${
                isActive
                  ? 'bg-primary-fixed text-on-primary-fixed'
                  : 'text-on-surface-variant hover:bg-surface-container-low hover:text-primary'
              }`
            }
          >
            <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* User + logout */}
      <div className="p-md border-t border-outline-variant">
        <div className="flex items-center gap-sm mb-sm">
          <div className="w-9 h-9 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-label-md text-label-md shrink-0 uppercase">
            {initials}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-label-md text-label-md text-on-surface truncate" title={user.fullName}>{user.fullName}</span>
            <span className="font-body-sm text-body-sm text-secondary truncate">{roleLabel}</span>
          </div>
        </div>
        <button
          onClick={() => api.logout()}
          className="w-full flex items-center justify-center gap-xs py-2 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-error-container hover:text-error transition-colors font-label-md text-label-md"
        >
          <span className="material-symbols-outlined text-[18px]">logout</span>
          Log Out
        </button>
      </div>
    </aside>
  )
}
