import { useCallback, useEffect, useState } from 'react';

/*
 * Theme = an explicit user choice stamped on <html data-theme>, or the OS
 * preference when the user has not chosen. index.html stamps the stored choice
 * before first paint so the shell never flashes the wrong palette.
 */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'yw.theme';

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function resolveTheme(): Theme {
  const stamped = document.documentElement.getAttribute('data-theme');
  if (stamped === 'light' || stamped === 'dark') return stamped;
  return prefersDark() ? 'dark' : 'light';
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', onChange);
  };
}

/** Read-only view of the theme in force. Canvas renderers redraw when it changes. */
export function useResolvedTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(resolveTheme);
  useEffect(() => subscribe(() => setTheme(resolveTheme())), []);
  return theme;
}

/** Owns the choice. Mount once, in the app shell. */
export function useThemeToggle(): { theme: Theme; toggle: () => void } {
  const [theme, setThemeState] = useState<Theme>(resolveTheme);

  useEffect(() => subscribe(() => setThemeState(resolveTheme())), []);

  const toggle = useCallback(() => {
    const next: Theme = resolveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode — the choice simply does not survive a reload.
    }
    setThemeState(next);
  }, []);

  useEffect(() => {
    // Keep the stamp in sync when the user had no stored choice.
    if (readStoredTheme() === null) document.documentElement.removeAttribute('data-theme');
  }, []);

  return { theme, toggle };
}
