# Google reCAPTCHA setup

The login, Google sign-in, account registration, registration OTP, and admin MFA endpoints require a verified Google reCAPTCHA v2 checkbox token. The browser sends the one-use token as `recaptcha_token`; Django verifies it with Google's `siteverify` API before running the corresponding auth action.

## Keys and domains

Create separate reCAPTCHA v2 checkbox key pairs for development and production in the Google reCAPTCHA admin console. Add these allowed hostnames to the matching keys:

- Development: `localhost` and `127.0.0.1`.
- Production: `cav-photostudio-and-cafe-frontend.onrender.com` and each custom frontend hostname that serves the app.
- Native app WebViews: allow the local WebView hostname used by the platform (commonly `localhost`). Confirm the hostname Google returns for each supported build before release.

Set the public key as `REACT_APP_RECAPTCHA_SITE_KEY` in the frontend's local environment and the Render static service environment. The local Render export loader copies only this explicitly allowlisted `REACT_APP_` variable into the browser build.

This frontend uses Create React App (`react-scripts`), so use the `REACT_APP_` prefix consistently; `VITE_` variables are not read by this build. `npm run build` fails before bundling if the public site key is absent, so a deployment cannot publish a login or registration page with verification silently unconfigured. A non-empty process environment value overrides the local export; an empty process value does not mask a configured export value.

Set the matching private key as `RECAPTCHA_SECRET_KEY` only in the backend environment: the local backend export or Render backend service settings. Set `RECAPTCHA_ALLOWED_HOSTS` to a comma-separated list of the exact hostnames that key accepts. `RECAPTCHA_ENABLED` defaults to `true`; setting it to `false` is intended only for isolated automated tests.

The current deployment blueprint declares `REACT_APP_RECAPTCHA_SITE_KEY` as a Render-supplied (`sync: false`) variable. Add the real public site key to the `cav-photostudio-and-cafe-frontend` Static Site environment in Render, then trigger a new deployment because static environment values are compiled into the bundle. Add its matching secret only to the separately managed backend service, and confirm the backend `RECAPTCHA_ALLOWED_HOSTS` includes every production frontend hostname configured for that key. The repository's Render blueprint does not provision or manage the backend service.

Never put the secret key in a `REACT_APP_` variable, frontend export, Render static-service variable, source code, or client logs. Use different key pairs for development and production. The site key is public by design, but the secret is server-only.

## Retry behavior

Google's tokens are single-use and expire after two minutes. A rejected, expired, or reused token requires the user to complete the checkbox again. The backend returns a clear message and the frontend resets the widget after every auth attempt. If the widget cannot load, the page exposes a retry action.

The Render frontend Content Security Policy permits Google's reCAPTCHA script, frame, and verification endpoints. If deployment adds a different provider or policy, retain those reCAPTCHA origins in the applicable CSP directives.
