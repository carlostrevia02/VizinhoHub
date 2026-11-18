import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { CartIcon } from '../components/Icons'
import { authErrorMessage, useAuth } from '../context/AuthContext'
import { useDocumentTitle } from '../lib/useDocumentTitle'

const COPY = {
  login: { title: 'Entre para continuar', submit: 'Entrar' },
  register: { title: 'Crie sua conta', submit: 'Criar conta' },
  reset: { title: 'Recupere sua senha', submit: 'Enviar link de recuperação' },
}

function Login() {
  useDocumentTitle('VizinhoHub — Entrar')
  const { user, loading, isMerchant, login, register, loginWithGoogle, resetPassword } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  // Depois do login: volta para onde o usuário estava; comerciante cai no painel.
  // O redirecionamento acontece aqui, quando o contexto já conhece o usuário e o papel dele.
  if (!loading && user) {
    return <Navigate to={location.state?.from?.pathname ?? (isMerchant ? '/dashboard' : '/')} replace />
  }

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  const switchMode = (next) => (e) => {
    e.preventDefault()
    setMode(next)
    setError('')
    setInfo('')
  }

  const run = async (action) => {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      await action()
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    const email = form.email.trim()
    run(async () => {
      if (mode === 'reset') {
        await resetPassword(email)
        setInfo('Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha.')
        return
      }
      if (mode === 'register') {
        if (!form.name.trim()) throw new Error('name-required')
        await register(form.name.trim(), email, form.password)
      } else {
        await login(email, form.password)
      }
    })
  }

  const google = () => run(loginWithGoogle)

  return (
    <div className="login-wrap">
      <section className="panel login">
        <div className="logo-big">
          <CartIcon size={32} strokeWidth={2.2} />
        </div>
        <h1>VizinhoHub</h1>
        <p className="sub">{COPY[mode].title}</p>

        <form onSubmit={submit} noValidate>
          {mode === 'register' && (
            <div className="field">
              <label htmlFor="nome">Nome</label>
              <input id="nome" autoComplete="name" value={form.name} onChange={set('name')} placeholder="Maria Souza" />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} placeholder="voce@email.com" />
          </div>
          {mode !== 'reset' && (
            <div className="field">
              <label htmlFor="senha">Senha</label>
              <input
                id="senha"
                type="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={form.password}
                onChange={set('password')}
                placeholder="••••••••"
              />
            </div>
          )}

          {error && <p className="form-msg error" role="alert">{error === 'name-required' ? 'Informe seu nome.' : error}</p>}
          {info && <p className="form-msg ok" role="status">{info}</p>}

          <button className="btn block" type="submit" disabled={busy}>
            {busy ? 'Aguarde…' : COPY[mode].submit}
          </button>
          {mode === 'login' && (
            <>
              <p style={{ height: 6 }}></p>
              <button className="btn ghost block" type="button" disabled={busy} onClick={google}>
                Entrar com Google
              </button>
              <p className="muted" style={{ textAlign: 'center', marginBottom: 0 }}>
                <a href="#" className="link-green" onClick={switchMode('reset')}>Esqueci minha senha</a>
              </p>
            </>
          )}
        </form>

        <p className="muted" style={{ textAlign: 'center', marginBottom: 0 }}>
          {mode === 'register' ? (
            <>Já tem conta? <a href="#" className="link-green" onClick={switchMode('login')}>Entrar</a></>
          ) : mode === 'reset' ? (
            <a href="#" className="link-green" onClick={switchMode('login')}>Voltar ao login</a>
          ) : (
            <>Ainda não tem conta? <a href="#" className="link-green" onClick={switchMode('register')}>Cadastre-se</a></>
          )}
        </p>
      </section>
    </div>
  )
}

export default Login
