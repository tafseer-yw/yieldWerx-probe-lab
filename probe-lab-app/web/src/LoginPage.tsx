import { useEffect, useState, type FormEvent, type ReactElement } from 'react';

import { errorMessage } from './api.js';
import { useAuth } from './auth.js';
import { WaferHero } from './WaferHero.js';
import { Alert, Card, CardBody, Field, Icon, Logo } from './ui.js';
import { productBrand } from '../../shared/contracts.js';

/** What this build actually ships — nothing aspirational. */
const features = [
  'Wafer CSV upload with per-row validation and a rejection report',
  'Round wafer map, coloured by pass/fail or hard bin',
  'Find groups of failed dies that touch on their sides or corners',
  'Bin pareto with bin % and a running-total line',
  'Explainable wafer triage with fixed pattern matching',
  'Roles — viewer, dev, qa, admin — over a documented OpenAPI surface',
];

export function LoginPage(): ReactElement {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = `Sign in · ${productBrand.name}`;
  }, []);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await login(username, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login">
      <aside className="login-aside">
        <WaferHero />
        <Logo onDark height={38} />
        <div className="login-pitch">
          <h2>Hands-on PROBE practice for Dev and QA</h2>
          <div className="login-features">
            {features.map((feature) => (
              <span className="login-feature" key={feature}>
                <span className="tick">
                  <Icon name="tick" size={11} />
                </span>
                {feature}
              </span>
            ))}
          </div>
        </div>
        <p className="login-foot">Fully offline company practice lab</p>
      </aside>

      <main className="login-main">
        <div className="login-card">
          <Logo height={30} className="login-card-logo" />
          <div>
            <h1>Sign in</h1>
            <p className="muted">Use a demo account to reach the workspace.</p>
          </div>
          <Card>
            <CardBody>
              <form onSubmit={onSubmit}>
                <Field label="Username">
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    placeholder="dev"
                    required
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </Field>
                {error ? <Alert tone="error">{error}</Alert> : null}
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            </CardBody>
          </Card>
          <div className="demo-users">
            <p className="kicker">Demo accounts</p>
            <div className="demo-user-row">
              <code className="demo-user">viewer / viewer</code>
              <code className="demo-user">dev / dev</code>
              <code className="demo-user">qa / qa</code>
              <code className="demo-user">admin / admin</code>
            </div>
            <p className="muted">Only dev, qa, and admin may upload wafer data.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
