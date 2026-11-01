describe('browser API origin', () => {
  const originalApiBaseUrl = process.env.REACT_APP_API_BASE_URL;

  afterEach(() => {
    if (originalApiBaseUrl === undefined) delete process.env.REACT_APP_API_BASE_URL;
    else process.env.REACT_APP_API_BASE_URL = originalApiBaseUrl;
    jest.resetModules();
  });

  test('uses the frontend origin for the deployed same-origin API rewrite', () => {
    process.env.REACT_APP_API_BASE_URL = 'same-origin';
    jest.resetModules();

    const { API_BASE_URL } = require('./config');

    expect(API_BASE_URL).toBe(window.location.origin);
  });
});
