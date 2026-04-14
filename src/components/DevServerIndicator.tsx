import { useNetworkStore } from '@/lib/network';
import { Wifi, WifiOff, Server } from 'lucide-react';
import { useEffect, useState } from 'react';

export const DevServerIndicator = () => {
  const { isOnline, connectionType } = useNetworkStore();
  const [isDevMode, setIsDevMode] = useState(false);

  useEffect(() => {
    // Detect if running on dev server by checking the URL
    const isDevServer =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '192.168.1.109' ||
      window.location.port === '8081' ||
      window.location.port === '5173';

    setIsDevMode(isDevServer);
  }, []);

  // Only show in dev mode
  if (!isDevMode) return null;

  return (
    <div className="fixed bottom-20 right-4 z-50 flex flex-col gap-2">
      {/* Dev Server Indicator */}
      <div className="flex items-center gap-2 bg-blue-500/90 text-white px-3 py-2 rounded-lg shadow-lg backdrop-blur-sm text-xs font-medium">
        <Server className="w-3 h-3" />
        <span>Dev Server</span>
      </div>

      {/* Network Status Indicator */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg backdrop-blur-sm text-xs font-medium ${
        isOnline
          ? 'bg-green-500/90 text-white'
          : 'bg-red-500/90 text-white'
      }`}>
        {isOnline ? (
          <>
            <Wifi className="w-3 h-3" />
            <span>{connectionType}</span>
          </>
        ) : (
          <>
            <WifiOff className="w-3 h-3" />
            <span>Offline</span>
          </>
        )}
      </div>
    </div>
  );
};
