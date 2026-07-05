import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/ui/Button.jsx'
import { api } from '../services/api.js'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await api.login(email, password)
      // Route platform admins to their own portal, clinic users to campaigns
      if (data.user?.platformRole === 'platform_admin') {
        navigate('/admin')
      } else {
        navigate('/campaigns')
      }
    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-container-low flex flex-col items-center justify-center p-margin-mobile md:p-margin-desktop font-body text-on-background">
      <main className="w-full max-w-[440px] flex flex-col items-center gap-lg">
        <header className="text-center w-full">
          <span className="material-symbols-outlined text-primary text-[40px] filled">medical_services</span>
          <h1 className="font-display text-headline-xl text-on-surface mt-sm">Auvia Collect</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-xs">Secure Provider Access</p>
        </header>

        <div className="w-full bg-surface-container-lowest rounded-2xl shadow-ambient p-lg flex flex-col gap-md border border-outline-variant/30">
          {error && (
            <div className="bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-lg p-sm text-body-sm">
              {error}
            </div>
          )}

          <h2 className="font-display text-headline-md text-on-surface">Sign In</h2>
          <form className="flex flex-col gap-md" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-xs">
              <label className="font-label-md text-label-md text-on-surface-variant" htmlFor="email">
                Work Email
              </label>
              <input
                id="email"
                type="email"
                required
                placeholder="provider@clinic.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-sm py-[10px] font-body-md text-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
              />
            </div>

            <div className="flex flex-col gap-xs">
              <div className="flex justify-between items-center w-full">
                <label className="font-label-md text-label-md text-on-surface-variant" htmlFor="password">
                  Password
                </label>
                <a className="font-label-sm text-label-sm text-primary hover:text-primary-container transition-colors" href="#">
                  Forgot password?
                </a>
              </div>
              <input
                id="password"
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-sm py-[10px] font-body-md text-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors"
              />
            </div>

            <Button type="submit" icon={loading ? undefined : "arrow_forward"} variant={loading ? "disabled" : "primary"} disabled={loading} className="mt-xs">
              {loading ? 'Logging In...' : 'Log In'}
            </Button>
          </form>
        </div>

        <p className="font-body-sm text-body-sm text-on-surface-variant text-center">
          Don't have an account? <span className="font-medium text-secondary">Contact admin for access.</span>
        </p>
      </main>

      <footer className="mt-lg">
        <p className="font-label-sm text-label-sm text-on-secondary-fixed-variant">
          © 2026 Auvia Collect. Powered by NexovAI.
        </p>
      </footer>
    </div>
  )
}
