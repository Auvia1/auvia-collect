const VARIANTS = {
  success: 'bg-[#ecfdf5] text-[#065f46]',
  neutral: 'bg-[#f1f5f9] text-[#475569]',
  warning: 'bg-[#fffbeb] text-[#92400e]',
  error: 'bg-[#fef2f2] text-[#991b1b]',
  primary: 'bg-primary-fixed text-on-primary-fixed-variant',
  secondary: 'bg-secondary-fixed text-on-secondary-fixed-variant',
  tertiary: 'bg-tertiary-fixed text-on-tertiary-fixed-variant',
}

export default function Badge({ variant = 'neutral', icon, children }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full font-label-sm text-label-sm whitespace-nowrap ${VARIANTS[variant] || VARIANTS.neutral}`}
    >
      {icon && <span className="material-symbols-outlined text-[14px]">{icon}</span>}
      {children}
    </span>
  )
}
