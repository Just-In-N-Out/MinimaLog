import { create } from 'zustand';
import { Network } from '@capacitor/network';
import { Capacitor } from '@capacitor/core';

export type ConnectionQuality = 'high' | 'medium' | 'low' | 'offline';

interface NetworkState {
  isOnline: boolean;
  connectionType: string;
  isHighQuality: boolean;
  connectionQuality: ConnectionQuality;
  debugOfflineMode: boolean; // Manual override for testing
  setOnline: (online: boolean) => void;
  setConnectionType: (type: string) => void;
  setHighQuality: (quality: boolean) => void;
  setConnectionQuality: (quality: ConnectionQuality) => void;
  setDebugOfflineMode: (enabled: boolean) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  isOnline: true,
  connectionType: 'wifi',
  isHighQuality: true,
  connectionQuality: 'high',
  debugOfflineMode: false,
  setOnline: (online) => set({ isOnline: online }),
  setConnectionType: (type) => set({ connectionType: type }),
  setHighQuality: (quality) => set({ isHighQuality: quality }),
  setConnectionQuality: (quality) => set({ connectionQuality: quality }),
  setDebugOfflineMode: (enabled) => set({ debugOfflineMode: enabled }),
}));

/**
 * Classify connection quality based on connection type
 */
const getConnectionQuality = (connectionType: string, isOnline: boolean): ConnectionQuality => {
  if (!isOnline) return 'offline';

  const type = connectionType.toLowerCase();

  // High quality connections
  if (type === 'wifi' || type === '5g' || type === '4g') {
    return 'high';
  }

  // Low quality connections
  if (type === '3g' || type === '2g' || type === 'slow-2g') {
    return 'low';
  }

  // Unknown cellular or other - treat as medium quality
  if (type === 'cellular' || type === 'unknown') {
    return 'medium';
  }

  // Default to medium for safety
  return 'medium';
};

/**
 * Update network state based on connection status
 */
const updateNetworkState = (connectionType: string, connected: boolean) => {
  const quality = getConnectionQuality(connectionType, connected);
  const isHighQuality = quality === 'high';

  console.log(`[Network] Connection: ${connectionType}, Online: ${connected}, Quality: ${quality}`);

  useNetworkStore.getState().setOnline(connected);
  useNetworkStore.getState().setConnectionType(connectionType);
  useNetworkStore.getState().setHighQuality(isHighQuality);
  useNetworkStore.getState().setConnectionQuality(quality);
};

/**
 * Initialize network monitoring with real connection detection
 * Falls back to browser navigator.onLine on web platforms
 */
export const initNetworkMonitoring = async () => {
  console.log('[Network] Initializing real network monitoring');

  try {
    if (Capacitor.isNativePlatform()) {
      // Use Capacitor Network plugin on native platforms
      const status = await Network.getStatus();
      updateNetworkState(status.connectionType, status.connected);

      // Listen for network changes
      Network.addListener('networkStatusChange', (status) => {
        updateNetworkState(status.connectionType, status.connected);
      });

      console.log('[Network] Native network monitoring initialized');
    } else {
      // Web platform fallback - use navigator.onLine
      const isOnline = navigator.onLine;
      const connectionType = isOnline ? 'wifi' : 'none';
      updateNetworkState(connectionType, isOnline);

      // Listen for online/offline events
      window.addEventListener('online', () => {
        updateNetworkState('wifi', true);
      });

      window.addEventListener('offline', () => {
        updateNetworkState('none', false);
      });

      console.log('[Network] Web network monitoring initialized');
    }
  } catch (error) {
    console.error('[Network] Failed to initialize monitoring:', error);
    // Fallback to assuming online with medium quality
    updateNetworkState('unknown', true);
  }
};

/**
 * Check if we should operate in offline mode
 * Returns true when:
 * - Debug offline mode is enabled, OR
 * - Device is actually offline (no connection)
 */
export const shouldUseOfflineMode = (): boolean => {
  const state = useNetworkStore.getState();

  // Debug mode override
  if (state.debugOfflineMode) {
    console.log('[Network] Using DEBUG offline mode');
    return true;
  }

  // Actually offline
  if (!state.isOnline || state.connectionQuality === 'offline') {
    console.log('[Network] Device is offline');
    return true;
  }

  return false;
};

/**
 * Get recommended image loading timeout based on connection quality
 */
export const getImageLoadTimeout = (): number => {
  const quality = useNetworkStore.getState().connectionQuality;

  switch (quality) {
    case 'high':
      return 30000; // 30 seconds for high quality
    case 'medium':
      return 15000; // 15 seconds for medium quality
    case 'low':
      return 5000; // 5 seconds for low quality (3G)
    case 'offline':
      return 0; // No network loading
    default:
      return 15000; // Default to medium
  }
};
