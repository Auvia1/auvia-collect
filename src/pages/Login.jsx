import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api.js'
import Button from '../components/ui/Button.jsx'

// ── Auto-redirect if already logged in ──────────────────────────────────────
function useAuthRedirect(navigate) {
  useEffect(() => {
    const token = localStorage.getItem('auvia_token')
    const user  = api.getCurrentUser()
    if (token && user) {
      if (user.userType === 'admin' || user.platformRole === 'platform_admin') {
        navigate('/admin', { replace: true })
      } else {
        navigate('/campaigns', { replace: true })
      }
    }
  }, [navigate])
}

// ── Shared field component ───────────────────────────────────────────────────
function Field({ id, label, type = 'text', placeholder, value, onChange, icon }) {
  const [showPw, setShowPw] = useState(false)
  const inputType = type === 'password' ? (showPw ? 'text' : 'password') : type

  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor={id} className="font-label-md text-label-md text-on-surface-variant">
        {label}
      </label>
      <div className="relative">
        {icon && (
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px] pointer-events-none select-none">
            {icon}
          </span>
        )}
        <input
          id={id}
          type={inputType}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          required
          autoComplete={
            type === 'password' ? 'current-password'
            : type === 'email'  ? 'email'
            : 'off'
          }
          className={`w-full bg-surface-container-lowest border border-outline-variant rounded-lg
            py-[10px] pr-4 text-body-md font-body text-on-surface placeholder-outline
            focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary
            transition-colors duration-150
            ${icon ? 'pl-10' : 'pl-sm'}`}
        />
        {type === 'password' && (
          <button
            type="button"
            onClick={() => setShowPw(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface transition-colors"
            aria-label={showPw ? 'Hide password' : 'Show password'}
          >
            <span className="material-symbols-outlined text-[18px]">
              {showPw ? 'visibility_off' : 'visibility'}
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

// ── Error banner ─────────────────────────────────────────────────────────────
function ErrorBanner({ message }) {
  return (
    <div className="flex items-start gap-xs bg-error-container/60 border border-error/30 rounded-lg px-sm py-xs">
      <span className="material-symbols-outlined text-error text-[16px] mt-0.5 shrink-0">error</span>
      <p className="text-body-sm font-body text-on-error-container">{message}</p>
    </div>
  )
}

// ── Login form ───────────────────────────────────────────────────────────────
function LoginForm({ onSuccess }) {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await api.login(email, password)
      onSuccess(data.user)
    } catch (err) {
      setError(err.message || 'Login failed. Check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-md">
      {error && <ErrorBanner message={error} />}

      <Field
        id="login-email"
        label="Work Email"
        type="email"
        placeholder="you@clinic.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        icon="mail"
      />

      <div className="flex flex-col gap-xs">
        <div className="flex justify-between items-center">
          <label htmlFor="login-password" className="font-label-md text-label-md text-on-surface-variant">
            Password
          </label>
          <button
            type="button"
            className="font-label-sm text-label-sm text-primary hover:text-primary-container transition-colors"
          >
            Forgot password?
          </button>
        </div>
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px] pointer-events-none select-none">
            lock
          </span>
          <input
            id="login-password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg py-[10px] pl-10 pr-4 text-body-md font-body text-on-surface placeholder-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors duration-150"
          />
        </div>
      </div>

      <Button
        type="submit"
        disabled={loading}
        variant={loading ? 'disabled' : 'primary'}
        icon={loading ? undefined : 'arrow_forward'}
        className="mt-xs w-full justify-center"
      >
        {loading
          ? <span className="flex items-center gap-xs">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
              </svg>
              Signing in…
            </span>
          : 'Sign In'
        }
      </Button>
    </form>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function Login() {
  const navigate = useNavigate()

  useAuthRedirect(navigate)

  function handleSuccess(user) {
    if (user?.userType === 'admin' || user?.platformRole === 'platform_admin') {
      navigate('/admin', { replace: true })
    } else {
      navigate('/campaigns', { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-surface-container-low flex flex-col items-center justify-center p-margin-mobile md:p-margin-desktop font-body text-on-background">

      <main className="w-full max-w-[440px] flex flex-col items-center gap-lg">

        {/* Logo / brand */}
        <header className="text-center w-full">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-sm">
            <span className="material-symbols-outlined filled text-on-primary text-[28px]">
              medical_services
            </span>
          </div>
          <h1 className="font-display text-headline-md text-on-surface mt-xs">Auvia Collect</h1>
          <p className="font-body text-body-sm text-on-surface-variant mt-xs">
            AI-powered healthcare payment recovery
          </p>
        </header>

        {/* Card */}
        <div className="w-full bg-surface-container-lowest rounded-2xl shadow-ambient border border-outline-variant/40 p-lg flex flex-col gap-md">

          {/* Heading */}
          <div>
            <h2 className="font-display text-headline-md text-on-surface">
              Welcome back
            </h2>
            <p className="font-body text-body-sm text-on-surface-variant mt-xs">
              Sign in to your clinic portal.
            </p>
          </div>

          {/* Form */}
          <LoginForm onSuccess={handleSuccess} />
        </div>

        {/* Footer note */}
        <p className="font-label-sm text-label-sm text-on-surface-variant text-center">
          © {new Date().getFullYear()} Auvia Collect · Powered by{' '}
          <span className="text-primary font-semibold">NexovAI</span>
        </p>
      </main>
    </div>
  )
}
