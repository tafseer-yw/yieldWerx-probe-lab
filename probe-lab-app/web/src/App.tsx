import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { WaferIntelligenceApi } from './api.js';
import { productBrand, productVersions } from '../../shared/contracts.js';
import {
  AuthContext,
  clearStoredSession,
  loadSession,
  storeSession,
  useAuth,
  type AuthContextValue,
  type Session,
} from './auth.js';
import { useThemeToggle } from './theme.js';
import { analysisHelp, type AnalysisHelp } from './help.js';
import { HelpDot, Icon, Logo, initials, type IconName } from './ui.js';
import { LoginPage } from './LoginPage.js';
import { DashboardPage } from './DashboardPage.js';
import { UploadPage } from './UploadPage.js';
import { UploadHistoryPage } from './UploadHistoryPage.js';
import { WaferListPage } from './WaferListPage.js';
import { WaferDetailPage } from './WaferDetailPage.js';
import { ClusterDetectionPage } from './ClusterDetectionPage.js';
import { BinParetoPage } from './BinParetoPage.js';
import { SampleDataDialog } from './SampleDataDialog.js';
import { ProbeGuidePage } from './ProbeGuidePage.js';
import { WaferTriagePage } from './WaferTriagePage.js';

const NAV_STATE_KEY = 'yw.nav-collapsed';

interface NavEntry {
  to: string;
  label: string;
  icon: IconName;
  tag?: string;
}

const navGroups: Array<{ heading: string; items: NavEntry[] }> = [
  {
    heading: 'Overview',
    items: [{ to: '/dashboard', label: 'Dashboard', icon: 'dashboard' }],
  },
  {
    heading: 'Data',
    items: [
      { to: '/upload', label: 'Upload data', icon: 'upload' },
      { to: '/uploads', label: 'Upload history', icon: 'history' },
      { to: '/wafers', label: 'Wafers', icon: 'wafer' },
    ],
  },
  {
    heading: 'Analysis',
    items: [
      { to: '/triage', label: 'Wafer triage', icon: 'target' },
      { to: '/detection', label: 'Cluster detection', icon: 'scan' },
      { to: '/reports/bin-pareto', label: 'Bin pareto', icon: 'chart' },
    ],
  },
];

const pageTitles: Array<{
  match: (path: string) => boolean;
  title: string;
  subtitle: string;
  analysisHelp?: AnalysisHelp;
  tag?: string;
}> = [
  {
    match: (path) => path.startsWith('/dashboard'),
    title: 'Dashboard',
    subtitle: 'The whole practice lab at a glance',
  },
  {
    match: (path) => path.startsWith('/upload') && !path.startsWith('/uploads'),
    title: 'Upload data',
    subtitle: 'Check and save a wafer CSV',
  },
  {
    match: (path) => path.startsWith('/uploads'),
    title: 'Upload history',
    subtitle: 'Every upload with its status and validation outcome',
  },
  {
    match: (path) => /^\/wafers\/.+/u.test(path),
    title: 'Wafer detail',
    subtitle: 'Die map and hard bin distribution',
  },
  {
    match: (path) => path.startsWith('/wafers'),
    title: 'Wafers',
    subtitle: 'Landed wafers, newest first',
  },
  {
    match: (path) => path.startsWith('/triage'),
    title: 'Wafer triage',
    subtitle: 'Choose which wafer problem to check first',
    analysisHelp: analysisHelp.waferTriage,
  },
  {
    match: (path) => path.startsWith('/detection'),
    title: 'Cluster detection',
    subtitle: 'Groups of failing dies that touch',
    analysisHelp: analysisHelp.clusterDetection,
  },
  {
    match: (path) => path.startsWith('/guide'),
    title: 'PROBE guide',
    subtitle: 'Set up the lab, install the plugins, and follow your practice track',
  },
  {
    match: (path) => path.startsWith('/reports'),
    title: 'Bin pareto',
    subtitle: 'Largest bin losses with a running total',
    analysisHelp: analysisHelp.binPareto,
  },
];

