import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  User, LogOut, Settings, CreditCard, Shield,
  ChevronDown, BookOpen, Sparkles
} from 'lucide-react';

function UserProfile() {
  const navigate = useNavigate();
  const { user, subscription, usage, isAdmin, logout, isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isAuthenticated || !user) {
    return (
      <button
        onClick={() => navigate('/welcome')}
        className="flex items-center gap-2 px-4 py-2 bg-golden-400/10 hover:bg-golden-400/20
                   rounded-lg text-golden-400 transition-colors text-sm"
      >
        <User className="w-4 h-4" />
        <span>Sign In</span>
      </button>
    );
  }

  const handleLogout = async () => {
    setIsOpen(false);
    await logout();
    navigate('/welcome');
  };

  // Calculate usage percentages
  const storiesPercent = usage ? (usage.storiesGenerated / usage.storiesLimit) * 100 : 0;
  const minutesPercent = usage ? (usage.minutesUsed / usage.minutesLimit) * 100 : 0;

  // Get tier badge color
  const tierColors = {
    free: 'bg-gray-500',
    dreamer: 'bg-purple-500',
    storyteller: 'bg-golden-400',
    family: 'bg-emerald-500',
    admin: 'bg-red-500'
  };

  const tierBadgeColor = tierColors[subscription?.tier] || 'bg-gray-500';

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Profile Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 p-1 rounded-full hover:bg-night-800/50 transition-colors"
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.displayName}
            className="w-9 h-9 rounded-full border-2 border-golden-400/50"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-golden-400/20 flex items-center justify-center border-2 border-golden-400/50">
            <User className="w-5 h-5 text-golden-400" />
          </div>
        )}
        <ChevronDown className={`w-4 h-4 text-night-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-night-800 rounded-xl border border-night-700
                       shadow-xl z-50 overflow-hidden animate-fadeIn">
          {/* User Info Header */}
          <div className="p-4 border-b border-night-700 bg-night-800/50">
            <div className="flex items-center gap-3">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.displayName}
                  className="w-12 h-12 rounded-full"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-golden-400/20 flex items-center justify-center">
                  <User className="w-6 h-6 text-golden-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{user.displayName}</p>
                <p className="text-sm text-night-400 truncate">{user.email}</p>
              </div>
            </div>

            {/* Subscription Badge */}
            <div className="mt-3 flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold text-white ${tierBadgeColor}`}>
                {subscription?.tier?.toUpperCase() || 'FREE'}
              </span>
              {isAdmin && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500 text-white flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  ADMIN
                </span>
              )}
            </div>
          </div>

          {/* Usage Stats */}
          {usage && (
            <div className="p-4 border-b border-night-700">
              <p className="text-xs text-night-400 mb-3 uppercase tracking-wide">This Month's Usage</p>

              {/* Stories */}
              <div className="mb-3">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-night-300 flex items-center gap-1">
                    <BookOpen className="w-3 h-3" />
                    Stories
                  </span>
                  <span className="text-night-400">
                    {usage.storiesGenerated} / {usage.storiesLimit}
                  </span>
                </div>
                <div className="h-1.5 bg-night-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      storiesPercent >= 90 ? 'bg-red-500' :
                      storiesPercent >= 70 ? 'bg-yellow-500' : 'bg-golden-400'
                    }`}
                    style={{ width: `${Math.min(100, storiesPercent)}%` }}
                  />
                </div>
              </div>

              {/* Narration Minutes */}
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-night-300 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Narration
                  </span>
                  <span className="text-night-400">
                    {usage.minutesUsed?.toFixed(1)} / {usage.minutesLimit} min
                  </span>
                </div>
                <div className="h-1.5 bg-night-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      minutesPercent >= 90 ? 'bg-red-500' :
                      minutesPercent >= 70 ? 'bg-yellow-500' : 'bg-emerald-400'
                    }`}
                    style={{ width: `${Math.min(100, minutesPercent)}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Menu Items */}
          <div className="py-2">
            <button
              onClick={() => { setIsOpen(false); navigate('/library'); }}
              className="w-full px-4 py-2 flex items-center gap-3 text-night-300 hover:text-white
                         hover:bg-night-700/50 transition-colors text-left"
            >
              <BookOpen className="w-4 h-4" />
              <span>My Library</span>
            </button>

            <button
              onClick={() => { setIsOpen(false); navigate('/subscription'); }}
              className="w-full px-4 py-2 flex items-center gap-3 text-night-300 hover:text-white
                         hover:bg-night-700/50 transition-colors text-left"
            >
              <CreditCard className="w-4 h-4" />
              <span>Subscription</span>
            </button>

            <button
              onClick={() => { setIsOpen(false); navigate('/settings'); }}
              className="w-full px-4 py-2 flex items-center gap-3 text-night-300 hover:text-white
                         hover:bg-night-700/50 transition-colors text-left"
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>

            {isAdmin && (
              <button
                onClick={() => { setIsOpen(false); navigate('/admin'); }}
                className="w-full px-4 py-2 flex items-center gap-3 text-red-400 hover:text-red-300
                           hover:bg-night-700/50 transition-colors text-left"
              >
                <Shield className="w-4 h-4" />
                <span>Admin Panel</span>
              </button>
            )}
          </div>

          {/* Logout */}
          <div className="p-2 border-t border-night-700">
            <button
              onClick={handleLogout}
              className="w-full px-4 py-2 flex items-center gap-3 text-night-400 hover:text-white
                         hover:bg-night-700/50 rounded-lg transition-colors text-left"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserProfile;
