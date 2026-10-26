import { useCallback, useEffect, useState } from 'react';

export interface DisplayPrefs {
  textSize: 100 | 112 | 125;
  spacious: boolean;
  reduceMotion: boolean;
  theme: 'system' | 'light' | 'dark';
}

const KEY = 'cbid:display';
const DEFAULTS: DisplayPrefs = { textSize: 100, spacious: false, reduceMotion: false, theme: 'system' };

function read(): DisplayPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function applyPrefs(p: DisplayPrefs) {
  const root = document.documentElement;
  root.style.fontSize = p.textSize === 100 ? '' : `${p.textSize}%`;
  if (p.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', p.theme);
  document.body.classList.toggle('pref-spacious', p.spacious);
  document.body.classList.toggle('pref-reduce-motion', p.reduceMotion);
}

/** Per-device display preferences (text size, spacing, motion, theme). Not sensitive; stored locally. */
export function usePreferences() {
  const [prefs, setPrefs] = useState<DisplayPrefs>(read);
  useEffect(() => { applyPrefs(prefs); }, [prefs]);
  const update = useCallback((patch: Partial<DisplayPrefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...patch };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);
  return { prefs, update };
}

export const initialPrefs = read;
