import { useEffect, useId, useRef, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Clock, FileText, Info, Inbox, RefreshCw, X } from 'lucide-react';
import { ApiError } from '../api/client';
import { formatDateTime, relative } from '../utils/format';
import networkLogo from '../assets/cbid-network-logo.webp';
import { Select as SelectControl, type SelectProps } from './Select';
export { Select } from './Select';

/** Transparent institute emblem (public/). */
export const INSTITUTE_LOGO_SRC = encodeURI('/CBID Institute Logo Emblem.png');

/* ---------------------------------------------------------------- brand */
/** CBID Institute wordmark (public PNG). Use `fluid` on auth hero so width follows layout CSS. */
export function InstituteLogo({
  height = 44,
  fluid,
  alt = 'CBID Institute',
}: {
  height?: number;
  fluid?: boolean;
  alt?: string;
}) {
  const fixed = !fluid && height > 0;
  return (
    <img
      className="logo-plate logo-plate--institute"
      src={INSTITUTE_LOGO_SRC}
      alt={alt}
      {...(fixed ? { height, style: { height, width: 'auto' as const } } : {})}
    />
  );
}

/** CBID Network PK Sindh logo, the parent organisation. */
export function NetworkLogo({ height = 40, alt = 'CBID Network PK Sindh' }: { height?: number; alt?: string }) {
  return <img className="logo-plate" src={networkLogo} alt={alt} height={height} width={Math.round(height * 470 / 225)} />;
}

/* ---------------------------------------------------------------- page header */
export interface Crumb { label: string; to?: string }
export function PageHeader({ title, eyebrow, lede, actions, crumbs, headingRef }: {
  title: ReactNode; eyebrow?: ReactNode; lede?: ReactNode; actions?: ReactNode; crumbs?: Crumb[];
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <header className="page-header">
      <div className="stack-sm" style={{ minWidth: 0 }}>
        {crumbs && crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb">
            <ol>
              {crumbs.map((c, i) => (
                <li key={i}>{c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
              ))}
            </ol>
          </nav>
        )}
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 tabIndex={-1} ref={headingRef}>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

/** Heading for a course sub-page (the course title is the page h1). Receives focus after navigation. */
export function SectionTitle({ title, lede, actions, headingId }: { title: ReactNode; lede?: ReactNode; actions?: ReactNode; headingId?: string }) {
  return (
    <header className="page-header course-section-head">
      <div className="stack-sm course-section-head__copy">
        <h2 id={headingId} tabIndex={-1} data-page-heading>{title}</h2>
        {lede && <p className="course-section-head__lede">{lede}</p>}
      </div>
      {actions && <div className="course-section-head__actions row">{actions}</div>}
    </header>
  );
}

/* ---------------------------------------------------------------- states */
export function Skeleton({ lines = 3, height = 18 }: { lines?: number; height?: number }) {
  return (
    <div className="stack-sm" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="stack" style={{ padding: 'var(--s-2) 0' }}>
      <span className="sr-only">{label}…</span>
      <Skeleton lines={4} />
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiError ? error.message : 'Something went wrong while loading this page.';
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div className="notice notice--danger" role="alert">
      <AlertTriangle aria-hidden="true" />
      <div className="stack-sm">
        <p><strong>{notFound ? 'Not found.' : 'This could not be loaded.'}</strong> {message}</p>
        {onRetry && !notFound && (
          <div><button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}><RefreshCw aria-hidden="true" />Try again</button></div>
        )}
        {notFound && <p><Link to="/">Go to your home page</Link></p>}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <Inbox aria-hidden="true" />}
      <p><strong>{title}</strong></p>
      {children && <div className="muted">{children}</div>}
      {action}
    </div>
  );
}

/** Renders loading / error / data for a query in one consistent way. */
export function QueryView<T>({ q, children, loadingLabel }: { q: UseQueryResult<T>; children: (data: T) => ReactNode; loadingLabel?: string }) {
  if (q.isPending) return <Loading label={loadingLabel} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <>{children(q.data)}</>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok' | 'danger'; children: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div className={`notice${tone === 'info' ? '' : ` notice--${tone}`}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- badges */
export function Badge({ tone, children, icon }: { tone?: 'ok' | 'warn' | 'danger' | 'info' | 'brand' | 'outline'; children: ReactNode; icon?: ReactNode }) {
  return <span className={`badge${tone ? ` badge--${tone}` : ''}`}>{icon}{children}</span>;
}

export function PublishBadge({ status }: { status: string }) {
  if (status === 'published') return <Badge tone="ok" icon={<CheckCircle2 aria-hidden="true" />}>Published</Badge>;
  if (status === 'archived') return <Badge tone="outline">Archived</Badge>;
  return <Badge tone="warn" icon={<CircleDashed aria-hidden="true" />}>Draft</Badge>;
}

/** Due date with an absolute time and a relative hint; colour never carries meaning alone. */
export function DueLabel({ iso, done, prefix = 'Due' }: { iso: string; done?: boolean; prefix?: string }) {
  const past = new Date(iso) < new Date();
  return (
    <span className="row" style={{ gap: 6 }}>
      <Clock aria-hidden="true" width={15} height={15} />
      <span>{prefix} <time dateTime={iso}>{formatDateTime(iso)}</time></span>
      {!done && <span className="meta">({relative(iso)})</span>}
      {past && !done && <Badge tone="danger">Past due</Badge>}
    </span>
  );
}

export function ProgressBar({
  value,
  label,
  compact,
}: {
  value: number | null | undefined;
  label: string;
  compact?: boolean;
}) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const bar = (
    <div
      className={v === 100 ? 'progress progress--complete' : 'progress'}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
    >
      <span style={{ width: `${v}%` }} />
    </div>
  );
  if (compact) {
    return (
      <div className="progress-compact">
        <span className="progress-compact__value tabular">{value == null ? '—' : `${v}%`}</span>
        {bar}
      </div>
    );
  }
  return (
    <div className="stack-sm">
      <div className="row-between meta">
        <span>{label}</span>
        <span className="tabular">{value == null ? 'No content yet' : `${v}%`}</span>
      </div>
      {bar}
    </div>
  );
}

