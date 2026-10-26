import type { Tx } from '../db/pool.js';

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

/** Public branding from system settings. Works without a session (trusted function, whitelisted keys only). */
export async function branding(tx: Tx): Promise<Branding> {
  const row = await tx.one<{ s: Partial<Branding> }>('SELECT app.public_settings() AS s');
  return { ...DEFAULT_BRANDING, ...row.s };
}

/** Plain-text email footer naming the institute and how to get help. */
export function emailFooter(b: Branding): string {
  return `\n--\n${b.institute_name}, ${b.organisation_name}\n${b.contact_address}\n${b.support_email} · ${b.contact_phone} · ${b.website_url}\n`;
}
