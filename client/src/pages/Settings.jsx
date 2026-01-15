import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiCall } from '../config';
import Layout, { PageContainer, PageHeader } from '../components/Layout';
import {
  Settings as SettingsIcon, User, Bell, Volume2, Palette,
  Save, Check, Loader2, Columns
} from 'lucide-react';

function Settings() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { textLayout, setTextLayout } = useTheme();
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState({
    displayName: '',
    defaultVoice: '',
    autoPlayNarration: true,
    darkModeEnabled: true,
    notificationsEnabled: false,
    calmModeDefault: false,
    cyoaDefault: true
  });

  // Load user preferences on mount
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/welcome');
      return;
    }
    if (user) {
      setSettings(prev => ({
        ...prev,
        displayName: user.displayName || ''
      }));

      // Fetch saved preferences from API
      const loadPreferences = async () => {
        try {
          const response = await apiCall(`/config/preferences/${user.id}`);
          if (response.preferences) {
            const prefs = response.preferences.preferences || {};
            setSettings(prev => ({
              ...prev,
              autoPlayNarration: prefs.auto_play_narration ?? true,
              darkModeEnabled: prefs.dark_mode ?? true,
              notificationsEnabled: prefs.notifications ?? false,
              calmModeDefault: prefs.bedtime_mode ?? false,
              cyoaDefault: prefs.cyoa_enabled ?? true,
              defaultVoice: prefs.default_voice || ''
            }));
          }
        } catch (error) {
          console.error('Failed to load preferences:', error);
        }
      };
      loadPreferences();
    }
  }, [isAuthenticated, user, navigate]);

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!user?.id) return;

    setLoading(true);
    try {
      // Map settings to API preferences format
      const preferences = {
        auto_play_narration: settings.autoPlayNarration,
        dark_mode: settings.darkModeEnabled,
        notifications: settings.notificationsEnabled,
        bedtime_mode: settings.calmModeDefault,
        cyoa_enabled: settings.cyoaDefault,
        default_voice: settings.defaultVoice
      };

      await apiCall('/config/preferences', {
        method: 'POST',
        body: JSON.stringify({
          user_id: user.id,
          preferences: { preferences }
        })
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <PageContainer maxWidth="2xl" className="pt-20 pb-8">
        {/* Header with Save Button */}
        <PageHeader
          title="Settings"
          subtitle="Manage your preferences"
          backPath="/"
          actions={
            <button
              onClick={handleSave}
              disabled={loading || saved}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors
                        ${saved
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-narrimo-coral hover:bg-[#ff8579] text-narrimo-midnight'}`}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : saved ? (
                <Check className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saved ? 'Saved' : 'Save'}
            </button>
          }
        />

        {/* Profile Section */}
        <section className="bg-slate-800/50 rounded-xl p-6 border border-slate-700 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <User className="w-5 h-5 text-narrimo-coral" />
            <h2 className="text-lg font-semibold text-white">Profile</h2>
          </div>

          <div className="flex items-center gap-4 mb-6">
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.displayName}
                className="w-16 h-16 rounded-full border-2 border-slate-700"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center">
                <User className="w-8 h-8 text-slate-400" />
              </div>
            )}
            <div>
              <p className="text-white font-medium">{user?.displayName}</p>
              <p className="text-sm text-slate-400">{user?.email}</p>
              <p className="text-xs text-slate-500 mt-1">Signed in with Google</p>
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">Display Name</label>
            <input
              type="text"
              value={settings.displayName}
              onChange={(e) => handleChange('displayName', e.target.value)}
              className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white
                       focus:outline-none focus:border-narrimo-coral"
            />
          </div>
        </section>

        {/* Audio Section */}
        <section className="bg-slate-800/50 rounded-xl p-6 border border-slate-700 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <Volume2 className="w-5 h-5 text-narrimo-coral" />
            <h2 className="text-lg font-semibold text-white">Audio</h2>
          </div>

          <div className="space-y-4">
            <ToggleSetting
              label="Auto-play Narration"
              description="Automatically start playing audio when a scene is ready"
              value={settings.autoPlayNarration}
              onChange={(v) => handleChange('autoPlayNarration', v)}
            />
          </div>
        </section>

        {/* Story Defaults Section */}
        <section className="bg-slate-800/50 rounded-xl p-6 border border-slate-700 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <SettingsIcon className="w-5 h-5 text-narrimo-coral" />
            <h2 className="text-lg font-semibold text-white">Story Defaults</h2>
          </div>

          <div className="space-y-4">
            <ToggleSetting
              label="Calm Mode by Default"
              description="Start new stories in a softer intensity profile"
              value={settings.calmModeDefault}
              onChange={(v) => handleChange('calmModeDefault', v)}
            />

            <ToggleSetting
              label="Enable Choose Your Own Adventure"
              description="Include interactive choices in your stories by default"
              value={settings.cyoaDefault}
              onChange={(v) => handleChange('cyoaDefault', v)}
            />

            {/* Text Layout Preference */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Columns className="w-4 h-4 text-narrimo-coral" />
                <label className="text-white font-medium">Default Text Layout</label>
              </div>
              <p className="text-sm text-slate-400 mb-3">
                Choose how story text is displayed during playback
              </p>
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-3 bg-slate-900 border border-slate-700 rounded-lg cursor-pointer hover:border-narrimo-coral/50 transition-colors">
                  <input
                    type="radio"
                    name="textLayout"
                    value="vertical"
                    checked={textLayout === 'vertical'}
                    onChange={(e) => setTextLayout(e.target.value)}
                    className="accent-narrimo-coral"
                  />
                  <div>
                    <p className="text-white font-medium">Vertical Flow</p>
                    <p className="text-xs text-slate-400">Traditional top-to-bottom reading</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 bg-slate-900 border border-slate-700 rounded-lg cursor-pointer hover:border-narrimo-coral/50 transition-colors">
                  <input
                    type="radio"
                    name="textLayout"
                    value="horizontal"
                    checked={textLayout === 'horizontal'}
                    onChange={(e) => setTextLayout(e.target.value)}
                    className="accent-narrimo-coral"
                  />
                  <div>
                    <p className="text-white font-medium">Two Columns</p>
                    <p className="text-xs text-slate-400">Side-by-side newspaper style</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 bg-slate-900 border border-slate-700 rounded-lg cursor-pointer hover:border-narrimo-coral/50 transition-colors">
                  <input
                    type="radio"
                    name="textLayout"
                    value="modal"
                    checked={textLayout === 'modal'}
                    onChange={(e) => setTextLayout(e.target.value)}
                    className="accent-narrimo-coral"
                  />
                  <div>
                    <p className="text-white font-medium">Modal (One Paragraph)</p>
                    <p className="text-xs text-slate-400">Focus on one paragraph at a time with navigation</p>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </section>

        {/* Appearance Section */}
        <section className="bg-slate-800/50 rounded-xl p-6 border border-slate-700 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <Palette className="w-5 h-5 text-narrimo-coral" />
            <h2 className="text-lg font-semibold text-white">Appearance</h2>
          </div>

          <div className="space-y-4">
            <ToggleSetting
              label="Dark Mode"
              description="Use the dark theme by default"
              value={settings.darkModeEnabled}
              onChange={(v) => handleChange('darkModeEnabled', v)}
            />
          </div>
        </section>

        {/* Notifications Section */}
        <section className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center gap-3 mb-6">
            <Bell className="w-5 h-5 text-narrimo-coral" />
            <h2 className="text-lg font-semibold text-white">Notifications</h2>
          </div>

          <div className="space-y-4">
            <ToggleSetting
              label="Story Notifications"
              description="Get notified when your story is ready"
              value={settings.notificationsEnabled}
              onChange={(v) => handleChange('notificationsEnabled', v)}
            />
          </div>
        </section>

        {/* Danger Zone */}
        <section className="mt-8 p-6 border border-red-500/30 rounded-xl">
          <h3 className="text-red-400 font-semibold mb-4">Danger Zone</h3>
          <p className="text-slate-400 text-sm mb-4">
            Deleting your account will permanently remove all your stories, preferences, and subscription data.
          </p>
          <button
            className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30
                     text-red-400 rounded-lg transition-colors"
          >
            Delete Account
          </button>
        </section>
      </PageContainer>
    </Layout>
  );
}

function ToggleSetting({ label, description, value, onChange }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-white font-medium">{label}</p>
        <p className="text-sm text-slate-400">{description}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-12 h-6 rounded-full transition-colors
                  ${value ? 'bg-narrimo-coral' : 'bg-slate-700'}`}
      >
        <div
          className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform
                    ${value ? 'left-7' : 'left-1'}`}
        />
      </button>
    </div>
  );
}

export default Settings;
