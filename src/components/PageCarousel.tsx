import { useEffect, useState, useRef, lazy, Suspense } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Swiper, SwiperSlide } from 'swiper/react';
import type { Swiper as SwiperType } from 'swiper';
import 'swiper/css';
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";

// Lazy load pages for better initial bundle size
const Home = lazy(() => import("@/pages/Home"));
const History = lazy(() => import("@/pages/History"));
const Progress = lazy(() => import("@/pages/Progress"));
const AIHelp = lazy(() => import("@/pages/AIHelp"));
const Profile = lazy(() => import("@/pages/Profile"));

const navOrder = ["/history", "/progress", "/", "/ai-help", "/profile"];
const pageComponents: Record<string, React.ComponentType> = {
  "/history": History,
  "/progress": Progress,
  "/": Home,
  "/ai-help": AIHelp,
  "/profile": Profile,
};

export const PageCarousel = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const swiperRef = useRef<SwiperType | null>(null);
  const derivedIndex = navOrder.indexOf(location.pathname);
  const resolvedIndex = derivedIndex === -1 ? 2 : derivedIndex;
  const totalSlides = navOrder.length;
  const [sliderPosition, setSliderPosition] = useState(resolvedIndex);
  const [visitedRoutes, setVisitedRoutes] = useState<Set<number>>(
    () => new Set([resolvedIndex])
  );

  // Keep the swiper in sync with the URL-driven index
  useEffect(() => {
    if (derivedIndex === -1 && location.pathname !== "/") {
      navigate("/", { replace: true });
    }

    const swiper = swiperRef.current;
    if (swiper && swiper.activeIndex !== resolvedIndex) {
      swiper.slideTo(resolvedIndex, 0);
    }

    setSliderPosition(resolvedIndex);
    setVisitedRoutes((prev) => {
      if (prev.has(resolvedIndex)) return prev;
      const next = new Set(prev);
      next.add(resolvedIndex);
      return next;
    });
  }, [resolvedIndex, derivedIndex, location.pathname, navigate]);

  const handleSlideChange = (swiper: SwiperType) => {
    const newIndex = swiper.activeIndex;

    // Trigger haptic feedback on native platforms
    if (Capacitor.isNativePlatform()) {
      Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
    }

    setSliderPosition(newIndex);
    setVisitedRoutes((prev) => {
      if (prev.has(newIndex)) return prev;
      const next = new Set(prev);
      next.add(newIndex);
      return next;
    });
    if (navOrder[newIndex] !== location.pathname) {
      navigate(navOrder[newIndex], { replace: true });
    }
  };

  const handleSlideProgress = (swiper: SwiperType, progress: number) => {
    const absolute = progress * (totalSlides - 1);
    setSliderPosition(absolute);
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-hidden relative">
        <Swiper
          onSwiper={(swiper) => (swiperRef.current = swiper)}
          onSlideChange={handleSlideChange}
          onProgress={handleSlideProgress}
          initialSlide={resolvedIndex}
          spaceBetween={0}
          slidesPerView={1}
          speed={300}
          touchRatio={1}
          threshold={10}
          resistance={true}
          resistanceRatio={0.85}
          preventInteractionOnTransition={false}
          touchStartPreventDefault={false}
          simulateTouch={true}
          allowTouchMove={true}
          className="h-full w-full"
          style={{ 
            width: '100%', 
            height: '100%',
          }}
        >
          {navOrder.map((route, index) => {
            const PageComponent = pageComponents[route];
            const isNearby = Math.abs(sliderPosition - index) <= 1.1;
            const shouldRender = visitedRoutes.has(index) || isNearby;
            return (
              <SwiperSlide key={route} className="h-full w-full">
                <div className="h-full w-full overflow-y-auto bg-background smooth-scroll">
                  {shouldRender ? (
                    <Suspense
                      fallback={
                        <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                          Loading...
                        </div>
                      }
                    >
                      <PageComponent />
                    </Suspense>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                      Loading...
                    </div>
                  )}
                </div>
              </SwiperSlide>
            );
          })}
        </Swiper>

        {/* Floating Action Button */}
        <div
          className="absolute z-50 flex justify-center"
          style={{
            right: '0',
            left: '80%',
            bottom: 'calc(env(safe-area-inset-bottom) + 90px)',
            pointerEvents: 'auto',
          }}
        >
          <Button
            size="lg"
            className="rounded-full h-14 w-14 shadow-lg"
            onClick={() => navigate("/start-workout")}
          >
            <Plus className="h-6 w-6" />
          </Button>
        </div>
      </div>

      <BottomNav currentIndex={sliderPosition} />
    </div>
  );
};
