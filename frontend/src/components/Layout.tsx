import { Link, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { Button } from './ui';

export function Logo() {
  return (
    <span className="flex items-center gap-2 text-lg font-bold tracking-tight">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#4f46e5" />
        <rect x="6" y="7" width="6" height="18" rx="2" fill="#fff" opacity=".95" />
        <rect x="13" y="7" width="6" height="12" rx="2" fill="#fff" opacity=".75" />
        <rect x="20" y="7" width="6" height="15" rx="2" fill="#fff" opacity=".55" />
      </svg>
      RetroLive
    </span>
  );
}

function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="rounded-lg p-2 text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {dark ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
          <Link to="/" aria-label="RetroLive home" className="mr-auto">
            <Logo />
          </Link>
          {user ? (
            <>
              <Link
                to="/host"
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                My sessions
              </Link>
              <span className="hidden text-sm text-slate-500 sm:inline dark:text-slate-400">{user.name}</span>
              <Button
                variant="ghost"
                small
                data-testid="sign-out"
                onClick={() => {
                  logout();
                  navigate('/');
                }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <Link
              to="/login"
              data-testid="host-link"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Host a retro
            </Link>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="py-6 text-center text-xs text-slate-500 dark:text-slate-500">
        RetroLive: a live retrospective board for teams
      </footer>
    </div>
  );
}
