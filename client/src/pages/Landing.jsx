import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Moon, Sparkles, Mic, Volume2, BookOpen, Users, Wand2,
  GitBranch, Shield, Clock, Palette, Music, Image, Archive,
  ChevronDown, Check, Star, Play, Headphones, MessageCircle,
  Gamepad2, Baby, Sword, Heart, Ghost, Compass, BookMarked,
  ArrowRight, Loader2
} from 'lucide-react';

// Google OAuth Client ID - Replace with your actual client ID
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, loginWithGoogle, loading: authLoading } = useAuth();
  const [showPricing, setShowPricing] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const featuresRef = useRef(null);
  const pricingRef = useRef(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

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

  const initializeGoogle = () => {
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
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          console.log('[GoogleAuth] Received response');
          if (response.credential) {
            handleGoogleResponse(response);
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true
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

    if (!GOOGLE_CLIENT_ID) {
      // Demo mode - skip auth for testing (no Google Client ID configured)
      console.log('[GoogleAuth] No client ID - entering demo mode');
      navigate('/');
      return;
    }

    if (!googleReady || !window.google?.accounts?.id) {
      console.log('[GoogleAuth] Google API not ready, retrying initialization...');
      setLoginError('Google Sign-In is loading. Please try again in a moment.');
      // Try to initialize again
      if (window.google?.accounts?.id) {
        initializeGoogle();
      }
      return;
    }

    try {
      console.log('[GoogleAuth] Triggering Google prompt...');
      window.google.accounts.id.prompt((notification) => {
        console.log('[GoogleAuth] Prompt notification:', notification.getMomentType());
        if (notification.isNotDisplayed()) {
          const reason = notification.getNotDisplayedReason();
          console.log('[GoogleAuth] Prompt not displayed:', reason);
          // Show fallback button for common issues
          if (reason === 'opt_out_or_no_session' || reason === 'suppressed_by_user') {
            setShowGoogleButton(true);
            setLoginError(null); // Clear error, we have a fallback
          } else {
            setLoginError('Google Sign-In unavailable. Please try the button below.');
            setShowGoogleButton(true);
          }
        }
        if (notification.isSkippedMoment()) {
          console.log('[GoogleAuth] Prompt skipped:', notification.getSkippedReason());
          setShowGoogleButton(true);
        }
      });
    } catch (error) {
      console.error('[GoogleAuth] Prompt failed:', error);
      setLoginError('Failed to open Google Sign-In. Please try again.');
      setShowGoogleButton(true);
    }
  };

  // Render Google button when fallback is needed
  useEffect(() => {
    if (showGoogleButton && googleReady && googleButtonRef.current && window.google?.accounts?.id) {
      console.log('[GoogleAuth] Rendering fallback button');
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
      icon: Baby,
      title: "Bedtime Tales",
      description: "Gentle, calming stories designed to ease children (and adults) into peaceful sleep. Soft narration, ambient sounds, and dreamy adventures.",
      color: "from-purple-500 to-indigo-600"
    },
    {
      icon: Sword,
      title: "Epic Adventures",
      description: "Heroes, quests, and legendary journeys. From dragon-slaying knights to space explorers charting unknown galaxies.",
      color: "from-orange-500 to-red-600"
    },
    {
      icon: Ghost,
      title: "Spooky Stories",
      description: "Thrilling tales with just the right amount of suspense. Adjustable intensity from 'mildly mysterious' to 'edge of your seat'.",
      color: "from-gray-600 to-purple-800"
    },
    {
      icon: Gamepad2,
      title: "D&D Campaigns",
      description: "Full tabletop RPG experiences narrated by AI. Create characters, roll dice, explore dungeons, and make choices that matter.",
      color: "from-red-600 to-yellow-500"
    },
    {
      icon: Heart,
      title: "Romance & Drama",
      description: "Heartwarming tales of love, friendship, and human connection. From meet-cutes to sweeping period dramas.",
      color: "from-pink-500 to-rose-600"
    },
    {
      icon: Compass,
      title: "Mystery & Detective",
      description: "Whodunits and detective stories where you gather clues and solve the case. Perfect for puzzle lovers.",
      color: "from-emerald-600 to-teal-700"
    }
  ];

  // Core features
  const features = [
    {
      icon: Mic,
      title: "Voice-First Design",
      description: "Just speak naturally. Our real-time conversation agent understands your story preferences without touching your phone. Perfect for lying in bed."
    },
    {
      icon: Volume2,
      title: "Professional Narration",
      description: "Premium AI voices from ElevenLabs bring every character to life. Choose from dozens of narrator styles - from soothing bedtime tones to dramatic storytellers."
    },
    {
      icon: GitBranch,
      title: "Choose Your Adventure",
      description: "Interactive branching narratives where your choices shape the story. Voice-activated or tap-to-select decision points throughout."
    },
    {
      icon: BookMarked,
      title: "Read-Along Karaoke",
      description: "Follow along with synchronized text highlighting as the story is narrated. Perfect for improving reading skills or following complex plots."
    },
    {
      icon: Wand2,
      title: "Author Styles",
      description: "Stories crafted in the style of your favorite authors - Tolkien's epic prose, Rowling's whimsy, King's suspense, or Seuss's playful rhymes."
    },
    {
      icon: Image,
      title: "Picture Book Mode",
      description: "AI-generated illustrations accompany each scene, creating a visual storybook experience. Export as a digital keepsake."
    },
    {
      icon: Archive,
      title: "Story Library",
      description: "Your personal archive of every story ever told. Re-listen anytime, share favorites, or continue branching stories where you left off."
    },
    {
      icon: Shield,
      title: "Content Controls",
      description: "Fine-grained safety settings for every listener. Control intensity levels for suspense, romance, and action. Kid-safe defaults with adult options."
    }
  ];

  // Pricing tiers
  const pricingTiers = [
    {
      name: "Dreamer",
      price: "$7.99",
      period: "/month",
      description: "Perfect for occasional storytelling",
      features: [
        "5 stories per month",
        "Up to 10 minutes each",
        "Standard voices",
        "Story library access",
        "1 user profile"
      ],
      highlight: false,
      cta: "Start Dreaming"
    },
    {
      name: "Storyteller",
      price: "$14.99",
      period: "/month",
      description: "Most popular for families",
      features: [
        "12 stories per month",
        "Up to 20 minutes each",
        "Premium voices",
        "Choose Your Adventure",
        "Picture Book mode",
        "2 user profiles",
        "Priority generation"
      ],
      highlight: true,
      cta: "Become a Storyteller"
    },
    {
      name: "Family",
      price: "$24.99",
      period: "/month",
      description: "Unlimited imagination for everyone",
      features: [
        "25 stories per month",
        "Up to 30 minutes each",
        "All premium features",
        "D&D Campaign mode",
        "Custom voice cloning",
        "5 user profiles",
        "Offline downloads"
      ],
      highlight: false,
      cta: "Start Family Plan"
    }
  ];

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-night-900 via-night-950 to-black">
        <Loader2 className="w-12 h-12 text-golden-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-night-900 via-night-950 to-black text-white overflow-x-hidden">
      {/* Hero Section */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 py-20">
        {/* Animated stars background */}
        <div className="absolute inset-0 stars-bg opacity-60 pointer-events-none" />

        {/* Floating particles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute w-1 h-1 bg-golden-400/30 rounded-full animate-float"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 5}s`,
                animationDuration: `${3 + Math.random() * 4}s`
              }}
            />
          ))}
        </div>

        {/* Logo and headline */}
        <div className="relative z-10 text-center max-w-4xl mx-auto">
          <div className="mb-8 animate-float">
            <div className="relative inline-block">
              <Moon className="w-28 h-28 text-golden-400 mx-auto" />
              <Sparkles className="w-8 h-8 text-golden-400 absolute -top-2 -right-2 animate-twinkle" />
              <Sparkles className="w-5 h-5 text-golden-300 absolute bottom-4 -left-4 animate-twinkle" style={{ animationDelay: '1s' }} />
            </div>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-6">
            <span className="gradient-text">Storyteller</span>
          </h1>

          <p className="text-xl md:text-2xl text-night-200 mb-4 font-light">
            Where Every Night Becomes an Adventure
          </p>

          <p className="text-lg text-night-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            AI-powered personalized audio stories with professional narration.
            Just speak your wishes into the night, and watch as unique tales
            unfold - perfectly crafted for bedtime, road trips, or quiet moments.
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
              onClick={() => scrollToSection(featuresRef)}
              className="flex items-center gap-2 px-6 py-3 text-night-300 hover:text-golden-400 transition-colors"
            >
              <span>Learn more</span>
              <ChevronDown className="w-5 h-5 animate-bounce" />
            </button>
          </div>

          {loginError && (
            <p className="text-red-400 text-sm mb-4">{loginError}</p>
          )}

          {/* Fallback Google Sign-In button (rendered by Google API) */}
          {showGoogleButton && (
            <div className="flex justify-center mb-4">
              <div ref={googleButtonRef} className="google-signin-button" />
            </div>
          )}

          {/* Trust indicators */}
          <div className="flex flex-wrap justify-center gap-6 text-night-500 text-sm">
            <span className="flex items-center gap-1">
              <Check className="w-4 h-4 text-green-500" /> No credit card required
            </span>
            <span className="flex items-center gap-1">
              <Check className="w-4 h-4 text-green-500" /> Free story included
            </span>
            <span className="flex items-center gap-1">
              <Check className="w-4 h-4 text-green-500" /> Cancel anytime
            </span>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronDown className="w-8 h-8 text-night-500" />
        </div>
      </section>

      {/* Story Types Section */}
      <section className="py-20 px-6 bg-gradient-to-b from-night-950 to-night-900">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-4">
            <span className="gradient-text">Endless Worlds Await</span>
          </h2>
          <p className="text-night-300 text-center mb-16 max-w-2xl mx-auto">
            From gentle bedtime tales to epic adventures, choose your genre or let our AI surprise you
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {storyTypes.map((type, index) => (
              <div
                key={index}
                className="group relative p-6 bg-night-800/50 rounded-2xl border border-night-700
                         hover:border-golden-400/50 transition-all duration-300 hover:-translate-y-1"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${type.color} opacity-0
                              group-hover:opacity-10 rounded-2xl transition-opacity duration-300`} />
                <type.icon className="w-10 h-10 text-golden-400 mb-4" />
                <h3 className="text-xl font-semibold mb-2 text-white">{type.title}</h3>
                <p className="text-night-400 text-sm leading-relaxed">{type.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section ref={featuresRef} className="py-20 px-6 bg-night-900">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-4">
            <span className="gradient-text">Powered by Magic (and AI)</span>
          </h2>
          <p className="text-night-300 text-center mb-16 max-w-2xl mx-auto">
            Eight specialized AI agents work together to craft stories that feel truly personal
          </p>

          <div className="grid md:grid-cols-2 gap-8">
            {features.map((feature, index) => (
              <div
                key={index}
                className="flex gap-4 p-6 bg-night-800/30 rounded-xl border border-night-800
                         hover:border-night-700 transition-colors"
              >
                <div className="flex-shrink-0">
                  <div className="w-12 h-12 bg-golden-400/10 rounded-xl flex items-center justify-center">
                    <feature.icon className="w-6 h-6 text-golden-400" />
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-2 text-white">{feature.title}</h3>
                  <p className="text-night-400 text-sm leading-relaxed">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6 bg-gradient-to-b from-night-900 to-night-950">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-16">
            <span className="gradient-text">As Simple as Saying Goodnight</span>
          </h2>

          <div className="space-y-12">
            {[
              {
                step: 1,
                title: "Start with Your Voice",
                description: "Tap the moon and simply talk. Tell us who's listening, what kind of story you're in the mood for, or just say 'surprise me'.",
                icon: Mic
              },
              {
                step: 2,
                title: "Watch the Magic Happen",
                description: "Our multi-agent AI crafts a unique story just for you - complete with characters, plot twists, and the perfect pacing for your chosen length.",
                icon: Wand2
              },
              {
                step: 3,
                title: "Listen & Interact",
                description: "Sit back as professional narration brings your story to life. Make choices when prompted, or just let the tale unfold.",
                icon: Headphones
              },
              {
                step: 4,
                title: "Save Your Adventures",
                description: "Every story is saved to your library. Re-listen, explore different branches, or share your favorites.",
                icon: Archive
              }
            ].map((item, index) => (
              <div key={index} className="flex gap-6 items-start">
                <div className="flex-shrink-0 w-16 h-16 bg-golden-400/10 rounded-full flex items-center justify-center
                              border-2 border-golden-400">
                  <span className="text-2xl font-bold text-golden-400">{item.step}</span>
                </div>
                <div className="flex-1 pt-3">
                  <h3 className="text-xl font-semibold mb-2 text-white flex items-center gap-3">
                    {item.title}
                    <item.icon className="w-5 h-5 text-golden-400" />
                  </h3>
                  <p className="text-night-400 leading-relaxed">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Voice Agent Highlight */}
      <section className="py-20 px-6 bg-night-950">
        <div className="max-w-5xl mx-auto">
          <div className="bg-gradient-to-br from-night-800 to-night-900 rounded-3xl p-8 md:p-12 border border-night-700">
            <div className="flex flex-col md:flex-row gap-8 items-center">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-4">
                  <MessageCircle className="w-8 h-8 text-golden-400" />
                  <span className="text-sm text-golden-400 font-semibold uppercase tracking-wide">
                    Real-Time Conversation
                  </span>
                </div>
                <h2 className="text-3xl font-bold mb-4 text-white">
                  Your Personal Story Concierge
                </h2>
                <p className="text-night-300 mb-6 leading-relaxed">
                  No menus. No typing. Just natural conversation. Our voice agent understands context,
                  remembers your preferences, and helps you design the perfect story - all while you're
                  getting comfortable in bed.
                </p>
                <p className="text-night-400 italic">
                  "I want a story about a brave knight... but make it funny, and not too scary...
                  oh, and can there be a talking dog?"
                </p>
                <p className="text-golden-400 mt-4 font-medium">
                  "Perfect! I'll create a comedic medieval adventure with Sir Bumblesworth
                  and his wise-cracking canine companion, Biscuit. Ready to begin?"
                </p>
              </div>
              <div className="flex-shrink-0">
                <div className="w-48 h-48 bg-night-800 rounded-full flex items-center justify-center
                              border-4 border-golden-400/30 relative">
                  <Moon className="w-20 h-20 text-golden-400 animate-pulse" />
                  <div className="absolute inset-0 rounded-full border-4 border-golden-400/20 animate-ping" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section ref={pricingRef} className="py-20 px-6 bg-gradient-to-b from-night-950 to-night-900">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-4">
            <span className="gradient-text">Choose Your Journey</span>
          </h2>
          <p className="text-night-300 text-center mb-16 max-w-2xl mx-auto">
            Start free with one story. Upgrade when you're ready for more adventures.
          </p>

          <div className="grid md:grid-cols-3 gap-8">
            {pricingTiers.map((tier, index) => (
              <div
                key={index}
                className={`relative p-8 rounded-2xl border transition-all duration-300 hover:-translate-y-2
                          ${tier.highlight
                            ? 'bg-gradient-to-b from-golden-400/10 to-night-800 border-golden-400 shadow-xl shadow-golden-400/20'
                            : 'bg-night-800/50 border-night-700 hover:border-night-600'
                          }`}
              >
                {tier.highlight && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-golden-400
                                text-night-900 text-sm font-semibold rounded-full">
                    Most Popular
                  </div>
                )}

                <h3 className="text-2xl font-bold mb-2 text-white">{tier.name}</h3>
                <p className="text-night-400 text-sm mb-4">{tier.description}</p>

                <div className="mb-6">
                  <span className="text-4xl font-bold text-golden-400">{tier.price}</span>
                  <span className="text-night-400">{tier.period}</span>
                </div>

                <ul className="space-y-3 mb-8">
                  {tier.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-night-300 text-sm">
                      <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={handleGoogleLogin}
                  className={`w-full py-3 rounded-xl font-semibold transition-all duration-300
                            ${tier.highlight
                              ? 'bg-golden-400 text-night-900 hover:bg-golden-300'
                              : 'bg-night-700 text-white hover:bg-night-600'
                            }`}
                >
                  {tier.cta}
                </button>
              </div>
            ))}
          </div>

          <p className="text-center text-night-500 text-sm mt-8">
            All plans include a 7-day free trial. Cancel anytime.
          </p>
        </div>
      </section>

      {/* Roadmap Preview */}
      <section className="py-20 px-6 bg-night-900">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-4">
            <span className="gradient-text">Coming Soon</span>
          </h2>
          <p className="text-night-300 mb-12 max-w-2xl mx-auto">
            We're just getting started. Here's what's on the horizon...
          </p>

          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { icon: Users, label: "Multiplayer Stories" },
              { icon: Music, label: "Custom Soundtracks" },
              { icon: Gamepad2, label: "Voice-Controlled Games" },
              { icon: Star, label: "Celebrity Voices" }
            ].map((item, index) => (
              <div key={index} className="p-4 bg-night-800/30 rounded-xl border border-night-800">
                <item.icon className="w-8 h-8 text-golden-400/60 mx-auto mb-2" />
                <p className="text-night-400 text-sm">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 px-6 bg-gradient-to-b from-night-900 to-night-950">
        <div className="max-w-3xl mx-auto text-center">
          <Moon className="w-16 h-16 text-golden-400 mx-auto mb-6" />
          <h2 className="text-4xl font-bold mb-4 text-white">
            Ready to Begin Your Story?
          </h2>
          <p className="text-night-300 mb-8 text-lg">
            Your first adventure is on us. No credit card required.
          </p>
          <button
            onClick={handleGoogleLogin}
            disabled={loginLoading}
            className="inline-flex items-center gap-3 px-10 py-5 bg-golden-400 text-night-900
                     rounded-xl font-bold text-xl shadow-lg hover:shadow-xl transition-all
                     duration-300 hover:scale-105 disabled:opacity-50"
          >
            {loginLoading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <Play className="w-6 h-6" />
            )}
            <span>Start Your Free Story</span>
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 bg-night-950 border-t border-night-800">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2">
              <Moon className="w-6 h-6 text-golden-400" />
              <span className="font-bold text-white">Storyteller</span>
            </div>

            <div className="flex gap-6 text-night-400 text-sm">
              <a href="#" className="hover:text-golden-400 transition-colors">Privacy</a>
              <a href="#" className="hover:text-golden-400 transition-colors">Terms</a>
              <a href="#" className="hover:text-golden-400 transition-colors">Support</a>
              <a href="#" className="hover:text-golden-400 transition-colors">Contact</a>
            </div>

            <p className="text-night-500 text-sm">
              Made with AI and imagination
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
