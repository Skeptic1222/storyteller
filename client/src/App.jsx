import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Landing from './pages/Landing';
import Story from './pages/Story';
import Storytime from './pages/Storytime';
import Configure from './pages/Configure';
import Library from './pages/Library';
import Reader from './pages/Reader';
import Admin from './pages/Admin';
import Subscription from './pages/Subscription';
import Settings from './pages/Settings';
import { SocketProvider } from './context/SocketContext';
import { AudioProvider } from './context/AudioContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';

// Wrapper to show Landing for unauthenticated users, Home for authenticated
function RootRoute() {
  const { isAuthenticated, loading } = useAuth();

  // Show nothing while checking auth status
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-golden-400 border-t-transparent rounded-full animate-spin" />
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

function App() {
  // Wake lock is handled by individual pages that need it (Home, Story, Storytime)
  // Do NOT enable wake lock globally as it causes screen dimming issues

  return (
    <ErrorBoundary fallbackMessage="The storyteller encountered an unexpected error. Your story progress is saved - please try again.">
      <AuthProvider>
        <SocketProvider>
          <AudioProvider>
            <div className="min-h-screen bg-gradient-to-b from-night-900 via-night-950 to-black stars-bg">
              <Routes>
                <Route path="/" element={<RootRoute />} />
                <Route path="/welcome" element={<Landing />} />
                <Route path="/storytime/:sessionId" element={<Storytime />} />
                <Route path="/story/:sessionId" element={<Story />} />
                <Route path="/configure" element={<Configure />} />
                <Route path="/configure/:sessionId" element={<Configure />} />
                <Route path="/library" element={<Library />} />
                <Route path="/reader/:storyId" element={<Reader />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/subscription" element={<Subscription />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </div>
          </AudioProvider>
        </SocketProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
