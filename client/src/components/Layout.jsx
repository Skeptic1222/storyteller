import { useEffect } from 'react';
import NavBar from './NavBar';
import { useTheme } from '../context/ThemeContext';

/**
 * Layout - Wrapper component for consistent page structure
 *
 * Features:
 * - Skip link for accessibility
 * - NavBar integration
 * - Theme-aware background
 * - Immersive mode for reading experiences
 */
function Layout({
  children,
  showNav = true,
  immersive = false,
  transparent = false,
  className = ''
}) {
  const { appTheme } = useTheme();

  // Apply theme to body for full-page coverage
  useEffect(() => {
    document.body.classList.remove('theme-dark', 'theme-light');
    document.body.classList.add(`theme-${appTheme.id}`);

    // Apply CSS variables from theme
    if (appTheme.cssVars) {
      Object.entries(appTheme.cssVars).forEach(([key, value]) => {
        document.documentElement.style.setProperty(key, value);
      });
    }
  }, [appTheme]);

  // Immersive mode - minimal chrome for reading
  if (immersive) {
    return (
      <div className={`min-h-screen bg-slate-950 ${className}`}>
        {/* Skip link for accessibility */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4
                     focus:z-[100] focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white
                     focus:rounded-lg focus:outline-none"
        >
          Skip to main content
        </a>

        {showNav && <NavBar immersive transparent={transparent} />}

        <main id="main-content" className="min-h-screen">
          {children}
        </main>
      </div>
    );
  }

  // Standard layout with full navigation
  return (
    <div className={`min-h-screen bg-slate-900 text-slate-100 ${className}`}>
      {/* Skip link for accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4
                   focus:z-[100] focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white
                   focus:rounded-lg focus:outline-none"
      >
        Skip to main content
      </a>

      {showNav && <NavBar transparent={transparent} />}

      <main id="main-content">
        {children}
      </main>
    </div>
  );
}

/**
 * PageContainer - Centered content container for standard pages
 */
export function PageContainer({ children, className = '', maxWidth = '2xl' }) {
  const maxWidthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '4xl': 'max-w-4xl',
    '6xl': 'max-w-6xl',
    full: 'max-w-full'
  };

  return (
    <div className={`mx-auto px-4 py-6 ${maxWidthClasses[maxWidth] || 'max-w-2xl'} ${className}`}>
      {children}
    </div>
  );
}

/**
 * PageHeader - Consistent page header with optional back button
 */
export function PageHeader({
  title,
  subtitle,
  backPath,
  actions,
  className = ''
}) {
  return (
    <header className={`mb-6 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {backPath && (
            <a
              href={backPath}
              className="p-2 rounded-lg hover:bg-slate-800 transition-colors"
              aria-label="Go back"
            >
              <svg
                className="w-5 h-5 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </a>
          )}
          <div>
            <h1 className="text-2xl font-bold text-slate-100">{title}</h1>
            {subtitle && (
              <p className="text-slate-400 text-sm mt-1">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * Card - Consistent card styling
 */
export function Card({ children, className = '', hover = false, padding = true }) {
  return (
    <div
      className={`
        bg-slate-800 border border-slate-700 rounded-xl
        ${padding ? 'p-4' : ''}
        ${hover ? 'hover:border-slate-600 hover:bg-slate-750 transition-colors cursor-pointer' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

export default Layout;
