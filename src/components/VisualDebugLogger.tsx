/**
 * Visual Debug Logger
 *
 * Shows debug logs visually on screen for TestFlight testing
 * where console logs aren't accessible
 */

import { useState, useEffect, useCallback } from 'react';
import { X, ChevronDown, ChevronUp, AlertCircle, CheckCircle, Info, XCircle } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

interface DebugLog {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error';
  category: string;
  message: string;
  details?: any;
}

export class VisualDebugger {
  private static listeners: Set<(log: DebugLog) => void> = new Set();
  private static logs: DebugLog[] = [];
  private static maxLogs = 50;

  static log(type: DebugLog['type'], category: string, message: string, details?: any) {
    const log: DebugLog = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date().toLocaleTimeString(),
      type,
      category,
      message,
      details,
    };

    this.logs.unshift(log);
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    this.listeners.forEach(listener => listener(log));

    // Also log to console
    const consoleMsg = `[${category}] ${message}`;
    switch (type) {
      case 'error':
        console.error(consoleMsg, details);
        break;
      case 'warning':
        console.warn(consoleMsg, details);
        break;
      case 'success':
        console.log('✓', consoleMsg, details);
        break;
      default:
        console.log(consoleMsg, details);
    }
  }

  static subscribe(listener: (log: DebugLog) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  static getLogs() {
    return this.logs;
  }

  static clear() {
    this.logs = [];
    this.listeners.forEach(listener => listener({
      id: 'clear',
      timestamp: new Date().toLocaleTimeString(),
      type: 'info',
      category: 'System',
      message: 'Logs cleared'
    }));
  }
}

// Convenience methods
export const vLog = {
  info: (category: string, message: string, details?: any) =>
    VisualDebugger.log('info', category, message, details),

  success: (category: string, message: string, details?: any) =>
    VisualDebugger.log('success', category, message, details),

  warning: (category: string, message: string, details?: any) =>
    VisualDebugger.log('warning', category, message, details),

  error: (category: string, message: string, details?: any) =>
    VisualDebugger.log('error', category, message, details),
};

export const VisualDebugLogger = () => {
  const [isOpen, setIsOpen] = useState(true); // START OPEN for TestFlight debugging
  const [isMinimized, setIsMinimized] = useState(false);
  const [logs, setLogs] = useState<DebugLog[]>(VisualDebugger.getLogs());
  const [filter, setFilter] = useState<DebugLog['type'] | 'all'>('all');

  useEffect(() => {
    const unsubscribe = VisualDebugger.subscribe((log) => {
      setLogs(VisualDebugger.getLogs());
    });
    return unsubscribe;
  }, []);

  const filteredLogs = filter === 'all'
    ? logs
    : logs.filter(log => log.type === filter);

  const getIcon = (type: DebugLog['type']) => {
    switch (type) {
      case 'success': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'warning': return <AlertCircle className="h-4 w-4 text-orange-500" />;
      default: return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const getTypeColor = (type: DebugLog['type']) => {
    switch (type) {
      case 'success': return 'bg-green-50 border-green-200 text-green-900';
      case 'error': return 'bg-red-50 border-red-200 text-red-900';
      case 'warning': return 'bg-orange-50 border-orange-200 text-orange-900';
      default: return 'bg-blue-50 border-blue-200 text-blue-900';
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-[9999] flex items-center gap-2 bg-black/90 text-white px-4 py-2 rounded-full shadow-lg text-sm font-mono"
      >
        <Info className="h-4 w-4" />
        Debug Logs ({logs.length})
      </button>
    );
  }

  return (
    <div
      className={cn(
        "fixed bottom-0 right-0 z-[9999] bg-white dark:bg-gray-900 border-l border-t shadow-2xl",
        isMinimized ? "h-12" : "h-[60vh]",
        "w-full max-w-md transition-all duration-200"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4" />
          <span className="font-mono text-sm font-semibold">Debug Logger</span>
          <span className="text-xs text-gray-500">({filteredLogs.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => VisualDebugger.clear()}
            className="h-7 px-2 text-xs"
          >
            Clear
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMinimized(!isMinimized)}
            className="h-7 w-7"
          >
            {isMinimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsOpen(false)}
            className="h-7 w-7"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Filter Tabs */}
          <div className="flex gap-1 p-2 border-b bg-gray-50 dark:bg-gray-800 overflow-x-auto">
            {(['all', 'info', 'success', 'warning', 'error'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={cn(
                  "px-3 py-1 rounded text-xs font-medium whitespace-nowrap",
                  filter === type
                    ? "bg-primary text-primary-foreground"
                    : "bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600"
                )}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
                {type !== 'all' && ` (${logs.filter(l => l.type === type).length})`}
              </button>
            ))}
          </div>

          {/* Logs */}
          <div className="overflow-y-auto h-[calc(100%-8rem)] p-2 space-y-1 font-mono text-xs">
            {filteredLogs.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                No logs yet
              </div>
            ) : (
              filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className={cn(
                    "p-2 rounded border",
                    getTypeColor(log.type)
                  )}
                >
                  <div className="flex items-start gap-2">
                    {getIcon(log.type)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] text-gray-500">
                          {log.timestamp}
                        </span>
                        <span className="text-[10px] font-semibold bg-black/10 px-1 rounded">
                          {log.category}
                        </span>
                      </div>
                      <div className="break-words">{log.message}</div>
                      {log.details && (
                        <details className="mt-1">
                          <summary className="text-[10px] text-gray-600 cursor-pointer">
                            Details
                          </summary>
                          <pre className="mt-1 text-[10px] bg-black/5 p-1 rounded overflow-x-auto">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};
