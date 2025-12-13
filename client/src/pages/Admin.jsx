import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiCall } from '../config';
import {
  Users, Search, ChevronLeft, ChevronRight, Shield,
  CreditCard, BarChart3, RefreshCw, Gift, Edit2
} from 'lucide-react';

function Admin() {
  const navigate = useNavigate();
  const { user, isAdmin, getAuthHeader } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showTierModal, setShowTierModal] = useState(false);
  const [showBonusModal, setShowBonusModal] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      navigate('/');
      return;
    }
    loadStats();
    loadUsers();
  }, [isAdmin, navigate]);

  const loadStats = async () => {
    try {
      const response = await apiCall('/admin/stats', {
        headers: getAuthHeader()
      });
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const loadUsers = async (page = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page, limit: 20 });
      if (search) params.append('search', search);

      const response = await apiCall(`/admin/users?${params}`, {
        headers: getAuthHeader()
      });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    loadUsers(1);
  };

  const updateTier = async (userId, tier, reason) => {
    try {
      const response = await apiCall(`/admin/users/${userId}/subscription`, {
        method: 'PUT',
        headers: getAuthHeader(),
        body: JSON.stringify({ tier, reason })
      });
      if (response.ok) {
        loadUsers(pagination.page);
        setShowTierModal(false);
        setSelectedUser(null);
      }
    } catch (error) {
      console.error('Failed to update tier:', error);
    }
  };

  const addBonus = async (userId, bonusStories, bonusMinutes, reason) => {
    try {
      const response = await apiCall(`/admin/users/${userId}/bonus`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: JSON.stringify({ bonusStories, bonusMinutes, reason })
      });
      if (response.ok) {
        loadUsers(pagination.page);
        setShowBonusModal(false);
        setSelectedUser(null);
      }
    } catch (error) {
      console.error('Failed to add bonus:', error);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-red-500" />
            <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
          </div>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-night-800 hover:bg-night-700 rounded-lg text-night-300 transition-colors"
          >
            Back to Home
          </button>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-night-800/50 rounded-xl p-4 border border-night-700">
              <div className="flex items-center gap-2 text-night-400 mb-2">
                <Users className="w-4 h-4" />
                <span className="text-sm">Total Users</span>
              </div>
              <p className="text-2xl font-bold text-white">{stats.users?.total || 0}</p>
              <p className="text-xs text-night-500">+{stats.users?.newThisWeek || 0} this week</p>
            </div>

            <div className="bg-night-800/50 rounded-xl p-4 border border-night-700">
              <div className="flex items-center gap-2 text-night-400 mb-2">
                <BarChart3 className="w-4 h-4" />
                <span className="text-sm">Stories Created</span>
              </div>
              <p className="text-2xl font-bold text-white">{stats.stories?.total || 0}</p>
              <p className="text-xs text-night-500">+{stats.stories?.newThisWeek || 0} this week</p>
            </div>

            <div className="bg-night-800/50 rounded-xl p-4 border border-night-700">
              <div className="flex items-center gap-2 text-night-400 mb-2">
                <CreditCard className="w-4 h-4" />
                <span className="text-sm">Paid Subscribers</span>
              </div>
              <p className="text-2xl font-bold text-white">
                {(stats.subscriptions?.dreamer || 0) +
                 (stats.subscriptions?.storyteller || 0) +
                 (stats.subscriptions?.family || 0)}
              </p>
            </div>

            <div className="bg-night-800/50 rounded-xl p-4 border border-night-700">
              <div className="flex items-center gap-2 text-night-400 mb-2">
                <RefreshCw className="w-4 h-4" />
                <span className="text-sm">This Month</span>
              </div>
              <p className="text-lg font-bold text-white">
                {stats.currentMonthUsage?.storiesGenerated || 0} stories
              </p>
              <p className="text-xs text-night-500">
                {stats.currentMonthUsage?.minutesUsed?.toFixed(1) || 0} min narration
              </p>
            </div>
          </div>
        )}

        {/* User Search */}
        <form onSubmit={handleSearch} className="mb-6">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-night-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by email or name..."
                className="w-full pl-10 pr-4 py-2 bg-night-800 border border-night-700 rounded-lg
                         text-white placeholder-night-500 focus:outline-none focus:border-golden-400"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-golden-400 hover:bg-golden-300 rounded-lg text-night-900 font-medium"
            >
              Search
            </button>
          </div>
        </form>

        {/* Users Table */}
        <div className="bg-night-800/50 rounded-xl border border-night-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-night-700 bg-night-800">
                  <th className="px-4 py-3 text-left text-sm font-medium text-night-400">User</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-night-400">Tier</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-night-400">Limits</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-night-400">Joined</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-night-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="5" className="px-4 py-8 text-center text-night-400">
                      Loading users...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-4 py-8 text-center text-night-400">
                      No users found
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="border-b border-night-700/50 hover:bg-night-700/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {u.avatar_url ? (
                            <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-night-700 flex items-center justify-center">
                              <Users className="w-4 h-4 text-night-400" />
                            </div>
                          )}
                          <div>
                            <p className="text-white font-medium">{u.display_name}</p>
                            <p className="text-sm text-night-400">{u.email}</p>
                          </div>
                          {u.is_admin && (
                            <Shield className="w-4 h-4 text-red-500" />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          u.tier === 'admin' ? 'bg-red-500/20 text-red-400' :
                          u.tier === 'family' ? 'bg-emerald-500/20 text-emerald-400' :
                          u.tier === 'storyteller' ? 'bg-golden-400/20 text-golden-400' :
                          u.tier === 'dreamer' ? 'bg-purple-500/20 text-purple-400' :
                          'bg-night-600 text-night-300'
                        }`}>
                          {u.tier?.toUpperCase() || 'FREE'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-night-300">
                        {u.stories_limit || 1} stories / {u.minutes_limit || 10} min
                      </td>
                      <td className="px-4 py-3 text-sm text-night-400">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => { setSelectedUser(u); setShowTierModal(true); }}
                            className="p-2 hover:bg-night-700 rounded-lg text-night-400 hover:text-white transition-colors"
                            title="Change Tier"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { setSelectedUser(u); setShowBonusModal(true); }}
                            className="p-2 hover:bg-night-700 rounded-lg text-night-400 hover:text-white transition-colors"
                            title="Add Bonus"
                          >
                            <Gift className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-night-700">
              <p className="text-sm text-night-400">
                Showing {(pagination.page - 1) * 20 + 1} - {Math.min(pagination.page * 20, pagination.total)} of {pagination.total}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => loadUsers(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  className="p-2 hover:bg-night-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-5 h-5 text-night-400" />
                </button>
                <button
                  onClick={() => loadUsers(pagination.page + 1)}
                  disabled={pagination.page === pagination.pages}
                  className="p-2 hover:bg-night-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-5 h-5 text-night-400" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Tier Change Modal */}
        {showTierModal && selectedUser && (
          <TierModal
            user={selectedUser}
            onClose={() => { setShowTierModal(false); setSelectedUser(null); }}
            onSave={updateTier}
          />
        )}

        {/* Bonus Modal */}
        {showBonusModal && selectedUser && (
          <BonusModal
            user={selectedUser}
            onClose={() => { setShowBonusModal(false); setSelectedUser(null); }}
            onSave={addBonus}
          />
        )}
      </div>
    </div>
  );
}

function TierModal({ user, onClose, onSave }) {
  const [tier, setTier] = useState(user.tier || 'free');
  const [reason, setReason] = useState('');

  const tiers = [
    { id: 'free', name: 'Free', limits: '1 story, 10 min' },
    { id: 'dreamer', name: 'Dreamer', limits: '5 stories, 50 min' },
    { id: 'storyteller', name: 'Storyteller', limits: '12 stories, 120 min' },
    { id: 'family', name: 'Family', limits: '25 stories, 250 min' },
    { id: 'admin', name: 'Admin', limits: 'Unlimited' }
  ];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-night-800 rounded-xl p-6 max-w-md w-full border border-night-700">
        <h3 className="text-lg font-bold text-white mb-4">Change Subscription Tier</h3>
        <p className="text-night-400 mb-4">
          Changing tier for: <span className="text-white">{user.email}</span>
        </p>

        <div className="space-y-2 mb-4">
          {tiers.map((t) => (
            <label
              key={t.id}
              className={`flex items-center justify-between p-3 rounded-lg cursor-pointer border
                         ${tier === t.id ? 'border-golden-400 bg-golden-400/10' : 'border-night-700 hover:border-night-600'}`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="tier"
                  value={t.id}
                  checked={tier === t.id}
                  onChange={(e) => setTier(e.target.value)}
                  className="sr-only"
                />
                <span className="text-white font-medium">{t.name}</span>
              </div>
              <span className="text-sm text-night-400">{t.limits}</span>
            </label>
          ))}
        </div>

        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for change (optional)"
          className="w-full px-4 py-2 bg-night-900 border border-night-700 rounded-lg text-white
                   placeholder-night-500 focus:outline-none focus:border-golden-400 mb-4"
        />

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-night-700 hover:bg-night-600 rounded-lg text-night-300"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(user.id, tier, reason)}
            className="flex-1 px-4 py-2 bg-golden-400 hover:bg-golden-300 rounded-lg text-night-900 font-medium"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function BonusModal({ user, onClose, onSave }) {
  const [bonusStories, setBonusStories] = useState(0);
  const [bonusMinutes, setBonusMinutes] = useState(0);
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-night-800 rounded-xl p-6 max-w-md w-full border border-night-700">
        <h3 className="text-lg font-bold text-white mb-4">Add Bonus Credits</h3>
        <p className="text-night-400 mb-4">
          Adding bonus to: <span className="text-white">{user.email}</span>
        </p>

        <div className="space-y-4 mb-4">
          <div>
            <label className="block text-sm text-night-400 mb-1">Bonus Stories</label>
            <input
              type="number"
              min="0"
              value={bonusStories}
              onChange={(e) => setBonusStories(parseInt(e.target.value) || 0)}
              className="w-full px-4 py-2 bg-night-900 border border-night-700 rounded-lg text-white
                       focus:outline-none focus:border-golden-400"
            />
          </div>
          <div>
            <label className="block text-sm text-night-400 mb-1">Bonus Minutes</label>
            <input
              type="number"
              min="0"
              value={bonusMinutes}
              onChange={(e) => setBonusMinutes(parseInt(e.target.value) || 0)}
              className="w-full px-4 py-2 bg-night-900 border border-night-700 rounded-lg text-white
                       focus:outline-none focus:border-golden-400"
            />
          </div>
        </div>

        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for bonus (optional)"
          className="w-full px-4 py-2 bg-night-900 border border-night-700 rounded-lg text-white
                   placeholder-night-500 focus:outline-none focus:border-golden-400 mb-4"
        />

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-night-700 hover:bg-night-600 rounded-lg text-night-300"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(user.id, bonusStories, bonusMinutes, reason)}
            disabled={bonusStories === 0 && bonusMinutes === 0}
            className="flex-1 px-4 py-2 bg-golden-400 hover:bg-golden-300 rounded-lg text-night-900 font-medium
                     disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Bonus
          </button>
        </div>
      </div>
    </div>
  );
}

export default Admin;
