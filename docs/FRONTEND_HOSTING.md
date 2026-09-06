# UNVEIL frontend hosting

UNVEIL is deployed on Vercel from the public GitHub repository.

- Production URL: https://veil-green.vercel.app
- Repository: https://github.com/Iniwura/veil
- Frontend: `frontend/`
- Build output: `frontend/dist`

## Production configuration

The repository root contains the active `vercel.json` configuration. It installs both the root and frontend dependency
sets, builds the Vite frontend, publishes `frontend/dist`, and rewrites application routes to `index.html` for SPA
navigation.

Equivalent configuration:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "installCommand": "npm install && npm --prefix frontend install",
  "buildCommand": "npm --prefix frontend run build",
  "outputDirectory": "frontend/dist",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

The separate Frontend GitHub Actions workflow also installs both dependency sets before building because frontend
TypeScript imports shared repository modules.

## Local production build

From the repository root:

```bash
npm install
npm --prefix frontend install
npm --prefix frontend run build
```

The frontend package also exposes its distribution verifier:

```bash
cd frontend
npm run verify:dist
```

## Application routes

The current application uses the public landing page plus the app routes under `/app`, including the active Save and
Draw experiences. Vercel's SPA rewrite allows direct navigation and browser refresh without requiring separate server
routes.

## Release state

The production deployment uses the final V4 Sepolia addresses documented in the root README and `docs/DEPLOYMENT.md`.

Vercel deployments are created from GitHub updates to the repository. A successful Vercel status on the submission
commit verifies that the hosted production build completed for that revision.

## Demo boundary

The hosted application is a Sepolia competition/demo build. Its cUSDC label refers to the deployed demo asset route, and
its ERC-4626 strategy appreciation is simulated rather than production market yield.
