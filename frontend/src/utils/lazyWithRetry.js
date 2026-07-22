export const isChunkLoadError = (error) => {
  const text = `${error?.name || ''} ${error?.message || ''}`;
  return /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed|Unexpected token ['<]|Failed to load script/i.test(text);
};

const wait = (milliseconds) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

// A transient asset request can be retried once without mutating the URL or reloading the app.
export const lazyWithRetry = async (importer) => {
  try {
    return await importer();
  } catch (error) {
    if (!isChunkLoadError(error)) throw error;
    await wait(250);
    return importer();
  }
};
