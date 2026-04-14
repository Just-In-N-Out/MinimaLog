/**
 * Check storage quota and warn user if approaching limit
 */
export const checkStorageQuota = async (): Promise<{
  used: number;
  quota: number;
  percentUsed: number;
  available: number;
} | null> => {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    const percentUsed = ((estimate.usage || 0) / (estimate.quota || 1)) * 100;

    return {
      used: estimate.usage || 0,
      quota: estimate.quota || 0,
      percentUsed,
      available: (estimate.quota || 0) - (estimate.usage || 0),
    };
  }
  return null;
};

/**
 * Show warning if storage is running low
 */
export const checkAndWarnStorage = async (): Promise<void> => {
  const quota = await checkStorageQuota();

  if (quota && quota.percentUsed > 80) {
    console.warn('[StorageManager] Storage almost full:', quota);

    // Trigger UI warning (dispatch event)
    window.dispatchEvent(new CustomEvent('storage-warning', {
      detail: quota
    }));
  }
};
