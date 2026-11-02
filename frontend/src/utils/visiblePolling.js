/** Run background refreshes only while the page is visible, with one request in flight. */
export function startVisiblePolling(task, intervalMs, { resumeDebounceMs = 1500 } = {}) {
  let active = true;
  let inFlight = false;
  let lastStartedAt = 0;

  const run = async () => {
    if (!active || document.hidden || inFlight) return;
    const now = Date.now();
    if (now - lastStartedAt < resumeDebounceMs) return;
    lastStartedAt = now;
    inFlight = true;
    try {
      await task();
    } catch {
      console.error('Background refresh failed.');
    } finally {
      inFlight = false;
    }
  };

  const handleResume = () => { void run(); };
  const intervalId = window.setInterval(() => { void run(); }, intervalMs);
  window.addEventListener('focus', handleResume);
  document.addEventListener('visibilitychange', handleResume);

  return () => {
    active = false;
    window.clearInterval(intervalId);
    window.removeEventListener('focus', handleResume);
    document.removeEventListener('visibilitychange', handleResume);
  };
}
