jest.mock('axios', () => {
  const instance = {
    get: jest.fn(),
    post: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => instance),
      get: jest.fn(),
      post: jest.fn(),
      __mockInstance: instance,
    },
  };
});

import axios from 'axios';
import { beginAuthTransition, clearQueryCache, getCached } from './client';

describe('authenticated query cache', () => {
  let api;

  beforeEach(() => {
    api = axios.__mockInstance;
    api.get.mockReset();
    clearQueryCache();
  });

  test('coalesces simultaneous identical GET requests', async () => {
    const response = { data: [{ id: 1 }] };
    api.get.mockResolvedValue(response);

    const [first, second] = await Promise.all([
      getCached('/api/inventory/products/', { params: { limit: 50 } }),
      getCached('/api/inventory/products/', { params: { limit: 50 } }),
    ]);

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(first).toBe(response);
    expect(second).toBe(response);
  });

  test('discards cached user data when the authenticated session changes', async () => {
    const firstSessionResponse = { data: [{ owner: 'first-session' }] };
    const secondSessionResponse = { data: [{ owner: 'second-session' }] };
    api.get.mockResolvedValueOnce(firstSessionResponse).mockResolvedValueOnce(secondSessionResponse);

    await getCached('/api/auth/profile/');
    beginAuthTransition();
    const secondSession = await getCached('/api/auth/profile/');

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(secondSession).toBe(secondSessionResponse);
  });
});
