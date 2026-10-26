import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} · CBID Institute`;
  }, [title]);
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** Ticks every `ms` — used for live countdowns. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Moves focus to the element on mount (page headings after navigation). */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  return ref;
}

export interface Branding {
  institute_name: string;
  organisation_name: string;
  support_email: string;
  contact_phone: string;
  contact_address: string;
  website_url: string;
}

export const DEFAULT_BRANDING: Branding = {
  institute_name: 'CBID Institute',
  organisation_name: 'CBID Network PK Sindh',
  support_email: 'info@cbidnetwork.org',
  contact_phone: '+92 21 34155705',
  contact_address: 'B-52/1, Block 13-D/1, Jamali Road, Gulshan-e-Iqbal, Karachi',
  website_url: 'https://cbidnetwork.org',
};

/** Public institute details (name and contact) from the administrator's settings; works before sign-in. */
export function useBranding(): Branding {
  const q = useQuery({
    queryKey: ['branding'],
    queryFn: () => api.get<Branding>('/branding'),
    staleTime: 10 * 60_000,
    retry: false,
  });
  return { ...DEFAULT_BRANDING, ...q.data };
}

/** tel: link target from a display phone number. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`;
