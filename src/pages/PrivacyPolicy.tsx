import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

const PrivacyPolicy = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Header with back button */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="container mx-auto px-4 py-4 flex items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/about")}
            title="Back to About"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold ml-4">Privacy Policy</h1>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-6 py-12 max-w-3xl">
        <Card className="bg-muted/50">
          <CardContent className="p-8 md:p-12">
            <div className="space-y-8">
              <div>
                <h2 className="text-3xl font-bold mb-4">Privacy Policy</h2>
                <p className="text-sm text-muted-foreground">Last updated: {new Date().toLocaleDateString()}</p>
              </div>

              <div className="space-y-6 text-muted-foreground leading-relaxed">
                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">Introduction</h3>
                  <p>
                    Welcome to MinimaLog! We built this app to help you track your fitness journey, and we take your privacy seriously. This policy explains in plain language what information we collect, how we use it, and who we share it with.
                  </p>
                  <p>
                    MinimaLog ("we", "our", or "us") is committed to protecting your personal information and being transparent about our data practices.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">What Information We Collect</h3>

                  <div className="pl-4 space-y-4">
                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Account & Profile Information (Required)</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li><strong className="text-foreground">Email address</strong> - Used to create your account and send you important updates</li>
                        <li><strong className="text-foreground">Username</strong> - Your public display name (3-20 characters)</li>
                        <li><strong className="text-foreground">Password</strong> (if you sign up with email) - We never store your actual password, only an encrypted version</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Profile Information (Optional)</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li><strong className="text-foreground">Profile picture</strong> - Photos you upload from your camera or photo library</li>
                        <li><strong className="text-foreground">Bio</strong> - Up to 240 characters about yourself</li>
                        <li><strong className="text-foreground">Display name</strong> - How you want to be known in the app</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Fitness & Health Data</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li><strong className="text-foreground">Workout logs</strong> - Exercises, sets, reps, weights, duration, and notes</li>
                        <li><strong className="text-foreground">Personal Records (PRs)</strong> - Your best lifts for squat, bench press, deadlift</li>
                        <li><strong className="text-foreground">Body measurements</strong> (optional) - Current bodyweight and height</li>
                        <li><strong className="text-foreground">Wellness metrics</strong> (optional) - Sleep quality ratings and mood scores</li>
                        <li><strong className="text-foreground">Training preferences</strong> - Your goals, training style, and motivation</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Social Activity</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li><strong className="text-foreground">Posts</strong> - Workouts you choose to share publicly or with followers</li>
                        <li><strong className="text-foreground">Follows & Followers</strong> - Your social connections within the app</li>
                        <li><strong className="text-foreground">Privacy settings</strong> - Whether your account is public or private</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Photos & Media</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li><strong className="text-foreground">Camera access</strong> - Only when you take a photo for your profile or workout posts</li>
                        <li><strong className="text-foreground">Photo library access</strong> - Only when you choose to upload a photo</li>
                        <li>We compress and resize profile pictures to optimize storage and performance</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Technical Data</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li><strong className="text-foreground">Device information</strong> - Platform (iOS/Android), network status (for offline mode)</li>
                        <li><strong className="text-foreground">App performance</strong> - Load times and performance metrics (stored locally, not sent anywhere)</li>
                        <li><strong className="text-foreground">Crash reports</strong> - If the app crashes, we may collect basic diagnostic info</li>
                      </ul>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">How We Use Your Information</h3>
                  <p>We use your information to:</p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li><strong className="text-foreground">Run the app</strong> - Store your workouts, track your progress, and show you your PRs</li>
                    <li><strong className="text-foreground">Enable social features</strong> - Let you share workouts with friends and see their progress</li>
                    <li><strong className="text-foreground">Provide AI coaching</strong> - Generate personalized workout tips (only when you request them)</li>
                    <li><strong className="text-foreground">Send important updates</strong> - Account notifications, security alerts, and app updates</li>
                    <li><strong className="text-foreground">Improve the app</strong> - Fix bugs, optimize performance, and build new features</li>
                    <li><strong className="text-foreground">Provide offline access</strong> - Cache your data locally so you can log workouts without internet</li>
                  </ul>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">Third-Party AI Services (Google Gemini AI)</h3>
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 space-y-2">
                    <p className="font-semibold text-foreground">Important: AI Tips Feature</p>
                    <p>
                      When you use our AI-powered workout tips feature, we send some of your workout data to <strong className="text-foreground">Google Gemini AI</strong>, a third-party artificial intelligence service provided by Google LLC.
                    </p>
                  </div>

                  <div className="pl-4 space-y-3 mt-4">
                    <div>
                      <h4 className="font-semibold text-foreground mb-2">What data goes to Google?</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li>Your recent workout history (last 2-4 weeks)</li>
                        <li>Exercise names, weights, reps, and sets</li>
                        <li>Muscle groups you've trained</li>
                        <li>Your wellness metrics (sleep quality, mood ratings)</li>
                        <li>Your fitness goals and training preferences</li>
                        <li>Previous AI tips you've received (to avoid repetition)</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">What does NOT go to Google?</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li>Your email address, username, or account information</li>
                        <li>Your photos or profile pictures</li>
                        <li>Your social connections or posts</li>
                        <li>Any personal identifiers</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Your control:</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li><strong className="text-foreground">This feature is optional</strong> - AI tips are only generated when you explicitly request them</li>
                        <li><strong className="text-foreground">Limited usage</strong> - You can generate up to 5 AI tips per day</li>
                        <li><strong className="text-foreground">You'll be asked for consent</strong> - Before your first AI tip, we'll explain what data is shared and ask for your permission</li>
                        <li><strong className="text-foreground">You can opt out</strong> - Disable AI features anytime in Privacy Settings</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Google's Privacy Policy:</h4>
                      <p>
                        Google's use of your workout data is governed by their privacy policy. Learn more at:{" "}
                        <a
                          href="https://policies.google.com/privacy"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          https://policies.google.com/privacy
                        </a>
                      </p>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">Backend Services (Supabase)</h3>
                  <p>
                    We use <strong className="text-foreground">Supabase</strong> (provided by Supabase Inc.) to store and manage all your app data. This includes your profile, workouts, posts, and photos.
                  </p>

                  <div className="pl-4 space-y-3">
                    <div>
                      <h4 className="font-semibold text-foreground mb-2">What data is stored on Supabase?</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li>All account information and authentication data</li>
                        <li>All workout logs, PRs, and training history</li>
                        <li>Social posts, follows, and followers</li>
                        <li>Profile pictures and workout photos (in Supabase Storage)</li>
                        <li>AI suggestion history (the tips you've received)</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Security measures:</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li><strong className="text-foreground">Encrypted in transit</strong> - All data is transmitted using TLS 1.2+ encryption</li>
                        <li><strong className="text-foreground">Row Level Security (RLS)</strong> - You can only access your own data, unless you've shared it publicly</li>
                        <li><strong className="text-foreground">Secure authentication</strong> - Industry-standard auth protocols protect your account</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Supabase's Privacy Policy:</h4>
                      <p>
                        Learn more about how Supabase protects your data:{" "}
                        <a
                          href="https://supabase.com/privacy"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          https://supabase.com/privacy
                        </a>
                      </p>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">Authentication Providers</h3>
                  <p>We offer multiple ways to sign in to make account creation easier:</p>

                  <div className="pl-4 space-y-3">
                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Sign in with Apple</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li>We receive your email address and first name (if you choose to share them)</li>
                        <li>Apple's privacy policy applies to this authentication method</li>
                        <li>You can choose to hide your email by using Apple's private relay</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Sign in with Google</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li>We receive your email address and display name</li>
                        <li>Google's OAuth privacy policy applies to this authentication method</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Email Magic Link</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li>Passwordless sign-in - We send you a one-time link via email</li>
                        <li>Links expire after 5 minutes for security</li>
                        <li>No passwords stored or shared</li>
                      </ul>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">Data Sharing & Social Features</h3>

                  <div className="pl-4 space-y-3">
                    <div>
                      <h4 className="font-semibold text-foreground mb-2">What you control:</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li><strong className="text-foreground">Public posts</strong> - When you share a workout to the feed, it's visible to all users</li>
                        <li><strong className="text-foreground">Private account mode</strong> - Set your account to private so only approved followers see your posts</li>
                        <li><strong className="text-foreground">Profile visibility</strong> - Your username, avatar, and bio are always public (so people can find and follow you)</li>
                        <li><strong className="text-foreground">Workout privacy</strong> - You choose what to share - keep workouts private or post them publicly</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">What we DON'T do with your data:</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li className="text-foreground font-semibold">We DO NOT sell your personal information to anyone</li>
                        <li className="text-foreground font-semibold">We DO NOT share your data with advertisers</li>
                        <li className="text-foreground font-semibold">We DO NOT use third-party analytics or tracking services</li>
                        <li className="text-foreground font-semibold">We DO NOT share your workout data with anyone except Google Gemini AI (and only when you use AI tips)</li>
                      </ul>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">Local Storage & Offline Mode</h3>
                  <p>
                    To make the app work offline, we store some of your data locally on your device:
                  </p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li><strong className="text-foreground">Cached workout data</strong> - So you can log workouts without internet</li>
                    <li><strong className="text-foreground">Exercise library</strong> - Exercise names, instructions, and images downloaded for offline use</li>
                    <li><strong className="text-foreground">Profile info</strong> - Your basic profile data for quick access</li>
                    <li><strong className="text-foreground">App preferences</strong> - Theme (dark/light mode) and other settings</li>
                    <li><strong className="text-foreground">Authentication tokens</strong> - So you stay logged in</li>
                  </ul>
                  <p className="mt-3">
                    This local data syncs with Supabase when you're back online. You can clear the cache anytime from the app settings.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">Data Retention</h3>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li><strong className="text-foreground">Active accounts</strong> - We keep your data as long as your account is active</li>
                    <li><strong className="text-foreground">Deleted accounts</strong> - When you delete your account, we permanently remove all your data from our systems within 30 days</li>
                    <li><strong className="text-foreground">Legal obligations</strong> - We may retain certain data longer if required by law</li>
                    <li><strong className="text-foreground">Backups</strong> - Deleted data may persist in backup systems for up to 90 days before being fully purged</li>
                  </ul>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">Your Privacy Rights</h3>
                  <p>You have complete control over your data. Here's what you can do:</p>

                  <div className="pl-4 space-y-3">
                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Access & View</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li>View all your workout data, posts, and profile information anytime in the app</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Edit & Update</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li>Change your username, bio, profile picture, bodyweight, and height in Settings</li>
                        <li>Edit or delete individual workouts and posts</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Privacy Controls</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li>Set your account to public or private</li>
                        <li>Control who can see your posts (public vs followers-only)</li>
                        <li>Enable or disable AI-powered tips</li>
                        <li>Approve or reject follow requests</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold text-foreground mb-2">Delete Your Data</h4>
                      <ul className="list-disc list-inside space-y-1 ml-4">
                        <li><strong className="text-foreground">Delete individual posts</strong> - Tap the delete icon on any post</li>
                        <li><strong className="text-foreground">Delete your entire account</strong> - Go to Settings → Delete Account. This permanently removes all your data including workouts, posts, photos, and profile information from our servers</li>
                        <li>Account deletion is irreversible - make sure you want to do this!</li>
                      </ul>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">When We May Share Your Information</h3>
                  <p>We only share your personal information in these specific situations:</p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li><strong className="text-foreground">With your consent</strong> - When you explicitly choose to share (like posting workouts publicly or generating AI tips)</li>
                    <li><strong className="text-foreground">Service providers</strong> - Supabase (backend), Google Gemini AI (tips feature), Apple/Google (authentication)</li>
                    <li><strong className="text-foreground">Legal requirements</strong> - If required by law, court order, or government request</li>
                    <li><strong className="text-foreground">Safety & security</strong> - To protect against fraud, abuse, or security threats</li>
                    <li><strong className="text-foreground">Business transfers</strong> - If we're acquired or merged with another company (you'll be notified)</li>
                  </ul>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">Children's Privacy</h3>
                  <p>
                    MinimaLog is not intended for children under 13 years of age. We do not knowingly collect personal information from children under 13. If you are a parent or guardian and believe your child has provided us with personal information, please contact us and we will delete that information.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">International Data Transfers</h3>
                  <p>
                    Your data may be transferred to and stored on servers located outside your country. By using MinimaLog, you consent to the transfer of your information to countries that may have different data protection laws than your country. We ensure appropriate safeguards are in place to protect your data.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">California Privacy Rights (CCPA)</h3>
                  <p>
                    If you are a California resident, you have additional rights under the California Consumer Privacy Act (CCPA):
                  </p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li><strong className="text-foreground">Right to know</strong> - Request what personal information we collect and how we use it</li>
                    <li><strong className="text-foreground">Right to delete</strong> - Request deletion of your personal information</li>
                    <li><strong className="text-foreground">Right to opt-out</strong> - We don't sell personal information, so there's nothing to opt out of</li>
                    <li><strong className="text-foreground">Right to non-discrimination</strong> - We won't discriminate against you for exercising your privacy rights</li>
                  </ul>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">European Privacy Rights (GDPR)</h3>
                  <p>
                    If you are in the European Economic Area (EEA), you have additional rights under the General Data Protection Regulation (GDPR):
                  </p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li><strong className="text-foreground">Right to access</strong> - Get a copy of your personal data</li>
                    <li><strong className="text-foreground">Right to rectification</strong> - Correct inaccurate data</li>
                    <li><strong className="text-foreground">Right to erasure</strong> - Request deletion of your data</li>
                    <li><strong className="text-foreground">Right to restrict processing</strong> - Limit how we use your data</li>
                    <li><strong className="text-foreground">Right to data portability</strong> - Receive your data in a portable format</li>
                    <li><strong className="text-foreground">Right to object</strong> - Object to certain types of processing</li>
                    <li><strong className="text-foreground">Right to withdraw consent</strong> - Withdraw consent for data processing at any time</li>
                  </ul>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">Changes to This Privacy Policy</h3>
                  <p>
                    We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. When we make changes:
                  </p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li>We'll update the "Last updated" date at the top of this page</li>
                    <li>For significant changes, we'll notify you via email or in-app notification</li>
                    <li>Continued use of the app after changes means you accept the updated policy</li>
                  </ul>
                  <p className="mt-3">
                    We encourage you to review this Privacy Policy periodically to stay informed about how we protect your information.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">Contact Us</h3>
                  <p>
                    If you have any questions, concerns, or requests regarding this Privacy Policy or how we handle your personal information, please contact us:
                  </p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li>Through the app's support channels</li>
                    <li>Via email: support@minimalog.app (if applicable)</li>
                  </ul>
                  <p className="mt-3">
                    We'll respond to your inquiry within 30 days.
                  </p>
                </section>

                <section className="bg-muted/30 rounded-lg p-6 space-y-3">
                  <h3 className="text-xl font-semibold text-foreground">Summary</h3>
                  <p className="font-medium">
                    The bottom line: We collect the information needed to run the app and help you track your fitness. We use Supabase to store your data securely. If you use AI tips, we send workout data to Google Gemini AI (with your consent). We don't sell your data, we don't use ads, and you have full control over your information.
                  </p>
                </section>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default PrivacyPolicy;
