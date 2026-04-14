import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { setupCapacitorFetch } from "./util/capacitor-fetch";
import { setupDeepLinkHandling } from "./lib/auth-config";
import { ErrorBoundary } from "./components/ErrorBoundary";

console.log("[main.tsx] Starting app initialization...");

// Initialize Capacitor HTTP for iOS/Android
console.log("[main.tsx] Setting up Capacitor fetch...");
setupCapacitorFetch();

// Initialize deep link handling for native OAuth/email confirmation
console.log("[main.tsx] Setting up deep link handling...");
setupDeepLinkHandling();

console.log("[main.tsx] Rendering React app...");
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
console.log("[main.tsx] React app render scheduled");
// Note: Splash screen removal is handled by SplashScreen component in App.tsx
// after React has actually mounted (via useEffect)
