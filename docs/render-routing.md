# Render SPA Routing

The frontend is a React single-page application. Configure the Render static site routes in this order:

| Source | Destination | Action |
| --- | --- | --- |
| `/api/*` | `https://cav-photostudio-and-cafe.onrender.com/api/*` | Rewrite |
| `/*` | `/index.html` | Rewrite |

The API rewrite must precede the SPA fallback. Otherwise Django API paths return the frontend HTML document. Both rules are versioned in the root `render.yaml`; for an existing static site that was not created from the Blueprint, add them in Render Dashboard under Static Site > Redirects/Rewrites, with the API rule first. Verify the API path returns Django JSON before enabling traffic.

## Environment settings

The checked-in `render.yaml` supplies public frontend configuration such as the API path and Google OAuth client ID. Locally, `frontend/load-render-env.cjs` reads `cav_env/CAV-Photostudio-and-Cafe-frontend.env` and passes only an explicit public-variable allowlist to Create React App. The backend export is a local development file and is loaded by Django locally. Do not copy the whole export into Render: enter production values individually as managed backend secrets, and use a restricted non-owner `DATABASE_URL` role without `BYPASSRLS`. Keep credentials out of frontend variables and the static bundle.

The backend service is configured separately in Render and is not provisioned by this Blueprint. Never add backend values to `render.yaml`, frontend build variables, or the frontend export. Provision private Redis and set `REDIS_URL` when using the default multiple Gunicorn workers so rate limits and OTP/MFA state are shared.

## Static Site Headers

Render applies custom response headers for static sites from the Dashboard. The API origin must return `Cache-Control: private, no-store` and `Cloudflare-CDN-Cache-Control: no-store`. In Cloudflare, add a cache-bypass rule for `/api/*` before other cache rules and purge cached API URLs after correcting routing. For the existing frontend service, add these rules in **Static Site > Headers**:

| Path | Header | Value |
| --- | --- | --- |
| `/*` | `Cache-Control` | `no-store, max-age=0, s-maxage=0, must-revalidate` |
| `/api/*` | `Cache-Control` | `private, no-store, max-age=0, must-revalidate` |

This prevents the CDN from serving an old HTML entry document after a deployment. Hashed JavaScript and CSS filenames still ensure that each deployed build has distinct assets.

If security headers are configured in the Dashboard, preserve the existing CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and `Permissions-Policy` rules when adding the cache rule.
