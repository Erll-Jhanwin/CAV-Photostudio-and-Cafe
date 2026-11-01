import React, { useSyncExternalStore } from 'react';
import {
  getGlobalLoadingProgressSnapshot,
  subscribeToGlobalLoadingProgress,
} from '../../utils/globalLoadingProgress';

export function GlobalLoadingProgress() {
  const visible = useSyncExternalStore(
    subscribeToGlobalLoadingProgress,
    getGlobalLoadingProgressSnapshot,
    () => false,
  );

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[120] h-0.5 overflow-hidden bg-gold/20"
      role="status"
      aria-label="Loading page data"
      aria-live="polite"
    >
      <div className="global-loading-progress h-full w-1/3 bg-gold-dark" />
    </div>
  );
}
