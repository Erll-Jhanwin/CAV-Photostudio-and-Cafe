const CHUNK_RELOAD_KEY = 'cav:chunk-reload-attempted';
const MAX_CHUNK_RELOAD_ATTEMPTS = 2;

export const isChunkLoadError = (error) => {
  const text = `${error?.name || ''} ${error?.message || ''}`;
  return /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(text);
};

export const reloadWithFreshAssets = () => {
  const url = new URL(window.location.href);
  url.searchParams.set('_cav_reload', Date.now().toString());
  window.location.replace(url.toString());
};

export const lazyWithRetry = (importer) => (
  importer()
    .then((module) => {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      return module;
    })
    .catch((error) => {
      const attempts = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || '0');
      if (isChunkLoadError(error) && attempts < MAX_CHUNK_RELOAD_ATTEMPTS) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(attempts + 1));
        reloadWithFreshAssets();
        return new Promise(() => {});
      }
      throw error;
    })
);

export const resetChunkReloadAttempt = () => {
  sessionStorage.removeItem(CHUNK_RELOAD_KEY);
};
