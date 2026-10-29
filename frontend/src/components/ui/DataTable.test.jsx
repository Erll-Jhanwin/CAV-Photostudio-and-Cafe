import React from 'react';
import { render, screen } from '@testing-library/react';
import { PaginationControls } from './DataTable';

test('Daily Sales Logs keeps its pagination footer visible when all rows fit on one page', () => {
  render(<PaginationControls page={1} setPage={jest.fn()} total={3} pageSize={8} alwaysVisible compact />);

  expect(screen.getByText('Showing 1-3 of 3')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
});

test('other tables keep hiding pagination when a single page does not need controls', () => {
  const { container } = render(<PaginationControls page={1} setPage={jest.fn()} total={3} pageSize={8} />);
  expect(container).toBeEmptyDOMElement();
});
