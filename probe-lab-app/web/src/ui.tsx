import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { UploadStatus } from '../../shared/contracts.js';
import type { AnalysisHelp, FieldHelp } from './help.js';

/*
 * Design-system primitives. Everything is local — no icon or component
 * dependency — so the app stays fully offline.
 */

export type IconName =
  | 'upload'
  | 'history'
  | 'wafer'
  | 'scan'
  | 'chart'
  | 'search'
  | 'close'
  | 'check'
  | 'warning'
  | 'error'
  | 'info'
  | 'sun'
  | 'moon'
  | 'signout'
  | 'menu'
  | 'file'
  | 'left'
  | 'right'
  | 'back'
  | 'clipboard'
  | 'target'
  | 'inbox'
  | 'refresh'
  | 'tick'
  | 'panel'
  | 'caret'
  | 'help'
  | 'dashboard';

const glyphs: Record<IconName, ReactElement> = {
  upload: (
    <>
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4.5h4.5" />
      <path d="M12 8v4.5l3 1.8" />
    </>
  ),
  wafer: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M4 9h16M4 15h16M9 3.5v17M15 3.5v17" />
    </>
  ),
  scan: (
    <>
      <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  chart: (
    <>
      <path d="M3 21h18" />
      <path d="M6 21V10M12 21V4M18 21v-7" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </>
  ),
  warning: (
    <>
      <path d="M10.3 3.9 2.4 17.5A1.9 1.9 0 0 0 4 20.4h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5M12 16h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  signout: (
    <>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  left: <path d="m14 6-6 6 6 6" />,
  right: <path d="m10 6 6 6-6 6" />,
  back: (
    <>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </>
  ),
  clipboard: (
    <>
      <path d="M9 4h6v3H9z" />
      <path d="M15 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 12h5l1.5 2.5h5L16 12h5" />
      <path d="M5.5 5h13l2.5 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z" />
    </>
  ),
  tick: <path d="m5 12.5 4.5 4.5L19 7" />,
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 4v16" />
    </>
  ),
  caret: <path d="m6 9.5 6 6 6-6" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.3a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.5-2.6 2.5" />
      <path d="M12 16.4h.01" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-13.6-4.6L3 9" />
      <path d="M4 5v4h4" />
      <path d="M4 13a8 8 0 0 0 13.6 4.6L21 15" />
      <path d="M20 19v-4h-4" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </>
  ),
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyphs[name]}
    </svg>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return <section className={className ? `card ${className}` : 'card'}>{children}</section>;
}

export function CardHead({
  title,
  subtitle,
  kicker,
  actions,
  titleId,
  help,
  helpTitle,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  kicker?: string;
  actions?: ReactNode;
  titleId?: string;
  help?: FieldHelp;
  helpTitle?: string;
}): ReactElement {
  return (
    <header className="card-head">
      <div className="card-head-titles">
        {kicker ? <p className="kicker">{kicker}</p> : null}
        <div className="card-head-line">
          <h2 id={titleId}>{title}</h2>
          {help ? <HelpDot title={helpTitle ?? String(title)} help={help} /> : null}
        </div>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="card-head-actions">{actions}</div> : null}
    </header>
  );
}

export function CardBody({
  children,
  tight,
}: {
  children: ReactNode;
  tight?: boolean;
}): ReactElement {
  return <div className={tight ? 'card-body tight' : 'card-body'}>{children}</div>;
}

const POPOVER_WIDTH = 328;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/(^-|-$)/gu, '');
}

/**
 * The `?` beside a label. Its accessible name is deliberately just "Help" — it
 * must not contain the field's own words, or `getByLabel('Device')` would match
 * the help button as well as the control. The field name reaches assistive tech
 * through `aria-describedby` and through the popover's own heading instead.
 *
 * The popover is portalled to <body>, positioned beside its label, and clamped
 * to the viewport. The portal also keeps a sticky header's backdrop-filter from
 * becoming the fixed-position containing block.
 */
