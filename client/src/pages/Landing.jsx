import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiCall } from '../config';
import { setStoredToken } from '../utils/authToken';
import { useAuth } from '../context/AuthContext';
import {
  Sparkles, Mic, Volume2, BookOpen, Users, Wand2,
  GitBranch, Shield, Music, Image, Archive,
  ChevronDown, Check, Star, Play, Headphones, MessageCircle,
  Sword, Heart, Ghost, Compass, BookMarked,
  Loader2, Feather
} from 'lucide-react';

// Google OAuth Client ID - Replace with your actual client ID
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const BASE_URL = import.meta.env.BASE_URL || '/storyteller/';

function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, loginWithGoogle, loading: authLoading, checkAuthStatus } = useAuth();
  const [showPricing, setShowPricing] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [showDevLogin, setShowDevLogin] = useState(false);
  const [devLoginLoading, setDevLoginLoading] = useState(false);
  const [devLoginError, setDevLoginError] = useState(null);
  const [devTokenInput, setDevTokenInput] = useState('');
  const [requiresSecureContext, setRequiresSecureContext] = useState(false);
  const [secureContextUrl, setSecureContextUrl] = useState('');
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const featuresRef = useRef(null);
  const pricingRef = useRef(null);
  const heroParticles = useMemo(() => (
    [...Array(20)].map((_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      animationDelay: `${Math.random() * 5}s`,
      animationDuration: `${3 + Math.random() * 4}s`,
      color: i % 3 === 0
        ? 'rgba(255, 111, 97, 0.4)'
        : i % 3 === 1
          ? 'rgba(106, 138, 130, 0.35)'
          : 'rgba(247, 244, 233, 0.25)'
    }))
  ), []);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShowDevLogin(params.get('dev') === '1');
  }, []);

  useEffect(() => {
    const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (!window.isSecureContext && !isLocalhost) {
      setRequiresSecureContext(true);
      setSecureContextUrl(window.location.href.replace(/^http:/, 'https:'));
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleReducedMotionChange = (event) => setPrefersReducedMotion(event.matches);
    setPrefersReducedMotion(reducedMotionQuery.matches);

    if (reducedMotionQuery.addEventListener) {
      reducedMotionQuery.addEventListener('change', handleReducedMotionChange);
      return () => reducedMotionQuery.removeEventListener('change', handleReducedMotionChange);
    }

    reducedMotionQuery.addListener(handleReducedMotionChange);
    return () => reducedMotionQuery.removeListener(handleReducedMotionChange);
  }, []);

  // Track Google API ready state
  const [googleReady, setGoogleReady] = useState(false);
  const [showGoogleButton, setShowGoogleButton] = useState(false);
  const googleInitialized = useRef(false);
  const googleButtonRef = useRef(null);

  // Load Google Sign-In
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) {
      console.log('[GoogleAuth] No client ID configured');
      return;
    }

    // Check if script already exists (e.g., hot reload)
    const existingScript = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existingScript) {
      console.log('[GoogleAuth] Script already loaded, initializing...');
      initializeGoogle();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.id = 'google-signin-script';

    script.onload = () => {
      console.log('[GoogleAuth] Script loaded successfully');
      initializeGoogle();
    };

    script.onerror = (error) => {
      console.error('[GoogleAuth] Failed to load Google Sign-In script:', error);
      setLoginError('Failed to load Google Sign-In. Please refresh the page.');
    };

    document.body.appendChild(script);

    return () => {
      // Only remove if we added it
      const scriptToRemove = document.getElementById('google-signin-script');
      if (scriptToRemove && scriptToRemove.parentNode) {
        scriptToRemove.parentNode.removeChild(scriptToRemove);
      }
    };
  }, []);

  const initializeGoogle = async () => {
    if (googleInitialized.current) {
      console.log('[GoogleAuth] Already initialized');
      setGoogleReady(true);
      return;
    }

    if (!window.google?.accounts?.id) {
      console.error('[GoogleAuth] Google accounts API not available');
      return;
    }

    try {
      // Initialize Google Sign-In
      // Using auto_select: false prevents automatic sign-in with cached credentials
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          console.log('[GoogleAuth] Received response');
          if (response.credential) {
            handleGoogleResponse(response);
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
        itp_support: true,
        use_fedcm_for_prompt: false  // Disable FedCM to avoid personalized UI
      });
      googleInitialized.current = true;
      setGoogleReady(true);
      console.log('[GoogleAuth] Initialized successfully');
    } catch (error) {
      console.error('[GoogleAuth] Initialization failed:', error);
      setLoginError('Failed to initialize Google Sign-In');
    }
  };

    const handleGoogleResponse = async (response) => {
      if (response.credential) {
        setLoginLoading(true);
        setLoginError(null);
        console.log('[GoogleAuth] Authenticating with server...');
        const result = await loginWithGoogle(response.credential);
      if (!result.success) {
        console.error('[GoogleAuth] Server auth failed:', result.error);
        setLoginError(result.error);
      } else {
        console.log('[GoogleAuth] Authentication successful');
      }
      setLoginLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    console.log('[GoogleAuth] Login button clicked, googleReady:', googleReady);

    if (requiresSecureContext) {
      setLoginError('Google Sign-In requires HTTPS on this domain. Switch to the secure URL to continue.');
      return;
    }

    if (!GOOGLE_CLIENT_ID) {
      console.log('[GoogleAuth] No client ID - entering demo mode');
      setLoginError('Google Sign-In is not configured.');
      return;
    }

    if (!googleReady || !window.google?.accounts?.id) {
      console.log('[GoogleAuth] Google API not ready, retrying initialization...');
      setLoginError('Google Sign-In is loading. Please try again in a moment.');
      if (window.google?.accounts?.id) {
        initializeGoogle();
      }
      return;
    }

    // Trigger the Google One Tap / account chooser popup directly
    console.log('[GoogleAuth] Triggering prompt...');
    setLoginError(null);
    window.google.accounts.id.prompt((notification) => {
      console.log('[GoogleAuth] Prompt notification:', notification.getMomentType());
      if (notification.isNotDisplayed()) {
        // Prompt couldn't be displayed - fall back to OAuth popup
        console.log('[GoogleAuth] Prompt not displayed, reason:', notification.getNotDisplayedReason());
        // Try OAuth 2.0 popup as fallback
        triggerOAuthPopup();
      } else if (notification.isSkippedMoment()) {
        console.log('[GoogleAuth] Prompt skipped, reason:', notification.getSkippedReason());
      } else if (notification.isDismissedMoment()) {
        console.log('[GoogleAuth] Prompt dismissed, reason:', notification.getDismissedReason());
      }
    });
  };

  // Fallback when One Tap is blocked - show Google's official button instead
  const triggerOAuthPopup = () => {
    // Show the Google-rendered button as fallback (works when One Tap is blocked)
    console.log('[GoogleAuth] One Tap blocked, showing Google button as fallback');
    setLoginLoading(false);
    setShowGoogleButton(true);
  };

  const handleDevLogin = async () => {
    const token = devTokenInput.trim();
    if (!token) {
      setDevLoginError('Dev token required.');
      return;
    }

    setDevLoginLoading(true);
    setDevLoginError(null);

    try {
      const response = await apiCall('/auth/dev-login', {
        method: 'POST',
        body: JSON.stringify({ token })
      });

      if (response.ok) {
        const data = await response.json();
        setStoredToken(data.token);
        await checkAuthStatus();
        navigate('/');
      } else {
        let errorMessage = 'Dev login failed.';
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {
          // Keep default message.
        }
        setDevLoginError(errorMessage);
      }
    } catch (error) {
      console.error('[DevLogin] Failed:', error);
      setDevLoginError('Dev login failed. Please try again.');
    } finally {
      setDevLoginLoading(false);
    }
  };

  // Render Google button when fallback is needed (One Tap blocked)
  useEffect(() => {
    if (showGoogleButton && googleReady && googleButtonRef.current && window.google?.accounts?.id) {
      console.log('[GoogleAuth] Rendering Google button as fallback');
      googleButtonRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(
        googleButtonRef.current,
        {
          type: 'standard',
          theme: 'filled_blue',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: 280
        }
      );
    }
  }, [showGoogleButton, googleReady]);

  const scrollToSection = (ref) => {
    ref.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Story type cards data
  const storyTypes = [
    {
      icon: Sparkles,
      title: "Mythic & Folklore",
      description: "Legends, gods, and hidden realms. Reimagine timeless myths or invent new ones from scratch.",
      color: "from-narrimo-sage/60 to-narrimo-coral/50"
    },
    {
      icon: Sword,
      title: "Epic Adventures",
      description: "Heroes, quests, and legendary journeys. From dragon-slaying knights to rogue pilots in distant galaxies.",
      color: "from-narrimo-coral/50 to-orange-500/40"
    },
    {
      icon: Ghost,
      title: "Thriller & Horror",
      description: "Suspenseful stories with adjustable intensity, from eerie mystery to full cinematic terror.",
      color: "from-slate-700/70 to-narrimo-midnight/80"
    },
    {
      icon: BookOpen,
      title: "Interactive Fiction",
      description: "Branching narratives where every choice reshapes the world. Multiple endings, rich characters, and replayable arcs.",
      color: "from-cyan-500/40 to-narrimo-sage/50"
    },
    {
      icon: Heart,
      title: "Romance & Drama",
      description: "Slow burns, high stakes, and intimate character arcs across eras and genres.",
      color: "from-rose-500/40 to-narrimo-coral/50"
    },
    {
      icon: Compass,
      title: "Mystery & Detective",
      description: "Puzzle-forward stories where you gather clues, interrogate suspects, and solve the case.",
      color: "from-emerald-500/40 to-narrimo-sage/60"
    }
  ];

  // Core features
  const features = [
    {
      icon: Mic,
      title: "Voice-First Design",
      description: "Speak naturally and shape stories in real time. Hands-free creation that works anywhere, any time."
    },
    {
      icon: Volume2,
      title: "Professional Narration",
      description: "Premium AI voices bring every character to life. Choose cinematic narrators, intimate whispers, or bold dramatic delivery."
    },
    {
      icon: GitBranch,
      title: "Choose Your Adventure",
      description: "Interactive branching narratives where your choices change the arc. Tap or speak your decisions."
    },
    {
      icon: BookMarked,
      title: "Read-Along Karaoke",
      description: "Synchronized text highlighting for clean read-along playback and deep scene review."
    },
    {
      icon: Wand2,
      title: "Author Style Inspiration",
      description: "Channel the rhythm and tone of iconic storytelling styles, with policy-aligned inspiration controls."
    },
    {
      icon: Image,
      title: "Visual Scene Mode",
      description: "AI-generated illustrations can accompany key moments for a cinematic storyboard feel."
    },
    {
      icon: Archive,
      title: "Living Library",
      description: "Every world, story, and branch saved. Re-listen, remix, or expand later."
    },
    {
      icon: Shield,
      title: "Content Controls",
      description: "Set intensity and safety boundaries per listener, with mature themes where permitted."
    }
  ];

  // Pricing tiers
  const pricingTiers = [
    {
      name: "Explorer",
      price: "$7.99",
      period: "/month",
      description: "For occasional story sparks",
      features: [
        "5 stories per month",
        "Up to 10 minutes each",
        "Standard voices",
        "Library access",
        "1 user profile"
      ],
      highlight: false,
      cta: "Start Exploring"
    },
    {
      name: "Creator",
      price: "$14.99",
      period: "/month",
      description: "Most popular for weekly creators",
      features: [
        "12 stories per month",
        "Up to 20 minutes each",
        "Premium voices",
        "Interactive branching",
        "Story Bible access",
        "2 user profiles",
        "Priority generation"
      ],
      highlight: true,
      cta: "Go Creator"
    },
    {
      name: "Studio",
      price: "$24.99",
      period: "/month",
      description: "For shared worlds and long arcs",
      features: [
        "25 stories per month",
        "Up to 30 minutes each",
        "All premium features",
        "Extended story length",
        "Custom voice cloning",
        "5 user profiles",
        "Offline downloads"
      ],
      highlight: false,
      cta: "Build a Studio"
    }
  ];

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-narrimo-midnight via-slate-950 to-black">
        <Loader2 className="w-12 h-12 text-narrimo-coral animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-narrimo-midnight via-slate-950 to-black text-white overflow-x-hidden">
      {/* Hero Section */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 py-20">
        {/* Subtle paper texture background */}
        <div className="absolute inset-0 paper-bg opacity-60 pointer-events-none" />

        {/* Floating particles with gradient colors */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {heroParticles.map((particle) => (
            <div
              key={particle.id}
              className={`absolute w-1 h-1 rounded-full landing-hero-particle ${prefersReducedMotion ? '' : 'animate-float'}`}
              style={{
                left: particle.left,
                top: particle.top,
                animationDelay: particle.animationDelay,
                animationDuration: particle.animationDuration,
                backgroundColor: particle.color
              }}
            />
          ))}
        </div>

        {/* Logo and headline */}
        <div className="relative z-10 text-center max-w-4xl mx-auto">
          <div className={`mb-8 landing-decorative-motion ${prefersReducedMotion ? '' : 'animate-float'}`}>
            <div className="relative inline-block">
              <img
                src={`${BASE_URL}assets/images/newlogo.png`}
                alt="Narrimo logo"
                className="h-56 md:h-64 w-auto mx-auto drop-shadow-2xl object-contain"
                style={{ filter: 'drop-shadow(0 0 30px rgba(255, 111, 97, 0.35))' }}
                onError={(e) => {
                  // Fallback to BookOpen icon if image fails
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'block';
                }}
              />
              <div style={{ display: 'none' }}>
                <BookOpen className="w-28 h-28 text-narrimo-coral mx-auto" />
              </div>
            </div>
          </div>

          {/* Logo already contains text "Narrimo" - text element removed to avoid duplication */}

          <p className="text-xl md:text-2xl text-narrimo-cream mb-4 font-light tracking-wide">
            Narrated worlds, endlessly customizable
          </p>

          <p className="text-lg text-slate-300 mb-10 max-w-2xl mx-auto leading-relaxed">
            Cinematic audio stories across every genre. Emulate author styles, branch your plot,
            and co-write in real time with a concierge that remembers your canon.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
            <button
              onClick={handleGoogleLogin}
              disabled={loginLoading}
              className="group flex items-center gap-3 px-8 py-4 bg-white text-gray-800 rounded-xl
                       font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300
                       hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loginLoading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <svg className="w-6 h-6" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              )}
              <span>Continue with Google</span>
            </button>

            <button
              onClick={() => navigate('/discover')}
              className="flex items-center gap-2 px-6 py-3 rounded-xl border border-white/20 text-slate-200
                       hover:border-narrimo-coral/60 hover:text-narrimo-coral transition-colors"
            >
              Browse free stories
            </button>

            <button
              onClick={() => scrollToSection(featuresRef)}
              className="flex items-center gap-2 px-6 py-3 text-slate-300 hover:text-narrimo-coral transition-colors"
            >
              <span>Learn more</span>
              <ChevronDown className={`w-5 h-5 landing-decorative-motion ${prefersReducedMotion ? '' : 'animate-bounce'}`} />
            </button>
          </div>

          {/* Fallback Google Sign-In button (rendered by Google API when One Tap is blocked) */}
          {showGoogleButton && (
            <div className="flex justify-center mb-4">
              <div ref={googleButtonRef} className="google-signin-button" />
            </div>
          )}

          {loginError && (
            <p className="text-red-400 text-sm mb-4 whitespace-pre-line">{loginError}</p>
          )}
          {requiresSecureContext && (
            <div className="text-amber-300 text-sm mb-4">
              Google Sign-In needs HTTPS. Open{' '}
              <a href={secureContextUrl} className="underline hover:text-amber-200">
                the secure Narrimo URL
              </a>
              {' '}to continue.
            </div>
          )}

          {showDevLogin && (
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-4">
              <input
                type="password"
                value={devTokenInput}
                onChange={(event) => setDevTokenInput(event.target.value)}
                placeholder="Dev token"
                className="w-64 px-4 py-2 rounded-lg bg-slate-900/80 text-slate-100 border border-slate-700
                         focus:outline-none focus:border-narrimo-coral/80 focus:ring-2 focus:ring-narrimo-coral/20"
              />
              <button
                onClick={handleDevLogin}
                disabled={loginLoading || devLoginLoading}
                className="group flex items-center gap-2 px-5 py-2 bg-slate-800/80 text-slate-100 rounded-lg
                         font-semibold text-sm border border-slate-700 hover:border-narrimo-coral/60 transition-all
                         hover:shadow-lg hover:shadow-narrimo-coral/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {devLoginLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Feather className="w-4 h-4 text-narrimo-sage" />
                )}
                <span>Dev Login</span>
              </button>
            </div>
          )}

          {devLoginError && (
            <p className="text-red-400 text-sm mb-4">{devLoginError}</p>
          )}

          {/* Trust indicators */}
          <div className="flex flex-wrap justify-center gap-6 text-slate-500 text-sm">
            <span className="flex items-center gap-1">
              <Check className="w-4 h-4 text-green-500" /> No credit card required
            </span>
            <span className="flex items-center gap-1">
              <Check className="w-4 h-4 text-green-500" /> Listen to free stories without a subscription
            </span>
            <span className="flex items-center gap-1">
              <Check className="w-4 h-4 text-green-500" /> Cancel anytime
            </span>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 landing-decorative-motion ${prefersReducedMotion ? '' : 'animate-bounce'}`}>
          <ChevronDown className="w-8 h-8 text-slate-500" />
        </div>
      </section>

      {/* Story Types Section */}
      <section className="py-20 px-6 bg-gradient-to-b from-slate-950 to-narrimo-midnight">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-4">
            <span className="gradient-text">Worlds Without Limits</span>
          </h2>
          <p className="text-slate-300 text-center mb-16 max-w-2xl mx-auto">
            Choose a genre, set the tone, and let Narrimo shape the arc.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {storyTypes.map((type, index) => (
              <div
                key={index}
                className="group relative p-6 bg-slate-800/50 rounded-2xl border border-slate-700
                         hover:border-narrimo-coral/60 transition-all duration-300 hover:-translate-y-1"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${type.color} opacity-0
                              group-hover:opacity-10 rounded-2xl transition-opacity duration-300`} />
                <type.icon className="w-10 h-10 text-narrimo-coral mb-4" />
                <h3 className="text-xl font-semibold mb-2 text-white">{type.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{type.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section ref={featuresRef} className="py-20 px-6 bg-narrimo-midnight">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-4">
            <span className="gradient-text">AI, Audio, and Living Worlds</span>
          </h2>
          <p className="text-slate-300 text-center mb-16 max-w-2xl mx-auto">
            A multi-agent system crafts narration, structure, and continuity with human-level pacing.
          </p>

          <div className="grid md:grid-cols-2 gap-8">
            {features.map((feature, index) => (
              <div
                key={index}
                className="flex gap-4 p-6 bg-slate-800/30 rounded-xl border border-slate-800
                         hover:border-slate-700 transition-colors"
              >
                <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-narrimo-coral/10 rounded-xl flex items-center justify-center">
                  <feature.icon className="w-6 h-6 text-narrimo-coral" />
                </div>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-2 text-white">{feature.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6 bg-gradient-to-b from-narrimo-midnight to-slate-950">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-16">
            <span className="gradient-text">From Spark to Story</span>
          </h2>

          <div className="space-y-12">
            {[
              {
                step: 1,
                title: "Start with Your Voice",
                description: "Tap and talk. Describe characters, mood, or genre, or just say 'surprise me'.",
                icon: Mic
              },
              {
                step: 2,
                title: "Watch the Arc Form",
                description: "Narrimo shapes a full story arc with characters, twists, and pacing tuned to your length and intensity.",
                icon: Wand2
              },
              {
                step: 3,
                title: "Listen & Steer",
                description: "Professional narration brings it to life. Choose branches or let the story unfold hands-free.",
                icon: Headphones
              },
              {
                step: 4,
                title: "Save Your Worlds",
                description: "Everything lands in your library. Re-listen, remix, or expand the canon later.",
                icon: Archive
              }
            ].map((item, index) => (
              <div key={index} className="flex gap-6 items-start">
                <div className="flex-shrink-0 w-16 h-16 bg-narrimo-coral/10 rounded-full flex items-center justify-center
                              border-2 border-narrimo-coral">
                  <span className="text-2xl font-bold text-narrimo-coral">{item.step}</span>
                </div>
                <div className="flex-1 pt-3">
                  <h3 className="text-xl font-semibold mb-2 text-white flex items-center gap-3">
                    {item.title}
                    <item.icon className="w-5 h-5 text-narrimo-coral" />
                  </h3>
                  <p className="text-slate-400 leading-relaxed">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Voice Agent Highlight */}
      <section className="py-20 px-6 bg-slate-950">
        <div className="max-w-5xl mx-auto">
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-8 md:p-12 border border-slate-700">
            <div className="flex flex-col md:flex-row gap-8 items-center">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-4">
                  <MessageCircle className="w-8 h-8 text-narrimo-coral" />
                  <span className="text-sm text-narrimo-coral font-semibold uppercase tracking-wide">
                    Real-Time Conversation
                  </span>
                </div>
                <h2 className="text-3xl font-bold mb-4 text-white">
                  Your Personal Story Concierge
                </h2>
                <p className="text-slate-300 mb-6 leading-relaxed">
                  No menus. No typing. Just natural conversation. Our voice agent understands context,
                  remembers your preferences, and helps you design the perfect story on the fly.
                </p>
                <p className="text-slate-400 italic">
                  "I want a story about a brave knight... but make it funny, and not too scary...
                  oh, and can there be a talking dog?"
                </p>
                <p className="text-narrimo-coral mt-4 font-medium">
                  "Perfect! I'll create a comedic medieval adventure with Sir Bumblesworth
                  and his wise-cracking canine companion, Biscuit. Ready to begin?"
                </p>
              </div>
              <div className="flex-shrink-0">
                <div className="w-48 h-48 bg-slate-800 rounded-full flex items-center justify-center
                              border-4 border-narrimo-coral/30 relative">
                  <BookOpen className={`w-20 h-20 text-narrimo-coral landing-decorative-motion ${prefersReducedMotion ? '' : 'animate-pulse'}`} />
                  <div className={`absolute inset-0 rounded-full border-4 border-narrimo-coral/20 landing-decorative-motion ${prefersReducedMotion ? '' : 'animate-ping'}`} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section ref={pricingRef} className="py-20 px-6 bg-gradient-to-b from-slate-950 to-slate-900">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-4">
            <span className="gradient-text">Choose Your Journey</span>
          </h2>
          <p className="text-slate-300 text-center mb-16 max-w-2xl mx-auto">
            Start free with one story. Upgrade when you're ready for more adventures.
          </p>

          <div className="grid md:grid-cols-3 gap-8">
            {pricingTiers.map((tier, index) => (
              <div
                key={index}
                className={`relative p-8 rounded-2xl border transition-all duration-300 hover:-translate-y-2
                          ${tier.highlight
                            ? 'bg-gradient-to-b from-narrimo-coral/10 to-slate-800 border-narrimo-coral shadow-xl shadow-narrimo-coral/20'
                            : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                          }`}
              >
                {tier.highlight && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-narrimo-coral
                                text-narrimo-midnight text-sm font-semibold rounded-full">
                    Most Popular
                  </div>
                )}

                <h3 className="text-2xl font-bold mb-2 text-white">{tier.name}</h3>
                <p className="text-slate-400 text-sm mb-4">{tier.description}</p>

                <div className="mb-6">
                  <span className="text-4xl font-bold text-narrimo-coral">{tier.price}</span>
                  <span className="text-slate-400">{tier.period}</span>
                </div>

                <ul className="space-y-3 mb-8">
                  {tier.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-slate-300 text-sm">
                      <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={handleGoogleLogin}
                  className={`w-full py-3 rounded-xl font-semibold transition-all duration-300
                            ${tier.highlight
                              ? 'bg-narrimo-coral text-narrimo-midnight hover:bg-[#ff8579]'
                              : 'bg-slate-700 text-white hover:bg-slate-600'
                            }`}
                >
                  {tier.cta}
                </button>
              </div>
            ))}
          </div>

          <p className="text-center text-slate-500 text-sm mt-8">
            Listen to free stories without a subscription. All plans include a 7-day free trial. Cancel anytime.
          </p>
        </div>
      </section>

      {/* Roadmap Preview */}
      <section className="py-20 px-6 bg-slate-900">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-4">
            <span className="gradient-text">Coming Soon</span>
          </h2>
          <p className="text-slate-300 mb-12 max-w-2xl mx-auto">
            We're just getting started. Here's what's on the horizon...
          </p>

          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { icon: Users, label: "Multiplayer Stories" },
              { icon: Music, label: "Custom Soundtracks" },
              { icon: Feather, label: "Write Your Own Endings" },
              { icon: Star, label: "Celebrity Voices" }
            ].map((item, index) => (
              <div key={index} className="p-4 bg-slate-800/30 rounded-xl border border-slate-800">
                <item.icon className="w-8 h-8 text-narrimo-sage/80 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 px-6 bg-gradient-to-b from-slate-900 to-slate-950">
        <div className="max-w-3xl mx-auto text-center">
          <BookOpen className="w-16 h-16 text-narrimo-coral mx-auto mb-6" />
          <h2 className="text-4xl font-bold mb-4 text-white">
            Ready to Build a World?
          </h2>
          <p className="text-slate-300 mb-8 text-lg">
            Your first listen is on us. No credit card required.
          </p>
          <button
            onClick={handleGoogleLogin}
            disabled={loginLoading}
            className="inline-flex items-center gap-3 px-10 py-5 bg-narrimo-coral text-narrimo-midnight
                     rounded-xl font-bold text-xl shadow-lg hover:shadow-xl transition-all
                     duration-300 hover:scale-105 hover:bg-[#ff8579] disabled:opacity-50"
          >
            {loginLoading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <Play className="w-6 h-6" />
            )}
            <span>Start Listening Free</span>
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 bg-slate-950 border-t border-slate-800">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
             <div className="flex items-center gap-2">
               <img
                 src={`${BASE_URL}assets/images/newlogo.png`}
                 alt="Narrimo logo"
                 className="h-16 md:h-20 w-auto object-contain"
               />
               <span className="font-bold text-white">Narrimo</span>
             </div>

            <div className="flex gap-6 text-slate-400 text-sm">
              <a href="#" className="hover:text-narrimo-coral transition-colors">Privacy</a>
              <a href="#" className="hover:text-narrimo-coral transition-colors">Terms</a>
              <a href="#" className="hover:text-narrimo-coral transition-colors">Support</a>
              <a href="#" className="hover:text-narrimo-coral transition-colors">Contact</a>
            </div>

            <p className="text-slate-500 text-sm">
              Made with AI and imagination
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
