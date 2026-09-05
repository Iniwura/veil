/* global console */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const distDir = path.resolve(process.argv[2] ?? path.join("frontend", "dist"));

function fail(message) {
  console.error(`frontend dist verification failed: ${message}`);
  process.exitCode = 1;
}

function requiredFile(relativePath) {
  const filePath = path.join(distDir, relativePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`missing ${relativePath}`);
    return undefined;
  }
  if (fs.statSync(filePath).size === 0) fail(`${relativePath} is empty`);
  return filePath;
}

function allFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(entryPath) : [entryPath];
  });
}

if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
  fail(`dist directory does not exist: ${distDir}`);
  process.exit(1);
}

const indexPath = requiredFile("index.html");
const tfhePath = requiredFile("tfhe_bg.wasm");
const kmsPath = requiredFile("kms_lib_bg.wasm");

if (!indexPath || !tfhePath || !kmsPath) process.exit(1);

const indexHtml = fs.readFileSync(indexPath, "utf8");
if (!indexHtml.includes("<title>UNVEIL — Save privately. Win verifiably.</title>")) {
  fail("index.html does not contain the expected UNVEIL title");
}
if (!indexHtml.includes('id="root"')) fail("index.html does not contain the React root");

const files = allFiles(distDir);
const localReferences = [...indexHtml.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
  .map((match) => match[1].split(/[?#]/, 1)[0])
  .filter((reference) => reference.startsWith("/") && !reference.startsWith("//"));

for (const reference of localReferences) {
  const relativePath = reference.replace(/^\/+/, "");
  if (!relativePath) continue;
  const referencedPath = path.join(distDir, relativePath);
  if (!fs.existsSync(referencedPath) || !fs.statSync(referencedPath).isFile()) {
    fail(`index.html references missing local asset ${reference}`);
  }
}

const forbiddenProductionStrings = [
  "MotionDebugVault",
  "motionDebug",
  "LOCAL MOTION HARNESS",
  "Harness principal",
  "Harness reserved",
  "Harness shares",
];
for (const filePath of files.filter((candidate) => candidate.endsWith(".js"))) {
  const source = fs.readFileSync(filePath, "utf8");
  for (const forbidden of forbiddenProductionStrings) {
    if (source.includes(forbidden)) fail(`${forbidden} is present in ${path.relative(distDir, filePath)}`);
  }
}

if (process.exitCode) process.exit(1);

console.log("frontend dist verification passed");
console.log(`  dist: ${distDir}`);
console.log(`  tfhe_bg.wasm: ${fs.statSync(tfhePath).size} bytes`);
console.log(`  kms_lib_bg.wasm: ${fs.statSync(kmsPath).size} bytes`);
console.log(`  local index references: ${localReferences.length}`);
