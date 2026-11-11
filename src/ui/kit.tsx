import React, { createContext, useContext, useEffect, useState } from 'react';
import type { DB, User } from '../domain/types';
import { LuX, LuInbox } from 'react-icons/lu';

// ── App context ───────────────────────────────────────────
export interface View { name: string; id?: string }
export interface Ctx {
  db: DB; me: User;
  nav: (v: View) => void;
  act: <R>(fn: (d: DB) => R, ok?: string | ((r: R) => string)) => R | undefined;
  readOnly?: boolean;
  toast?: (kind: 'ok' | 'err', text: string) => void;
}
export const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ── Primitives ────────────────────────────────────────────
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'teal'; size?: 'sm' | 'md'; icon?: React.ReactNode };
export function Button({ variant = 'primary', size = 'md', icon, className, children, ...rest }: BtnProps) {
  const { readOnly } = useApp() ?? {};
  const v = {
    primary: 'bg-navy-900 text-white hover:bg-navy-800 disabled:bg-slate-300',
    teal: 'bg-teal-600 text-white hover:bg-teal-700 disabled:bg-slate-300',
    secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300',
    danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50 disabled:text-slate-400',
  }[variant];
  return (
    <button {...rest} disabled={rest.disabled || readOnly}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm', v, className)}>
      {icon}{children}
    </button>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx('rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)}>{children}</div>;
}
export function CardHeader({ title, subtitle, right }: { title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div><h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>{subtitle && <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>}</div>
      {right}
    </div>
  );
}

const TONES = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  teal: 'bg-teal-50 text-teal-800 ring-teal-200',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  navy: 'bg-navy-900 text-white ring-navy-900',
} as const;
export type Tone = keyof typeof TONES;
export function Pill({ tone = 'gray', children, dot }: { tone?: Tone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold ring-1 ring-inset whitespace-nowrap', TONES[tone])}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}{children}
    </span>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-bold tabular-nums', tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-red-700' : 'text-slate-900')}>{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-slate-500">{hint}</div>}
    </Card>
  );
}

export function Empty({ title, body, action, icon }: { title: string; body?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">{icon ?? <LuInbox size={18} />}</div>
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      {body && <p className="mt-1 max-w-sm text-[13px] text-slate-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cx('max-h-[92vh] w-full overflow-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button className="rounded-md p-1 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close"><LuX size={18} /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-semibold text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-[12px] text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-[12px] font-medium text-red-700">{error}</span>}
    </label>
  );
}
export const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100';

export function Select({ value, onChange, options, className, label }: { value: string; onChange: (v: string) => void; options: [string, string][]; className?: string; label?: string }) {
  return (
    <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className={cx('h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-[13px] text-slate-800 focus:border-indigo-500 focus:outline-none', className)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function Tabs({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: [string, React.ReactNode][] }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
      {items.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} className={cx('rounded-md px-3 py-1.5 text-[13px] font-semibold', value === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>{l}</button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-[22px] font-bold tracking-tight text-slate-900">{title}</h1>{subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}</div>
      {right && <div className="flex flex-wrap gap-2">{right}</div>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: React.ReactNode[]; children: React.ReactNode; empty?: React.ReactNode }) {
  const hasRows = React.Children.count(children) > 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead><tr className="border-b border-slate-200 bg-slate-50 text-[12px] uppercase tracking-wide text-slate-500">{head.map((h, i) => <th key={i} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {!hasRows && (empty ?? <Empty title="Nothing here" />)}
    </div>
  );
}
export const Td = ({ children, className }: { children?: React.ReactNode; className?: string }) => <td className={cx('px-4 py-3 align-middle text-slate-700', className)}>{children}</td>;

export function Pager({ page, pages, onPage, total }: { page: number; pages: number; onPage: (p: number) => void; total: number }) {
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-[13px] text-slate-500">
      <span>{total} result{total === 1 ? '' : 's'}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="tabular-nums">Page {page} of {Math.max(pages, 1)}</span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function useSort<T>(rows: T[], keys: Record<string, (r: T) => string | number>, initial: string) {
  const [key, setKey] = useState(initial); const [dir, setDir] = useState<1 | -1>(1);
  const sorted = [...rows].sort((a, b) => { const x = keys[key](a), y = keys[key](b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  const header = (k: string, label: string) => (
    <button className="inline-flex items-center gap-1 uppercase hover:text-slate-800" onClick={() => { if (k === key) setDir(dir === 1 ? -1 : 1); else { setKey(k); setDir(1); } }}>
      {label}{k === key ? (dir === 1 ? ' ↑' : ' ↓') : ''}
    </button>
  );
  return { sorted, header };
}

export function Callout({ tone = 'blue', icon, title, children, action }: { tone?: 'blue' | 'teal' | 'amber' | 'red' | 'green' | 'gray'; icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode }) {
  const t = { blue: 'border-indigo-200 bg-indigo-50/60', teal: 'border-teal-200 bg-teal-50/60', amber: 'border-amber-200 bg-amber-50/70', red: 'border-red-200 bg-red-50/70', green: 'border-emerald-200 bg-emerald-50/70', gray: 'border-slate-200 bg-slate-50' }[tone];
  return (
    <div className={cx('flex gap-3 rounded-xl border p-4', t)}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-slate-900">{title}</div>{children && <div className="mt-1 text-[13px] leading-relaxed text-slate-700">{children}</div>}{action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}</div>
    </div>
  );
}

/** Renders a message exactly as written, preserving its line breaks. */
export function MessageBody({ body }: { body: string }) {
  return <div className="space-y-2 text-[13.5px] leading-relaxed text-slate-700">{body.split('\n\n').map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}</div>;
}
