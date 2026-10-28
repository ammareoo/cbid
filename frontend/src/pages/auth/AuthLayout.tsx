import type { ReactNode } from 'react';
import { Mail, MapPin, Phone } from 'lucide-react';
import { InstituteLogo, NetworkLogo } from '../../components/ui';
import { telHref, useBranding } from '../../hooks/misc';

/** Contact block shared by the sign-in pages and the app footer. */
export function ContactDetails({ compact }: { compact?: boolean }) {
  const b = useBranding();
  return (
    <address className={compact ? 'contact contact--compact' : 'contact'}>
      <span><MapPin aria-hidden="true" />{b.contact_address}</span>
      <span><Phone aria-hidden="true" /><a href={telHref(b.contact_phone)}>{b.contact_phone}</a></span>
      <span><Mail aria-hidden="true" /><a href={`mailto:${b.support_email}`}>{b.support_email}</a></span>
    </address>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  const b = useBranding();
  const site = b.website_url.replace(/^https?:\/\//, '');
  return (
    <div className="auth">
      {/* The form comes first in reading and focus order (and on phones); on wide screens the aside sits to its left. */}
      <main className="auth__main" id="main">
        <div className="auth__card">
          <div className="auth__card-body">
            <div className="auth__mobile-brand"><InstituteLogo height={56} alt="" /></div>
            {children}
          </div>
          <footer className="auth__foot" aria-label="Contact CBID Institute">
            <div className="auth__foot-org">
              <NetworkLogo height={28} alt={b.organisation_name} />
              <div className="auth__foot-org-copy">
                <p>
                  An initiative of {b.organisation_name}.{' '}
                  <a href={b.website_url} rel="noopener noreferrer">{site}</a>
                </p>
                <ContactDetails compact />
              </div>
            </div>
          </footer>
        </div>
      </main>
      <aside className="auth__aside" aria-label={`About ${b.institute_name}`}>
        <div className="auth__aside-inner">
          <div className="auth__brand">
            <div className="auth__brand-logo">
              <InstituteLogo fluid alt={`${b.institute_name}: Learn, Innovate & Implement`} />
            </div>
            <p className="auth__brand-tag">
              <span className="auth__brand-tag-text">
                Centre of Excellence of
                <br />
                {b.organisation_name}
              </span>
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
