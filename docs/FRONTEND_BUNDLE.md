# UNVEIL frontend bundle record

Measured from the release-candidate frontend build with Vite `7.3.6` and the existing dependency lockfile. No protocol
or client semantics were changed for this measurement.

## Entry output

| Measure                 | Approved V2 UI / signature-motion | Release candidate |
| ----------------------- | --------------------------------: | ----------------: |
| Initial JavaScript      |                     522,835 bytes |     522,835 bytes |
| Initial JavaScript gzip |                         176.37 kB |         176.37 kB |
| CSS                     |                          46.86 kB |          46.86 kB |
| CSS gzip                |                           9.14 kB |           9.14 kB |
| Lazy JavaScript chunks  |                              none |              none |

The production entry file is the single hashed application chunk. Vite still reports a warning because the entry exceeds
its 500 kB threshold; the warning is accepted for this release candidate because the measured composition is understood
and no safe low-risk split was required.

## Rollup module measurement

Rollup reported 129 modules in the entry. Its rendered module-length totals are pre-minification category measurements
and are not additive final bundle bytes:

- Application modules under `frontend/src`: `130,149` bytes.
- React, React DOM, and scheduler: `593,084` bytes.
- ethers plus its `@adraffy` and `@noble` helper modules: `719,144` bytes.
- Zama Relayer SDK JavaScript: `0` bytes.
- Other modules: `1,308` bytes.

The dominant dependencies are therefore React DOM and ethers. The browser FHE runtime is not duplicated in the
application chunk: `@zama-fhe/relayer-sdk` is imported only for TypeScript types in `frontend/src/veilClient.ts`, while
the runtime remains the existing external Zama `0.4.1` UMD script in `frontend/index.html`. The FHE support files are
emitted separately as the root-level `tfhe_bg.wasm` and `kms_lib_bg.wasm` assets.

## Code-splitting decision

Route/page splitting was reviewed and rejected for this slice. The current application creates one wallet-scoped
`useUnveil` controller and shares it across routes. Splitting pages without changing that lifecycle would not remove the
dominant React/ethers cost and would increase the risk of duplicate wallet listeners, repeated private-state loading, or
route transition regressions.

The release verifier records the current single-entry output and confirms that the development-only motion harness is
absent from production JavaScript.
