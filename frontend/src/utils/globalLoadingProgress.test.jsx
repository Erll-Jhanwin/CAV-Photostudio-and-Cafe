import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { GlobalLoadingProgress } from '../components/ui/GlobalLoadingProgress';
import {
  beginGlobalLoadingProgress,
  endGlobalLoadingProgress,
} from './globalLoadingProgress';

describe('GlobalLoadingProgress', () => {
  let tokens;

  beforeEach(() => {
    jest.useFakeTimers();
    tokens = [];
  });

  afterEach(() => {
    act(() => tokens.forEach(token => endGlobalLoadingProgress(token)));
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('appears immediately for a network request and hides when it finishes', () => {
    render(<GlobalLoadingProgress />);
    act(() => { tokens.push(beginGlobalLoadingProgress()); });

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

});
