import { Link } from 'react-router-dom'
import { useTitle } from '../lib/useTitle'
import { LoginBrand } from './LoginPage'

export function ForgotPage() {
  useTitle('Account help')
  return (
    <div className="app login-app">
      <main className="page">
        <LoginBrand />
        <h1 className="page-title">Account help</h1>
        <div className="card">
          <p>
            This is a demo portal. To reset your username or password, call the Riverside Health support line at
            (555) 010-2000.
          </p>
          <p className="muted">Demo accounts are listed on the sign-in page.</p>
        </div>
        <Link className="btn btn-back" to="/login">
          Back to sign in
        </Link>
      </main>
    </div>
  )
}
