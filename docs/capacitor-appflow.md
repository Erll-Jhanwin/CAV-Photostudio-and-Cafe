# Capacitor Appflow Builds

The Android app is a bundled copy of the React frontend. It must use the deployed Django API, not `localhost`.

## Appflow environment variables

Add these variables to the Appflow environment used for the Android build:

```text
REACT_APP_API_BASE_URL=https://cav-photostudio-and-cafe.onrender.com
REACT_APP_MOBILE_API_BASE_URL=https://cav-photostudio-and-cafe.onrender.com
```

`REACT_APP_*` values are embedded when Create React App builds the bundle. Changing a variable requires a new web build and Android build.

The backend CORS configuration accepts Capacitor's `https://localhost` origin. Keep your deployed frontend URL in `CORS_ALLOWED_ORIGINS` as well; the app uses JWT authorization and does not depend on browser cookies.

## Build command

Use this command before the Android native build step:

```text
npm ci && npm run cap:sync
```

`cap:sync` builds the frontend and copies it to the root `android/` Capacitor project. Build that project only. Do not build the legacy `frontend/android/` folder, since it can contain an older bundled app.

## Google sign-in on Android

The app uses native Android Google sign-in, not the browser button used by the website. Before creating an Appflow release:

1. In Google Cloud Console, create an **Android** OAuth client.
2. Set its package name to `com.cav.photostudio`.
3. Add the SHA-1 fingerprint of the certificate that signs the Appflow release. If Google Play App Signing is enabled, also add the SHA-1 from Play Console under **Test and release > Setup > App signing**.
4. Keep the existing **Web** OAuth client ID in both `REACT_APP_GOOGLE_CLIENT_ID` for the Appflow build and `GOOGLE_CLIENT_ID` for the Django service. The app has a native fallback so the button is visible even before Appflow variables are configured, but setting the variable is still recommended for future client-ID changes. The native app requests an ID token for this web client, and Django verifies that token.

An Android OAuth client is different from the authorized JavaScript origins used by the website. Do not add `capacitor://localhost` as a JavaScript origin for Android authentication.

## Verify a release

1. Install the new APK or AAB on a physical device.
2. Open the app and sign in with an account that works on the deployed website.
3. If sign-in fails, check the API service logs for `POST /api/auth/login/`.
   - No request means the APK has an incorrect/stale API URL or the device has no network access.
   - A `401` request means the API received the credentials and rejected them; reset the password or verify the username for that deployed database.
   - A `200` request means authentication worked; inspect the device log for a client-side navigation issue.
