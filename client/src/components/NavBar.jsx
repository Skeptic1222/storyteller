import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import UserProfile from './UserProfile';
import { useAuth } from '../context/AuthContext';

const BASE_URL = import.meta.env.BASE_URL || '/storyteller/';
const LOGO_SRC = `${BASE_URL}assets/images/newlogo.png`;

function NavBar({ immersive = false, transparent = false }) {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = isAuthenticated
    ? [
      { path: '/configure', label: 'Create Story' },
      { path: '/story-bible', label: 'Story Bible' },
      { path: '/library', label: 'Library' }
    ]
    : [
      { path: '/discover', label: 'Library' },
      { path: '/welcome', label: 'Sign In' }
    ];

  const handleScroll = useCallback(() => {
    const currentScrollY = window.scrollY;
    const scrollThreshold = 50;

    if (currentScrollY < scrollThreshold) {
      setIsVisible(true);
      setLastScrollY(currentScrollY);
      return;
    }

    if (currentScrollY > lastScrollY + 10) {
      setIsVisible(false);
      setIsMobileMenuOpen(false);
    } else if (currentScrollY < lastScrollY - 10) {
      setIsVisible(true);
    }

    setLastScrollY(currentScrollY);
  }, [lastScrollY]);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const renderNavLink = ({ path, label, isHash }) => {
    const className = `px-4 py-2 rounded-full text-sm font-medium transition-colors ` +
      (isActive(path)
        ? 'text-narrimo-cream bg-white/10'
        : 'text-slate-200 hover:text-white hover:bg-white/10');

    if (isHash) {
      return (
        <a key={label} href={`${BASE_URL.replace(/\/$/, '')}${path}`} className={className}>
          {label}
        </a>
      );
    }

    return (
      <Link key={label} to={path} className={className}>
        {label}
      </Link>
    );
  };

  if (immersive) {
    return (
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-transform duration-300 ${
        isVisible ? 'translate-y-0' : '-translate-y-full'
      }`}
      >
        <div className="flex items-center justify-between px-4 py-3 bg-[#0A2342]/85 backdrop-blur-md">
          <Link to="/" className="flex items-center gap-2" aria-label="Narrimo home">
            <img src={LOGO_SRC} alt="Narrimo logo" className="h-14 md:h-16 w-auto object-contain" />
          </Link>
          <UserProfile />
        </div>
      </nav>
    );
  }

  return (
    <>
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-transform duration-300 ${
        isVisible ? 'translate-y-0' : '-translate-y-full'
      } ${transparent ? '' : 'bg-[#0A2342]/90 backdrop-blur-md border-b border-white/10'}`}
      >
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between h-24">
            <Link to="/" className="flex items-center gap-3" aria-label="Narrimo home">
              <img src={LOGO_SRC} alt="Narrimo logo" className="h-14 md:h-16 w-auto object-contain" />
            </Link>

            <div className="hidden lg:flex items-center gap-2">
              {navItems.map(renderNavLink)}
            </div>

            <div className="flex items-center gap-3">
              <Link
                to={isAuthenticated ? '/configure' : '/welcome'}
                className="hidden md:inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold
                           bg-narrimo-coral text-white shadow-lg shadow-[#FF6F61]/30 hover:bg-[#ff867a]"
              >
                {isAuthenticated ? 'Start a Story' : 'Sign In'}
              </Link>
              <UserProfile />
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="lg:hidden p-2 rounded-full text-slate-200 hover:text-white hover:bg-white/10"
                aria-label="Toggle menu"
                aria-expanded={isMobileMenuOpen}
              >
                {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {isMobileMenuOpen && (
          <div className="lg:hidden border-t border-white/10 bg-[#0A2342]/95 backdrop-blur-md">
            <div className="px-4 py-3 flex flex-col gap-2">
              {navItems.map((item) => (
                <div key={item.label}>{renderNavLink(item)}</div>
              ))}
              <Link
                to={isAuthenticated ? '/configure' : '/welcome'}
                className="mt-2 inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold
                           bg-narrimo-coral text-white shadow-lg shadow-[#FF6F61]/30"
              >
                {isAuthenticated ? 'Start a Story' : 'Sign In'}
              </Link>
            </div>
          </div>
        )}
      </nav>
      <div className="h-24" />
    </>
  );
}

export default NavBar;
