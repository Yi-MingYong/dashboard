import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { fmt } from '../lib/format';
import { fold } from '../lib/text';
import { Icon } from './Icon';

/* ───────────── Panel ───────────── */

export function Panel({
  title, sub, actions, children, className = '', foot, bodyClass = '',
}: {
  title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; foot?: ReactNode; bodyClass?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          {title && <h3 className="panel-title" style={{ fontSize: 13 }}>{title}</h3>}
          {sub && <span className="panel-sub">{sub}</span>}
          <span className="spacer" />
          {actions}
        </header>
      )}
      <div className={`panel-body ${bodyClass}`}>{children}</div>
      {foot && <footer className="panel-foot">{foot}</footer>}
    </section>
  );
}

/* ───────────── Simple data table (table view of a chart) ───────────── */

export interface TableSpec {
  columns: { key: string; label: string; align?: 'r' }[];
  rows: Record<string, ReactNode>[];
}

export function DataTable({ spec }: { spec: TableSpec }) {
  return (
    <table className="tbl">
      <thead>
        <tr>{spec.columns.map((c) => <th key={c.key} className={c.align ?? ''}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {spec.rows.map((r, i) => (
          <tr key={i}>{spec.columns.map((c) => <td key={c.key} className={c.align ?? ''}>{r[c.key]}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export function TableToggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <button type="button" className="btn-link" aria-pressed={on} onClick={() => set(!on)}>
      {on ? 'Grafiek' : 'Tabel'}
    </button>
  );
}

/* ───────────── KPI strip ───────────── */

export interface KpiItem {
  label: string;
  value: string;
  delta?: string | null;
  up?: boolean;
  note?: string;
}

export function KpiStrip({ items, className = '' }: { items: KpiItem[]; className?: string }) {
  return (
    <div className={`kpis ${className}`}>
      {items.map((k) => (
        <div className="kpi" key={k.label}>
          <div className="kpi-label" title={k.label}>{k.label}</div>
          <div className="kpi-value">{k.value}</div>
          <div className="kpi-meta">
            {k.delta && <span className={`d ${k.up ? 'up' : 'down'}`}>{k.delta}</span>}
            {k.note && <span className="muted ellipsis">{k.note}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────── Ranked rows ───────────── */

export interface RankItem {
  key: string;
  label: string;
  value: number;
  sub?: string;
}

export function RankRows({
  items, onSelect, activeKey, limit = 200, color = 'red', empty = 'Geen gegevens in deze selectie.', valueLabel,
}: {
  items: RankItem[]; onSelect?: (key: string) => void; activeKey?: string | null; limit?: number; color?: 'red' | 'slate';
  empty?: string; valueLabel?: (n: number) => string;
}) {
  const [shown, setShown] = useState(limit);
  useEffect(() => {
    setShown(limit);
  }, [items, limit]);
  if (!items.length) return <div className="empty">{empty}</div>;
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <>
      <ol className="rows">
        {items.slice(0, shown).map((it, i) => {
          const inner = (
            <>
              <span className="r">{String(i + 1).padStart(2, '0')}</span>
              <span className="ellipsis" title={it.label}>
                {it.label}
                {it.sub && <span className="muted" style={{ fontSize: 11.5, marginLeft: 6 }}>{it.sub}</span>}
              </span>
              <span className={`track ${color === 'slate' ? 'slate' : ''}`}><span style={{ width: `${(Math.abs(it.value) / max) * 100}%` }} /></span>
              <span className="v">{valueLabel ? valueLabel(it.value) : fmt(it.value)}</span>
            </>
          );
          return (
            <li key={it.key}>
              {onSelect ? (
                <button type="button" className="row rank" aria-current={activeKey === it.key} onClick={() => onSelect(it.key)}>{inner}</button>
              ) : (
                <div className="row rank">{inner}</div>
              )}
            </li>
          );
        })}
      </ol>
      {items.length > shown && (
        <div style={{ padding: '6px 8px' }}>
          <button type="button" className="btn-link" onClick={() => setShown((s) => s + 50)}>Toon meer ({fmt(items.length - shown)})</button>
        </div>
      )}
    </>
  );
}

/* ───────────── Thin segmented bar with legend ───────────── */

export function SegBar({ parts, label }: { parts: { label: string; value: number; color: string }[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div className="segbar" role="img" aria-label={`${label}: ${shown.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
        {shown.map((p) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${fmt(p.value)}`} />
        ))}
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        {shown.map((p) => (
          <span key={p.label}><span className="sw" style={{ background: p.color }} />{p.label} <span className="mono muted">{fmt(p.value)}</span></span>
        ))}
      </div>
    </div>
  );
}

/* ───────────── Segmented control ───────────── */

export function Seg<T extends string | number>({ options, value, onChange, label }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ───────────── Popover ───────────── */

export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

/* ───────────── Person combobox ───────────── */

export function Combobox({
  placeholder, options, value, onChange, valueLabel, ariaLabel,
}: {
  placeholder: string; options: { value: string; label: string; count?: number; search: string }[];
  value: string | null; onChange: (v: string | null) => void; valueLabel?: string; ariaLabel: string;
}) {
  const { open, setOpen, ref } = usePopover();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const matches = useMemo(() => {
    const terms = fold(q).split(/\s+/).filter(Boolean);
    return options.filter((o) => terms.every((t) => o.search.includes(t))).slice(0, 50);
  }, [q, options]);
  useEffect(() => {
    setActive(0);
  }, [q]);
  const pick = (v: string | null) => {
    onChange(v);
    setQ('');
    setOpen(false);
  };
  return (
    <div className="pop-anchor" ref={ref}>
      <div className="search" style={{ width: 190 }}>
        <Icon name="user" size={13} />
        <input
          className="input"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder={value ? valueLabel : placeholder}
          value={open ? q : value ? valueLabel ?? '' : ''}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && matches[active]) {
              e.preventDefault();
              pick(matches[active].value);
            }
          }}
          style={value ? { borderColor: 'var(--ink)' } : undefined}
        />
        {value && (
          <button type="button" className="btn btn-xs btn-icon clear" style={{ border: 0, height: 24 }} aria-label="Wis persoon" onClick={() => pick(null)}>
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
      {open && (
        <div className="popover" style={{ minWidth: 280 }}>
          <div className="listbox" role="listbox" id={listId}>
            {matches.length ? (
              matches.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className="menu-item"
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o.value)}
                >
                  <span className="ellipsis">{o.label}</span>
                  {o.count != null && <span className="count">{fmt(o.count)}</span>}
                </button>
              ))
            ) : (
              <div className="empty" style={{ padding: 14 }}>Geen personen gevonden.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Keyboard navigation for master tables: ArrowUp/ArrowDown move the selection. */
export function useListKeys<T>(items: T[], selected: T | null, select: (item: T) => void) {
  return (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (!items.length) return;
    e.preventDefault();
    const i = selected == null ? -1 : items.indexOf(selected);
    const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
    select(items[next]);
  };
}
