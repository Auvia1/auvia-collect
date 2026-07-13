import PlatformUsersPanel from '../components/admin/PlatformUsersPanel.jsx'

export default function PlatformUsers() {
  return (
    <div className="flex flex-col gap-6 pb-12 w-full">
      <div className="border-b pb-6 border-gray-200">
        <h2 className="text-3xl font-bold mb-2 text-[#1e293b]">Platform Users</h2>
        <p className="text-sm text-[#64748b]">Manage platform-wide users, approve new registrations, and assign roles.</p>
      </div>
      <PlatformUsersPanel />
    </div>
  )
}
