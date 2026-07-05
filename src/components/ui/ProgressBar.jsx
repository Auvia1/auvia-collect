export default function ProgressBar({ percent, shimmer = false, colorClass = 'bg-primary' }) {
  return (
    <div className="w-full bg-surface-container-highest h-2.5 rounded-full overflow-hidden">
      <div
        className={`${colorClass} h-full rounded-full relative overflow-hidden transition-all duration-500`}
        style={{ width: `${percent}%` }}
      >
        {shimmer && (
          <div className="absolute inset-0 bg-white/20 w-full h-full transform -skew-x-12 -translate-x-full animate-shimmer" />
        )}
      </div>
    </div>
  )
}
