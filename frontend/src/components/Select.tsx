import {
  Children, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ChangeEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode, type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

type SelectTone = 'md' | 'sm';

type Option = { value: string; label: string; disabled?: boolean };

function optionLabel(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(optionLabel).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return optionLabel(node.props.children);
  return '';
}

function parseOptions(children: ReactNode): Option[] {
  const out: Option[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== 'option') return;
    const props = (child as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>).props;
    const label = optionLabel(props.children) || (props.value != null ? String(props.value) : '');
    const value = props.value != null ? String(props.value) : label;
    out.push({ value, label, disabled: Boolean(props.disabled) });
  });
  return out;
}

function emitChange(
  onChange: SelectHTMLAttributes<HTMLSelectElement>['onChange'] | undefined,
  value: string,
  name?: string,
) {
  if (!onChange) return;
  const target = { value, name: name ?? '' } as HTMLSelectElement;
  onChange({ target, currentTarget: target } as ChangeEvent<HTMLSelectElement>);
}

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  tone?: SelectTone;
  inline?: boolean;
};

/** Premium select with a designed dropdown list (ported to body so it always stacks on top). */
export function Select({
  className,
  tone = 'md',
  inline,
  children,
  value,
  defaultValue,
  onChange,
  onBlur,
  disabled,
  id,
  name,
  required,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  'aria-label': ariaLabel,
  style,
  ...rest
}: SelectProps) {
  const options = useMemo(() => parseOptions(children), [children]);
  const isControlled = value !== undefined;
  const [uncontrolled, setUncontrolled] = useState(() => String(defaultValue ?? options[0]?.value ?? ''));
  const selected = String(isControlled ? value : uncontrolled);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === selected)));
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selectedLabel = options.find((o) => o.value === selected)?.label ?? selected;

  function placeMenu() {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const gap = 6;
    const maxH = Math.min(320, window.innerHeight * 0.5);
    const spaceBelow = window.innerHeight - r.bottom - gap - 8;
    const spaceAbove = r.top - gap - 8;
    const openUp = spaceBelow < Math.min(maxH, 160) && spaceAbove > spaceBelow;
    const height = Math.min(maxH, openUp ? spaceAbove : spaceBelow);
    const width = Math.max(r.width, inline ? 180 : r.width);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    setMenuStyle({
      position: 'fixed',
      left: Math.max(8, left),
      width,
      maxHeight: height,
      zIndex: 10000,
      ...(openUp
        ? { bottom: window.innerHeight - r.top + gap, top: 'auto' }
        : { top: r.bottom + gap, bottom: 'auto' }),
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    placeMenu();
    const onReposition = () => placeMenu();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, inline, options.length]);

  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === selected);
    setActive(idx >= 0 ? idx : 0);
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, options, selected]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !el) return;
    // Scroll only inside the menu — scrollIntoView can jump the page when the list is portaled.
    const listRect = list.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top < listRect.top) list.scrollTop -= listRect.top - elRect.top;
    else if (elRect.bottom > listRect.bottom) list.scrollTop += elRect.bottom - listRect.bottom;
  }, [active, open]);

  function choose(next: string) {
    if (!isControlled) setUncontrolled(next);
    emitChange(onChange, next, name);
    setOpen(false);
    btnRef.current?.focus();
  }

  function move(delta: number) {
    if (!options.length) return;
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + delta + options.length) % options.length;
      if (!options[i]?.disabled) {
        setActive(i);
        return;
      }
    }
  }

  function onTriggerKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (e.key === 'ArrowDown') move(1);
      if (e.key === 'ArrowUp') move(-1);
      if (e.key === 'Enter' || e.key === ' ') {
        const opt = options[active];
        if (opt && !opt.disabled) choose(opt.value);
      }
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      const first = options.findIndex((o) => !o.disabled);
      if (first >= 0) setActive(first);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      for (let i = options.length - 1; i >= 0; i--) {
        if (!options[i]?.disabled) { setActive(i); break; }
      }
    }
  }

  void rest;

  const menu = open ? createPortal(
    <ul
      ref={listRef}
      id={listId}
      className={`select-menu select-menu--portal${tone === 'sm' ? ' select-menu--sm' : ''}`}
      role="listbox"
      tabIndex={-1}
      style={menuStyle}
      aria-activedescendant={options[active] ? `${listId}-opt-${active}` : undefined}
    >
      {options.map((opt, i) => {
        const isSelected = opt.value === selected;
        const isActive = i === active;
        return (
          <li
            key={`${opt.value}-${i}`}
            id={`${listId}-opt-${i}`}
            role="option"
            data-index={i}
            aria-selected={isSelected}
            aria-disabled={opt.disabled || undefined}
            className={[
              'select-menu__option',
              isSelected ? 'is-selected' : '',
              isActive ? 'is-active' : '',
              opt.disabled ? 'is-disabled' : '',
            ].filter(Boolean).join(' ')}
            onMouseEnter={() => !opt.disabled && setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { if (!opt.disabled) choose(opt.value); }}
          >
            <span className="select-menu__label">{opt.label}</span>
            {isSelected && <Check className="select-menu__check" aria-hidden="true" />}
          </li>
        );
      })}
    </ul>,
    document.body,
  ) : null;

  return (
    <div
      ref={rootRef}
      className={[
        'select-wrap',
        'select-wrap--menu',
        tone === 'sm' ? 'select-wrap--sm' : '',
        inline ? 'select-wrap--inline' : '',
        open ? 'is-open' : '',
      ].filter(Boolean).join(' ')}
    >
      <button
        ref={btnRef}
        type="button"
        id={id}
        disabled={disabled}
        className={`select${tone === 'sm' ? ' select--sm' : ''}${className ? ` ${className}` : ''}`}
        style={style}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        onBlur={onBlur as never}
      >
        <span className="select__value">{selectedLabel || 'Select…'}</span>
        <ChevronDown className="select__chevron" aria-hidden="true" />
      </button>
      {menu}
      {name != null && <input type="hidden" name={name} value={selected} disabled={disabled} />}
    </div>
  );
}
