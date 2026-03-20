import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Progress } from "@/components/ui/progress";

const LoadingScreen = () => {
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          return 100;
        }
        return prev + 0.625;
      });
    }, 50);

    const timer = setTimeout(() => {
      navigate("/auth");
    }, 8000);

    return () => {
      clearTimeout(timer);
      clearInterval(progressInterval);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <h1 className="text-5xl font-bold mb-4">MinimaLog</h1>
          <p className="text-xl text-muted-foreground">You log we track</p>
        </div>
        
        <div className="space-y-4 pt-12">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-muted-foreground/30">Customizing app for you</p>
        </div>
      </div>
    </div>
  );
};

export default LoadingScreen;
