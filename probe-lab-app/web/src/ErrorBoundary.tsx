import { Component, type ErrorInfo, type ReactNode } from 'react';

import { clearStoredSession } from './auth.js';

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The application UI crashed.', error, info.componentStack);
  }

  public override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="shell">
        <section className="card">
          <div className="card-body">
            <p className="kicker">Recovery</p>
            <h1>Something went wrong.</h1>
            <p className="muted">
              The page could not be rendered. Reload to start from a clean session.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                clearStoredSession();
                window.location.assign('/login');
              }}
            >
              Return to sign in
            </button>
          </div>
        </section>
      </main>
    );
  }
}
