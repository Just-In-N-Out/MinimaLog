import { Capacitor } from '@capacitor/core';
import { vLog } from '@/components/VisualDebugLogger';

/**
 * Get the appropriate redirect URL for authentication flows
 * On native platforms, use custom URL scheme so the callback happens in the app's WebView
 * where the code_verifier is stored (same storage context as signInWithOAuth)
 * On web, use the current origin
 */
export const getAuthRedirectUrl = (type: 'signup' | 'reset' = 'signup'): string => {
  if (Capacitor.isNativePlatform()) {
    // Use custom URL scheme for native platforms
    // This ensures OAuth callback happens in the app's WebView
    // where Supabase stored the code_verifier
    return 'com.minimalog.app://auth/callback';
  }

  // Use custom domain for web OAuth to show branded URL to users
  // The custom domain redirects back to Supabase
  const customDomain = 'https://minimalog.fit';

  return type === 'reset'
    ? `${customDomain}/auth/reset`
    : `${customDomain}/auth/callback`;
};

// Whitelist of allowed redirect paths for security
const ALLOWED_REDIRECT_PATHS = [
  '/auth/reset',
  '/auth/callback',
  '/auth',
];

// Allowed URL schemes for the app
const ALLOWED_SCHEMES = ['com.minimalog.app', 'ionic', 'capacitor'];

/**
 * Validate and sanitize deep link URL to prevent open redirect vulnerabilities
 */
const isValidDeepLink = (url: URL): boolean => {
  // Validate URL scheme
  const scheme = url.protocol.replace(':', '');
  if (!ALLOWED_SCHEMES.includes(scheme) && !url.hostname.startsWith(ALLOWED_SCHEMES[0])) {
    console.warn('Invalid URL scheme detected:', scheme);
    return false;
  }

  return true;
};

/**
 * Get validated redirect path from deep link
 * Returns null if path is not in whitelist
 */
const getValidatedRedirectPath = (pathname: string): string | null => {
  // Normalize pathname
  const normalized = pathname.toLowerCase().replace(/^\/+|\/+$/g, '');

  // Check against whitelist
  if (normalized.includes('reset')) {
    return '/auth/reset';
  } else if (normalized.includes('callback')) {
    return '/auth/callback';
  } else if (normalized.includes('auth')) {
    return '/auth';
  }

  console.warn('Path not in whitelist:', pathname);
  return null;
};

/**
 * Sanitize URL parameters (hash and search)
 * Only allows specific auth-related parameters
 */
const sanitizeUrlParams = (hash: string, search: string): { hash: string; search: string } => {
  const sanitized = { hash: '', search: '' };

  try {
    // For hash params (e.g., #access_token=...)
    if (hash) {
      const hashParams = new URLSearchParams(hash.replace('#', ''));
      const allowedHashParams = [
        'access_token', 'refresh_token', 'expires_in', 'token_type', 'type',
        'code', 'code_verifier', 'state', 'error', 'error_description'
      ];
      const sanitizedHash = new URLSearchParams();

      allowedHashParams.forEach(param => {
        if (hashParams.has(param)) {
          sanitizedHash.set(param, hashParams.get(param)!);
        }
      });

      const hashString = sanitizedHash.toString();
      if (hashString) {
        sanitized.hash = `#${hashString}`;
      }
    }

    // For query params (e.g., ?code=...)
    if (search) {
      const searchParams = new URLSearchParams(search.replace('?', ''));
      const allowedSearchParams = [
        'code', 'code_verifier', 'state', 'error', 'error_description'
      ];
      const sanitizedSearch = new URLSearchParams();

      allowedSearchParams.forEach(param => {
        if (searchParams.has(param)) {
          sanitizedSearch.set(param, searchParams.get(param)!);
        }
      });

      const searchString = sanitizedSearch.toString();
      if (searchString) {
        sanitized.search = `?${searchString}`;
      }
    }
  } catch (error) {
    console.error('Error sanitizing URL params:', error);
  }

  return sanitized;
};

/**
 * Initialize deep link handling for native platforms
 */
