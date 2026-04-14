import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft } from "lucide-react";

const Info = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("about");

  return (
    <div className="min-h-screen w-full flex flex-col overflow-hidden bg-background">
      {/* Header with iOS safe area */}
      <header className="border-b bg-background z-10 flex-shrink-0 pb-4" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px) + 1rem, 2.5rem)' }}>
        <div className="container mx-auto px-4 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Information</h1>
        </div>
      </header>

      {/* Content - scrollable */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden smooth-scroll">
        <div className="container mx-auto px-4 py-6 max-w-3xl">
          <div className="rounded-3xl border border-border bg-background shadow-sm overflow-hidden">
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList className="flex w-full bg-background rounded-none">
                <TabsTrigger
                  value="about"
                  className="flex-1 px-4 py-3 text-sm font-semibold rounded-none transition-colors data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=inactive]:bg-muted data-[state=inactive]:text-muted-foreground"
                >
                  About Us
                </TabsTrigger>
                <TabsTrigger
                  value="privacy"
                  className="flex-1 px-4 py-3 text-sm font-semibold rounded-none transition-colors data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=inactive]:bg-muted data-[state=inactive]:text-muted-foreground"
                >
                  Privacy Policy
                </TabsTrigger>
              </TabsList>

              <TabsContent value="about" className="space-y-4 mt-0 px-4 pb-6 pt-4 sm:px-6 sm:pt-6">
                <Card className="bg-background shadow-sm rounded-3xl border-0">
                  <CardContent className="p-6 md:p-8">
                    <div className="space-y-6 text-center md:text-left">
                      <h2 className="text-2xl font-bold">About Us</h2>
                    
                    <div className="space-y-4 text-muted-foreground leading-relaxed text-sm">
                      <p>
                        We built Minima Log for real lifters — the ones who don't need flashy charts or endless screens just to track a workout. We got tired of cluttered apps that tried to be everything and forgot the basics.
                      </p>
                      
                      <p>
                        Our approach is simple: less noise, more iron. The design gets out of your way so you can focus on training, not tapping. Log your sets, track your progress, and get AI-powered suggestions when you actually want them.
                      </p>
                      
                      <p>
                        No gimmicks. No influencer fluff. Just pure functionality that respects your time and your grind.
                      </p>
                      
                      <p className="font-medium text-foreground pt-2">
                        Because in the gym — and in our app — every rep, every set, every word counts.
                      </p>
                    </div>
                    
                    <div className="pt-4 border-t text-center md:text-left">
                      <p className="text-base font-semibold text-foreground">You log, We track</p>
                    </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="privacy" className="space-y-4 mt-0 px-4 pb-6 pt-4 sm:px-6 sm:pt-6">
                <Card className="bg-background shadow-sm rounded-3xl border-0">
                  <CardContent className="p-6 md:p-8">
                    <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold mb-2">Privacy Policy</h2>
                      <p className="text-xs text-muted-foreground">Last updated: {new Date().toLocaleDateString()}</p>
                    </div>

                    <div className="space-y-5 text-muted-foreground leading-relaxed text-sm">
                      <section className="space-y-2">
                        <h3 className="text-base font-semibold text-foreground">Introduction</h3>
                        <p>
                          Minimalift ("we", "our", or "us") respects your privacy. This Privacy Policy explains how we collect, use, and protect your personal information when you use our workout tracking application.
                        </p>
                      </section>

                      <section className="space-y-2">
                        <h3 className="text-base font-semibold text-foreground">Information We Collect</h3>
                        <p>
                          <strong className="text-foreground">Account Information:</strong> When you create an account, we collect your email address and profile information you choose to provide.
                        </p>
                        <p>
                          <strong className="text-foreground">Workout Data:</strong> We store your workout logs, exercises, sets, reps, weights, personal records (PRs), and training history.
                        </p>
                        <p>
                          <strong className="text-foreground">Usage Information:</strong> We may collect information about how you use the app, including features accessed and interaction patterns.
                        </p>
                      </section>

                      <section className="space-y-2">
                        <h3 className="text-base font-semibold text-foreground">How We Use Your Information</h3>
                        <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                          <li>To provide and maintain our workout tracking service</li>
                          <li>To track your progress and personal records</li>
                          <li>To generate AI-powered workout suggestions</li>
                          <li>To improve and optimize the app experience</li>
                          <li>To communicate with you about your account</li>
                        </ul>
                      </section>

                      <section className="space-y-2">
                        <h3 className="text-base font-semibold text-foreground">Data Storage and Security</h3>
                        <p>
                          Your data is stored securely using industry-standard encryption. We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, or destruction.
                        </p>
                      </section>

                      <section className="space-y-2">
                        <h3 className="text-base font-semibold text-foreground">Data Sharing</h3>
                        <p>
                          We do not sell your personal information. We only share your data in the following circumstances:
                        </p>
                        <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                          <li>With your explicit consent</li>
                          <li>To comply with legal obligations</li>
                          <li>With service providers who help us operate the app (under strict confidentiality agreements)</li>
                        </ul>
                      </section>

                      <section className="space-y-2">
                        <h3 className="text-base font-semibold text-foreground">Your Rights</h3>
                        <p>You have the right to:</p>
                        <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                          <li>Access your personal data</li>
                          <li>Correct inaccurate data</li>
                          <li>Request deletion of your data</li>
                          <li>Export your workout data</li>
                          <li>Opt out of certain data processing activities</li>
                        </ul>
                      </section>

                      <section className="space-y-2">
                        <h3 className="text-base font-semibold text-foreground">Children's Privacy</h3>
                        <p>
                          Our service is not intended for users under the age of 13. We do not knowingly collect personal information from children under 13.
                        </p>
                      </section>

                      <section className="space-y-2">
                        <h3 className="text-base font-semibold text-foreground">Changes to This Policy</h3>
                        <p>
                          We may update this Privacy Policy from time to time. We will notify you of any changes by updating the "Last updated" date at the top of this policy.
                        </p>
                      </section>

                      <section className="space-y-2">
                        <h3 className="text-base font-semibold text-foreground">Contact Us</h3>
                        <p>
                          If you have questions about this Privacy Policy or how we handle your data, please contact us through the app's support channels.
                        </p>
                      </section>
                    </div>
                  </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Info;
