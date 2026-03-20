import React, { Suspense, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, PanInfo, useMotionValue, animate } from "framer-motion";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

// Lazy-load carousel pages for code splitting
const Home = React.lazy(() => import("@/pages/Home"));
const History = React.lazy(() => import("@/pages/History"));
const Progress = React.lazy(() => import("@/pages/Progress"));
const PRs = React.lazy(() => import("@/pages/PRs"));
const Profile = React.lazy(() => import("@/pages/Profile"));

const navOrder = ["/history", "/progress", "/", "/prs", "/profile"];
const pageComponents: Record<string, React.ComponentType> = {
  "/history": History,
  "/progress": Progress,
  "/": Home,
  "/prs": PRs,
  "/profile": Profile,
};

export const PageCarousel = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const x = useMotionValue(0);
  const [currentIndex, setCurrentIndex] = useState(navOrder.indexOf(location.pathname));

  useEffect(() => {
    const newIndex = navOrder.indexOf(location.pathname);
    setCurrentIndex(newIndex);
    // Animate to the correct position
    animate(x, -newIndex * window.innerWidth, {
      type: "spring",
      stiffness: 300,
      damping: 30,
    });
  }, [location.pathname, x]);

  const handleDragEnd = (_: any, info: PanInfo) => {
    const threshold = 80;
    const velocity = info.velocity.x;
    const offset = info.offset.x;

    // Swipe right (go to previous page)
    if ((offset > threshold || velocity > 500) && currentIndex > 0) {
      navigate(navOrder[currentIndex - 1]);
    }
    // Swipe left (go to next page)
    else if ((offset < -threshold || velocity < -500) && currentIndex < navOrder.length - 1) {
      navigate(navOrder[currentIndex + 1]);
    }
    // Snap back to current page
    else {
      animate(x, -currentIndex * window.innerWidth, {
        type: "spring",
        stiffness: 400,
        damping: 35,
      });
    }
  };

  return (
    <>
      <div className="fixed inset-0 overflow-hidden">
        <motion.div
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={handleDragEnd}
          style={{ x }}
          className="flex h-full touch-pan-y"
        >
          {navOrder.map((route, index) => {
            const PageComponent = pageComponents[route];
            const isVisible = Math.abs(index - currentIndex) <= 2;
            
            return (
              <div
                key={route}
                className="h-full flex-shrink-0 overflow-y-auto"
                style={{ width: `${window.innerWidth}px` }}
              >
                {isVisible && (
                  <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}>
                    <PageComponent />
                  </Suspense>
                )}
              </div>
            );
          })}
        </motion.div>
      </div>
      
      {/* Floating Action Button */}
      <div className="fixed bottom-24 right-6 z-50">
        <Button
          size="lg"
          className="rounded-full h-14 w-14 shadow-lg"
          onClick={() => navigate("/start-workout")}
        >
          <Plus className="h-6 w-6" />
        </Button>
      </div>
      
      <BottomNav />
    </>
  );
};
