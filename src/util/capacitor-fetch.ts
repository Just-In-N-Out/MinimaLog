import { Capacitor, CapacitorHttp } from '@capacitor/core';

// Override window.fetch on native platforms to use CapacitorHttp
// This fixes intermittent "AuthRetryableFetchError status 0" in WKWebView
export const setupCapacitorFetch = () => {
  try {
    if (!Capacitor.isNativePlatform()) return; // Web stays unchanged

    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
        const method = (init?.method || (input as Request)?.method || 'GET').toUpperCase();

        // Normalize headers to a plain object
        const headersObj: Record<string, string> = {};
        const headers = new Headers(init?.headers || (input as Request)?.headers || {});
        headers.forEach((value, key) => {
          headersObj[key] = value;
        });

        // Prepare body
        let data: any = undefined;
        const body = init?.body ?? (input as Request & { _bodyInit?: any })?._bodyInit;
        const contentType = headersObj['Content-Type'] || headersObj['content-type'];
        if (body != null) {
          if (typeof body === 'string') {
            // If JSON content, try to parse for CapacitorHttp
            if (contentType && contentType.includes('application/json')) {
              try { data = JSON.parse(body); } catch { data = body; }
            } else {
              data = body;
            }
          } else if (body instanceof FormData) {
            const form: Record<string, any> = {};
            body.forEach((v, k) => { form[k] = v as any; });
            data = form;
          } else {
            data = body as any;
          }
        }

        const resp = await CapacitorHttp.request({ url, method, headers: headersObj, data });

        // Build a Response-like object
        const respHeaders = new Headers();
        Object.entries(resp.headers || {}).forEach(([k, v]) => respHeaders.append(k, String(v)));

        const text = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
        return new Response(text, { status: resp.status ?? 200, headers: respHeaders });
      } catch (err) {
        // Fallback to original fetch if CapacitorHttp fails for any reason
        return originalFetch(input as any, init);
      }
    };

    if (import.meta.env.DEV) console.log('CapacitorHttp fetch shim installed');
  } catch (e) {
    // Silent failure keeps web fetch behavior
    if (import.meta.env.DEV) console.warn('CapacitorHttp setup skipped');
  }
};
