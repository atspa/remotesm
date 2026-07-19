import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "tsdown";

type BundleKind = "ts" | "mjs";

const kind = process.argv[2] as BundleKind | undefined;
if (kind !== "ts" && kind !== "mjs") {
  throw new TypeError('Expected bundle kind "ts" or "mjs".');
}

const outputDirectory = resolve(process.argv[3] || await getDefaultOutputDirectory());
const extension = kind === "ts" ? ".ts" : ".mjs";

await build({
  entry: { bundle: "src/index.ts" },
  format: "esm",
  dts: false,
  outDir: outputDirectory,
  outExtensions: () => ({ js: extension }),
  clean: false,
  target: "esnext",
  platform: "neutral",
});

async function getDefaultOutputDirectory(): Promise<string> {
  try {
    const tsconfig = JSON.parse(await readFile("tsconfig.json", "utf8")) as {
      compilerOptions?: { outDir?: unknown };
    };
    const outDir = tsconfig.compilerOptions?.outDir;
    return typeof outDir === "string" && outDir.trim() ? outDir : "build";
  } catch {
    return "build";
  }
}
