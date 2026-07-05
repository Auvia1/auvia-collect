export default function MobileHeader() {
  return (
    <header className="md:hidden bg-surface-container-lowest shadow-sm w-full z-40 flex justify-between items-center px-margin-mobile h-16 sticky top-0">
      <span className="font-display text-headline-md font-bold text-primary">Auvia Collect</span>
      <button aria-label="Open menu" className="text-on-surface-variant">
        <span className="material-symbols-outlined">menu</span>
      </button>
    </header>
  )
}
