import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    hmr: {
      protocol: 'ws',
      host: process.env.VITE_DEV_HOST || 'localhost',
      port: 8080,
      clientPort: 8080
    },
    cors: true,
    strictPort: true
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // PERFORMANCE: Advanced minification with Terser for maximum compression
    // IMPACT: 15-25% smaller bundle size vs default esbuild minification
    // WHY: Terser performs more aggressive optimizations including dead code elimination,
    //      mangling, and compression at the cost of slightly slower build times
    minify: 'terser',
    terserOptions: {
      compress: {
        // PERFORMANCE: Remove console.log/debug/info in production, keep error/warn for debugging
        // IMPACT: Eliminates ~348 console statements, reduces bundle size and runtime overhead
        drop_console: ['log', 'debug', 'info'],
        drop_debugger: true,
        // Additional aggressive optimizations
        passes: 2, // Run compression twice for better results
        pure_funcs: ['console.log', 'console.debug', 'console.info'], // Explicitly mark as pure
        dead_code: true, // Remove unreachable code
        unused: true, // Remove unused functions/variables
      },
      mangle: {
        safari10: true, // Ensure compatibility with older Safari versions
      },
      format: {
        comments: false, // Remove all comments from production build
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          // Core vendor libraries
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // UI component libraries
          'vendor-ui': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-select',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-tabs',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-avatar',
            '@radix-ui/react-toast',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-switch'
          ],
          // Charts library (only loaded in Progress pages)
          'vendor-charts': ['recharts'],
          // Animation libraries (used sparingly)
          'vendor-animations': ['framer-motion', 'gsap'],
          // Supabase and data fetching
          'vendor-data': ['@supabase/supabase-js', '@tanstack/react-query'],
          // Carousel/swiper
          'vendor-carousel': ['swiper'],
          // Date/time utilities
          'vendor-date': ['date-fns'],
        },
        // PERFORMANCE: Merge small chunks to reduce HTTP requests
        // IMPACT: Fewer files to load, faster initial page load on HTTP/1.1
        experimentalMinChunkSize: 20000, // 20KB minimum chunk size
      },
    },
    chunkSizeWarningLimit: 600,
    sourcemap: mode === 'development',
    // PERFORMANCE: Inline small assets as base64 to reduce HTTP requests
    // IMPACT: Faster loading for small images/fonts, one less round trip
    assetsInlineLimit: 4096, // 4KB threshold (default)
  },
}));