/* ---------------------------------------------------------------- form fields */
interface FieldProps { label: string; hint?: ReactNode; error?: string }

export function TextField({ label, hint, error, id, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fid = id ?? auto;
  const describedBy = [hint ? `${fid}-hint` : '', error ? `${fid}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={fid}>{label}</label>
      <input id={fid} className="input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
      {hint && <p className="hint" id={`${fid}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${fid}-err`}><AlertTriangle aria-hidden="true" /><span><span className="sr-only">Error: </span>{error}</span></p>}
    </div>
  );
}

export function TextAreaField({ label, hint, error, id, className, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const fid = id ?? auto;
  const describedBy = [hint ? `${fid}-hint` : '', error ? `${fid}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={fid}>{label}</label>
      <textarea id={fid} className={`textarea ${className ?? ''}`} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
      {hint && <p className="hint" id={`${fid}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${fid}-err`}><AlertTriangle aria-hidden="true" /><span><span className="sr-only">Error: </span>{error}</span></p>}
    </div>
  );
}

export function SelectField({
  label, hint, error, id, children, tone = 'md', ...rest
}: FieldProps & SelectProps) {
  const auto = useId();
  const fid = id ?? auto;
  const describedBy = [hint ? `${fid}-hint` : '', error ? `${fid}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={fid}>{label}</label>
      <SelectControl
        id={fid}
        tone={tone}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      >
        {children}
      </SelectControl>
      {hint && <p className="hint" id={`${fid}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${fid}-err`}><AlertTriangle aria-hidden="true" /><span><span className="sr-only">Error: </span>{error}</span></p>}
    </div>
  );
}

export function Checkbox({ label, hint, ...rest }: { label: ReactNode; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="check">
      <input type="checkbox" {...rest} />
      <span>{label}{hint && <span className="hint" style={{ display: 'block' }}>{hint}</span>}</span>
    </label>
  );
}

/** Lists every server/validation error at the top of a form and moves focus to it. */
export function ErrorSummary({ error }: { error: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) ref.current?.focus(); }, [error]);
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  const details = e?.details ?? [];
  return (
    <div className="error-summary" role="alert" tabIndex={-1} ref={ref}>
      <h2>{details.length ? 'Some fields need attention' : 'That did not work'}</h2>
      {details.length ? (
        <ul>{details.map((d) => <li key={d.path}>{labelFor(d.path)}: {d.message}</li>)}</ul>
      ) : (
        <p>{e?.message ?? 'Something went wrong. Please try again.'}</p>
      )}
    </div>
  );
}
const labelFor = (path: string) => path.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/\./g, ' › ');

/* ---------------------------------------------------------------- dialog
 * Fixed overlay (not <dialog showModal()>) so the panel stays in the normal
 * DOM stacking context — Cursor element select and similar tools can target it.
 */
export function Dialog({ open, onClose, title, children, wide, description }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; description?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descId = useId();
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => {
      const root = panelRef.current;
      if (!root) return;
      // Prefer a field so typing works immediately; never re-run this on parent re-renders.
      const field = root.querySelector<HTMLElement>('textarea, input:not([type="hidden"]):not([type="button"]):not([type="submit"]), select');
      const fallback = root.querySelector<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])');
      (field ?? fallback ?? root).focus();
    }, 0);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="dialog-root" role="presentation">
      <button type="button" className="dialog-root__backdrop" aria-label="Close dialog" onClick={() => onCloseRef.current()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`dialog${wide ? ' dialog--wide' : ''}`}
      >
        <div className="dialog__head">
          <div className="stack-sm">
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descId} className="muted">{description}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={() => onCloseRef.current()} aria-label="Close dialog"><X aria-hidden="true" /></button>
        </div>
        <div className="dialog__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel, danger, busy, onConfirm, onClose }: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div>{body}</div>
      <div className="form-actions">
        <button type="button" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm} disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}{confirmLabel}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- pagination */
export function Pagination({ page, totalPages, total, onPage, noun = 'results' }: {
  page: number; totalPages: number; total: number; onPage: (p: number) => void; noun?: string;
}) {
  return (
    <nav className="pagination" aria-label="Pagination">
      <p className="meta" aria-live="polite">{total} {noun} · page {page} of {totalPages}</p>
      <div className="row pagination__arrows">
        <button type="button" className="icon-btn" disabled={page <= 1} aria-label="Previous page" onClick={() => onPage(page - 1)}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <button type="button" className="icon-btn" disabled={page >= totalPages} aria-label="Next page" onClick={() => onPage(page + 1)}>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

export function FileLink({ id, name, size }: { id: string; name: string | null; size?: string }) {
  return (
    <a href={`/api/files/${id}`} className="row" style={{ gap: 6, display: 'inline-flex' }}>
      <FileText aria-hidden="true" width={16} height={16} />
      <span>{name ?? 'Download file'}</span>
      {size && <span className="meta">({size})</span>}
      <span className="sr-only">(download)</span>
    </a>
  );
}
