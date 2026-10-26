import { useEffect, useRef } from 'react';
import { usePreferences, type DisplayPrefs } from '../hooks/usePreferences';

/** Small non-modal panel: text size, spacing, motion and theme. Closes on Escape or outside click. */
export function DisplaySettings({ id, onClose }: { id: string; onClose: () => void }) {
  const { prefs, update } = usePreferences();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[aria-controls="display-panel"]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [onClose]);

  const sizes: [DisplayPrefs['textSize'], string][] = [[100, 'Standard'], [112, 'Large'], [125, 'Larger']];
  const themes: [DisplayPrefs['theme'], string][] = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

  return (
    <div id={id} ref={ref} className="panel" role="group" aria-label="Display settings"
      style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 'min(320px, calc(100vw - 32px))', padding: 'var(--s-5)', boxShadow: 'var(--shadow-pop)', zIndex: 60 }}>
      <div className="stack">
        <fieldset className="field">
          <legend>Text size</legend>
          {sizes.map(([v, l]) => (
            <label key={v} className="check"><input type="radio" name="textsize" checked={prefs.textSize === v} onChange={() => update({ textSize: v })} />{l}</label>
          ))}
        </fieldset>
        <fieldset className="field">
          <legend>Colour theme</legend>
          {themes.map(([v, l]) => (
            <label key={v} className="check"><input type="radio" name="theme" checked={prefs.theme === v} onChange={() => update({ theme: v })} />{l}</label>
          ))}
        </fieldset>
        <label className="check"><input type="checkbox" checked={prefs.spacious} onChange={(e) => update({ spacious: e.target.checked })} />Wider letter and line spacing</label>
        <label className="check"><input type="checkbox" checked={prefs.reduceMotion} onChange={(e) => update({ reduceMotion: e.target.checked })} />Reduce motion</label>
        <p className="hint">Saved on this device only.</p>
      </div>
    </div>
  );
}
