/**
 * Web Vitals Performance Monitoring
 *
 * PERFORMANCE MONITORING:
 * - Tracks Core Web Vitals metrics (CLS, FID, LCP, FCP, TTFB, INP)
 * - Provides real-time performance insights for optimization
 * - Helps identify performance regressions
 * - Can be integrated with analytics services for production monitoring
 *
 * CORE WEB VITALS (Google's key performance metrics):
 * - LCP (Largest Contentful Paint): < 2.5s good, < 4s needs improvement, > 4s poor
 *   Measures loading performance - when the main content becomes visible
 *
 * - FID (First Input Delay): < 100ms good, < 300ms needs improvement, > 300ms poor
 *   Measures interactivity - time from first user interaction to browser response
 *   NOTE: Being replaced by INP (Interaction to Next Paint) in 2024
 *
 * - CLS (Cumulative Layout Shift): < 0.1 good, < 0.25 needs improvement, > 0.25 poor
 *   Measures visual stability - how much content shifts around during load
 *
 * - INP (Interaction to Next Paint): < 200ms good, < 500ms needs improvement, > 500ms poor
 *   Measures overall responsiveness - latency of all user interactions
 *
 * - FCP (First Contentful Paint): < 1.8s good, < 3s needs improvement, > 3s poor
 *   When first content becomes visible
 *
 * - TTFB (Time to First Byte): < 800ms good, < 1800ms needs improvement, > 1800ms poor
 *   Server response time
 *
 * USAGE:
 * Import and call `initWebVitals()` in your App.tsx to start monitoring
 *
 * @example
 * import { initWebVitals } from '@/lib/webVitals';
 *
 * // In App.tsx or main.tsx
 * useEffect(() => {
 *   initWebVitals();
 * }, []);
 */

import { onCLS, onLCP, onFCP, onTTFB, onINP, type Metric } from 'web-vitals';

/**
 * Performance threshold configuration
 * Based on Google's Core Web Vitals recommendations
 */
const THRESHOLDS = {
  LCP: { good: 2500, needsImprovement: 4000 },
  FID: { good: 100, needsImprovement: 300 },
  CLS: { good: 0.1, needsImprovement: 0.25 },
  FCP: { good: 1800, needsImprovement: 3000 },
  TTFB: { good: 800, needsImprovement: 1800 },
  INP: { good: 200, needsImprovement: 500 },
} as const;

/**
 * Determine rating for a metric based on thresholds
 */
function getRating(name: string, value: number): 'good' | 'needs-improvement' | 'poor' {
  const threshold = THRESHOLDS[name as keyof typeof THRESHOLDS];
  if (!threshold) return 'good';

  if (value <= threshold.good) return 'good';
  if (value <= threshold.needsImprovement) return 'needs-improvement';
  return 'poor';
}

/**
 * Format metric value for display
 */
function formatValue(name: string, value: number): string {
  // CLS is unitless, others are in milliseconds
  if (name === 'CLS') {
    return value.toFixed(3);
  }
  return `${value.toFixed(0)}ms`;
}

/**
 * Get emoji indicator based on rating
 */
function getRatingEmoji(rating: 'good' | 'needs-improvement' | 'poor'): string {
  switch (rating) {
    case 'good':
      return '✅';
    case 'needs-improvement':
      return '⚠️';
    case 'poor':
      return '❌';
  }
}

/**
 * Log metric to console with color coding
 */
function logMetric(metric: Metric) {
  const rating = getRating(metric.name, metric.value);
  const emoji = getRatingEmoji(rating);
  const formattedValue = formatValue(metric.name, metric.value);

  // Color code based on rating
  const color =
    rating === 'good' ? '#10b981' : rating === 'needs-improvement' ? '#f59e0b' : '#ef4444';

  console.log(
    `%c${emoji} ${metric.name}: ${formattedValue} (${rating})`,
    `color: ${color}; font-weight: bold; padding: 2px 4px;`
  );

  // Additional details in collapsed group
  console.groupCollapsed(`${metric.name} details`);
  console.log('Rating:', rating);
  console.log('Value:', metric.value);
  console.log('Delta:', metric.delta);
  console.log('ID:', metric.id);
  console.log('Navigation Type:', metric.navigationType);
  console.groupEnd();
}

/**
 * Send metric to analytics service (placeholder)
 * Replace with your analytics integration (GA4, Sentry, etc.)
 */
function sendToAnalytics(metric: Metric) {
  // INTEGRATION POINT: Send to your analytics service
  // Example integrations:

  // Google Analytics 4:
  // if (window.gtag) {
  //   window.gtag('event', metric.name, {
  //     value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
  //     metric_id: metric.id,
  //     metric_value: metric.value,
  //     metric_delta: metric.delta,
  //   });
  // }

  // Sentry:
  // if (window.Sentry) {
  //   window.Sentry.captureMessage(`Web Vital: ${metric.name}`, {
  //     level: 'info',
  //     extra: { metric },
  //   });
  // }

  // Custom API endpoint:
  // fetch('/api/web-vitals', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(metric),
  // });

  // For now, just store in sessionStorage for debugging
  if (import.meta.env.DEV) {
    try {
      const existing = sessionStorage.getItem('web-vitals');
      const metrics = existing ? JSON.parse(existing) : {};
      metrics[metric.name] = {
        value: metric.value,
        rating: getRating(metric.name, metric.value),
        timestamp: new Date().toISOString(),
      };
      sessionStorage.setItem('web-vitals', JSON.stringify(metrics));
    } catch (e) {
      // Silently fail if sessionStorage is unavailable
    }
  }
}

/**
 * Handle metric reporting
 */
function handleMetric(metric: Metric) {
  // Always send to analytics
  sendToAnalytics(metric);

  // Only log to console in development
  if (import.meta.env.DEV) {
    logMetric(metric);
  }
}

/**
 * Initialize Web Vitals monitoring
 *
 * PERFORMANCE: This function is lightweight and runs after page load
 * IMPACT: ~2KB added to bundle when tree-shaken (web-vitals library)
 * WHY: Essential for tracking performance improvements and regressions
 *
 * Call this once in your app's entry point (App.tsx or main.tsx)
 */
export function initWebVitals() {
  // Only initialize in browser environment
  if (typeof window === 'undefined') return;

  console.log(
    '%c🔍 Web Vitals Monitoring Active',
    'background: #3b82f6; color: white; font-weight: bold; padding: 4px 8px; border-radius: 4px;'
  );

  // Register all Core Web Vitals listeners
  onCLS(handleMetric);
  // onFID removed - deprecated in web-vitals v4, use INP instead
  onLCP(handleMetric);
  onFCP(handleMetric);
  onTTFB(handleMetric);
  onINP(handleMetric); // New metric replacing FID

  // Log stored metrics from previous sessions in dev
  if (import.meta.env.DEV) {
    setTimeout(() => {
      try {
        const stored = sessionStorage.getItem('web-vitals');
        if (stored) {
          console.groupCollapsed('📊 Previous Web Vitals Session');
          console.table(JSON.parse(stored));
          console.groupEnd();
        }
      } catch (e) {
        // Silently fail
      }
    }, 1000);
  }
}

/**
 * Get current Web Vitals metrics (for debugging)
 * Returns stored metrics from sessionStorage
 */
export function getWebVitals(): Record<string, any> {
  try {
    const stored = sessionStorage.getItem('web-vitals');
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    return {};
  }
}

/**
 * Clear stored Web Vitals data
 */
export function clearWebVitals() {
  try {
    sessionStorage.removeItem('web-vitals');
  } catch (e) {
    // Silently fail
  }
}
