import { mkdir, rm } from "node:fs/promises";

const output = `${process.cwd()}/artifacts/UI-Feedback-Capture-store.zip`;
await mkdir("artifacts", { recursive: true });
await rm(output, { force: true });
const result = Bun.spawnSync(["zip", "-qr", output, "."], { cwd: "dist" });
if (result.exitCode !== 0)
  throw new Error(new TextDecoder().decode(result.stderr));
console.log(output);