export function App(): ReactElement {
  const [session, setSession] = useState<Session | null>(loadSession);
  const navigate = useNavigate();

  const logout = useCallback(() => {
    clearStoredSession();
    setSession(null);
    navigate('/login');
  }, [navigate]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await new WaferIntelligenceApi().login(username, password);
    const next = { token: response.accessToken, user: response.user };
    storeSession(next);
    try {
      localStorage.removeItem(NAV_STATE_KEY);
    } catch {
      // Private mode — Layout still uses its expanded default.
    }
    setSession(next);
  }, []);

  const api = useMemo(
    () => new WaferIntelligenceApi(session?.token, logout),
    [session?.token, logout],
  );
  const value = useMemo<AuthContextValue>(
    () => ({ api, session, login, logout }),
    [api, session, login, logout],
  );

  return (
    <AuthContext.Provider value={value}>
      <Routes>
        <Route
          path="/login"
          element={session ? <Navigate to="/dashboard" replace /> : <LoginPage />}
        />
        <Route element={session ? <Layout /> : <Navigate to="/login" replace />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route
            path="/upload"
            element={
              session?.user.role === 'viewer' ? (
                <Navigate to="/dashboard" replace />
              ) : (
                <UploadPage />
              )
            }
          />
          <Route path="/uploads" element={<UploadHistoryPage />} />
          <Route path="/wafers" element={<WaferListPage />} />
          <Route path="/wafers/:waferSequence" element={<WaferDetailPage />} />
          <Route path="/triage" element={<WaferTriagePage />} />
          <Route path="/detection" element={<ClusterDetectionPage />} />
          <Route path="/reports/bin-pareto" element={<BinParetoPage />} />
          <Route path="/guide" element={<ProbeGuidePage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </AuthContext.Provider>
  );
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_STATE_KEY) === 'true';
  } catch {
    return false;
  }
}

