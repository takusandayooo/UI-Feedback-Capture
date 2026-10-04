import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";

const watch = process.argv.includes("--watch");
// Remove runtime assets from earlier local-ASR builds.
for (const asset of [
  "runtime",
  "licenses",
  "voice.js",
  "asr-worker.js",
  "voice.html",
  "voice.css",
  "THIRD_PARTY_NOTICES.txt",
]) {
  await rm(asset, { recursive: true, force: true });
}
for (const [index, entry] of ["content", "background"].entries()) {
  await build({
    configFile: false,
    plugins: [
      {
        name: "existing-extension-loader",
        async writeBundle() {
          await cp(`dist/${entry}.js`, `${entry}.js`);
          if (index === 0) {
            for (const asset of ["manifest.json", "privacy.html", "icons"]) {
              await cp(`dist/${asset}`, asset, { recursive: true });
            }
          }
        },
      },
    ],
    publicDir: index === 0 ? "public" : false,
    build: {
      target: "chrome120",
      outDir: "dist",
      emptyOutDir: index === 0,
      minify: false,
      watch: watch ? {} : null,
      lib: {
        entry: resolve("src", `${entry}.ts`),
        name: `UIFeedback${entry}`,
        formats: ["iife"],
        fileName: () => `${entry}.js`,
      },
    },
  });
}
