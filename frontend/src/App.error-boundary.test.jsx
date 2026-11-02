import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';

describe('RouteErrorBoundary retry', () => {
  let consoleError;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test('remounts a screen after a transient render exception', () => {
    let shouldThrow = true;
    function RecoveringScreen() {
      if (shouldThrow) throw new Error('transient component error');
      return <p>Screen recovered</p>;
    }

    render(
      <RouteErrorBoundary>
        <RecoveringScreen />
      </RouteErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: 'This screen could not be opened' })).toBeInTheDocument();
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(screen.getByText('Screen recovered')).toBeInTheDocument();
  });

  test('reloads the same location for a rejected lazy chunk', () => {
    const onRetryChunkLoad = jest.fn();
    function FailedChunkScreen() {
      throw new Error('Loading chunk 42 failed.');
    }

    render(
      <RouteErrorBoundary onRetryChunkLoad={onRetryChunkLoad}>
        <FailedChunkScreen />
      </RouteErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(onRetryChunkLoad).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'This screen could not be opened' })).toBeInTheDocument();
  });
});
