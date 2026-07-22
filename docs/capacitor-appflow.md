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

## Verify a release

1. Install the new APK or AAB on a physical device.
2. Open the app and sign in with an account that works on the deployed website.
3. If sign-in fails, check the API service logs for `POST /api/auth/login/`.
   - No request means the APK has an incorrect/stale API URL or the device has no network access.
   - A `401` request means the API received the credentials and rejected them; reset the password or verify the username for that deployed database.
   - A `200` request means authentication worked; inspect the device log for a client-side navigation issue.
