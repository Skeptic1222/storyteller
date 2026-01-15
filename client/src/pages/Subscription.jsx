import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiCall } from '../config';
import Layout, { PageContainer, PageHeader } from '../components/Layout';
import {
  CreditCard, Check, Star, Crown, Users, Sparkles,
  BookOpen, Wand2, AlertCircle
} from 'lucide-react';

function Subscription() {
  const navigate = useNavigate();
  const { user, subscription, usage, isAuthenticated, getAuthHeader } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paypalConfigured, setPaypalConfigured] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/welcome');
      return;
    }
    loadPlans();
    checkPaypalStatus();
  }, [isAuthenticated, navigate]);

  const loadPlans = async () => {
    try {
      const response = await apiCall('/paypal/plans');
      if (response.ok) {
        const data = await response.json();
        setPlans(data.plans);
      }
    } catch (error) {
      console.error('Failed to load plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkPaypalStatus = async () => {
    try {
      const response = await apiCall('/paypal/status');
      if (response.ok) {
        const data = await response.json();
        setPaypalConfigured(data.configured);
      }
    } catch (error) {
      console.error('Failed to check PayPal status:', error);
    }
  };

  const handleSubscribe = async (planId) => {
    if (!paypalConfigured) {
      alert('Payment system is being set up. Please check back soon!');
      return;
    }

    try {
      const response = await apiCall('/paypal/create-subscription', {
        method: 'POST',
        headers: getAuthHeader(),
        body: JSON.stringify({ planId })
      });

      const data = await response.json();
      if (data.approvalUrl) {
        window.location.href = data.approvalUrl;
      } else {
        alert(data.message || 'Subscription functionality coming soon!');
      }
    } catch (error) {
      console.error('Subscription error:', error);
      alert('Failed to start subscription. Please try again.');
    }
  };

  const tierIcons = {
    dreamer: Sparkles,
    storyteller: Wand2,
    family: Users
  };

  const tierLabels = {
    dreamer: 'Explorer',
    storyteller: 'Creator',
    family: 'Studio'
  };

  const tierColors = {
    dreamer: 'from-narrimo-sage to-slate-700',
    storyteller: 'from-narrimo-coral to-[#ff8579]',
    family: 'from-slate-700 to-narrimo-sage'
  };

  return (
    <Layout>
      <PageContainer maxWidth="6xl" className="pt-20 pb-8">
        {/* Header */}
        <PageHeader
          title="Subscription Plans"
          subtitle="Choose the plan that fits your creative pace"
          backPath="/"
        />

        {/* Current Plan */}
        {subscription && (
          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700 mb-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400 mb-1">Current Plan</p>
                <p className="text-xl font-bold text-white capitalize">{tierLabels[subscription.tier] || subscription.tier}</p>
              </div>
              {usage && (
                <div className="text-right">
                  <p className="text-sm text-slate-400 mb-1">This Month's Usage</p>
                  <p className="text-white">
                    {usage.storiesGenerated} / {usage.storiesLimit} stories
                  </p>
                  <p className="text-slate-400 text-sm">
                    {usage.minutesUsed?.toFixed(1)} / {usage.minutesLimit} min narration
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* PayPal Notice */}
        {!paypalConfigured && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-8 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-200 font-medium">Payment System Coming Soon</p>
              <p className="text-amber-200/70 text-sm">
                We're finalizing our payment integration. In the meantime, enjoy the free tier
                or contact support for early access to premium features.
              </p>
            </div>
          </div>
        )}

        {/* Plans Grid */}
        <div className="grid md:grid-cols-3 gap-6">
          {loading ? (
            <div className="col-span-3 text-center py-12 text-slate-400">
              Loading plans...
            </div>
          ) : (
            plans.map((plan) => {
              const Icon = tierIcons[plan.id] || Star;
              const isCurrentPlan = subscription?.tier === plan.id;
              const gradient = tierColors[plan.id] || 'from-gray-500 to-gray-700';
              const displayName = tierLabels[plan.id] || plan.name;

              return (
                <div
                  key={plan.id}
                  className={`relative bg-slate-800/50 rounded-xl border overflow-hidden
                             ${isCurrentPlan ? 'border-narrimo-coral' : 'border-slate-700'}
                             ${plan.popular ? 'ring-2 ring-narrimo-coral/40' : ''}`}
                >
                  {plan.popular && (
                    <div className="absolute top-0 right-0 bg-narrimo-coral text-narrimo-midnight text-xs font-bold
                                   px-3 py-1 rounded-bl-lg">
                      MOST POPULAR
                    </div>
                  )}

                  {/* Header */}
                  <div className={`p-6 bg-gradient-to-r ${gradient}`}>
                    <Icon className="w-8 h-8 text-white mb-3" />
                    <h3 className="text-xl font-bold text-white">{displayName}</h3>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-3xl font-bold text-white">${plan.price}</span>
                      <span className="text-white/70">/month</span>
                    </div>
                  </div>

                  {/* Features */}
                  <div className="p-6">
                    <ul className="space-y-3 mb-6">
                      {plan.features.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-slate-300">
                          <Check className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>

                    {isCurrentPlan ? (
                      <div className="w-full py-3 bg-slate-700 rounded-lg text-center text-slate-400 font-medium">
                        Current Plan
                      </div>
                    ) : (
                      <button
                        onClick={() => handleSubscribe(plan.id)}
                        disabled={!paypalConfigured}
                        className={`w-full py-3 rounded-lg font-medium transition-colors
                                  ${paypalConfigured
                                    ? 'bg-narrimo-coral hover:bg-[#ff8579] text-narrimo-midnight'
                                    : 'bg-slate-700 text-slate-400 cursor-not-allowed'}`}
                      >
                        {paypalConfigured ? 'Subscribe' : 'Coming Soon'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Free Tier Info */}
        <div className="mt-8 bg-slate-800/30 rounded-xl p-6 border border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-4">Free Tier</h3>
          <div className="flex flex-wrap gap-6 text-slate-300">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-narrimo-coral" />
              <span>1 story per month</span>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-narrimo-coral" />
              <span>10 minutes of narration</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-narrimo-coral" />
              <span>1 user profile</span>
            </div>
          </div>
          <p className="text-slate-400 text-sm mt-4">
            Perfect for trying Narrimo. Upgrade anytime for more stories and features!
          </p>
        </div>
      </PageContainer>
    </Layout>
  );
}

export default Subscription;
