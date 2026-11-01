import React from 'react';
import { act, render, screen } from '@testing-library/react';
import RecaptchaChallenge from './RecaptchaChallenge';

describe('RecaptchaChallenge', () => {
  const originalSiteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY;

  afterEach(() => {
    if (originalSiteKey === undefined) delete process.env.REACT_APP_RECAPTCHA_SITE_KEY;
    else process.env.REACT_APP_RECAPTCHA_SITE_KEY = originalSiteKey;
    delete window.grecaptcha;
  });

  test('shows setup guidance if the public site key is missing', () => {
    delete process.env.REACT_APP_RECAPTCHA_SITE_KEY;
    render(<RecaptchaChallenge onTokenChange={jest.fn()} />);
    expect(screen.getByText(/Security verification is not configured/)).toBeInTheDocument();
  });

  test('clears an expired challenge token and provides a retry message', async () => {
    process.env.REACT_APP_RECAPTCHA_SITE_KEY = 'public-site-key';
    const onTokenChange = jest.fn();
    let widgetCallbacks;
    window.grecaptcha = {
      render: jest.fn((_element, callbacks) => {
        widgetCallbacks = callbacks;
        return 7;
      }),
      reset: jest.fn(),
    };
    render(<RecaptchaChallenge onTokenChange={onTokenChange} />);
    await act(async () => { await Promise.resolve(); });

    act(() => widgetCallbacks.callback('short-lived-token'));
    expect(onTokenChange).toHaveBeenLastCalledWith('short-lived-token', '');
    act(() => widgetCallbacks['expired-callback']());
    expect(onTokenChange).toHaveBeenLastCalledWith('', 'The security check expired. Complete it again to retry.');
  });
});
