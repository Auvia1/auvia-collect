export default function Footer() {
  return (
    <footer className="w-full py-md px-margin-mobile md:px-margin-desktop flex flex-col md:flex-row justify-between items-center gap-base mt-auto bg-surface-container-low border-t border-outline-variant">
      <div className="flex flex-col items-center md:items-start gap-1">
        <p className="text-secondary font-label-sm text-label-sm">© 2026 Auvia Collect. All rights reserved.</p>
        <p className="text-secondary font-label-sm text-label-sm opacity-70">Powered by NexovAI</p>
      </div>
      <nav className="flex gap-md">
        <a className="text-on-surface-variant font-label-sm text-label-sm hover:text-primary hover:underline transition-colors" href="#">
          Privacy
        </a>
        <a className="text-on-surface-variant font-label-sm text-label-sm hover:text-primary hover:underline transition-colors" href="#">
          Terms
        </a>
        <a className="text-on-surface-variant font-label-sm text-label-sm hover:text-primary hover:underline transition-colors" href="#">
          Security
        </a>
        <a className="text-on-surface-variant font-label-sm text-label-sm hover:text-primary hover:underline transition-colors" href="#">
          Support
        </a>
      </nav>
    </footer>
  )
}
