import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Award, Bell, BookOpen, Building2, CalendarDays, GraduationCap, LayoutDashboard, Library, LogOut, Megaphone,
  ScrollText, Settings2, SlidersHorizontal, Users, Info,
} from 'lucide-react';
import { api } from '../api/client';
import { roleLabel, useAuth, useUser } from '../auth/AuthProvider';
import { InstituteLogo, NetworkLogo } from '../components/ui';
import { TeacherAvatar } from '../components/CourseMedia';
import { ContactDetails } from '../pages/auth/AuthLayout';
import { useBranding } from '../hooks/misc';
import { DisplaySettings } from '../components/DisplaySettings';
import { initials, setDisplayTimeZone } from '../utils/format';
import type { Role } from '../api/types';

interface NavItem { to: string; label: string; icon: ComponentType<{ 'aria-hidden'?: boolean }>; end?: boolean; badge?: 'unread' }
interface NavGroup { label?: string; items: NavItem[] }

const NAV: Record<Role, NavGroup[]> = {
  student: [
    { items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/courses', label: 'My courses', icon: BookOpen },
      { to: '/calendar', label: 'Calendar', icon: CalendarDays },
      { to: '/grades', label: 'Grades', icon: GraduationCap },
      { to: '/certificates', label: 'Certificates', icon: Award },
    ] },
    { label: 'Institute', items: [
      { to: '/catalogue', label: 'Course catalogue', icon: Library },
      { to: '/announcements', label: 'Announcements', icon: Megaphone },
      { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'unread' },
    ] },
  ],
  teacher: [
    { items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/courses', label: 'My courses', icon: BookOpen },
      { to: '/calendar', label: 'Calendar', icon: CalendarDays },
    ] },
    { label: 'Institute', items: [
      { to: '/announcements', label: 'Announcements', icon: Megaphone },
      { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'unread' },
    ] },
  ],
  admin: [
    { items: [
      { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/admin/users', label: 'People', icon: Users },
      { to: '/admin/courses', label: 'Courses', icon: BookOpen },
      { to: '/admin/structure', label: 'Programme areas & terms', icon: Building2 },
    ] },
    { label: 'Oversight', items: [
      { to: '/admin/announcements', label: 'Announcements', icon: Megaphone },
      { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
      { to: '/admin/settings', label: 'Settings & status', icon: Settings2 },
      { to: '/calendar', label: 'Calendar', icon: CalendarDays },
      { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'unread' },
    ] },
  ],
};

function useUnread() {
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

function TopNavigation() {
  const user = useUser();
  const unread = useUnread().data?.unread ?? 0;
  return (
    <nav className="top-nav" aria-label="Main">
      <div className="top-nav__inner">
        {NAV[user.role].map((g, gi) => (
          <div key={gi} className="top-nav__group">
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end}>
                <it.icon aria-hidden />
                <span>{it.label}</span>
                {it.badge === 'unread' && unread > 0 && (
                  <span className="badge badge--danger">{unread}<span className="sr-only"> unread</span></span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}

export function AppShell() {
  const user = useUser();
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [displayOpen, setDisplayOpen] = useState(false);
  const unread = useUnread().data?.unread ?? 0;
  const settings = useQuery({
    queryKey: ['settings', 'public'],
    queryFn: () => api.get<{ maintenance_banner?: string; institute_name?: string; organisation_name?: string }>('/settings/public'),
    staleTime: 5 * 60_000,
  });

  useEffect(() => { setDisplayTimeZone(user.timezone); }, [user.timezone]);

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
        <header className="topbar">
          <Link to="/" className="topbar__brand">
            <InstituteLogo height={40} alt="CBID Institute home" />
            <span className="topbar__identity">
              <span className="topbar__title">{settings.data?.institute_name ?? 'CBID Institute'}</span>
              <span className="topbar__role">{roleLabel[user.role]} workspace</span>
            </span>
          </Link>
          <span className="topbar__spacer" />
          <div style={{ position: 'relative' }}>
            <button type="button" className="icon-btn" aria-label="Display settings" aria-expanded={displayOpen}
              aria-controls="display-panel" onClick={() => setDisplayOpen((v) => !v)}>
              <SlidersHorizontal aria-hidden="true" />
            </button>
            {displayOpen && <DisplaySettings id="display-panel" onClose={() => setDisplayOpen(false)} />}
          </div>
          <Link to="/notifications" className="icon-btn" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
            <Bell aria-hidden="true" />
            {unread > 0 && <span className="dot-count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
          </Link>
          <Link to="/settings" className="topbar__account" aria-label={`Account settings for ${user.preferredName ?? user.fullName}`}>
            {user.role === 'teacher' ? <TeacherAvatar /> : <span className="avatar" aria-hidden="true">{initials(user.fullName)}</span>}
            <span className="topbar__account-name">{user.preferredName ?? user.fullName}</span>
          </Link>
          <button type="button" className="icon-btn" aria-label="Sign out"
            onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>
            <LogOut aria-hidden="true" />
          </button>
        </header>
        <TopNavigation />
        <main id="main" tabIndex={-1} className="main">
          <Outlet />
        </main>
        <AppFooter />
      </div>
    </div>
  );
}

function AppFooter() {
  const b = useBranding();
  return (
    <footer className="app-footer">
      <div className="app-footer__inner">
        <div className="app-footer__brand">
          <NetworkLogo height={44} />
          <p>{b.institute_name} is the Centre of Excellence of {b.organisation_name}.{' '}
            <a href={b.website_url} rel="noopener noreferrer">Visit {b.website_url.replace(/^https:\/\//, '')}</a></p>
        </div>
        <ContactDetails compact />
      </div>
    </footer>
  );
}

/** Standard padded content container used by most pages. */
export function Page({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <div className="content" style={wide ? { maxWidth: 1400 } : undefined}>{children}</div>;
}
