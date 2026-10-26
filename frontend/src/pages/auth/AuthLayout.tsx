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
  return (
    <div className="auth">
      {/* The form comes first in reading and focus order (and on phones); on wide screens the aside sits to its left. */}
      <main className="auth__main" id="main">
        <div className="auth__card">
          <div className="auth__mobile-brand"><InstituteLogo height={56} alt="" /></div>
          {children}
        </div>
      </main>
      <aside className="auth__aside" aria-label={`About ${b.institute_name}`}>
        <InstituteLogo height={72} alt={`${b.institute_name}: Learn, Innovate & Implement`} />
        <div className="stack">
          <p className="eyebrow eyebrow--sign">Centre of Excellence of {b.organisation_name}</p>
          <h2 style={{ fontSize: 'var(--text-3xl)' }}>Learn, innovate and implement inclusion.</h2>
          <p>
            Training for persons with disabilities and their families, organisations of persons with disabilities,
            employers, educators and government. Study online, join workshops, and take your final assessment at our
            Karachi centre.
          </p>
        </div>
        <div className="sign" aria-hidden="true">
          <div className="sign__head"><span>Your route to a certificate</span></div>
          <ol>
            {['Study online at your own pace', 'Practise with feedback from your trainer', 'Take your assessment onsite in Karachi', 'Receive a certificate anyone can verify'].map((t, i) => (
              <li key={t}><div className="sign__row"><span className="sign__num">{i + 1}</span><span className="sign__title">{t}</span><span /></div></li>
            ))}
          </ol>
        </div>
        <div className="auth__org">
          <NetworkLogo height={52} />
          <div className="stack-sm">
            <p>
              An initiative of {b.organisation_name}: communities creating inclusive futures.{' '}
              <a href={b.website_url} rel="noopener noreferrer">{b.website_url.replace(/^https:\/\//, '')}</a>
            </p>
            <ContactDetails compact />
          </div>
        </div>
      </aside>
    </div>
  );
}