export const setupDeepLinkHandling = async () => {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { App } = await import('@capacitor/app');

    // Listen for deep links
    App.addListener('appUrlOpen', (data) => {
      console.log('[Deep Link] Received:', data.url);
      vLog.info('DeepLink', 'appUrlOpen received', { url: data.url });

      try {
        // The URL will be like: com.minimalog.app://auth/reset#access_token=...
        // For custom schemes, URL parsing can be tricky, so we handle it manually
        let url: URL;
        let hash = '';
        let search = '';

        try {
          url = new URL(data.url);

          // For custom schemes, parameters might not parse correctly
          // So we also manually extract them from the raw URL string
          const rawUrl = data.url;
          const hashIndex = rawUrl.indexOf('#');
          const queryIndex = rawUrl.indexOf('?');

          if (hashIndex !== -1) {
            hash = rawUrl.substring(hashIndex);
            console.log('[Deep Link] Manually extracted hash:', hash);
          } else {
            hash = url.hash || '';
          }

          if (queryIndex !== -1) {
            // Extract everything between ? and # (or end of string)
            const endIndex = hashIndex !== -1 ? hashIndex : rawUrl.length;
            search = rawUrl.substring(queryIndex, endIndex);
            console.log('[Deep Link] Manually extracted search:', search);
          } else {
            search = url.search || '';
          }
        } catch (urlError) {
          console.error('[Deep Link] URL parsing failed:', urlError);
          // Try to parse manually as fallback
          const matches = data.url.match(/^([^:]+):\/\/([^?#]+)(\?[^#]*)?(#.*)?$/);
          if (!matches) {
            throw new Error('Could not parse URL');
          }

          // Reconstruct URL for validation
          url = new URL(`https://${matches[2]}${matches[3] || ''}${matches[4] || ''}`);
          search = matches[3] || '';
          hash = matches[4] || '';
        }

        console.log('[Deep Link] Extracted params:', { hash, search });

        // Validate deep link scheme
        if (!isValidDeepLink(url)) {
          console.error('[Deep Link] Invalid scheme, ignoring');
          vLog.warning('DeepLink', 'Invalid URL scheme, ignoring', { url: data.url });
          return;
        }

        // For custom schemes like com.minimalog.app://auth/reset
        // url.host might be "auth" and url.pathname might be "/reset"
        // We need to combine them to get the full path
        const host = url.host || '';
        const pathname = url.pathname || '';
        const fullPath = host + pathname; // e.g., "auth/reset" or "auth"

        console.log('[Deep Link] Parsed path:', { fullPath, host, pathname });

        // Get validated redirect path
        const redirectPath = getValidatedRedirectPath(fullPath);
        if (!redirectPath) {
          console.error('[Deep Link] Path not in whitelist:', fullPath);
          vLog.warning('DeepLink', 'Path not in whitelist', { fullPath });
          return;
        }

        // Sanitize parameters (keep OAuth params)
        const sanitized = sanitizeUrlParams(hash, search);

        const finalUrl = `${redirectPath}${sanitized.search}${sanitized.hash}`;
        console.log('[Deep Link] Final sanitized params:', sanitized);
        console.log('[Deep Link] Navigating to:', finalUrl);

        // Skip OAuth callbacks with 'code' parameter - these are handled by GoogleSignInButton's listener
        if (sanitized.search && sanitized.search.includes('code=')) {
          console.log('[Deep Link] Skipping OAuth callback - handled by GoogleSignInButton');
          vLog.info('DeepLink', 'Skipping OAuth callback with code param', { finalUrl });
          return;
        }

        // Navigate to the validated path with sanitized params
        vLog.info('DeepLink', 'Navigating to deep link URL', { finalUrl });
        window.location.href = finalUrl;

      } catch (error) {
        console.error('[Deep Link] Error parsing URL:', error);
        console.warn('[Deep Link] Blocked suspicious attempt:', data.url);
        vLog.error('DeepLink', 'Error handling deep link', { url: data.url, error });
      }
    });

    if (import.meta.env.DEV) console.log('Deep link handling initialized');
  } catch (error) {
    console.error('Failed to setup deep link handling:', error);
  }
};
