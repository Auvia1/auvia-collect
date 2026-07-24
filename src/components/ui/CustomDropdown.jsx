import { useState, useEffect, useRef } from 'react';

export default function CustomDropdown({ value, options, onChange, icon, labelPrefix, minWidthClass = 'min-w-[180px]' }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.value === value) || options[0] || { label: '', value: '' };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between pl-10 pr-10 py-2.5 border border-outline-variant rounded-xl font-body text-label-md bg-surface-container-lowest text-on-surface hover:border-outline shadow-sm cursor-pointer transition-all ${minWidthClass} text-left focus:ring-1 focus:ring-primary focus:border-primary outline-none`}
      >
        {icon && (
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px] pointer-events-none">
            {icon}
          </span>
        )}
        <span className="truncate pr-1">{labelPrefix ? `${labelPrefix}: ` : ''}{selectedOption.label}</span>
        <span 
          className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px] transition-transform duration-200 pointer-events-none"
          style={{ transform: isOpen ? 'translateY(-50%) rotate(180deg)' : 'translateY(-50%)' }}
        >
          expand_more
        </span>
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 right-0 w-full min-w-[240px] bg-white border border-outline-variant rounded-xl shadow-xl z-50 py-1.5 animate-in fade-in duration-100 max-h-60 overflow-y-auto">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-4 py-2.5 text-sm font-body transition-colors flex items-center justify-between ${
                opt.value === value
                  ? 'bg-primary-fixed text-on-primary-fixed font-bold'
                  : 'hover:bg-surface-container-low text-on-surface'
              }`}
            >
              <span className="truncate pr-4">{opt.label}</span>
              {opt.value === value && (
                <span className="material-symbols-outlined text-[16px] text-primary shrink-0">check</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