export function HelpDot({
  title,
  help,
  labelId,
  buttonLabel = 'Help',
  variant = 'field',
}: {
  title: string;
  help: FieldHelp | AnalysisHelp;
  labelId?: string;
  buttonLabel?: string;
  variant?: 'field' | 'analysis';
}): ReactElement {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const popoverId = useId();
  const popoverWidth = variant === 'analysis' ? 440 : POPOVER_WIDTH;

  const place = (): void => {
    const bounds = buttonRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const edge = 12;
    const gap = 10;
    const roomOnRight = window.innerWidth - bounds.right - gap;
    const roomOnLeft = bounds.left - gap;

    if (roomOnRight >= popoverWidth) {
      setPosition({ top: Math.max(edge, bounds.top - 8), left: bounds.right + gap });
      return;
    }
    if (roomOnLeft >= popoverWidth) {
      setPosition({ top: Math.max(edge, bounds.top - 8), left: bounds.left - popoverWidth - gap });
      return;
    }

    const left = Math.min(
      Math.max(edge, bounds.left),
      Math.max(edge, window.innerWidth - popoverWidth - edge),
    );
    setPosition({ top: bounds.bottom + 8, left });
  };

  useEffect(() => {
    if (position === null) return;
    const close = (): void => setPosition(null);
    const onScroll = (event: Event): void => {
      const target = event.target;

      // The panel has its own scrollbar when its content is taller than the
      // viewport. Keep it open while that scrollbar is being used; only close
      // when the page (or another container behind the panel) moves.
      if (target instanceof Node && popoverRef.current?.contains(target)) return;
      close();
    };
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [position]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="help-dot"
        aria-label={buttonLabel}
        aria-expanded={position !== null}
        aria-controls={popoverId}
        aria-describedby={labelId}
        data-testid={`help-${slugify(title)}`}
        onClick={() => (position === null ? place() : setPosition(null))}
      >
        <Icon name={variant === 'analysis' ? 'info' : 'help'} size={15} />
      </button>
      {position !== null
        ? createPortal(
            <div
              ref={popoverRef}
              id={popoverId}
              role="note"
              className={variant === 'analysis' ? 'help-pop analysis-help-pop' : 'help-pop'}
              style={{ top: position.top, left: position.left, width: popoverWidth }}
            >
              <div className="help-pop-head">
                <h4>{title}</h4>
                <button
                  type="button"
                  className="btn btn-icon btn-sm"
                  aria-label="Close help"
                  onClick={() => setPosition(null)}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
              <dl>
                <dt>What it is</dt>
                <dd>{help.what}</dd>
                {'roi' in help ? (
                  <>
                    <dt>How it works</dt>
                    <dd>{help.how}</dd>
                    {'algorithm' in help && help.algorithm ? (
                      <>
                        <dt>{help.algorithm.title}</dt>
                        <dd>
                          <p>{help.algorithm.summary}</p>
                          <ol className="analysis-algorithm-steps">
                            {help.algorithm.steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                        </dd>
                      </>
                    ) : null}
                    <dt>Why it helps (ROI)</dt>
                    <dd>{help.roi}</dd>
                  </>
                ) : (
                  <>
                    <dt>Why it matters</dt>
                    <dd>{help.why}</dd>
                    <dt>How to use it</dt>
                    <dd>{help.how}</dd>
                  </>
                )}
              </dl>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * A labelled control, with optional help.
 *
 * The label is explicitly associated by `for`/`id` (the id is generated and
 * cloned onto the control) rather than by wrapping, so the `?` button can sit
 * beside the label text without joining the control's accessible name. Text
 * inside a <label> becomes part of that name — which is how a "Pick a device
 * first" hint once made the Test program field match a search for "Device".
 */
export function Field({
  label,
  hint,
  help,
  children,
}: {
  label: string;
  hint?: string;
  help?: FieldHelp;
  children: ReactNode;
}): ReactElement {
  const controlId = useId();
  const labelId = `${controlId}-label`;
  const hintId = `${controlId}-hint`;
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
    ? cloneElement(children, {
        id: controlId,
        'aria-describedby':
          [children.props['aria-describedby'], hint ? hintId : undefined]
            .filter(Boolean)
            .join(' ') || undefined,
      })
    : children;

  return (
    <div className="field">
      <div className="field-label-row">
        <label className="field-label" id={labelId} htmlFor={controlId}>
          {label}
        </label>
        {help ? <HelpDot title={label} help={help} labelId={labelId} /> : null}
      </div>
      {control}
      {hint ? (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  foot,
  icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  icon?: ReactNode;
  accent?: boolean;
}): ReactElement {
  return (
    <div className="stat">
      <span className="stat-label">
        {icon}
        {label}
      </span>
      <span className={accent ? 'stat-value is-accent' : 'stat-value'}>{value}</span>
      {foot ? <span className="stat-foot">{foot}</span> : null}
    </div>
  );
}

export type Tone = 'neutral' | 'good' | 'warning' | 'critical' | 'accent';

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: Tone;
  icon?: IconName;
  children: ReactNode;
}): ReactElement {
  return (
    <span className={tone === 'neutral' ? 'badge' : `badge badge-${tone}`}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

const statusTone: Record<UploadStatus, { tone: Tone; icon: IconName }> = {
  Queued: { tone: 'neutral', icon: 'history' },
  Parsing: { tone: 'accent', icon: 'refresh' },
  Succeeded: { tone: 'good', icon: 'check' },
  'Completed with errors': { tone: 'warning', icon: 'warning' },
  Rejected: { tone: 'critical', icon: 'error' },
};

export function StatusBadge({ status }: { status: UploadStatus }): ReactElement {
  const { tone, icon } = statusTone[status];
  return (
    <Badge tone={tone} icon={icon}>
      {status}
    </Badge>
  );
}

export function Alert({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'error' | 'good' | 'info';
  children: ReactNode;
}): ReactElement {
  const icon: IconName = tone === 'error' ? 'error' : tone === 'good' ? 'check' : 'info';
  return (
    <div
      className={tone === 'neutral' ? 'alert' : `alert alert-${tone}`}
      role={tone === 'error' ? 'alert' : undefined}
    >
      <Icon name={icon} size={16} />
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={20} />
      </span>
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }): ReactElement {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-bar" style={{ width: `${100 - index * 9}%` }} />
      ))}
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  total,
  unit,
  onPrevious,
  onNext,
}: {
  page: number;
  totalPages: number;
  total: number;
  unit: string;
  onPrevious: () => void;
  onNext: () => void;
}): ReactElement {
  return (
    <>
      <span className="pager-info">
        {total.toLocaleString()} {unit}
      </span>
      <div className="pager">
        <span className="pager-info">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page === 1}
          onClick={onPrevious}
        >
          <Icon name="left" size={14} />
          Previous
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page >= totalPages}
          onClick={onNext}
        >
          Next
          <Icon name="right" size={14} />
        </button>
      </div>
    </>
  );
}

/**
 * The yieldWerx wordmark. `onDark` lifts the brand blue so it stays legible on
 * the dark sign-in panel; the sidebar variant is lifted by CSS in dark mode.
 */
export function Logo({
  height = 32,
  onDark,
  className,
}: {
  height?: number;
  onDark?: boolean;
  className?: string;
}): ReactElement {
  const classes = ['brand-logo'];
  if (onDark) classes.push('on-dark');
  if (className) classes.push(className);
  return (
    <img
      src="/yieldwerx-logo.png"
      alt="yieldWerx"
      className={classes.join(' ')}
      style={{ height }}
      width={(height * 1260) / 349}
      height={height}
    />
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function initials(username: string): string {
  return username.slice(0, 1);
}
