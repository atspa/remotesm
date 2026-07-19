# RemoteEsm

`RemoteEsm` imports a remote ESM runtime module, fetches its `.d.ts` graph, converts declarations to JSON completion data, emits safe JSDoc helper typedefs, and caches everything in virtual memory.

## Main API

```ts
import { RemoteEsmImport, markdownCodeBlock } from "./index.ts";

const octo = await RemoteEsmImport("@octokit/core@7.0.6", {
  typeNameSuffix: "T",
  unknownType: "unknown",
  maxDepth: 2,
  maxFiles: 30,
  includeBareDtsImports: true,
  log: true,
  jsdoc: {
    format: "oneLine",
    space: "",
    tags: {
      property: "prop",
      argument: "arg"
    },
    globals: "importTypes",
    importTypes: {
      mode: "namespace",
      namespaceName: "OctokitModuleT"
    },
    shorthand: {
      enabled: true,
      includeTypedefs: true
    }
  }
});

output.markdown(markdownCodeBlock(octo.jsdoc, "js"));

const Octokit = octo.pick("Octokit");
console.info(Reflect.ownKeys(Octokit));
```

## Supported inputs

```ts
await RemoteEsmImport("zod");
await RemoteEsmImport("zod@4.4.3");
await RemoteEsmImport("@octokit/core");
await RemoteEsmImport("@octokit/core@7.0.6");
await RemoteEsmImport("github:user/repo#commit");
await RemoteEsmImport("gh:user/repo#commit");
await RemoteEsmImport("https://esm.sh/@octokit/core@7.0.6");
await RemoteEsmImport({ runtimeUrl: "https://esm.sh/pkg", dtsUrl: "https://example.com/pkg.d.ts", specifier: "pkg" });
```

## Notes

- `jsdoc.globals` defaults to `"none"`, so fake runtime stubs are not emitted unless requested.
- `jsdoc.globals: "importTypes"` emits type-only import aliases instead.
- `jsdoc.format: "oneLine"` joins each JSDoc block using `jsdoc.space`; `space: ""` joins blocks as `*//**`.
- Built-in shorthand aliases are enabled by default: `s`, `n`, `b`, `x`, `X`, `O`, etc.
