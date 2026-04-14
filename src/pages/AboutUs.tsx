import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

const AboutUs = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Header with back button */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="container mx-auto px-4 py-4 flex items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            title="Back to Home"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold ml-4">About Us</h1>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-6 py-12 max-w-3xl">
        <Card className="bg-muted/50">
          <CardContent className="p-8 md:p-12">
            <div className="space-y-8 text-center">
              <h2 className="text-3xl font-bold">About Us</h2>
              
              <div className="space-y-6 text-muted-foreground leading-relaxed">
                <p>
                  We built Minima Log for real lifters — the ones who don't need flashy charts or endless screens just to track a workout. We got tired of cluttered apps that tried to be everything and forgot the basics.
                </p>
                
                <p>
                  Our approach is simple: less noise, more iron. The design gets out of your way so you can focus on training, not tapping. Log your sets, track your progress, and get AI-powered suggestions when you actually want them.
                </p>
                
                <p>
                  No gimmicks. No influencer fluff. Just pure functionality that respects your time and your grind.
                </p>
                
                <p className="font-medium text-foreground">
                  Because in the gym — and in our app — every rep, every set, every word counts.
                </p>
              </div>
              
              <div className="pt-6 border-t space-y-4">
                <p className="text-lg font-semibold text-foreground">You log, We track</p>
                <Button 
                  variant="outline" 
                  onClick={() => navigate("/privacy-policy")}
                  className="w-full sm:w-auto"
                >
                  Privacy Policy
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default AboutUs;
