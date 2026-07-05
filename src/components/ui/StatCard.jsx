export default function StatCard({ label, value, icon, valueClassName = 'text-on-surface', trailing }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-md shadow-ambient border border-surface-container-low flex flex-col gap-sm">
      <div className="flex items-center justify-between text-on-surface-variant">
        <span className="font-label-md text-label-md">{label}</span>
        {icon && <span className="material-symbols-outlined text-secondary">{icon}</span>}
      </div>
      <div className="flex items-end gap-xs">
        <span className={`font-display text-headline-lg font-semibold ${valueClassName}`}>{value}</span>
        {trailing}
      </div>
    </div>
  )
}
