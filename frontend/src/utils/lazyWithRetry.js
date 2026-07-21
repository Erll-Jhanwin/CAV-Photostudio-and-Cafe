const CHUNK_RELOAD_KEY = 'cav:chunk-reload-attempted';

const isChunkLoadError = (error) => {
  const text = `${error?.name || ''} ${error?.message || ''}`;
  return /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(text);
};

export const lazyWithRetry = (importer) => (
  importer()
    .then((module) => {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      return module;
    })
    .catch((error) => {
      if (isChunkLoadError(error) && !sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, 'true');
        window.location.reload();
        return new Promise(() => {});
      }
      throw error;
    })
);

export const resetChunkReloadAttempt = () => {
  sessionStorage.removeItem(CHUNK_RELOAD_KEY);
};
