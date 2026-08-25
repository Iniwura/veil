# UNVEIL frontend hosting contract

This document is provider-neutral. No Vercel, Netlify, Cloudflare, or other hosting provider is selected or configured
in this release candidate.

## Required origin behavior

The frontend must be served over HTTPS. The host must return the built `frontend/dist/index.html` document for these
application routes, including direct navigation and browser refresh:

- `/app`
- `/app/save`
- `/app/draws`
- `/app/vault`
- `/app/prizes`
- `/app/history`
- `/app/more`

This is an SPA fallback, not a rewrite of static assets. Requests for hashed Vite assets and root-level WASM files must
continue to resolve to their actual files. Unknown static asset requests must not silently return `index.html`.

## Required response headers

Every frontend document that can initialize the FHE client must be served with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These headers are currently configured for Vite development and preview in `frontend/vite.config.ts`; a production
static host must configure them at the origin or edge as well. Vite configuration does not automatically configure a
separate production host.

The application also loads the Zama Relayer SDK browser bundle from the existing external URL in `frontend/index.html`:

```text
https://cdn.zama.org/relayer-sdk-js/0.4.1/relayer-sdk-js.umd.cjs
```

Do not change that version, vendor a second copy, or remove cross-origin isolation to work around a hosting issue. The
selected host must be tested with the current CDN resource under the COOP/COEP policy.

## WASM assets

The following root paths must remain reachable and must be served with the `application/wasm` content type:

- `/tfhe_bg.wasm`
- `/kms_lib_bg.wasm`

Both files are emitted into `frontend/dist` by the existing Vite plugin and must remain non-empty. They must not be
renamed, placed behind an SPA fallback, or blocked by an asset policy.

## Caching

- Do not cache `index.html` indefinitely. Use a short TTL or revalidation so a new release can update the application
  shell.
- Hashed Vite assets such as `/assets/index-<hash>.js` and `/assets/index-<hash>.css` may use long-lived immutable
  caching.
- The root WASM files may be cached when the deployment invalidates them with the release, but they must remain
  reachable at the exact root paths above.

## Release verification

From the repository root, build and verify the static release before selecting a host:

```bash
cd frontend
npm ci
npm run build
npm run verify:dist
```

`verify:dist` checks the required files, metadata, local asset references, WASM presence, and removal of the
development-only motion harness from the production JavaScript. Hosting-route fallback and response-header checks must
be repeated against the selected provider in the next slice.
