import { useEffect } from 'react';

const listeners = new Set();
const activeTokens = new Set();
let nextToken = 1;
let visible = false;
let visibleSnapshot = false;

const publish = () => {
  if (visibleSnapshot === visible) return;
  visibleSnapshot = visible;
  listeners.forEach(listener => listener());
};

const reconcile = () => {
  // A real network request should never leave a dashboard blank while its
  // content is being retrieved. Cached reads do not create a progress token.
  visible = activeTokens.size > 0;
  publish();
};

export const subscribeToGlobalLoadingProgress = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getGlobalLoadingProgressSnapshot = () => visibleSnapshot;

export const beginGlobalLoadingProgress = () => {
  const token = nextToken++;
  activeTokens.add(token);
  reconcile();
  return token;
};

export const endGlobalLoadingProgress = (token) => {
  if (!activeTokens.delete(token)) return;
  reconcile();
};

export const useGlobalLoadingProgressSignal = (active) => {
  useEffect(() => {
    if (!active) return undefined;
    const token = beginGlobalLoadingProgress();
    return () => endGlobalLoadingProgress(token);
  }, [active]);
};
