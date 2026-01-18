import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Headphones, Loader2, Search, SlidersHorizontal } from 'lucide-react';
import { apiCall } from '../config';
import NavBar from '../components/NavBar';

const SORT_OPTIONS = [
  { value: 'recent', label: 'Newest' },
  { value: 'popular', label: 'Most Played' }
];

function Discover() {
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState('recent');
  const [genreFilter, setGenreFilter] = useState('all');
  const [query, setQuery] = useState('');

  const fetchStories = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '24', sortBy });
      if (genreFilter !== 'all') {
        params.set('genre', genreFilter);
      }
      const response = await apiCall(`/sharing/discover?${params}`);
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to load stories');
      }
      setStories(data.stories || []);
    } catch (err) {
      setError(err.message || 'Failed to load stories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStories();
  }, [sortBy, genreFilter]);

  const genres = useMemo(() => {
    const unique = new Set();
    stories.forEach((story) => {
      if (story.genre) unique.add(story.genre);
    });
    return ['all', ...Array.from(unique).sort()];
  }, [stories]);

  const filteredStories = useMemo(() => {
    if (!query) return stories;
    const lowered = query.toLowerCase();
    return stories.filter((story) => (story.title || '').toLowerCase().includes(lowered));
  }, [stories, query]);

  return (
    <div className="min-h-screen bg-narrimo-midnight text-narrimo-cream">
      <NavBar transparent />

      <section className="pt-28 pb-12 px-6 relative overflow-hidden">
        <div className="absolute inset-0 narrimo-starfield opacity-50" />
        <div className="absolute -top-24 right-0 w-72 h-72 rounded-full bg-[#FF6F61]/20 blur-[120px]" />
        <div className="absolute top-1/2 -left-20 w-64 h-64 rounded-full bg-[#6A8A82]/20 blur-[120px]" />

        <div className="relative z-10 max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[#C0C0C0]">
                Listen Free
              </p>
              <h1 className="mt-3 text-4xl md:text-5xl font-heading font-semibold">
                Narrimo Discovery Library
              </h1>
              <p className="mt-3 text-slate-300 max-w-2xl">
                Curated public stories shared by creators. Stream cinematic narration without spending credits.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/welcome"
                className="px-5 py-2.5 rounded-full bg-white text-[#0A2342] font-semibold"
              >
                Sign in to create
              </Link>
              <Link
                to="/configure"
                className="px-5 py-2.5 rounded-full border border-white/20 text-white/90 font-semibold hover:border-white/40"
              >
                Start a story
              </Link>
            </div>
          </div>

          <div className="mt-8 grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
            <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by title"
                className="w-full bg-transparent text-slate-200 placeholder:text-slate-500 focus:outline-none"
                aria-label="Search stories"
              />
            </div>
            <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
              <SlidersHorizontal className="w-4 h-4 text-slate-400" />
              <select
                value={genreFilter}
                onChange={(event) => setGenreFilter(event.target.value)}
                className="w-full bg-transparent text-slate-200 focus:outline-none"
                aria-label="Filter by genre"
              >
                {genres.map((genre) => (
                  <option key={genre} value={genre} className="text-slate-900">
                    {genre === 'all' ? 'All genres' : genre}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
              <Headphones className="w-4 h-4 text-slate-400" />
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                className="w-full bg-transparent text-slate-200 focus:outline-none"
                aria-label="Sort stories"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="text-slate-900">
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="max-w-6xl mx-auto">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-300">
              <Loader2 className="w-8 h-8 animate-spin text-narrimo-coral" />
              <span className="ml-3">Loading free stories...</span>
            </div>
          )}

          {!loading && error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-red-200">
              {error}
            </div>
          )}

          {!loading && !error && filteredStories.length === 0 && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-10 text-center text-slate-300">
              <p className="text-lg font-semibold text-white">No public stories yet</p>
              <p className="mt-2 text-sm text-slate-400">
                Share a finished story to make it discoverable here.
              </p>
              <Link
                to="/configure"
                className="inline-flex mt-5 px-5 py-2.5 rounded-full bg-narrimo-coral text-white font-semibold"
              >
                Create a story
              </Link>
            </div>
          )}

          {!loading && !error && filteredStories.length > 0 && (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredStories.map((story) => (
                <div
                  key={story.shareCode}
                  className="group bg-white/5 border border-white/10 rounded-3xl overflow-hidden hover:border-white/25 transition-all"
                >
                  <div className="relative aspect-[4/3] overflow-hidden">
                    {story.coverImage ? (
                      <img
                        src={story.coverImage}
                        alt={`${story.title} cover`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#0A2342] via-[#132d4f] to-[#1f3a5c] flex items-center justify-center">
                        <Headphones className="w-10 h-10 text-white/40" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between text-xs text-white/80">
                      <span>{story.genre || 'Mixed genre'}</span>
                      <span>{story.sceneCount || 0} scenes</span>
                    </div>
                  </div>
                  <div className="p-5">
                    <h3 className="text-lg font-semibold text-white mb-2 line-clamp-2">
                      {story.title}
                    </h3>
                    <div className="flex items-center justify-between text-sm text-slate-400">
                      <span>{story.viewCount || 0} plays</span>
                      <span>{new Date(story.sharedAt).toLocaleDateString()}</span>
                    </div>
                    <Link
                      to={`/shared/${story.shareCode}`}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-narrimo-coral text-white text-sm font-semibold"
                    >
                      <Headphones className="w-4 h-4" />
                      Listen
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default Discover;
