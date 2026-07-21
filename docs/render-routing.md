# Render SPA Routing

The frontend is a React single-page application. Configure the Render static site with this rewrite rule so direct links and refreshes are handled by React Router:

| Source | Destination | Action |
| --- | --- | --- |
| `/*` | `/index.html` | Rewrite |

The same rule is versioned in the root `render.yaml` for Render Blueprint syncs. For an existing static site that was not created from the Blueprint, add the rule once in Render Dashboard: Static Site > Redirects/Rewrites.
