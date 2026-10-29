export const calculateSalesRowsPerPage = ({
  availableHeight,
  headerHeight,
  rowHeights,
  defaultRowHeight = 48,
  maxRows = 50,
}) => {
  const measuredRows = (rowHeights || []).map(Number).filter(height => Number.isFinite(height) && height > 0);
  const rowHeight = measuredRows.length ? Math.max(...measuredRows) : defaultRowHeight;
  const spaceForRows = Math.max(0, Number(availableHeight || 0) - Number(headerHeight || 0) - 4);
  return Math.min(maxRows, Math.max(1, Math.floor(spaceForRows / rowHeight)));
};
