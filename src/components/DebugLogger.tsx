import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { X, Trash2 } from 'lucide-react';

interface LogEntry {
  timestamp: string;
  level: 'log' | 'warn' | 'error';
  message: string;
}

/**
 * On-screen debug logger for viewing console logs in production/TestFlight
 * Only shows logs that contain [ExerciseImageCache]
 * Only renders in development mode
 */
export const DebugLogger = () => {
  // Only show in development
  if (!import.meta.env.DEV) return null;

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Intercept console methods
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    const addLog = (level: 'log' | 'warn' | 'error', args: any[]) => {
      const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');

      // Only capture ExerciseImageCache logs
      if (message.includes('[ExerciseImageCache]')) {
        const logEntry: LogEntry = {
          timestamp: new Date().toLocaleTimeString(),
          level,
          message
        };

        setLogs(prev => [...prev.slice(-99), logEntry]); // Keep last 100 logs
      }
    };

    console.log = (...args) => {
      originalLog(...args);
      addLog('log', args);
    };

    console.warn = (...args) => {
      originalWarn(...args);
      addLog('warn', args);
    };

    console.error = (...args) => {
      originalError(...args);
      addLog('error', args);
    };

    // Cleanup
    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom when new logs arrive
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const levelColors = {
    log: 'text-blue-400',
    warn: 'text-yellow-400',
    error: 'text-red-400'
  };

  return (
    <>
      {/* Toggle button - always visible */}
      {!isVisible && (
        <Button
          onClick={() => setIsVisible(true)}
          className="fixed bottom-20 right-4 z-50 rounded-full shadow-lg"
          size="sm"
          variant="secondary"
        >
          📋 Debug {logs.length > 0 && `(${logs.length})`}
        </Button>
      )}

      {/* Log viewer */}
      {isVisible && (
        <div className="fixed inset-0 z-50 bg-black/95 text-white p-4 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold">Image Cache Debug Logs</h2>
            <div className="flex gap-2">
              <Button
                onClick={() => setLogs([])}
                size="icon"
                variant="ghost"
                className="text-white"
              >
                <Trash2 className="h-5 w-5" />
              </Button>
              <Button
                onClick={() => setIsVisible(false)}
                size="icon"
                variant="ghost"
                className="text-white"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto font-mono text-xs bg-black border border-gray-700 rounded p-2">
            {logs.length === 0 ? (
              <div className="text-gray-500 text-center py-8">
                No logs yet. Logs will appear here when you download images.
              </div>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className="mb-1 border-b border-gray-800 pb-1">
                  <span className="text-gray-500">[{log.timestamp}]</span>
                  <span className={`ml-2 ${levelColors[log.level]}`}>
                    {log.message}
                  </span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>

          <div className="mt-2 text-xs text-gray-400 text-center">
            Showing ExerciseImageCache logs only
          </div>
        </div>
      )}
    </>
  );
};
