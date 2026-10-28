import { useEffect, useId, useRef, useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Award, BookOpen, Building2, CalendarDays, ChevronDown, GraduationCap, LayoutDashboard, Library, LogOut,
  ScrollText, Settings, Settings2, Users, Info,
} from 'lucide-react';
import { api } from '../api/client';
import { roleLabel, useAuth, useUser } from '../auth/AuthProvider';
import { InstituteLogo, NetworkLogo } from '../components/ui';
import { TeacherAvatar } from '../components/CourseMedia';
import { NotificationsMenu } from '../components/NotificationsMenu';
import { ContactDetails } from '../pages/auth/AuthLayout';
import { useBranding } from '../hooks/misc';
import { initials, setDisplayTimeZone } from '../utils/format';
import type { Role } from '../api/types';

interface NavItem { to: string; label: string; icon: ComponentType<{ 'aria-hidden'?: boolean }>; end?: boolean }
interface NavGroup { items: NavItem[] }

const NAV: Record<Role, NavGroup[]> = {
  student: [
    { items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/courses', label: 'My courses', icon: BookOpen },
      { to: '/calendar', label: 'Calendar', icon: CalendarDays },
      { to: '/grades', label: 'Grades', icon: GraduationCap },
      { to: '/certificates', label: 'Certificates', icon: Award },
      { to: '/catalogue', label: 'Catalogue', icon: Library },
    ] },
  ],
  teacher: [
    { items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/courses', label: 'My courses', icon: BookOpen },
      { to: '/calendar', label: 'Calendar', icon: CalendarDays },
    ] },
  ],
  admin: [
    { items: [
      { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/admin/users', label: 'People', icon: Users },
      { to: '/admin/courses', label: 'Courses', icon: BookOpen },
      { to: '/admin/structure', label: 'Programme areas', icon: Building2 },
      { to: '/admin/audit', label: 'Audit', icon: ScrollText },
      { to: '/admin/settings', label: 'Settings', icon: Settings2 },
      { to: '/calendar', label: 'Calendar', icon: CalendarDays },
    ] },
  ],
};

function TopNavigation() {
  const user = useUser();
  return (
    <nav className="top-nav" aria-label="Main">
      <div className="top-nav__inner">
        {NAV[user.role].flatMap((g) => g.items).map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end}>
            <span>{it.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function AccountMenu() {
  const user = useUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const name = user.preferredName ?? user.fullName;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="topbar__menu" ref={rootRef}>
      <button
        type="button"
        className="topbar__account"
        aria-label={`Account menu for ${name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {user.role === 'teacher' ? <TeacherAvatar /> : <span className="avatar topbar__avatar" aria-hidden="true">{initials(user.fullName)}</span>}
        <span className="topbar__account-meta">
          <span className="topbar__account-name">{name}</span>
          <span className="topbar__account-role">{roleLabel[user.role]}</span>
        </span>
        <ChevronDown className="topbar__chevron" aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} className="topbar__dropdown" role="menu" aria-label="Account">
          <div className="topbar__dropdown-head">
            <p className="topbar__dropdown-name">{name}</p>
            <p className="topbar__dropdown-email">{user.email}</p>
          </div>
          <Link role="menuitem" to="/settings" className="topbar__dropdown-item" onClick={() => setOpen(false)}>
            <Settings aria-hidden="true" />
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            className="topbar__dropdown-item topbar__dropdown-item--danger"
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            <LogOut aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const user = useUser();
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const settings = useQuery({
    queryKey: ['settings', 'public'],
    queryFn: () => api.get<{ maintenance_banner?: string; institute_name?: string; organisation_name?: string }>('/settings/public'),
    staleTime: 5 * 60_000,
  });

  useEffect(() => { setDisplayTimeZone(user.timezone); }, [user.timezone]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // On navigation (not the first load, so the skip link stays first in tab order),
  // move focus to the new page's heading so screen-reader users hear where they landed.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const t = setTimeout(() => {
      const h1 = document.querySelector<HTMLElement>('#main [data-page-heading]') ?? document.querySelector<HTMLElement>('#main h1');
      if (h1) h1.focus({ preventScroll: false });
      else document.getElementById('main')?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [location.pathname]);

  const banner = settings.data?.maintenance_banner;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to main content</a>
      <div className="main-col">
        {banner && <div className="banner" role="status"><Info aria-hidden="true" />{banner}</div>}
        <header className={`topbar${scrolled ? ' topbar--scrolled' : ''}`}>
          <Link to="/" className="topbar__brand">
            <InstituteLogo height={28} alt={settings.data?.institute_name ?? 'CBID Institute home'} />
          </Link>
          <TopNavigation />
          <div className="topbar__actions">
            <NotificationsMenu />
            <AccountMenu />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="main">
          <Outlet />
        </main>
        {location.pathname !== '/calendar' && <AppFooter />}
      </div>
    </div>
  );
}

function AppFooter() {
  const b = useBranding();
  return (
    <footer className="app-footer">
      <div className="app-footer__inner">
        <section className="app-footer__about" aria-label="About CBID Institute">
          <NetworkLogo height={40} />
          <p className="app-footer__lede">
            <strong>{b.institute_name}</strong> is the Centre of Excellence of {b.organisation_name}.
          </p>
        </section>
        <section className="app-footer__contact" aria-labelledby="footer-contact-h">
          <h2 id="footer-contact-h" className="app-footer__heading">Get in touch</h2>
          <ContactDetails compact />
        </section>
      </div>
    </footer>
  );
}

/** Standard padded content container used by most pages. */
export function Page({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <div className="content" style={wide ? { maxWidth: 1400 } : undefined}>{children}</div>;
}
