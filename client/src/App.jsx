import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { SocketProvider } from './context/SocketContext';
import { AudioProvider } from './context/AudioContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import ErrorBoundary from './components/ErrorBoundary';

// Eagerly load critical pages (landing, home)
import Home from './pages/Home';
import Landing from './pages/Landing';

// Lazy load all other pages for code splitting
const Story = lazy(() => import('./pages/Story'));
const Storytime = lazy(() => import('./pages/Storytime'));
const Configure = lazy(() => import('./pages/Configure'));
const Library = lazy(() => import('./pages/Library'));
const StoryBible = lazy(() => import('./pages/StoryBible'));
const Reader = lazy(() => import('./pages/Reader'));
const Discover = lazy(() => import('./pages/Discover'));
const SharedStory = lazy(() => import('./pages/SharedStory'));
const Admin = lazy(() => import('./pages/Admin'));
const Subscription = lazy(() => import('./pages/Subscription'));
const Settings = lazy(() => import('./pages/Settings'));
// DnD Campaign pages removed - migrated to GameMaster (2026-01-08)

// Loading spinner for lazy-loaded pages
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-3 border-narrimo-coral border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-sm">Loading...</p>
      </div>
    </div>
  );
}

// Wrapper to show Landing for unauthenticated users, Home for authenticated
function RootRoute() {
  const { isAuthenticated, loading } = useAuth();

  // Show nothing while checking auth status
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-narrimo-coral border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Show landing page for unauthenticated users
  if (!isAuthenticated) {
    return <Landing />;
  }

  // Show home for authenticated users
  return <Home />;
}

function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-narrimo-coral border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/welcome" replace />;
  }

  return children;
}

function App() {
  // Wake lock is handled by individual pages that need it (Home, Story, Storytime)
  // Do NOT enable wake lock globally as it causes screen dimming issues

  return (
    <ErrorBoundary fallbackMessage="Narrimo hit an unexpected error. Your story progress is saved - please try again.">
      <AuthProvider>
        <ThemeProvider>
          <SocketProvider>
            <AudioProvider>
              <div className="min-h-screen bg-gradient-to-b from-narrimo-midnight via-slate-950 to-black">
                <Suspense fallback={<PageLoader />}>
                  <Routes>
                    <Route path="/" element={<RootRoute />} />
                    <Route path="/welcome" element={<Landing />} />
                    <Route path="/discover" element={<Discover />} />
                    <Route path="/shared/:shareCode" element={<SharedStory />} />
                    <Route path="/storytime/:sessionId" element={<RequireAuth><Storytime /></RequireAuth>} />
                    <Route path="/story/:sessionId" element={<RequireAuth><Story /></RequireAuth>} />
                    <Route path="/configure" element={<RequireAuth><Configure /></RequireAuth>} />
                    <Route path="/configure/:sessionId" element={<RequireAuth><Configure /></RequireAuth>} />
                    <Route path="/library" element={<RequireAuth><Library /></RequireAuth>} />
                    <Route path="/story-bible" element={<RequireAuth><StoryBible /></RequireAuth>} />
                    <Route path="/reader/:storyId" element={<RequireAuth><Reader /></RequireAuth>} />
                    <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
                    <Route path="/subscription" element={<RequireAuth><Subscription /></RequireAuth>} />
                    <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
                  </Routes>
                </Suspense>
              </div>
            </AudioProvider>
          </SocketProvider>
        </ThemeProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
