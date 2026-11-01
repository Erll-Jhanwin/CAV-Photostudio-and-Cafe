import { useEffect } from 'react';

const listeners = new Set();
const activeTokens = new Set();
const suppressedKeys = new Set();
let nextToken = 1;
let visible = false;
let visibleSnapshot = false;
let activeSince = 0;
let showTimer = null;

const publish = () => {
  if (visibleSnapshot === visible) return;
  visibleSnapshot = visible;
  listeners.forEach(listener => listener());
};

const clearTimer = () => {
  if (showTimer !== null) {
    window.clearTimeout(showTimer);
    showTimer = null;
  }
};

const reconcile = () => {
  if (activeTokens.size === 0 || suppressedKeys.size > 0) {
    clearTimer();
    visible = false;
    publish();
    return;
  }
  if (visible || showTimer !== null) return;
  const remainingDelay = Math.max(0, 300 - (Date.now() - activeSince));
  if (remainingDelay === 0) {
    visible = true;
    publish();
    return;
  }
  showTimer = window.setTimeout(() => {
    showTimer = null;
    if (activeTokens.size > 0 && suppressedKeys.size === 0) {
      visible = true;
      publish();
    }
  }, remainingDelay);
};

export const subscribeToGlobalLoadingProgress = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getGlobalLoadingProgressSnapshot = () => visibleSnapshot;

export const beginGlobalLoadingProgress = () => {
  const token = nextToken++;
  if (activeTokens.size === 0) activeSince = Date.now();
  activeTokens.add(token);
  reconcile();
  return token;
};

export const endGlobalLoadingProgress = (token) => {
  if (!activeTokens.delete(token)) return;
  reconcile();
};

export const setGlobalLoadingProgressSuppressed = (key, suppressed) => {
  if (suppressed) suppressedKeys.add(key);
  else suppressedKeys.delete(key);
  reconcile();
};

export const useGlobalLoadingProgressSignal = (active) => {
  useEffect(() => {
    if (!active) return undefined;
    const token = beginGlobalLoadingProgress();
    return () => endGlobalLoadingProgress(token);
  }, [active]);
};

export const useGlobalLoadingProgressSuppression = (key, suppressed) => {
  useEffect(() => {
    setGlobalLoadingProgressSuppressed(key, suppressed);
    return () => setGlobalLoadingProgressSuppressed(key, false);
  }, [key, suppressed]);
};
