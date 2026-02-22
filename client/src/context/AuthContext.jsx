import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { apiCall } from '../config';
import { getStoredToken, setStoredToken, clearStoredToken, isTokenExpired } from '../utils/authToken';
import { clearAllPreferences } from '../utils/userScopedStorage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState(null);
  const [usage, setUsage] = useState(null);

  // Check for existing session on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = useCallback(async () => {
    try {
      const token = getStoredToken();
      if (!token || isTokenExpired(token)) {
        clearStoredToken();
        setLoading(false);
        return;
      }

      const response = await apiCall('/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        setSubscription(data.subscription);
        setUsage(data.usage);
      } else {
        // Token invalid, clear it
        clearStoredToken();
        setUser(null);
        setSubscription(null);
        setUsage(null);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      clearStoredToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Google OAuth login
  const loginWithGoogle = useCallback(async (credential) => {
    try {
      setLoading(true);
      const response = await apiCall('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential })
      });

      if (response.ok) {
        const data = await response.json();
        setStoredToken(data.token);
        setUser(data.user);
        setSubscription(data.subscription);
        setUsage(data.usage);
        return { success: true, isNewUser: data.user.isNewUser };
      } else {
        const error = await response.json();
        return { success: false, error: error.message || error.error };
      }
    } catch (error) {
      console.error('Google login failed:', error);
      return { success: false, error: 'Login failed. Please try again.' };
    } finally {
      setLoading(false);
    }
  }, []);

  // Logout
  const logout = useCallback(async () => {
    try {
      const token = getStoredToken();
      if (token) {
        await apiCall('/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      clearAllPreferences();
      clearStoredToken();
      setUser(null);
      setSubscription(null);
      setUsage(null);
    }
  }, []);

  // Refresh usage data
  const refreshUsage = useCallback(async () => {
    try {
      const token = getStoredToken();
      if (!token) return;

      const response = await apiCall('/auth/usage', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setUsage({
          storiesGenerated: data.stories.used,
          storiesLimit: data.stories.limit,
          storiesRemaining: data.stories.remaining,
          minutesUsed: data.narration.minutesUsed,
          minutesLimit: data.narration.minutesLimit,
          minutesRemaining: data.narration.minutesRemaining
        });
      }
    } catch (error) {
      console.error('Failed to refresh usage:', error);
    }
  }, []);

  // Check if user can generate a story
  const canGenerateStory = useCallback(() => {
    if (!usage) return { allowed: true }; // Allow if no usage tracking
    if (user?.isAdmin) return { allowed: true };
    if (usage.storiesRemaining <= 0) {
      return {
        allowed: false,
        reason: 'Story limit reached for this month',
        remaining: 0
      };
    }
    return { allowed: true, remaining: usage.storiesRemaining };
  }, [usage, user]);

  // Check if user can generate narration
  const canGenerateNarration = useCallback((estimatedMinutes = 0) => {
    if (!usage) return { allowed: true }; // Allow if no usage tracking
    if (user?.isAdmin) return { allowed: true };

    const remaining = usage.minutesRemaining;

    if (remaining <= 0) {
      return {
        allowed: false,
        reason: 'Narration minutes exhausted for this month',
        remaining: 0
      };
    }

    if (estimatedMinutes > remaining) {
      return {
        allowed: true,
        partial: true,
        reason: `Only ${remaining.toFixed(1)} minutes remaining`,
        remaining
      };
    }

    return { allowed: true, remaining };
  }, [usage, user]);

  // Get auth header for API calls
  const getAuthHeader = useCallback(() => {
    const token = getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    subscription,
    usage,
    isAuthenticated: !!user,
    isAdmin: user?.isAdmin || false,
    loginWithGoogle,
    logout,
    checkAuthStatus,
    refreshUsage,
    canGenerateStory,
    canGenerateNarration,
    getAuthHeader
  }), [user, loading, subscription, usage, loginWithGoogle, logout, checkAuthStatus, refreshUsage, canGenerateStory, canGenerateNarration, getAuthHeader]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
