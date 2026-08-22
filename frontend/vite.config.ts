import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const wasmAssets = [
  {
    route: "/tfhe_bg.wasm",
    source: path.resolve("node_modules/@zama-fhe/relayer-sdk/lib/tfhe_bg.wasm"),
    fileName: "tfhe_bg.wasm",
  },
  {
    route: "/kms_lib_bg.wasm",
    source: path.resolve("node_modules/@zama-fhe/relayer-sdk/lib/kms_lib_bg.wasm"),
    fileName: "kms_lib_bg.wasm",
  },
] as const;

function zamaWasmAssets(): Plugin {
  return {
    name: "veil-zama-wasm-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const asset = wasmAssets.find(({ route }) => req.url?.split("?")[0] === route);
        if (!asset) return next();

        try {
          const wasm = fs.readFileSync(asset.source);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/wasm");
          res.setHeader("Content-Length", wasm.byteLength.toString());
          res.end(wasm);
        } catch (error) {
          next(error as Error);
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const asset = wasmAssets.find(({ route }) => req.url?.split("?")[0] === route);
        if (!asset) return next();

        try {
          const wasm = fs.readFileSync(asset.source);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/wasm");
          res.setHeader("Content-Length", wasm.byteLength.toString());
          res.end(wasm);
        } catch (error) {
          next(error as Error);
        }
      });
    },
    generateBundle() {
      for (const asset of wasmAssets) {
        this.emitFile({
          type: "asset",
          fileName: asset.fileName,
          source: fs.readFileSync(asset.source),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), zamaWasmAssets()],
  server: {
    port: 5173,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
