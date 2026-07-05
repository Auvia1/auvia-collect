import { useState, useEffect } from 'react'
import Button from '../components/ui/Button.jsx'
import Badge from '../components/ui/Badge.jsx'
import { api } from '../services/api.js'

export default function UserManagement() {
  const [users, setUsers] = useState([])
  const [showInvite, setShowInvite] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentUser, setCurrentUser] = useState(null)

  // Invite form states
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState('Staff')
  const [inviting, setInviting] = useState(false)

  useEffect(() => {
    async function loadUsers() {
      try {
        const uList = await api.getUsers()
        setUsers(uList)
        const me = api.getCurrentUser()
        setCurrentUser(me)
      } catch (err) {
        console.error('Error fetching users:', err)
        setError(err.message || 'Failed to load clinic team members')
      } finally {
        setLoading(false)
      }
    }
    loadUsers()
  }, [])

  async function handleInvite(e) {
    e.preventDefault()
    if (!inviteEmail || !inviteName) return
    setInviting(true)
    setError('')
    try {
      const data = await api.inviteUser({
        name: inviteName,
        email: inviteEmail,
        role: inviteRole,
      })
      setUsers((prev) => [data.member, ...prev])
      setShowInvite(false)
      setInviteEmail('')
      setInviteName('')
      setInviteRole('Staff')
    } catch (err) {
      setError(err.message || 'Failed to send invitation')
    } finally {
      setInviting(false)
    }
  }

  async function handleDelete(memberId, name) {
    if (!confirm(`Are you sure you want to remove ${name} from this clinic?`)) return
    try {
      await api.removeUser(memberId)
      setUsers((prev) => prev.filter((u) => u.id !== memberId))
    } catch (err) {
      alert(err.message || 'Failed to remove member')
    }
  }

  if (loading) {
    return <div className="text-center py-20 font-body text-on-surface-variant">Loading team rosters...</div>;
  }

  const isAdmin = currentUser?.memberRole === 'admin' || currentUser?.platformRole === 'platform_admin'

  return (
    <div className="flex flex-col gap-md pb-12">
      <div className="flex justify-between items-center flex-wrap gap-sm">
        <div>
          <h1 className="font-display text-headline-xl text-on-surface">Team Members</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-xs">
            Manage staff access and permissions for your clinic.
          </p>
        </div>
        {isAdmin && (
          <Button icon="person_add" onClick={() => setShowInvite(true)}>
            Invite User
          </Button>
        )}
      </div>

      {error && (
        <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center">{error}</div>
      )}

      <div className="bg-surface-container-lowest rounded-xl shadow-ambient overflow-hidden border border-outline-variant/20">
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead>
              <tr className="bg-surface-bright text-on-surface-variant text-label-sm font-label-sm uppercase tracking-wider">
                <th className="px-md py-sm font-medium">Name</th>
                <th className="px-md py-sm font-medium">Email</th>
                <th className="px-md py-sm font-medium">Role</th>
                <th className="px-md py-sm font-medium">Status</th>
                <th className="px-md py-sm font-medium">Joined Date</th>
                {isAdmin && <th className="px-md py-sm font-medium text-center">Actions</th>}
              </tr>
            </thead>
            <tbody className="text-body-sm font-body-sm divide-y divide-surface-container-high">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="px-md py-lg text-center text-on-surface-variant italic">
                    No team members found.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className={`hover:bg-surface-bright transition-colors ${user.status === 'invited' ? 'opacity-70' : ''}`}>
                    <td className="px-md py-sm font-medium text-on-surface">{user.name}</td>
                    <td className="px-md py-sm text-on-surface-variant">{user.email}</td>
                    <td className="px-md py-sm">
                      <Badge variant={user.role.toLowerCase().includes('admin') ? 'primary' : 'secondary'}>{user.role}</Badge>
                    </td>
                    <td className="px-md py-sm">
                      <span className={user.status === 'invited' ? 'italic text-on-surface-variant' : 'text-secondary'}>
                        {user.status === 'invited' ? 'Invited' : 'Active'}
                      </span>
                    </td>
                    <td className="px-md py-sm text-on-surface-variant">{user.joinedDate}</td>
                    {isAdmin && (
                      <td className="px-md py-sm text-center">
                        {user.id !== currentUser.id && (
                          <button
                            onClick={() => handleDelete(user.id, user.name)}
                            className="text-error hover:opacity-80 transition-colors"
                            aria-label={`Remove ${user.name}`}
                          >
                            <span className="material-symbols-outlined text-[20px]">delete</span>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showInvite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-margin-mobile">
          <form onSubmit={handleInvite} className="bg-surface-container-lowest rounded-xl p-lg w-full max-w-md shadow-ambient border border-outline-variant/30 flex flex-col gap-md">
            <h2 className="font-display text-headline-md text-on-surface">Invite Team Member</h2>
            <div className="space-y-sm">
              <label className="block font-label-md text-label-md text-on-surface">Full Name</label>
              <input
                type="text"
                required
                placeholder="Dr. John Watson"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="w-full border border-outline-variant rounded-lg px-sm py-2 font-body-sm text-body-sm bg-transparent text-on-surface"
              />
            </div>
            <div className="space-y-sm">
              <label className="block font-label-md text-label-md text-on-surface">Email Address</label>
              <input
                type="email"
                required
                placeholder="watson@auvia.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full border border-outline-variant rounded-lg px-sm py-2 font-body-sm text-body-sm bg-transparent text-on-surface"
              />
            </div>
            <div className="space-y-sm">
              <label className="block font-label-md text-label-md text-on-surface">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full border border-outline-variant rounded-lg px-sm py-2 font-body-sm text-body-sm bg-surface-container-lowest text-on-surface cursor-pointer"
              >
                <option value="Staff">Staff</option>
                <option value="Administrator">Administrator</option>
              </select>
            </div>
            <div className="flex justify-end gap-sm mt-md">
              <Button type="button" variant="secondary" onClick={() => setShowInvite(false)} disabled={inviting}>Cancel</Button>
              <Button type="submit" disabled={inviting}>{inviting ? 'Inviting...' : 'Send Invite'}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
