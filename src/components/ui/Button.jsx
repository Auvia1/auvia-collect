const VARIANTS = {
  primary: 'bg-primary text-on-primary hover:bg-on-primary-fixed-variant shadow-sm',
  secondary: 'border border-outline-variant text-on-surface hover:bg-surface-container-low',
  disabled: 'bg-surface-variant text-on-surface-variant cursor-not-allowed opacity-70',
  ghost: 'text-primary hover:bg-primary-fixed',
}

export default function Button({ variant = 'primary', icon, children, className = '', ...props }) {
  return (
    <button
      className={`px-md py-sm rounded-lg font-label-md text-label-md transition-colors flex items-center justify-center gap-xs ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {icon && <span className="material-symbols-outlined text-[18px]">{icon}</span>}
      {children}
    </button>
  )
}
