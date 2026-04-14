import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Crown, Sparkles, Calendar, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubscription } from '@/hooks/useSubscription';
import { Paywall } from '@/components/Paywall';
import { SubscriptionBadge, FreeBadge } from '@/components/SubscriptionBadge';

export default function SubscriptionSettings() {
  const navigate = useNavigate();
  const {
    isPremium,
    isLoading,
    customerInfo,
    isInTrial,
    trialEndsAt,
    workoutCountThisMonth,
    templateCount,
    remainingWorkouts,
    remainingTemplates,
  } = useSubscription();
  const [showPaywall, setShowPaywall] = useState(false);

  const formatDate = (date: Date | null) => {
    if (!date) return 'N/A';
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  return (
    <div className="min-h-screen bg-background overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 pb-safe-bottom pt-24">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate('/profile')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Subscription</h1>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading subscription details...</p>
          </div>
        ) : (
          <>
            {/* Current Plan Card */}
            <div className="bg-card border rounded-lg p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Crown className={`h-6 w-6 ${isPremium ? 'text-yellow-500' : 'text-gray-400'}`} />
                  <h2 className="text-xl font-semibold">
                    {isPremium ? 'Premium Member' : 'Free Plan'}
                  </h2>
                </div>
                {isPremium ? (
                  <SubscriptionBadge showTrial={isInTrial} />
                ) : (
                  <FreeBadge />
                )}
              </div>

              {isPremium ? (
                <div className="space-y-3">
                  <p className="text-muted-foreground">
                    You have full access to all premium features
                  </p>

                  {isInTrial && trialEndsAt && (
                    <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-blue-600" />
                        <span className="font-medium text-blue-800 dark:text-blue-200">
                          Trial ends on {formatDate(trialEndsAt)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Subscription details if available */}
                  {customerInfo && (
                    <div className="text-sm text-muted-foreground space-y-1 mt-4">
                      <p>Manage your subscription in the App Store</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Free tier usage stats */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-background border rounded-lg p-4">
                      <div className="text-2xl font-bold text-primary">
                        {workoutCountThisMonth}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Workouts this month</p>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                        Unlimited
                      </p>
                    </div>

                    <div className="bg-background border rounded-lg p-4">
                      <div className="text-2xl font-bold text-primary">
                        {templateCount}/1
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Templates</p>
                      {remainingTemplates > 0 ? (
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                          {remainingTemplates} remaining
                        </p>
                      ) : (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                          Limit reached
                        </p>
                      )}
                    </div>
                  </div>

                  <Button onClick={() => setShowPaywall(true)} className="w-full" size="lg">
                    <Sparkles className="mr-2 h-4 w-4" />
                    Upgrade to Premium
                  </Button>
                </div>
              )}
            </div>

            {/* Feature Comparison Table */}
            <div className="bg-card border rounded-lg overflow-hidden">
              <div className="bg-gradient-to-r from-primary/10 to-primary/5 p-4 border-b">
                <h3 className="font-semibold flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Compare Plans
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-4 font-medium">Feature</th>
                      <th className="text-center p-4 font-medium w-24">Free</th>
                      <th className="text-center p-4 font-medium w-24 bg-primary/5">Premium</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b hover:bg-muted/50">
                      <td className="p-4">Workout logging</td>
                      <td className="text-center p-4">
                        <span className="text-green-600 dark:text-green-500 font-semibold">Unlimited</span>
                      </td>
                      <td className="text-center p-4 bg-primary/5">
                        <span className="text-green-600 dark:text-green-500 font-semibold">Unlimited</span>
                      </td>
                    </tr>
                    <tr className="border-b hover:bg-muted/50">
                      <td className="p-4">Workout templates</td>
                      <td className="text-center p-4">
                        <span className="text-muted-foreground">1 template</span>
                      </td>
                      <td className="text-center p-4 bg-primary/5">
                        <span className="text-green-600 dark:text-green-500 font-semibold">Unlimited</span>
                      </td>
                    </tr>
                    <tr className="border-b hover:bg-muted/50">
                      <td className="p-4">Exercise analytics</td>
                      <td className="text-center p-4">
                        <span className="text-muted-foreground">1 exercise</span>
                      </td>
                      <td className="text-center p-4 bg-primary/5">
                        <span className="text-green-600 dark:text-green-500 text-xl">✓</span>
                      </td>
                    </tr>
                    <tr className="border-b hover:bg-muted/50">
                      <td className="p-4">Workout history details</td>
                      <td className="text-center p-4">
                        <span className="text-red-600 dark:text-red-400">✗</span>
                      </td>
                      <td className="text-center p-4 bg-primary/5">
                        <span className="text-green-600 dark:text-green-500 text-xl">✓</span>
                      </td>
                    </tr>
                    <tr className="border-b hover:bg-muted/50">
                      <td className="p-4">AI workout tips</td>
                      <td className="text-center p-4">
                        <span className="text-red-600 dark:text-red-400">✗</span>
                      </td>
                      <td className="text-center p-4 bg-primary/5">
                        <span className="text-green-600 dark:text-green-500 text-xl">✓</span>
                      </td>
                    </tr>
                    <tr className="border-b hover:bg-muted/50">
                      <td className="p-4">Exercise history prefill</td>
                      <td className="text-center p-4">
                        <span className="text-red-600 dark:text-red-400">✗</span>
                      </td>
                      <td className="text-center p-4 bg-primary/5">
                        <span className="text-green-600 dark:text-green-500 text-xl">✓</span>
                      </td>
                    </tr>
                    <tr className="hover:bg-muted/50">
                      <td className="p-4 font-medium">Free trial</td>
                      <td className="text-center p-4">
                        <span className="text-muted-foreground">—</span>
                      </td>
                      <td className="text-center p-4 bg-primary/5">
                        <span className="text-green-600 dark:text-green-500 font-semibold">7 days</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Premium User Statistics */}
            {!isPremium && (
              <div className="bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 rounded-lg p-6">
                <h3 className="font-semibold mb-3 text-center">Premium Users See Real Results</h3>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="bg-background/80 backdrop-blur-sm rounded-lg p-4 text-center">
                    <div className="text-3xl font-bold text-green-600 dark:text-green-500 mb-1">2.8x</div>
                    <p className="text-xs text-muted-foreground">More consistent training</p>
                  </div>
                  <div className="bg-background/80 backdrop-blur-sm rounded-lg p-4 text-center">
                    <div className="text-3xl font-bold text-green-600 dark:text-green-500 mb-1">3.2x</div>
                    <p className="text-xs text-muted-foreground">Faster strength gains</p>
                  </div>
                  <div className="bg-background/80 backdrop-blur-sm rounded-lg p-4 text-center">
                    <div className="text-3xl font-bold text-green-600 dark:text-green-500 mb-1">87%</div>
                    <p className="text-xs text-muted-foreground">Track all exercises</p>
                  </div>
                  <div className="bg-background/80 backdrop-blur-sm rounded-lg p-4 text-center">
                    <div className="text-3xl font-bold text-green-600 dark:text-green-500 mb-1">4.1x</div>
                    <p className="text-xs text-muted-foreground">More PRs achieved</p>
                  </div>
                </div>
                <p className="text-xs text-center text-muted-foreground mt-4">
                  Data from September 2025
                </p>
              </div>
            )}

            {/* Manage Subscription (Premium only) */}
            {isPremium && (
              <div className="mt-6 text-center text-sm text-muted-foreground">
                <p>To manage or cancel your subscription,</p>
                <p>open the App Store → Account → Subscriptions</p>
              </div>
            )}
          </>
        )}
      </div>

      <Paywall open={showPaywall} onClose={() => setShowPaywall(false)} />
    </div>
  );
}
