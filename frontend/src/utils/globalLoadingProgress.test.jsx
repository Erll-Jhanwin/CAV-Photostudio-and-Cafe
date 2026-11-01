import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { GlobalLoadingProgress } from '../components/ui/GlobalLoadingProgress';
import {
  beginGlobalLoadingProgress,
  endGlobalLoadingProgress,
  setGlobalLoadingProgressSuppressed,
} from './globalLoadingProgress';

describe('GlobalLoadingProgress', () => {
  let tokens;

  beforeEach(() => {
    jest.useFakeTimers();
    tokens = [];
  });

  afterEach(() => {
    act(() => tokens.forEach(token => endGlobalLoadingProgress(token)));
    setGlobalLoadingProgressSuppressed('test-skeleton', false);
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('stays hidden for fast requests and appears after 300 ms', () => {
    render(<GlobalLoadingProgress />);
    act(() => { tokens.push(beginGlobalLoadingProgress()); });

    expect(screen.queryByRole('status', { name: 'Loading page data' })).not.toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(299); });
    expect(screen.queryByRole('status', { name: 'Loading page data' })).not.toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(1); });
    expect(screen.getByRole('status', { name: 'Loading page data' })).toBeInTheDocument();

    act(() => { endGlobalLoadingProgress(tokens.pop()); });
    expect(screen.queryByRole('status', { name: 'Loading page data' })).not.toBeInTheDocument();
  });

  test('stays visible until overlapping requests have all finished', () => {
    render(<GlobalLoadingProgress />);
    act(() => {
      tokens.push(beginGlobalLoadingProgress());
      tokens.push(beginGlobalLoadingProgress());
      jest.advanceTimersByTime(300);
    });
    expect(screen.getByRole('status', { name: 'Loading page data' })).toBeInTheDocument();

    act(() => { endGlobalLoadingProgress(tokens.pop()); });
    expect(screen.getByRole('status', { name: 'Loading page data' })).toBeInTheDocument();
    act(() => { endGlobalLoadingProgress(tokens.pop()); });
    expect(screen.queryByRole('status', { name: 'Loading page data' })).not.toBeInTheDocument();
  });

  test('remains hidden while a page skeleton is providing loading feedback', () => {
    render(<GlobalLoadingProgress />);
    setGlobalLoadingProgressSuppressed('test-skeleton', true);
    act(() => {
      tokens.push(beginGlobalLoadingProgress());
      jest.advanceTimersByTime(500);
    });
    expect(screen.queryByRole('status', { name: 'Loading page data' })).not.toBeInTheDocument();

    act(() => { setGlobalLoadingProgressSuppressed('test-skeleton', false); });
    expect(screen.getByRole('status', { name: 'Loading page data' })).toBeInTheDocument();
    act(() => { endGlobalLoadingProgress(tokens.pop()); });
  });
});
