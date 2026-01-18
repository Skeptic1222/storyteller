import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Headphones, Loader2, Lock } from 'lucide-react';
import { apiCall } from '../config';
import NavBar from '../components/NavBar';

function SharedStory() {
  const { shareCode } = useParams();
  const [story, setStory] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const loadStory = async (passwordOverride = null) => {
    setLoading(true);
    setError(null);
    setRequiresPassword(false);
    try {
      const query = passwordOverride ? `?password=${encodeURIComponent(passwordOverride)}` : '';
      const response = await apiCall(`/sharing/story/${shareCode}${query}`);
      const data = await response.json();

      if (!response.ok || !data?.success) {
        if (data?.requiresPassword) {
          setRequiresPassword(true);
          setStory(null);
          setScenes([]);
          return;
        }
        throw new Error(data?.error || 'Story not available');
      }

      setStory(data.story);
      setScenes(data.scenes || []);
    } catch (err) {
      setError(err.message || 'Failed to load story');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStory();
  }, [shareCode]);

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    if (!password) return;
    setSubmitting(true);
    await loadStory(password);
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-narrimo-midnight text-narrimo-cream">
      <NavBar transparent />

      <section className="pt-28 pb-12 px-6">
        <div className="max-w-4xl mx-auto">
          <Link to="/discover" className="text-sm text-slate-400 hover:text-white">
            Back to Discovery
          </Link>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="max-w-4xl mx-auto">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-300">
              <Loader2 className="w-8 h-8 animate-spin text-narrimo-coral" />
              <span className="ml-3">Loading story...</span>
            </div>
          )}

          {!loading && error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-red-200">
              {error}
            </div>
          )}

          {!loading && requiresPassword && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
              <div className="flex items-center gap-3 mb-4 text-slate-200">
                <Lock className="w-5 h-5 text-narrimo-coral" />
                <p className="text-lg font-semibold">This story is protected</p>
              </div>
              <form onSubmit={handlePasswordSubmit} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter access code"
                  className="flex-1 bg-slate-900/70 border border-slate-700 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-narrimo-coral"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-3 rounded-xl bg-narrimo-coral text-white font-semibold disabled:opacity-60"
                >
                  {submitting ? 'Unlocking...' : 'Unlock'}
                </button>
              </form>
            </div>
          )}

          {!loading && !requiresPassword && story && (
            <div className="space-y-10">
              <div className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden">
                <div className="relative aspect-[16/9] bg-slate-900/40">
                  {story.coverImage ? (
                    <img src={story.coverImage} alt={`${story.title} cover`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Headphones className="w-10 h-10 text-white/40" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                  <div className="absolute bottom-4 left-5 right-5">
                    <p className="text-sm text-slate-300">
                      {story.genre || 'Multi-genre'} story
                    </p>
                    <h1 className="text-3xl md:text-4xl font-heading font-semibold text-white">
                      {story.title}
                    </h1>
                  </div>
                </div>
                {story.synopsis && (
                  <div className="p-6 text-slate-200">
                    <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Synopsis</p>
                    <p className="mt-2 text-base text-slate-200">{story.synopsis}</p>
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div className="flex items-center gap-2 text-slate-300">
                  <Headphones className="w-4 h-4 text-narrimo-coral" />
                  <h2 className="text-lg font-semibold">Scenes</h2>
                </div>

                {scenes.length === 0 && (
                  <div className="text-slate-400">No scenes available for this story yet.</div>
                )}

                {scenes.map((scene, index) => (
                  <div key={scene.id || index} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-slate-300">
                        Scene {index + 1}
                      </h3>
                      {scene.audioUrl ? (
                        <span className="text-xs text-emerald-300">Audio ready</span>
                      ) : (
                        <span className="text-xs text-slate-500">Text only</span>
                      )}
                    </div>
                    <p className="text-slate-200 text-sm leading-relaxed">
                      {scene.text || 'Scene text unavailable.'}
                    </p>
                    {scene.audioUrl && (
                      <audio className="w-full mt-4" controls preload="none" src={scene.audioUrl}>
                        Your browser does not support the audio element.
                      </audio>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default SharedStory;
