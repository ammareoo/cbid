import { usePreferences, type DisplayPrefs } from '../hooks/usePreferences';

/** Display preferences (text size, theme, spacing, motion). Saved on this device only. */
export function DisplayPrefsFields() {
  const { prefs, update } = usePreferences();
  const sizes: [DisplayPrefs['textSize'], string][] = [[100, 'Standard'], [112, 'Large'], [125, 'Larger']];
  const themes: [DisplayPrefs['theme'], string][] = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

  return (
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
  );
}