function Layout(): ReactElement {
  const { api, session } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [sampleOpen, setSampleOpen] = useState(false);

  const readiness = useQuery({
    queryKey: ['readiness'],
    queryFn: () => api.getReadiness(),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const databaseStatus = readiness.isError
    ? { label: 'Unreachable', tone: 'unavailable' }
    : readiness.data
      ? readiness.data.dependencies.database === 'available'
        ? { label: 'Connected', tone: 'connected' }
        : { label: 'Unavailable', tone: 'unavailable' }
      : { label: 'Checking', tone: 'checking' };
  const apiVersion = readiness.data?.version ?? '—';

  const page = pageTitles.find((entry) => entry.match(location.pathname));

  useEffect(() => {
    document.title = page ? `${page.title} · ${productBrand.name}` : productBrand.name;
    return () => {
      document.title = productBrand.name;
    };
  }, [page]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(NAV_STATE_KEY, String(next));
      } catch {
        // Private mode — the choice simply does not survive a reload.
      }
      return next;
    });
  }, []);

  const shellClass = ['shell'];
  if (collapsed && !menuOpen) shellClass.push('is-collapsed');

  return (
    <div className={shellClass.join(' ')}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {menuOpen ? (
        <div className="scrim" role="presentation" onClick={() => setMenuOpen(false)} />
      ) : null}

      <aside className={menuOpen ? 'sidebar is-open' : 'sidebar'}>
        <Link
          to="/dashboard"
          className="brand"
          aria-label="Open the dashboard"
          title="Dashboard"
          onClick={() => setMenuOpen(false)}
        >
          {collapsed && !menuOpen ? (
            <img src="/favicon.png" alt="" className="brand-glyph" width={32} height={32} />
          ) : (
            <>
              <Logo height={30} />
              <span className="brand-tag">PROBE Lab</span>
            </>
          )}
        </Link>

        {navGroups.map((group) => (
          <nav className="nav-group" key={group.heading} aria-label={group.heading}>
            <p className="kicker nav-heading">{group.heading}</p>
            {group.items
              .filter((item) => item.to !== '/upload' || session?.user.role !== 'viewer')
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  aria-label={item.tag ? `${item.label}, ${item.tag}` : item.label}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) => (isActive ? 'nav-item is-active' : 'nav-item')}
                  onClick={() => setMenuOpen(false)}
                >
                  <Icon name={item.icon} size={21} />
                  <span className="nav-label">{item.label}</span>
                  {item.tag ? (
                    <span className="feature-tag nav-feature-tag">{item.tag}</span>
                  ) : null}
                </NavLink>
              ))}
          </nav>
        ))}

        <div className="sidebar-foot">
          <div
            className="sidebar-system"
            role="status"
            aria-label="System versions and database status"
          >
            <div className="sidebar-system-item" title={`UI version ${productVersions.ui}`}>
              <span>UI</span>
              <strong>v{productVersions.ui}</strong>
            </div>
            <div className="sidebar-system-item" title={`API version ${apiVersion}`}>
              <span>API</span>
              <strong>{apiVersion === '—' ? apiVersion : `v${apiVersion}`}</strong>
            </div>
            <div
              className={`sidebar-system-item database-status is-${databaseStatus.tone}`}
              title={`Database ${databaseStatus.label.toLowerCase()}`}
            >
              <span>DB</span>
              <strong>
                <i aria-hidden="true" />
                {databaseStatus.label}
              </strong>
            </div>
          </div>
          <button
            type="button"
            className="btn nav-collapse"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            data-testid="nav-collapse"
            data-direction={collapsed ? 'right' : 'left'}
          >
            <Icon name={collapsed ? 'right' : 'left'} size={11} />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="btn btn-icon sidebar-toggle"
            aria-label="Open navigation"
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="menu" size={18} />
          </button>
          <div className="topbar-titles">
            <div className="topbar-title-line">
              <h1>{page?.title ?? 'yieldWerx PROBE Lab'}</h1>
              {page?.tag ? <span className="feature-tag">{page.tag}</span> : null}
              {page?.analysisHelp ? (
                <HelpDot
                  title={page.title}
                  help={page.analysisHelp}
                  buttonLabel={`About ${page.title}`}
                  variant="analysis"
                />
              ) : null}
            </div>
            <p>{page?.subtitle}</p>
          </div>
          <div className="topbar-actions">
            <Link className="btn btn-ghost btn-sm" to="/guide" aria-label="PROBE guide">
              <Icon name="help" size={14} />
              <span className="topbar-action-label">PROBE guide</span>
            </Link>
            <span className="topbar-divider" aria-hidden="true">
              |
            </span>
            <a
              className="btn btn-ghost btn-sm"
              href="/docs"
              target="_blank"
              rel="noreferrer"
              aria-label="API docs"
            >
              <Icon name="file" size={14} />
              <span className="topbar-action-label">API docs</span>
            </a>
            {session?.user.role === 'admin' ? (
              <>
                <span className="topbar-divider" aria-hidden="true">
                  |
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label="Sample wafers"
                  onClick={() => setSampleOpen(true)}
                >
                  <Icon name="wafer" size={14} />
                  <span className="topbar-action-label">Sample wafers</span>
                </button>
              </>
            ) : null}
            <span className="topbar-divider" aria-hidden="true">
              |
            </span>
            <ThemeButton />
            <span className="topbar-divider" aria-hidden="true">
              |
            </span>
            <UserMenu />
          </div>
        </header>
        {sampleOpen ? <SampleDataDialog onClose={() => setSampleOpen(false)} /> : null}
        <main className="content" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function ThemeButton(): ReactElement {
  const { theme, toggle } = useThemeToggle();
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
      <span className="topbar-action-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}

function UserMenu(): ReactElement {
  const { session, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const username = session?.user.username ?? '';

  return (
    <div className="user-menu" ref={wrapRef}>
      <button
        type="button"
        className="user-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar">{initials(username)}</span>
        <span className="user-meta">
          <span className="user-name">{username}</span>
          <span className="user-role">{session?.user.role}</span>
        </span>
        <Icon name="caret" size={14} />
      </button>

      {open ? (
        <div className="menu" role="menu">
          <div className="menu-head">
            <span className="avatar">{initials(username)}</span>
            <span className="user-meta">
              <span className="user-name">{username}</span>
              <span className="user-role">{session?.user.role}</span>
            </span>
          </div>
          <button type="button" role="menuitem" className="menu-item" onClick={logout}>
            <Icon name="signout" size={15} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
