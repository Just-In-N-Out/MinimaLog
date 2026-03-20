import React, { Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";

import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { PageCarousel } from "@/components/PageCarousel";
import { AuthProvider } from "@/contexts/AuthContext";

// Lazy-load non-carousel routes for code splitting
const Auth = React.lazy(() => import("./pages/Auth"));
const Onboarding = React.lazy(() => import("./pages/Onboarding"));
const LoadingScreen = React.lazy(() => import("./pages/LoadingScreen"));
const StartWorkout = React.lazy(() => import("./pages/StartWorkout"));
const WorkoutSession = React.lazy(() => import("./pages/WorkoutSession"));
const WorkoutDetail = React.lazy(() => import("./pages/WorkoutDetail"));
const ExerciseProgressDetail = React.lazy(() => import("./pages/ExerciseProgressDetail"));
const NotFound = React.lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const MainRoutes = () => {
  const location = useLocation();
  const carouselRoutes = ["/history", "/progress", "/", "/prs", "/profile"];
  const isCarouselRoute = carouselRoutes.includes(location.pathname);

  if (isCarouselRoute) {
    return <PageCarousel />;
  }

  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/loading" element={<LoadingScreen />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/start-workout" element={<StartWorkout />} />
        <Route path="/workout/:id" element={<WorkoutSession />} />
        <Route path="/workout-detail/:id" element={<WorkoutDetail />} />
        <Route path="/exercise-progress/:exerciseId" element={<ExerciseProgressDetail />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
          <MainRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
