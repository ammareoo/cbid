import { useEffect, useId, useRef, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, FileText, Info, Inbox, RefreshCw, X } from 'lucide-react';
import { ApiError } from '../api/client';
import { formatDateTime, relative } from '../utils/format';
import instituteLogo from '../assets/cbid-institute-logo.webp';
import networkLogo from '../assets/cbid-network-logo.webp';

/* ---------------------------------------------------------------- brand */
/** CBID Institute logo (from cbidnetwork.org). Sits on a light plate so it stays legible in dark mode. */
export function InstituteLogo({ height = 44, alt = 'CBID Institute' }: { height?: number; alt?: string }) {
  return <img className="logo-plate" src={instituteLogo} alt={alt} height={height} width={Math.round(height * 502 / 225)} />;
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
export function SectionTitle({ title, lede, actions }: { title: ReactNode; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header" style={{ marginBottom: 'var(--s-5)' }}>
      <div className="stack-sm">
        <h2 tabIndex={-1} data-page-heading style={{ fontSize: 'var(--text-2xl)' }}>{title}</h2>
        {lede && <p className="muted" style={{ maxWidth: '62ch' }}>{lede}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
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

export function ProgressBar({ value, label }: { value: number | null | undefined; label: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="stack-sm">
      <div className="row-between meta"><span>{label}</span><span className="tabular">{value == null ? 'No content yet' : `${v}%`}</span></div>
      <div className={v === 100 ? 'progress progress--complete' : 'progress'} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}>
        <span style={{ width: `${v}%` }} />
      </div>
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
      {hint && <p className="hint" id={`${fid}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${fid}-err`}><AlertTriangle aria-hidden="true" /><span><span className="sr-only">Error: </span>{error}</span></p>}
      <input id={fid} className="input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
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
      {hint && <p className="hint" id={`${fid}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${fid}-err`}><AlertTriangle aria-hidden="true" /><span><span className="sr-only">Error: </span>{error}</span></p>}
      <textarea id={fid} className={`textarea ${className ?? ''}`} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
    </div>
  );
}

export function SelectField({ label, hint, error, id, children, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const fid = id ?? auto;
  const describedBy = [hint ? `${fid}-hint` : '', error ? `${fid}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={fid}>{label}</label>
      {hint && <p className="hint" id={`${fid}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${fid}-err`}><AlertTriangle aria-hidden="true" /><span><span className="sr-only">Error: </span>{error}</span></p>}
      <select id={fid} className="select" aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest}>{children}</select>
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

/* ---------------------------------------------------------------- dialog */
export function Dialog({ open, onClose, title, children, wide, description }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; description?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`dialog${wide ? ' dialog--wide' : ''}`} aria-labelledby={titleId} onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && (
        <>
          <div className="dialog__head">
            <div className="stack-sm">
              <h2 id={titleId}>{title}</h2>
              {description && <p className="muted">{description}</p>}
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog"><X aria-hidden="true" /></button>
          </div>
          <div className="dialog__body">{children}</div>
        </>
      )}
    </dialog>
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
      <div className="row">
        <button type="button" className="btn btn--secondary btn--sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button type="button" className="btn btn--secondary btn--sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
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
