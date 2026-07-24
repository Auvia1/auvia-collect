import { useState, useEffect } from 'react'
import { api } from '../../services/api.js'
import Badge from '../ui/Badge.jsx'
import Button from '../ui/Button.jsx'
import CustomDropdown from '../ui/CustomDropdown.jsx'

export default function PlatformUsersPanel() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [clinicFilter, setClinicFilter] = useState('all')

  const [editingUser, setEditingUser] = useState(null)
  const [editForm, setEditForm] = useState({ user_type: '', platform_role: '', is_active: true })
  const [saveLoading, setSaveLoading] = useState(false)

  useEffect(() => {
    loadUsers()
  }, [])

  async function loadUsers() {
    setLoading(true)
    setError('')
    try {
      const data = await api.getAdminUsers()
      setUsers(data)
    } catch (err) {
      setError(err.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  async function handleStatusChange(id, newStatus) {
    try {
      await api.updateAdminUserStatus(id, newStatus)
      setUsers(prev => prev.map(u => u.id === id ? { ...u, status: newStatus } : u))
    } catch (err) {
      alert(err.message || 'Failed to update user status')
    }
  }

  function startEdit(user) {
    setEditingUser(user.id)
    setEditForm({
      user_type: user.user_type || 'client',
      platform_role: user.platform_role || 'standard',
      is_active: user.is_active
    })
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    setSaveLoading(true)
    try {
      const updated = await api.updateAdminUser(editingUser, editForm)
      setUsers(prev => prev.map(u => u.id === editingUser ? { ...u, ...updated } : u))
      setEditingUser(null)
    } catch (err) {
      alert(err.message || 'Failed to update user')
    } finally {
      setSaveLoading(false)
    }
  }

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.full_name.toLowerCase().includes(search.toLowerCase()) || 
                          u.email.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === 'all' || u.status === statusFilter
    const matchesClinic = clinicFilter === 'all' || 
                          (clinicFilter === 'none' && !u.clinic_id) || 
                          u.clinic_id === clinicFilter
    return matchesSearch && matchesStatus && matchesClinic
  })

  const uniqueClinicsMap = new Map();
  users.forEach(u => {
    if (u.clinic_id) uniqueClinicsMap.set(u.clinic_id, u.clinic_name);
  });
  const uniqueClinics = Array.from(uniqueClinicsMap.entries());

  if (loading) {
    return <div className="text-center py-20 font-body text-on-surface-variant">Loading users...</div>;
  }

  return (
    <div className="flex flex-col gap-6 bg-white border border-gray-200 shadow-sm rounded-lg overflow-hidden min-h-[500px]">
      <div className="p-6 border-b border-gray-100 flex justify-between items-center flex-wrap gap-4 bg-white">
        <div>
          <h3 className="text-xl font-bold text-[#1e293b]">User Management</h3>
          <p className="text-sm text-[#64748b]">Approve new registrations and manage platform roles.</p>
        </div>
        
        <div className="flex gap-4 items-center">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">
              search
            </span>
            <input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64 pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-[#1e293b] focus:outline-none focus:border-[#0f4c81] focus:ring-1 focus:ring-[#0f4c81]"
            />
          </div>
          <CustomDropdown
            value={statusFilter}
            options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' }
            ]}
            onChange={setStatusFilter}
            icon="filter_alt"
            minWidthClass="min-w-[150px]"
          />
          <CustomDropdown
            value={clinicFilter}
            options={[
              { value: 'all', label: 'All Clinics' },
              { value: 'none', label: 'No Clinic' },
              ...uniqueClinics.map(([id, name]) => ({ value: id, label: name }))
            ]}
            onChange={setClinicFilter}
            icon="local_hospital"
            minWidthClass="min-w-[160px] max-w-[200px]"
          />
        </div>
      </div>

      {error && (
        <div className="mx-6 bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-md text-center">{error}</div>
      )}

      <div className="overflow-x-auto w-full">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-50 border-y border-gray-100">
            <tr>
              <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">User</th>
              <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Role & Type</th>
              <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Clinic</th>
              <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Status</th>
              <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider">Joined</th>
              <th className="p-4 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm text-[#1e293b]">
            {filteredUsers.map(user => (
              <tr key={user.id} className="hover:bg-gray-50/50 transition-colors">
                {editingUser === user.id ? (
                  <td colSpan="6" className="p-4 bg-blue-50/30">
                    <form onSubmit={handleSaveEdit} className="flex flex-col gap-4">
                      <div className="flex justify-between items-center mb-2">
                        <h4 className="font-semibold text-sm text-[#1e293b]">Editing {user.full_name} ({user.email})</h4>
                        <button type="button" onClick={() => setEditingUser(null)} className="text-gray-400 hover:text-gray-600">
                          <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-[#475569] mb-1">User Type</label>
                          <CustomDropdown
                            value={editForm.user_type}
                            options={[
                              { value: 'client', label: 'Client' },
                              { value: 'admin', label: 'Admin' }
                            ]}
                            onChange={(val) => setEditForm({ ...editForm, user_type: val })}
                            icon="person"
                            minWidthClass="w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[#475569] mb-1">Platform Role</label>
                          <CustomDropdown
                            value={editForm.platform_role}
                            options={[
                              { value: 'standard', label: 'Standard' },
                              { value: 'platform_admin', label: 'Platform Admin' }
                            ]}
                            onChange={(val) => setEditForm({ ...editForm, platform_role: val })}
                            icon="admin_panel_settings"
                            minWidthClass="w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[#475569] mb-1">Active State</label>
                          <div className="flex items-center h-9">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editForm.is_active}
                                onChange={e => setEditForm({ ...editForm, is_active: e.target.checked })}
                                className="rounded border-gray-300 text-[#0f4c81] focus:ring-[#0f4c81]"
                              />
                              <span className="text-sm">Account Enabled</span>
                            </label>
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 mt-2">
                        <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button>
                        <Button type="submit" variant="primary" disabled={saveLoading}>
                          {saveLoading ? 'Saving...' : 'Save Changes'}
                        </Button>
                      </div>
                    </form>
                  </td>
                ) : (
                  <>
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span className="font-semibold text-sm text-[#1e293b]">{user.full_name}</span>
                        <span className="text-gray-500 text-xs">{user.email}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs uppercase font-semibold text-gray-600">{user.user_type}</span>
                        <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded w-max">{user.platform_role}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-sm font-medium text-gray-700">{user.clinic_name || <span className="text-gray-400 italic">No Clinic</span>}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {user.status === 'pending' && <Badge variant="warning">Pending</Badge>}
                        {user.status === 'approved' && <Badge variant="success">Approved</Badge>}
                        {user.status === 'rejected' && <Badge variant="error">Rejected</Badge>}
                        {!user.is_active && <Badge variant="neutral">Deactivated</Badge>}
                      </div>
                    </td>
                    <td className="p-4 text-gray-500 font-medium text-xs">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2">
                        {(user.status === 'pending' || user.status === 'rejected') && (
                          <button
                            title="Approve User"
                            onClick={() => handleStatusChange(user.id, 'approved')}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                          >
                            <span className="material-symbols-outlined text-[20px]">check_circle</span>
                          </button>
                        )}
                        {(user.status === 'pending' || user.status === 'approved') && (
                          <button
                            title="Reject User"
                            onClick={() => handleStatusChange(user.id, 'rejected')}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                          >
                            <span className="material-symbols-outlined text-[20px]">cancel</span>
                          </button>
                        )}
                        <button
                          title="Edit Details"
                          onClick={() => startEdit(user)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        >
                          <span className="material-symbols-outlined text-[20px]">edit</span>
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan="6" className="p-8 text-center text-gray-400 italic">No users found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
