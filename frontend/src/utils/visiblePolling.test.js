import { act } from '@testing-library/react';
import { startVisiblePolling } from './visiblePolling';

describe('visible background polling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-02T00:00:00Z'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('skips hidden pages and de-duplicates a simultaneous focus and visibility refresh', async () => {
    const task = jest.fn().mockResolvedValue(undefined);
    const stop = startVisiblePolling(task, 10_000);

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => { jest.advanceTimersByTime(10_000); });
    expect(task).not.toHaveBeenCalled();

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => { await Promise.resolve(); });
    expect(task).toHaveBeenCalledTimes(1);

    stop();
  });

  test('does not start a second refresh while the previous one is pending', async () => {
    let finish;
    const task = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    const stop = startVisiblePolling(task, 10_000);

    act(() => { jest.advanceTimersByTime(10_000); });
    await act(async () => { await Promise.resolve(); });
    act(() => { jest.advanceTimersByTime(10_000); });
    expect(task).toHaveBeenCalledTimes(1);

    await act(async () => { finish(); });
    stop();
  });
});
