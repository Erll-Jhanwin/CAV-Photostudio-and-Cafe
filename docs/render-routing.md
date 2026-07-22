# Render SPA Routing

The frontend is a React single-page application. Configure the Render static site with this rewrite rule so direct links and refreshes are handled by React Router:

| Source | Destination | Action |
| --- | --- | --- |
| `/*` | `/index.html` | Rewrite |

The same rule is versioned in the root `render.yaml` for Render Blueprint syncs. For an existing static site that was not created from the Blueprint, add the rule once in Render Dashboard: Static Site > Redirects/Rewrites.

## Static Site Headers

Render applies custom response headers for static sites from the Dashboard. For the existing frontend service, add this rule in **Static Site > Headers**:

| Path | Header | Value |
| --- | --- | --- |
| `/*` | `Cache-Control` | `no-store, max-age=0, s-maxage=0, must-revalidate` |

This prevents the CDN from serving an old HTML entry document after a deployment. Hashed JavaScript and CSS filenames still ensure that each deployed build has distinct assets.

If security headers are configured in the Dashboard, preserve the existing CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and `Permissions-Policy` rules when adding the cache rule.
