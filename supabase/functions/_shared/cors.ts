/**
 * CORS Configuration for Supabase Edge Functions
 *
 * Security: Restricts API access to whitelisted origins only
 * Prevents CSRF attacks from unauthorized domains
 */

// Allowed origins for CORS requests
// Add your production domain, development servers, and mobile app schemes
const ALLOWED_ORIGINS = [
  'http://localhost:5173',           // Vite dev server
  'http://localhost:8100',           // Ionic dev server
  'https://localhost',               // iOS local development
  'capacitor://localhost',           // Capacitor iOS app
  'http://localhost',                // Capacitor Android app
  'ionic://localhost',               // Ionic iOS app
  'http://localhost:8080',           // Alternative dev port
  // Add your production domain here when deployed
  // 'https://your-production-domain.com',
];

/**
 * Get CORS headers based on request origin
 * Returns secure headers with origin validation
 */
export function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  // Check if origin is in allowed list
  const isAllowed = requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin);

  return {
    'Access-Control-Allow-Origin': isAllowed ? requestOrigin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}

/**
 * Handle CORS preflight OPTIONS requests
 */
export function handleCorsPreflightRequest(requestOrigin: string | null): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(requestOrigin),
  });
}

/**
 * Create a JSON response with CORS headers
 */
export function createCorsResponse(
  data: any,
  requestOrigin: string | null,
  status: number = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...getCorsHeaders(requestOrigin),
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Validate origin is allowed
 * Returns true if origin is whitelisted, false otherwise
 */
export function isOriginAllowed(origin: string | null): boolean {
  return origin !== null && ALLOWED_ORIGINS.includes(origin);
}
