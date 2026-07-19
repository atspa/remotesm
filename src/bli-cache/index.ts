
/**
 * Environment-agnostic runtime-module and TypeScript-declaration resolver.
 *
 * Modes:
 * - standaloneScript: bare and `npm: ` references resolve through esm.sh.
 * - nodenext: bare and `npm: ` references resolve through local node_modules,
 *   searching upward from the importing file. CDN fallback is disabled by default.
 * - monaco: local-first package resolution with CDN fallback and optional
 *   monaco-editor-auto-typings integration.
 *
 * Remote runtime modules can be persisted in Cache Storage. In Airtable, the
 * default cache is scoped to the current `base.id`, for example:
 *
 *   auto-typings:appXXXXXXXXXXXXXX
 *
 * Requested aliases such as `zod` point to exact records such as `zod @4.2.3`.
 * The exact record stores ESM source text and expiry metadata.
 */
export default class AutoTypings {
    static sharedCache = createMemoryCache();

    /**
     * @param {object} [options]
     * @param {'standaloneScript'|'nodenext'|'monaco'} [options.mode='standaloneScript']
     * @param {object} [options.libs]
     * @param {(input: string, init?: object) => Promise<any>} [options.libs.fetch]
     * @param {(specifier: string) => Promise<any>} [options.libs.importModule]
     * @param {typeof URL} [options.libs.URL]
     * @param {typeof Response} [options.libs.Response]
     * @param {typeof Blob} [options.libs.Blob]
     * @param {CacheStorage} [options.libs.cacheStorage]
     * @param {(url: URL) => Promise<string>|string} [options.libs.readTextFile]
     * @param {(path: string) => string|URL} [options.libs.pathToFileURL]
     * @param {() => string} [options.libs.cwd]
     * @param {Console|Pick<Console, 'error'|'warn'>} [options.libs.console]
     * @param {any} [options.libs.monaco]
     * @param {any} [options.libs.MonacoAutoTypings]
     * @param {any} [options.libs.editor]
     * @param {string|URL} [options.projectBaseURL]
     * @param {string|URL|null} [options.nodeModulesBaseURL]
     * @param {string|URL} [options.cdnBaseURL='https://esm.sh/']
     * @param {string|URL} [options.packageFilesBaseURL='https://cdn.jsdelivr.net/npm/']
     * @param {boolean} [options.allowCdnFallback]
     * @param {object} [options.cache]
     * @param {string} [options.cacheScope]
     * @param {{value:number, unit:string}} [options.cacheCycleLength]
     * @param {boolean} [options.persistentModuleCache=true]
     * @param {string} [options.moduleCacheName='auto-typings']
     * @param {number} [options.maxTypeDepth=8]
     * @param {number} [options.maxTypeFiles=256]
     * @param {number} [options.typeConcurrency=8]
     * @param {(error: unknown) => void} [options.onError]
     * @param {string} [options.monacoFileRoot='inmemory://model/']
     * @param {any} [options.monacoSourceCache]
     * @param {any} [options.monacoSourceResolver]
     */
    constructor({
        mode = 'standaloneScript',

        libs: {
            fetch: fetchImpl =
            globalThis.fetch?.bind(globalThis),

            importModule =
            specifier =>
                import(
                    /* @vite-ignore */
                    specifier
                ),

            URL: URLImpl =
            globalThis.URL,

            Response: ResponseImpl =
            globalThis.Response,

            Blob: BlobImpl =
            globalThis.Blob,

            cacheStorage =
            globalThis.caches,

            readTextFile,
            pathToFileURL,

            cwd =
            globalThis.process?.cwd?.bind(
                globalThis.process,
            ),

            console: consoleImpl =
            globalThis.console,

            monaco,
            MonacoAutoTypings,
            editor,
        } = {},

        projectBaseURL,
        nodeModulesBaseURL,

        cdnBaseURL =
        'https://esm.sh/',

        packageFilesBaseURL =
        'https://cdn.jsdelivr.net/npm/',

        allowCdnFallback,

        cache =
        AutoTypings.sharedCache,

        cacheScope,

        cacheCycleLength = {
            value: 24,
            unit: 'hours',
        },

        persistentModuleCache =
        true,

        moduleCacheName =
        'auto-typings',

        maxTypeDepth = 8,
        maxTypeFiles = 256,
        typeConcurrency = 8,

        onError,

        monacoFileRoot =
        'inmemory://model/',

        monacoSourceCache,
        monacoSourceResolver,
    } = {}) {
        if (!URLImpl) {
            throw new TypeError(
                'A URL implementation is required through libs.URL or globalThis.URL',
            );
        }

        if (
            ![
                'standaloneScript',
                'nodenext',
                'monaco',
            ].includes(mode)
        ) {
            throw new TypeError(
                `Unsupported mode: ${mode;
        } `,
      );
    }

    this.mode = mode;

    this.libs = {
      fetch: fetchImpl,
      importModule,
      URL: URLImpl,
      Response: ResponseImpl,
      Blob: BlobImpl,
      cacheStorage,
      readTextFile,
      pathToFileURL,
      cwd,
      console: consoleImpl,
      monaco,
      MonacoAutoTypings,
      editor,
    };

    this.cache =
      normalizeMemoryCache(cache);

    this.maxTypeDepth =
      toPositiveInteger(
        maxTypeDepth,
        'maxTypeDepth',
      );

    this.maxTypeFiles =
      toPositiveInteger(
        maxTypeFiles,
        'maxTypeFiles',
      );

    this.typeConcurrency =
      toPositiveInteger(
        typeConcurrency,
        'typeConcurrency',
      );

    this.onError =
      onError ??
      (error => {
        consoleImpl?.error?.(
          error,
        );
      });

    this.projectBaseURL =
      this.#normalizeBaseURL(
        projectBaseURL,
      );

    this.cdnBaseURL =
      new URLImpl(
        String(cdnBaseURL),
        this.projectBaseURL,
      );

    this.packageFilesBaseURL =
      new URLImpl(
        String(
          packageFilesBaseURL,
        ),
        this.projectBaseURL,
      );

    this.allowCdnFallback =
      mode ===
      'standaloneScript'
        ? true
        : (
          allowCdnFallback ??
          mode !== 'nodenext'
        );

    if (
      mode ===
      'standaloneScript'
    ) {
      this.nodeModulesBaseURL =
        null;
    } else if (
      nodeModulesBaseURL ===
      null
    ) {
      this.nodeModulesBaseURL =
        null;
    } else {
      this.nodeModulesBaseURL =
        new URLImpl(
          String(
            nodeModulesBaseURL ??
            './node_modules/',
          ),
          this.#asDirectoryURL(
            this.projectBaseURL,
          ),
        );
    }

    this.cacheCycleLength =
      normalizeCacheCycleLength(
        cacheCycleLength,
      );

    this.cacheCycleMilliseconds =
      cacheCycleToMilliseconds(
        this.cacheCycleLength,
      );

    const detectedScope =
      cacheScope ??
      detectCurrentBaseId();

    this.persistentModuleCache =
      (
        persistentModuleCache &&
        detectedScope &&
        cacheStorage &&
        ResponseImpl
      )
        ? {
          scope:
            String(
              detectedScope,
            ),

          cacheName:
            `${ moduleCacheName; }:${ detectedScope; } `,

          storage:
            cacheStorage,

          Response:
            ResponseImpl,

          Blob:
            BlobImpl,

          promise:
            null,
        }
        : null;

    this.monacoOptions = {
      fileRoot:
        monacoFileRoot,

      sourceCache:
        monacoSourceCache,

      sourceResolver:
        monacoSourceResolver,
    };

    this.monacoLoaders =
      new Map();

    this.monacoModels =
      new Map();

    this.monacoAliases =
      Object.create(null);

    if (
      mode === 'monaco' &&
      (
        !monaco ||
        !MonacoAutoTypings ||
        !editor
      )
    ) {
      throw new TypeError(
        'monaco mode requires libs.monaco, libs.MonacoAutoTypings, and libs.editor',
      );
    }
  }

  /**
   * Parse an npm-style package reference.
   */
  parsePackageReference(
    value,
  ) {
    const input =
      String(value)
        .replace(
          /^\/+/,
          '',
        );

    const match =
      input.match(
        /^(?<name>@[^/]+\/[^/@]+|[^/@]+)(?:@(?<version>[^/]+))?(?:\/(?<subpath>.*))?$/,
      );

    if (!match?.groups) {
      throw new TypeError(
        `Invalid package reference: ${ value; } `,
      );
    }

    return {
      name:
        match.groups.name,

      version:
        match.groups.version,

      subpath:
        match.groups.subpath ||
        '',
    };
  }

  /**
   * Resolve a package reference, path, or URL.
   */
  async resolve(
    specifier,
    parent =
      this.projectBaseURL.href,
  ) {
    const key = [
      this.mode,

      this.projectBaseURL.href,

      this.nodeModulesBaseURL
        ?.href ??
      '',

      this.cdnBaseURL.href,

      String(
        this.allowCdnFallback,
      ),

      String(parent),
      String(specifier),
    ].join('\n');

    if (
      this.cache.resolutions
        .has(key)
    ) {
      return this.cache.resolutions
        .get(key);
    }

    const promise =
      this.#resolveUncached(
        String(specifier),
        parent,
      );

    this.cache.resolutions
      .set(
        key,
        promise,
      );

    try {
      return await promise;
    } catch (error) {
      this.cache.resolutions
        .delete(key);

      throw error;
    }
  }

  /**
   * Load and recursively collect TypeScript declarations.
   */
  async types(
    specifier,
    parent =
      this.projectBaseURL.href,
  ) {
    const resolved =
      await this.resolve(
        specifier,
        parent,
      );

    const key =
      resolved.typeCacheKey;

    if (
      this.cache.types
        .has(key)
    ) {
      return this.cache.types
        .get(key);
    }

    const promise =
      this.#loadTypesUncached(
        resolved,
      );

    this.cache.types.set(
      key,
      promise,
    );

    try {
      const bundle =
        await promise;

      if (
        this.mode ===
        'monaco'
      ) {
        await this.#registerMonaco(
          resolved,
          bundle,
        );
      }

      return bundle;
    } catch (error) {
      this.cache.types
        .delete(key);

      throw error;
    }
  }

  /**
   * Resolve and import a runtime module, using persistent source cache first.
   */
  async import(
    specifier,
    parent =
      this.projectBaseURL.href,
  ) {
    const resolved =
      await this.resolve(
        specifier,
        parent,
      );

    const memoryKey =
      resolved.runtimeURL;

    if (
      !this.cache.modules
        .has(memoryKey)
    ) {
      const promise =
        this.#importResolvedModule(
          resolved,
        );

      this.cache.modules.set(
        memoryKey,
        promise,
      );

      promise.catch(() => {
        this.cache.modules
          .delete(
            memoryKey,
          );
      });
    }

    return this.cache.modules
      .get(memoryKey);
  }

  /**
   * Resolve a reference and return its runtime value and declarations.
   */
  async load(
    specifier,
    {
      parent =
        this.projectBaseURL.href,

      value = true,
      types = true,
    } = {},
  ) {
    const resolution =
      await this.resolve(
        specifier,
        parent,
      );

    const [
      runtimeValue,
      declarationBundle,
    ] =
      await Promise.all([
        value
          ? this.import(
            specifier,
            parent,
          )
          : undefined,

        types
          ? this.types(
            specifier,
            parent,
          )
          : undefined,
      ]);

    return {
      resolution,

      ...(
        value
          ? {
            value:
              runtimeValue,
          }
          : {}
      ),

      ...(
        types
          ? {
            types:
              declarationBundle,
          }
          : {}
      ),
    };
  }

  /**
   * Read text using the injected fetch or filesystem adapter.
   */
  async text(
    url,
    {
      optional = false,
      cache = true,
    } = {},
  ) {
    const href =
      this.#toURL(url)
        .href;

    if (
      cache &&
      this.cache.text
        .has(href)
    ) {
      return this.cache.text
        .get(href);
    }

    const promise =
      this.#readURLText(
        href,
        optional,
      );

    if (cache) {
      this.cache.text.set(
        href,
        promise,
      );
    }

    try {
      return await promise;
    } catch (error) {
      if (cache) {
        this.cache.text
          .delete(href);
      }

      throw error;
    }
  }

  /**
   * Read and parse JSON using the injected adapters.
   */
  async json(
    url,
    options,
  ) {
    const href =
      this.#toURL(url)
        .href;

    if (
      this.cache.json
        .has(href)
    ) {
      return this.cache.json
        .get(href);
    }

    const promise =
      this.text(
        href,
        options,
      ).then(
        text =>
          text === undefined
            ? undefined
            : JSON.parse(
              text,
            ),
      );

    this.cache.json.set(
      href,
      promise,
    );

    promise.catch(() => {
      this.cache.json
        .delete(href);
    });

    return promise;
  }

  /**
   * List exact persistently cached module records for the current scope.
   */
  async listCachedModules({
    includeSource = false,
    includeExpired = true,
  } = {}) {
    const cache =
      await this.#openPersistentModuleCache();

    if (!cache) {
      return [];
    }

    const requests =
      await cache.keys();

    const records = [];

    for (
      const request of
      requests
    ) {
      const url =
        new this.libs.URL(
          request.url,
        );

      if (
        !url.pathname.includes(
          '/modules/',
        )
      ) {
        continue;
      }

      const response =
        await cache.match(
          request,
        );

      if (!response) {
        continue;
      }

      try {
        const record =
          await response.json();

        if (
          record?.type !==
          'module'
        ) {
          continue;
        }

        const expired =
          !this.#isPersistentRecordFresh(
            record,
          );

        if (
          !includeExpired &&
          expired
        ) {
          continue;
        }

        records.push({
          ...record,

          ...(
            includeSource
              ? {}
              : {
                source:
                  undefined,
              }
          ),

          expired,
        });
      } catch {
        // Ignore malformed records.
      }
    }

    return records.sort(
      (
        left,
        right,
      ) =>
        String(
          left.key,
        ).localeCompare(
          String(
            right.key,
          ),
        ),
    );
  }

  /**
   * Get a cached module record by an alias or exact key.
   */
  async getCachedModule(
    key,
    {
      includeExpired = false,
    } = {},
  ) {
    const cache =
      await this.#openPersistentModuleCache();

    if (!cache) {
      return undefined;
    }

    const requestedKey =
      String(key);

    const alias =
      await this.#readPersistentRecord(
        cache,
        'aliases',
        requestedKey,
      );

    const moduleKey =
      alias?.moduleKey ??
      requestedKey;

    const record =
      await this.#readPersistentRecord(
        cache,
        'modules',
        moduleKey,
      );

    if (!record) {
      return undefined;
    }

    if (
      !includeExpired &&
      !this.#isPersistentRecordFresh(
        record,
      )
    ) {
      return undefined;
    }

    return record;
  }

  /**
   * Delete an exact module record and every alias that points to it.
   */
  async deleteCachedModule(
    key,
  ) {
    const cache =
      await this.#openPersistentModuleCache();

    if (!cache) {
      return false;
    }

    const suppliedKey =
      String(key);

    const alias =
      await this.#readPersistentRecord(
        cache,
        'aliases',
        suppliedKey,
      );

    const moduleKey =
      alias?.moduleKey ??
      suppliedKey;

    let deleted =
      await cache.delete(
        this.#persistentRecordURL(
          'modules',
          moduleKey,
        ),
      );

    deleted =
      (
        await cache.delete(
          this.#persistentRecordURL(
            'aliases',
            suppliedKey,
          ),
        )
      ) || deleted;

    for (
      const request of
      await cache.keys()
    ) {
      const url =
        new this.libs.URL(
          request.url,
        );

      if (
        !url.pathname.includes(
          '/aliases/',
        )
      ) {
        continue;
      }

      const response =
        await cache.match(
          request,
        );

      if (!response) {
        continue;
      }

      try {
        const candidate =
          await response.json();

        if (
          candidate?.moduleKey ===
          moduleKey
        ) {
          deleted =
            (
              await cache.delete(
                request,
              )
            ) || deleted;
        }
      } catch {
        // Ignore malformed aliases.
      }
    }

    /*
     * A deleted persistent source may back any resolved alias in memory.
     */
    this.cache.modules.clear();

    return deleted;
  }

  /**
   * Clear only in-memory caches for the current runtime.
   */
  clearMemoryCache() {
    for (
      const map of
      Object.values(
        this.cache,
      )
    ) {
      map.clear();
    }
  }

  /**
   * Delete the persistent Cache Storage cache for the current scope.
   */
  async clearPersistentCache() {
    if (
      !this.persistentModuleCache
    ) {
      return false;
    }

    const {
      storage,
      cacheName,
    } =
      this.persistentModuleCache;

    this.persistentModuleCache
      .promise =
      null;

    return storage.delete(
      cacheName,
    );
  }

  /**
   * Clear memory and, by default, persistent state.
   */
  async clearCache({
    persistent = true,
  } = {}) {
    this.clearMemoryCache();

    return persistent
      ? this.clearPersistentCache()
      : true;
  }

  async dispose() {
    for (
      const pending of
      this.monacoLoaders
        .values()
    ) {
      try {
        const result =
          await pending;

        result?.loader
          ?.dispose?.();

        result?.model
          ?.dispose?.();
      } catch {
        /*
         * A failed loader has no reliable
         * resources to dispose.
         */
      }
    }

    for (
      const model of
      new Set(
        this.monacoModels
          .values(),
      )
    ) {
      if (
        model !==
        this.libs.editor
          ?.getModel?.()
      ) {
        model.dispose?.();
      }
    }

    this.monacoLoaders
      .clear();

    this.monacoModels
      .clear();
  }

  async #importResolvedModule(
    resolved,
  ) {
    if (
      !this.persistentModuleCache ||
      !/^https?:/.test(
        resolved.runtimeURL,
      ) ||
      !this.libs.fetch
    ) {
      return this.libs.importModule(
        resolved.runtimeURL,
      );
    }

    const requestedKey =
      this.#requestedModuleCacheKey(
        resolved,
      );

    let cachedRecord;

    try {
      cachedRecord =
        await this.#getFreshPersistentModule(
          requestedKey,
        );
    } catch (error) {
      this.onError?.(
        error,
      );
    }

    if (cachedRecord) {
      try {
        return await this.#importCachedModuleSource(
          cachedRecord,
        );
      } catch (error) {
        this.onError?.(
          error,
        );

        await this.deleteCachedModule(
          cachedRecord.key,
        ).catch(
          () => {},
        );
      }
    }

    try {
      const freshRecord =
        await this.#fetchAndPersistModule(
          resolved,
          requestedKey,
        );

      return await this.#importCachedModuleSource(
        freshRecord,
      );
    } catch (error) {
      this.onError?.(
        error,
      );

      return this.libs.importModule(
        resolved.runtimeURL,
      );
    }
  }

  async #openPersistentModuleCache() {
    if (
      !this.persistentModuleCache
    ) {
      return null;
    }

    const config =
      this.persistentModuleCache;

    config.promise ??=
      config.storage.open(
        config.cacheName,
      );

    return config.promise;
  }

  #persistentRecordURL(
    kind,
    key,
  ) {
    const scope =
      this.persistentModuleCache
        ?.scope ??
      'default';

    return new this.libs.URL(
      `${
            encodeURIComponent(
                scope,
            );
        }/${;
        kind;
    }/${;
encodeURIComponent(
    key,
)
      }`,
      'https://auto-typings.invalid/',
    ).href;
  }

  async #readPersistentRecord(
    cache,
    kind,
    key,
  ) {
    const response =
      await cache.match(
        this.#persistentRecordURL(
          kind,
          key,
        ),
      );

    if (!response) {
      return undefined;
    }

    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  async #writePersistentRecord(
    cache,
    kind,
    key,
    value,
  ) {
    const ResponseImpl =
      this.persistentModuleCache
        .Response;

    const response =
      new ResponseImpl(
        JSON.stringify(
          value,
        ),
        {
          headers: {
            'content-type':
              'application/json; charset=utf-8',
          },
        },
      );

    await cache.put(
      this.#persistentRecordURL(
        kind,
        key,
      ),
      response,
    );
  }

  #isPersistentRecordFresh(
    record,
  ) {
    return (
      record &&
      Number.isFinite(
        record.expiresAt,
      ) &&
      record.expiresAt >
      Date.now()
    );
  }

  async #getFreshPersistentModule(
    requestedKey,
  ) {
    const cache =
      await this.#openPersistentModuleCache();

    if (!cache) {
      return undefined;
    }

    const alias =
      await this.#readPersistentRecord(
        cache,
        'aliases',
        requestedKey,
      );

    if (
      alias &&
      !this.#isPersistentRecordFresh(
        alias,
      )
    ) {
      await cache.delete(
        this.#persistentRecordURL(
          'aliases',
          requestedKey,
        ),
      );
    }

    const moduleKey =
      (
        alias &&
        this.#isPersistentRecordFresh(
          alias,
        )
      )
        ? alias.moduleKey
        : requestedKey;

    const record =
      await this.#readPersistentRecord(
        cache,
        'modules',
        moduleKey,
      );

    if (!record) {
      return undefined;
    }

    if (
      !this.#isPersistentRecordFresh(
        record,
      )
    ) {
      await cache.delete(
        this.#persistentRecordURL(
          'modules',
          moduleKey,
        ),
      );

      if (alias) {
        await cache.delete(
          this.#persistentRecordURL(
            'aliases',
            requestedKey,
          ),
        );
      }

      return undefined;
    }

    return record;
  }

  async #fetchAndPersistModule(
    resolved,
    requestedKey,
  ) {
    const cache =
      await this.#openPersistentModuleCache();

    if (!cache) {
      throw new Error(
        'Persistent module cache is unavailable',
      );
    }

    const sourceRequestURL =
      this.#cacheableModuleSourceURL(
        resolved,
      );

    const response =
      await this.libs.fetch(
        sourceRequestURL,
        {
          method:
            'GET',
        },
      );

    if (!response?.ok) {
      throw new Error(
        `Failed to fetch cacheable module $ { sourceRequestURL; }: ${
    response?.status ??
        'unknown';
} ${
    response?.statusText ??
        '';
} `.trim(),
      );
    }

    const source =
      await response.text();

    const sourceURL =
      response.url ||
      sourceRequestURL;

    const exactVersion =
      this.#inferExactModuleVersion(
        resolved,
        response,
        source,
      );

    const moduleKey =
      this.#exactModuleCacheKey(
        resolved,
        exactVersion,
      );

    const cachedAt =
      Date.now();

    const expiresAt =
      cachedAt +
      this.cacheCycleMilliseconds;

    const record = {
      type:
        'module',

      key:
        moduleKey,

      requestedKey,

      packageName:
        resolved.packageRef
          ?.name,

      version:
        exactVersion,

      subpath:
        resolved.packageRef
          ?.subpath ??
        '',

      runtimeURL:
        resolved.runtimeURL,

      sourceURL,
      source,
      cachedAt,
      expiresAt,

      cacheCycleLength: {
        ...this.cacheCycleLength,
      },
    };

    const aliases =
      new Set([
        requestedKey,
        moduleKey,
        resolved.original,
        resolved.runtimeURL,
      ]);

    await this.#writePersistentRecord(
      cache,
      'modules',
      moduleKey,
      record,
    );

    await Promise.all(
      Array.from(
        aliases,
      )
        .filter(Boolean)
        .map(
          aliasKey =>
            this.#writePersistentRecord(
              cache,
              'aliases',
              String(
                aliasKey,
              ),
              {
                type:
                  'alias',

                key:
                  String(
                    aliasKey,
                  ),

                moduleKey,
                cachedAt,
                expiresAt,
              },
            ),
        ),
    );

    return record;
  }

  #requestedModuleCacheKey(
    resolved,
  ) {
    if (
      !resolved.packageRef
    ) {
      return resolved.runtimeURL;
    }

    const {
      name,
      version,
      subpath,
    } =
      resolved.packageRef;

    return `${
    name;
}${
    version
        ? `@${version}`
        : '';
}${
    subpath
        ? `/${subpath}`
        : '';
}${
    this.#meaningfulRuntimeQuery(
        resolved.runtimeURL,
    );
} `;
  }

  #exactModuleCacheKey(
    resolved,
    exactVersion,
  ) {
    if (
      !resolved.packageRef
    ) {
      return resolved.runtimeURL;
    }

    const {
      name,
      version,
      subpath,
    } =
      resolved.packageRef;

    return `${
    name;
} @${
    exactVersion ??
        version ??
        'latest';
}${
    subpath
        ? `/${subpath}`
        : '';
}${
    this.#meaningfulRuntimeQuery(
        resolved.runtimeURL,
    );
} `;
  }

  #meaningfulRuntimeQuery(
    runtimeURL,
  ) {
    const url =
      new this.libs.URL(
        runtimeURL,
      );

    const ignored =
      new Set([
        'standalone',
      ]);

    const entries =
      Array.from(
        url.searchParams,
      )
        .filter(
          ([key]) =>
            !ignored.has(
              key,
            ),
        )
        .sort(
          (
            [left],
            [right],
          ) =>
            left.localeCompare(
              right,
            ),
        );

    if (
      !entries.length
    ) {
      return '';
    }

    const params =
      new URLSearchParams();

    for (
      const [
        key,
        value,
      ] of entries
    ) {
      params.append(
        key,
        value,
      );
    }

    return `? ${ params; } `;
  }

  #cacheableModuleSourceURL(
    resolved,
  ) {
    const url =
      new this.libs.URL(
        resolved.runtimeURL,
      );

    if (
      url.hostname ===
      'esm.sh' ||
      url.hostname.endsWith(
        '.esm.sh',
      )
    ) {
      if (
        !url.searchParams.has(
          'standalone',
        )
      ) {
        url.searchParams.set(
          'standalone',
          '',
        );
      }
    }

    return url.href;
  }

  #inferExactModuleVersion(
    resolved,
    response,
    source,
  ) {
    const packageRef =
      resolved.packageRef;

    if (!packageRef) {
      return undefined;
    }

    if (
      isExactVersion(
        packageRef.version,
      )
    ) {
      return packageRef.version;
    }

    const candidates = [
      response.url,

      resolved.runtimeURL,

      getHeader(
        response.headers,
        'x-esm-path',
      ),

      getHeader(
        response.headers,
        'x-typescript-types',
      ),

      source.slice(
        0,
        8192,
      ),
    ]
      .filter(Boolean)
      .join('\n');

    const escapedName =
      escapeRegExp(
        packageRef.name,
      );

    const match =
      candidates.match(
        new RegExp(
          `${
    escapedName;
} @(${
    SEMVER_SOURCE;
})`,
          'i',
        ),
      );

    return (
      match?.[1] ??
      packageRef.version
    );
  }

  async #importCachedModuleSource(
    record,
  ) {
    const rewrittenSource =
      rewriteModuleSpecifiers(
        record.source,
        record.sourceURL,
        this.cdnBaseURL.href,
        this.libs.URL,
      );

    const annotatedSource =
      `${
    rewrittenSource;
} \n;//# sourceURL=${
record.sourceURL
      }\n`;

    const BlobImpl =
      this.persistentModuleCache
        ?.Blob;

    const URLImpl =
      this.libs.URL;

    let blobError;

    if (
      BlobImpl &&
      typeof URLImpl.createObjectURL ===
      'function'
    ) {
      const blob =
        new BlobImpl(
          [
            annotatedSource,
          ],
          {
            type:
              'text/javascript',
          },
        );

      const blobURL =
        URLImpl.createObjectURL(
          blob,
        );

      try {
        return await this.libs.importModule(
          blobURL,
        );
      } catch (error) {
        blobError =
          error;
      } finally {
        URLImpl.revokeObjectURL?.(
          blobURL,
        );
      }
    }

    const dataURL =
      `data: text / javascript; charset = utf - 8, ${
    encodeURIComponent(
        annotatedSource,
    );
} `;

    try {
      return await this.libs.importModule(
        dataURL,
      );
    } catch (dataError) {
      if (blobError) {
        dataError.cause ??=
          blobError;
      }

      throw dataError;
    }
  }

  #normalizeBaseURL(
    value,
  ) {
    const URLImpl =
      this.libs.URL;

    if (value) {
      if (
        this.#isOSAbsolutePath(
          String(value),
        )
      ) {
        return this.#fileURLFromPath(
          String(value),
        );
      }

      return new URLImpl(
        String(value),
      );
    }

    if (
      this.mode ===
      'nodenext'
    ) {
      const cwd =
        this.libs.cwd?.();

      if (!cwd) {
        throw new TypeError(
          'nodenext mode requires projectBaseURL or libs.cwd',
        );
      }

      if (
        !this.libs
          .pathToFileURL
      ) {
        throw new TypeError(
          'nodenext mode requires libs.pathToFileURL when projectBaseURL is omitted',
        );
      }

      const source =
        String(cwd);

      const separator =
        source.includes('\\')
          ? '\\'
          : '/';

      const directory =
        /[\\/]$/.test(
          source,
        )
          ? source
          : `${ source; }${ separator; } `;

      return this.#fileURLFromPath(
        directory,
      );
    }

    const ambient =
      globalThis.document
        ?.baseURI ??
      globalThis.location
        ?.href ??
      'file:///';

    return new URLImpl(
      ambient,
    );
  }

  #asDirectoryURL(
    value,
  ) {
    const url =
      value instanceof
      this.libs.URL
        ? new this.libs.URL(
          value.href,
        )
        : new this.libs.URL(
          String(value),
          this.projectBaseURL,
        );

    if (
      !url.pathname.endsWith(
        '/',
      )
    ) {
      url.pathname =
        url.pathname.replace(
          /[^/]*$/,
          '',
        );

      url.search =
        '';

      url.hash =
        '';
    }

    return url;
  }

  async #resolveUncached(
    specifier,
    parent,
  ) {
    const URLImpl =
      this.libs.URL;

    const parentURL =
      this.#parentURL(
        parent,
      );

    if (
      specifier.startsWith(
        'cdn:',
      )
    ) {
      const raw =
        specifier.slice(4);

      const packageRef =
        this.parsePackageReference(
          raw,
        );

      return this.#resolution({
        original:
          specifier,

        kind:
          'cdn',

        runtimeURL:
          new URLImpl(
            raw,
            this.cdnBaseURL,
          ).href,

        packageRef,

        parentURL:
          parentURL.href,
      });
    }

    if (
      specifier.startsWith(
        'npm:',
      )
    ) {
      return this.#resolveNpm(
        specifier,
        specifier.slice(4),
        parentURL,
      );
    }

    if (
      this.#isOSAbsolutePath(
        specifier,
      )
    ) {
      const fileURL =
        this.#fileURLFromPath(
          specifier,
        );

      return this.#resolution({
        original:
          specifier,

        kind:
          'local-file',

        runtimeURL:
          fileURL.href,

        packageRef:
          null,

        parentURL:
          parentURL.href,
      });
    }

    if (
      /^[A-Za-z][A-Za-z\d+.-]*:/
        .test(
          specifier,
        )
    ) {
      const url =
        new URLImpl(
          specifier,
        );

      return this.#resolution({
        original:
          specifier,

        kind:
          this.#isLocalURL(
            url,
          )
            ? 'local-url'
            : 'url',

        runtimeURL:
          url.href,

        packageRef:
          this.#inferPackageFromURL(
            url,
          ),

        parentURL:
          parentURL.href,
      });
    }

    if (
      specifier.startsWith(
        '.',
      ) ||
      specifier.startsWith(
        '/',
      )
    ) {
      const url =
        new URLImpl(
          specifier,
          parentURL,
        );

      return this.#resolution({
        original:
          specifier,

        kind:
          this.#isLocalURL(
            url,
          )
            ? 'local-url'
            : 'url',

        runtimeURL:
          url.href,

        packageRef:
          null,

        parentURL:
          parentURL.href,
      });
    }

    return this.#resolveNpm(
      specifier,
      specifier,
      parentURL,
    );
  }

  async #resolveNpm(
    original,
    raw,
    parentURL,
  ) {
    const packageRef =
      this.parsePackageReference(
        raw,
      );

    const local =
      this.mode ===
      'standaloneScript'
        ? null
        : await this.#resolveLocalPackageRuntime(
          packageRef,
          parentURL,
        );

    if (local) {
      return this.#resolution({
        original,

        kind:
          'npm-local',

        runtimeURL:
          local.runtimeURL,

        packageRef,

        installedVersion:
          local.packageJson
            ?.version,

        localPackageRoot:
          local.packageRoot
            ?.href,

        localPackageJson:
          local.packageJson,

        parentURL:
          parentURL.href,
      });
    }

    if (
      !this.allowCdnFallback
    ) {
      const error =
        new Error(
          `Cannot find package ${
    JSON.stringify(
        packageRef.name,
    );
} from ${
    parentURL.href;
} `,
        );

      error.code =
        'ERR_MODULE_NOT_FOUND';

      error.packageName =
        packageRef.name;

      throw error;
    }

    return this.#resolution({
      original,

      kind:
        'npm-cdn',

      runtimeURL:
        new this.libs.URL(
          raw,
          this.cdnBaseURL,
        ).href,

      packageRef,

      parentURL:
        parentURL.href,
    });
  }

  #resolution(
    data,
  ) {
    const packageKey =
      data.packageRef
        ? `${
    data.packageRef.name;
} @${
    data.packageRef
        .version ??
        data.installedVersion ??
        '*';
}${
    data.packageRef
        .subpath
        ? `/${data.packageRef
            .subpath
        }`
        : '';
} `
        : data.runtimeURL;

    return Object.freeze({
      ...data,

      typeCacheKey: [
        this.mode,
        data.runtimeURL,
        data.localPackageRoot ??
        '',
        this.packageFilesBaseURL
          .href,
        packageKey,
      ].join('|'),
    });
  }

  async #resolveLocalPackageRuntime(
    ref,
    parentURL,
  ) {
    if (
      !this.nodeModulesBaseURL
    ) {
      return null;
    }

    const roots =
      this.mode ===
      'nodenext'
        ? this.#nodeModulesSearchRoots(
          parentURL,
        )
        : [
          this.nodeModulesBaseURL,
        ];

    for (
      const nodeModulesRoot of
      roots
    ) {
      const packageRoot =
        new this.libs.URL(
          `${ ref.name; }/`,;
nodeModulesRoot,
        );

const packageJsonURL =
    new this.libs.URL(
        'package.json',
        packageRoot,
    );

const packageJson =
    await this.json(
        packageJsonURL,
        {
            optional:
                true,
        },
    ).catch(
        () => undefined,
    );

if (!packageJson) {
    continue;
}

const conditions =
    this.mode ===
        'nodenext'
        ? [
            'node',
            'import',
            'default',
            'require',
        ]
        : [
            'browser',
            'import',
            'module',
            'default',
            'require',
        ];

const exported =
    resolvePackageExport(
        packageJson.exports,
        ref.subpath,
        conditions,
    );

if (
    packageJson.exports !=
    null &&
    exported ===
    undefined
) {
    const error =
        new Error(
            `Package subpath ${JSON.stringify(
                ref.subpath
                    ? `./${ref.subpath}`
                    : '.',
            )
            } is not defined by "exports" in ${packageJsonURL.href
            }`,
        );

    error.code =
        'ERR_PACKAGE_PATH_NOT_EXPORTED';

    throw error;
}

const entry =
    exported ??
    (
        ref.subpath ||
        undefined
    ) ??
    (
        this.mode !==
            'nodenext' &&
            typeof packageJson
                .browser ===
            'string'
            ? packageJson
                .browser
            : undefined
    ) ??
    packageJson.module ??
    packageJson.main ??
    'index.js';

return {
    runtimeURL:
        new this.libs.URL(
            String(entry)
                .replace(
                    /^\.\//,
                    '',
                ),
            packageRoot,
        ).href,

    packageRoot,
    packageJson,
};
    }

return null;
  }

#nodeModulesSearchRoots(
    parentURL,
) {
    const results = [];
    const seen = new Set();

    const add =
        url => {
            if (
                !seen.has(
                    url.href,
                )
            ) {
                seen.add(
                    url.href,
                );

                results.push(
                    url,
                );
            }
        };

    if (
        this.nodeModulesBaseURL
    ) {
        add(
            new this.libs.URL(
                this.nodeModulesBaseURL
                    .href,
            ),
        );
    }

    let directory =
        this.#asDirectoryURL(
            parentURL,
        );

    while (true) {
        add(
            new this.libs.URL(
                'node_modules/',
                directory,
            ),
        );

        const parent =
            new this.libs.URL(
                '../',
                directory,
            );

        if (
            parent.href ===
            directory.href
        ) {
            break;
        }

        directory =
            parent;
    }

    return results;
}

  async #loadTypesUncached(
    resolved,
) {
    const files =
        new Map();

    const packages =
        new Map();

    const seenEntries =
        new Set();

    let entry;
    let source;

    const headerEntry =
        /^https?:/.test(
            resolved.runtimeURL,
        )
            ? await this.#typescriptTypesHeader(
                resolved.runtimeURL,
            )
            : undefined;

    if (headerEntry) {
        entry =
            headerEntry;

        source =
            'x-typescript-types';

        await this.#collectDeclarationGraph(
            entry,
            files,
            packages,
            seenEntries,
            0,
        );
    } else if (
        resolved.packageRef
    ) {
        const result =
            await this.#collectPackageTypes(
                resolved.packageRef,
                files,
                packages,
                seenEntries,
                0,
                resolved,
            );

        entry =
            result?.entry;

        source =
            result?.source;
    } else {
        const localEntry =
            await this.#findLocalTypeEntry(
                resolved.runtimeURL,
            );

        if (localEntry) {
            entry =
                localEntry;

            source =
                'local';

            await this.#collectDeclarationGraph(
                entry,
                files,
                packages,
                seenEntries,
                0,
            );
        }
    }

    return {
        entry,

        source:
            source ??
            'none',

        files,
        packages,

        found:
            Boolean(
                entry,
            ),

        getFile:
            url =>
                files.get(
                    this.#toURL(
                        url,
                    ).href,
                ),

        toObject:
            () =>
                Object.fromEntries(
                    files,
                ),
    };
}

  async #collectPackageTypes(
    ref,
    files,
    packages,
    seenEntries,
    depth,
    resolutionHint = {},
) {
    if (
        depth >
        this.maxTypeDepth
    ) {
        return null;
    }

    const parentKey =
        resolutionHint
            .localPackageRoot ??
        resolutionHint
            .parentURL ??
        resolutionHint
            .runtimeURL ??
        '';

    const key =
        `${ref.name
        }@${ref.version ??
        '*'
        }${ref.subpath
            ? `/${ref.subpath}`
            : ''
        }|from:${parentKey
        }`;

    if (
        packages.has(
            key,
        )
    ) {
        return await packages.get(
            key,
        );
    }

    const entryPromise =
        this.#resolvePackageTypeEntry(
            ref,
            resolutionHint,
        );

    packages.set(
        key,
        entryPromise,
    );

    const info =
        await entryPromise;

    /*
     * Replace the pending entry-resolution promise before walking the
     * declaration graph. Self-references can now reuse the resolved value
     * rather than awaiting their own unfinished traversal.
     */
    packages.set(
        key,
        info,
    );

    if (!info?.entry) {
        return null;
    }

    await this.#collectDeclarationGraph(
        info.entry,
        files,
        packages,
        seenEntries,
        depth,
    );

    return info;
}

  async #resolvePackageTypeEntry(
    ref,
    resolutionHint = {},
) {
    const roots = [];

    if (
        resolutionHint
            .localPackageRoot &&
        resolutionHint
            .localPackageJson
    ) {
        roots.push({
            root:
                new this.libs.URL(
                    resolutionHint
                        .localPackageRoot,
                ),

            pkg:
                resolutionHint
                    .localPackageJson,

            source:
                'local-package',
        });
    } else if (
        this.nodeModulesBaseURL &&
        this.mode !==
        'standaloneScript'
    ) {
        const from =
            resolutionHint
                .parentURL ??
            resolutionHint
                .runtimeURL ??
            this.projectBaseURL
                .href;

        for (
            const nodeModulesRoot of
            this.#nodeModulesSearchRoots(
                from,
            )
        ) {
            const localRoot =
                new this.libs.URL(
                    `${ref.name}/`,
                    nodeModulesRoot,
                );

            const localPkg =
                await this.json(
                    new this.libs.URL(
                        'package.json',
                        localRoot,
                    ),
                    {
                        optional:
                            true,
                    },
                ).catch(
                    () => undefined,
                );

            if (localPkg) {
                roots.push({
                    root:
                        localRoot,

                    pkg:
                        localPkg,

                    source:
                        'local-package',
                });

                break;
            }
        }
    }

    if (
        this.allowCdnFallback
    ) {
        const remoteRoot =
            new this.libs.URL(
                `${ref.name
                }${ref.version
                    ? `@${ref.version}`
                    : ''
                }/`,
                this.packageFilesBaseURL,
            );

        const remotePkg =
            await this.json(
                new this.libs.URL(
                    'package.json',
                    remoteRoot,
                ),
                {
                    optional:
                        true,
                },
            ).catch(
                () => undefined,
            );

        if (remotePkg) {
            roots.push({
                root:
                    remoteRoot,

                pkg:
                    remotePkg,

                source:
                    'package-cdn',
            });
        }
    }

    const direct =
        await this.#firstPackageTypeCandidate(
            ref,
            roots,
        );

    if (direct) {
        return direct;
    }

    const typesName =
        definitelyTypedName(
            ref.name,
        );

    if (
        typesName ===
        ref.name
    ) {
        return null;
    }

    const typesRef = {
        name:
            typesName,

        version:
            undefined,

        subpath:
            ref.subpath,
    };

    const typesRoots = [];

    if (
        this.nodeModulesBaseURL &&
        this.mode !==
        'standaloneScript'
    ) {
        const from =
            resolutionHint
                .parentURL ??
            resolutionHint
                .runtimeURL ??
            this.projectBaseURL
                .href;

        for (
            const nodeModulesRoot of
            this.#nodeModulesSearchRoots(
                from,
            )
        ) {
            const localRoot =
                new this.libs.URL(
                    `${typesName}/`,
                    nodeModulesRoot,
                );

            const localPkg =
                await this.json(
                    new this.libs.URL(
                        'package.json',
                        localRoot,
                    ),
                    {
                        optional:
                            true,
                    },
                ).catch(
                    () => undefined,
                );

            if (localPkg) {
                typesRoots.push({
                    root:
                        localRoot,

                    pkg:
                        localPkg,

                    source:
                        'local-definitely-typed',
                });

                break;
            }
        }
    }

    if (
        this.allowCdnFallback
    ) {
        const remoteRoot =
            new this.libs.URL(
                `${typesName}/`,
                this.packageFilesBaseURL,
            );

        const remotePkg =
            await this.json(
                new this.libs.URL(
                    'package.json',
                    remoteRoot,
                ),
                {
                    optional:
                        true,
                },
            ).catch(
                () => undefined,
            );

        if (remotePkg) {
            typesRoots.push({
                root:
                    remoteRoot,

                pkg:
                    remotePkg,

                source:
                    'definitely-typed',
            });
        }
    }

    return this.#firstPackageTypeCandidate(
        typesRef,
        typesRoots,
    );
}

  async #firstPackageTypeCandidate(
    ref,
    roots,
) {
    for (
        const candidate of
        roots
    ) {
        const typePath =
            chooseTypeEntry(
                candidate.pkg,
                ref.subpath,
            );

        if (!typePath) {
            continue;
        }

        const entry =
            await this.#firstReadableDeclaration(
                declarationCandidates(
                    new this.libs.URL(
                        typePath.replace(
                            /^\.\//,
                            '',
                        ),
                        candidate.root,
                    ),
                ),
            );

        if (entry) {
            return {
                entry,

                source:
                    candidate.source,

                packageName:
                    ref.name,

                version:
                    candidate.pkg
                        .version ??
                    ref.version,
            };
        }
    }

    return null;
}

  async #collectDeclarationGraph(
    entryURL,
    files,
    packages,
    seenEntries,
    depth,
) {
    if (
        depth >
        this.maxTypeDepth
    ) {
        return;
    }

    const href =
        this.#toURL(
            entryURL,
        ).href;

    if (
        seenEntries.has(
            href,
        )
    ) {
        return;
    }

    if (
        seenEntries.size >=
        this.maxTypeFiles
    ) {
        const error =
            new RangeError(
                `Type graph exceeded the maximum of ${this.maxTypeFiles
                } files while loading ${href
                }`,
            );

        error.code =
            'ERR_TYPE_GRAPH_LIMIT';

        throw error;
    }

    /*
     * Mark before awaiting the fetch so cyclic declarations cannot schedule
     * the same file while its request is pending.
     */
    seenEntries.add(
        href,
    );

    const declarationSource =
        await this.text(
            href,
            {
                optional:
                    true,
            },
        );

    if (
        declarationSource ===
        undefined
    ) {
        return;
    }

    files.set(
        href,
        declarationSource,
    );

    const jobs =
        parseDeclarationDependencies(
            declarationSource,
        ).map(
            dependency =>
                async () => {
                    try {
                        if (
                            dependency.kind ===
                            'path'
                        ) {
                            const child =
                                await this.#firstReadableDeclaration(
                                    declarationCandidates(
                                        new this.libs.URL(
                                            dependency.value,
                                            href,
                                        ),
                                    ),
                                );

                            if (child) {
                                await this.#collectDeclarationGraph(
                                    child,
                                    files,
                                    packages,
                                    seenEntries,
                                    depth + 1,
                                );
                            }

                            return;
                        }

                        const ref =
                            dependency.kind ===
                                'types'
                                ? {
                                    name:
                                        definitelyTypedName(
                                            dependency.value,
                                        ),

                                    version:
                                        undefined,

                                    subpath:
                                        '',
                                }
                                : this.parsePackageReference(
                                    dependency.value,
                                );

                        await this.#collectPackageTypes(
                            ref,
                            files,
                            packages,
                            seenEntries,
                            depth + 1,
                            {
                                parentURL:
                                    href,
                            },
                        );
                    } catch (error) {
                        if (
                            error?.code ===
                            'ERR_TYPE_GRAPH_LIMIT'
                        ) {
                            throw error;
                        }

                        this.onError?.(
                            error,
                        );
                    }
                },
        );

    await runWithConcurrency(
        jobs,
        this.typeConcurrency,
    );
}

  async #typescriptTypesHeader(
    runtimeURL,
) {
    if (!this.libs.fetch) {
        return undefined;
    }

    try {
        const response =
            await this.libs.fetch(
                String(
                    runtimeURL,
                ),
                {
                    method:
                        'GET',
                },
            );

        if (!response?.ok) {
            return undefined;
        }

        const value =
            getHeader(
                response.headers,
                'x-typescript-types',
            );

        return value
            ? new this.libs.URL(
                value,
                response.url ||
                runtimeURL,
            ).href
            : undefined;
    } catch {
        return undefined;
    }
}

  async #findLocalTypeEntry(
    runtimeURL,
) {
    return this.#firstReadableDeclaration(
        declarationCandidates(
            this.#toURL(
                runtimeURL,
            ),
        ),
    );
}

  async #firstReadableDeclaration(
    candidates,
) {
    for (
        const candidate of
        candidates
    ) {
        const source =
            await this.text(
                candidate,
                {
                    optional:
                        true,
                },
            );

        if (
            source !==
            undefined
        ) {
            return this.#toURL(
                candidate,
            ).href;
        }
    }

    return undefined;
}

  async #registerMonaco(
    resolved,
    bundle,
) {
    const {
        monaco,
        MonacoAutoTypings,
        editor,
    } =
        this.libs;

    if (!bundle.found) {
        return;
    }

    if (
        resolved.packageRef
    ) {
        this.#setMonacoAlias(
            resolved.original,
            resolved.packageRef,
        );

        await this.#preloadMonacoPackage(
            resolved.packageRef,
        );

        return;
    }

    for (
        const [
            url,
            source,
        ] of bundle.files
    ) {
        const uri =
            monaco.Uri.parse(
                url,
            );

        if (
            !monaco.editor
                .getModel(
                    uri,
                )
        ) {
            const model =
                monaco.editor
                    .createModel(
                        source,
                        'typescript',
                        uri,
                    );

            this.monacoModels
                .set(
                    url,
                    model,
                );
        }
    }

    void MonacoAutoTypings;
    void editor;
}

#setMonacoAlias(
    specifier,
    ref,
) {
    const {
        monaco,
    } =
        this.libs;

    const target =
        `${ref.name
        }${ref.subpath
            ? `/${ref.subpath}`
            : ''
        }`;

    this.monacoAliases[
        specifier
    ] = [
            `node_modules/${target}`,
        ];

    for (
        const defaults of
        [
            monaco.languages
                .typescript
                .typescriptDefaults,

            monaco.languages
                .typescript
                .javascriptDefaults,
        ]
    ) {
        const current =
            defaults
                .getCompilerOptions();

        defaults
            .setCompilerOptions({
                ...current,

                moduleResolution:
                    monaco.languages
                        .typescript
                        .ModuleResolutionKind
                        .NodeJs,

                baseUrl:
                    current.baseUrl ??
                    this.monacoOptions
                        .fileRoot,

                paths: {
                    ...(
                        current.paths ??
                        {}
                    ),

                    ...this
                        .monacoAliases,
                },
            });
    }
}

  async #preloadMonacoPackage(
    ref,
) {
    const {
        monaco,
        MonacoAutoTypings,
    } =
        this.libs;

    const canonical =
        `${ref.name
        }${ref.subpath
            ? `/${ref.subpath}`
            : ''
        }`;

    const key =
        `${ref.name
        }@${ref.version ??
        '*'
        }:${ref.subpath
        }`;

    if (
        this.monacoLoaders
            .has(key)
    ) {
        return this.monacoLoaders
            .get(key);
    }

    const uri =
        monaco.Uri.parse(
            `${this.monacoOptions
                .fileRoot
            }__auto_typings__/${encodeURIComponent(
                key,
            )
            }.ts`,
        );

    const model =
        monaco.editor
            .createModel(
                `import ${JSON.stringify(
                    canonical,
                )
                };`,
                'typescript',
                uri,
            );

    const adapter = {
        getModel:
            () => model,

        onDidChangeModelContent:
            listener =>
                model.onDidChangeContent(
                    listener,
                ),

        getPosition:
            () => null,

        setPosition:
            () => { },
    };

    const sourceResolver =
        this.monacoOptions
            .sourceResolver ??
        createMonacoSourceResolver({
            fetch:
                this.libs.fetch,

            URL:
                this.libs.URL,

            nodeModulesBaseURL:
                this.nodeModulesBaseURL,

            packageFilesBaseURL:
                this.packageFilesBaseURL,

            readTextFile:
                this.libs
                    .readTextFile,
        });

    const promise =
        MonacoAutoTypings
            .create(
                adapter,
                {
                    monaco,

                    fileRootPath:
                        this.monacoOptions
                            .fileRoot,

                    debounceDuration:
                        0,

                    sourceResolver,

                    ...(
                        this.monacoOptions
                            .sourceCache
                            ? {
                                sourceCache:
                                    this.monacoOptions
                                        .sourceCache,
                            }
                            : {}
                    ),

                    ...(
                        ref.version
                            ? {
                                versions: {
                                    [ref.name]:
                                        ref.version,
                                },
                            }
                            : {}
                    ),

                    onError:
                        error =>
                            this.onError?.(
                                error,
                            ),
                },
            )
            .then(
                loader => ({
                    loader,
                    model,
                }),
            );

    this.monacoLoaders
        .set(
            key,
            promise,
        );

    promise.catch(() => {
        this.monacoLoaders
            .delete(key);

        model.dispose?.();
    });

    return promise;
}

#parentURL(
    parent,
) {
    if (
        parent instanceof
        this.libs.URL
    ) {
        return parent;
    }

    const value =
        String(parent);

    if (
        this.#isOSAbsolutePath(
            value,
        )
    ) {
        return this.#fileURLFromPath(
            value,
        );
    }

    return new this.libs.URL(
        value,
        this.projectBaseURL,
    );
}

#toURL(
    value,
) {
    if (
        value instanceof
        this.libs.URL
    ) {
        return value;
    }

    const string =
        String(value);

    if (
        this.#isOSAbsolutePath(
            string,
        )
    ) {
        return this.#fileURLFromPath(
            string,
        );
    }

    return new this.libs.URL(
        string,
        this.projectBaseURL,
    );
}

#isLocalURL(
    url,
) {
    return (
        url.protocol ===
        'file:' ||
        (
            this.projectBaseURL
                .protocol !==
            'file:' &&
            url.origin ===
            this.projectBaseURL
                .origin
        )
    );
}

#isOSAbsolutePath(
    value,
) {
    return (
        /^[A-Za-z]:[\\/]/
            .test(value) ||
        /^\\\\[^\\]+\\[^\\]+/
            .test(value)
    );
}

#fileURLFromPath(
    path,
) {
    if (
        !this.libs
            .pathToFileURL
    ) {
        throw new TypeError(
            `Cannot resolve filesystem path without libs.pathToFileURL: ${path}`,
        );
    }

    const value =
        this.libs.pathToFileURL(
            path,
        );

    return value instanceof
        this.libs.URL
        ? value
        : new this.libs.URL(
            String(value),
        );
}

  async #readURLText(
    href,
    optional,
) {
    const url =
        new this.libs.URL(
            href,
        );

    if (
        url.protocol ===
        'file:'
    ) {
        if (
            !this.libs
                .readTextFile
        ) {
            if (optional) {
                return undefined;
            }

            throw new TypeError(
                `libs.readTextFile is required to read ${href}`,
            );
        }

        try {
            return await this.libs
                .readTextFile(
                    url,
                );
        } catch (error) {
            if (optional) {
                return undefined;
            }

            throw error;
        }
    }

    if (!this.libs.fetch) {
        if (optional) {
            return undefined;
        }

        throw new TypeError(
            `libs.fetch is required to read ${href}`,
        );
    }

    try {
        const response =
            await this.libs.fetch(
                href,
                {
                    method:
                        'GET',
                },
            );

        if (response?.ok) {
            return await response.text();
        }

        if (
            optional ||
            response?.status ===
            404
        ) {
            return undefined;
        }

        throw new Error(
            `Failed to fetch ${href
                }: ${response?.status ??
                'unknown'
                } ${response?.statusText ??
                ''
                }`.trim(),
        );
    } catch (error) {
        if (optional) {
            return undefined;
        }

        throw error;
    }
}

#inferPackageFromURL(
    url,
) {
    const host =
        url.hostname
            .toLowerCase();

    let parts =
        url.pathname
            .split('/')
            .filter(Boolean);

    if (
        host ===
        'cdn.jsdelivr.net' &&
        parts[0] ===
        'npm'
    ) {
        parts =
            parts.slice(1);
    } else if (
        host ===
        'esm.sh' ||
        host.endsWith(
            '.esm.sh',
        )
    ) {
        if (
            /^v\d+$/.test(
                parts[0] ||
                '',
            )
        ) {
            parts =
                parts.slice(1);
        }
    } else if (
        host !==
        'unpkg.com'
    ) {
        return null;
    }

    if (!parts.length) {
        return null;
    }

    const scoped =
        parts[0]
            .startsWith('@');

    const head =
        scoped
            ? `${parts[0]
            }/${parts[1] ||
            ''
            }`
            : parts[0];

    const consumed =
        scoped
            ? 2
            : 1;

    const parsed =
        this.parsePackageReference(
            head,
        );

    parsed.subpath =
        parts
            .slice(consumed)
            .join('/');

    return parsed;
}
}

/**
 * Internal SourceResolver adapter compatible with
 * monaco-editor-auto-typings.
 */
function createMonacoSourceResolver({
    fetch =
    globalThis.fetch?.bind(
        globalThis,
    ),

    URL: URLImpl =
    globalThis.URL,

    readTextFile,

    nodeModulesBaseURL =
    null,

    packageFilesBaseURL =
    'https://cdn.jsdelivr.net/npm/',
} = {}) {
    if (!URLImpl) {
        throw new TypeError(
            'URL implementation is required',
        );
    }

    const remoteBase =
        new URLImpl(
            String(
                packageFilesBaseURL,
            ),
        );

    const localBase =
        nodeModulesBaseURL
            ? new URLImpl(
                String(
                    nodeModulesBaseURL,
                ),
                remoteBase,
            )
            : null;

    const read =
        async (
            url,
            optional = false,
        ) => {
            const target =
                url instanceof
                    URLImpl
                    ? url
                    : new URLImpl(
                        String(url),
                    );

            if (
                target.protocol ===
                'file:'
            ) {
                if (!readTextFile) {
                    if (optional) {
                        return undefined;
                    }

                    throw new TypeError(
                        `readTextFile is required for ${target.href}`,
                    );
                }

                try {
                    return await readTextFile(
                        target,
                    );
                } catch (error) {
                    if (optional) {
                        return undefined;
                    }

                    throw error;
                }
            }

            if (!fetch) {
                if (optional) {
                    return undefined;
                }

                throw new TypeError(
                    `fetch is required for ${target.href}`,
                );
            }

            try {
                const response =
                    await fetch(
                        target.href,
                        {
                            method:
                                'GET',
                        },
                    );

                if (response?.ok) {
                    return await response.text();
                }

                if (
                    optional ||
                    response?.status ===
                    404
                ) {
                    return undefined;
                }

                throw new Error(
                    `Failed to fetch ${target.href
                    }: ${response?.status ??
                    'unknown'
                    }`,
                );
            } catch (error) {
                if (optional) {
                    return undefined;
                }

                throw error;
            }
        };

    const packageFileURL =
        (
            base,
            name,
            version,
            filePath,
        ) =>
            new URLImpl(
                `${name
                }${version
                    ? `@${version}`
                    : ''
                }/${String(
                    filePath,
                ).replace(
                    /^\/+/,
                    '',
                )
                }`,
                base,
            );

    const resolve =
        async (
            name,
            version,
            filePath,
        ) => {
            if (localBase) {
                const local =
                    await read(
                        packageFileURL(
                            localBase,
                            name,
                            undefined,
                            filePath,
                        ),
                        true,
                    );

                if (
                    local !==
                    undefined
                ) {
                    return local;
                }
            }

            return read(
                packageFileURL(
                    remoteBase,
                    name,
                    version,
                    filePath,
                ),
                true,
            );
        };

    return {
        resolvePackageJson(
            name,
            version,
            subPath,
        ) {
            const prefix =
                subPath
                    ? `${String(
                        subPath,
                    ).replace(
                        /^\/+|\/+$/g,
                        '',
                    )
                    }/`
                    : '';

            return resolve(
                name,
                version,
                `${prefix}package.json`,
            );
        },

        resolveSourceFile(
            name,
            version,
            filePath,
        ) {
            return resolve(
                name,
                version,
                filePath,
            );
        },
    };
}

function createMemoryCache() {
    return {
        resolutions:
            new Map(),

        text:
            new Map(),

        json:
            new Map(),

        types:
            new Map(),

        modules:
            new Map(),
    };
}

function normalizeMemoryCache(
    cache,
) {
    const normalized =
        cache ??
        createMemoryCache();

    for (
        const key of
        [
            'resolutions',
            'text',
            'json',
            'types',
            'modules',
        ]
    ) {
        normalized[key] ??=
            new Map();
    }

    return normalized;
}

function toPositiveInteger(
    value,
    name,
) {
    const number =
        Number(value);

    if (
        !Number.isFinite(
            number,
        ) ||
        number < 1
    ) {
        throw new TypeError(
            `${name} must be a positive finite number`,
        );
    }

    return Math.floor(
        number,
    );
}

const SEMVER_SOURCE =
    String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`;

function detectCurrentBaseId() {
    try {
        if (
            typeof base !==
            'undefined' &&
            base?.id
        ) {
            return base.id;
        }
    } catch {
        /*
         * Ignore inaccessible host globals.
         */
    }

    return globalThis.base
        ?.id;
}

function normalizeCacheCycleLength(
    value,
) {
    const candidate =
        value ?? {
            value: 24,
            unit: 'hours',
        };

    const amount =
        Number(
            candidate.value,
        );

    const rawUnit =
        String(
            candidate.unit ??
            'hours',
        )
            .trim()
            .toLowerCase();

    if (
        !Number.isFinite(
            amount,
        ) ||
        amount <= 0
    ) {
        throw new TypeError(
            'cacheCycleLength.value must be a positive finite number',
        );
    }

    const aliases = {
        ms:
            'milliseconds',

        millisecond:
            'milliseconds',

        milliseconds:
            'milliseconds',

        second:
            'seconds',

        seconds:
            'seconds',

        minute:
            'minutes',

        minutes:
            'minutes',

        hour:
            'hours',

        hours:
            'hours',

        day:
            'days',

        days:
            'days',

        week:
            'weeks',

        weeks:
            'weeks',
    };

    const unit =
        aliases[
        rawUnit
        ];

    if (!unit) {
        throw new TypeError(
            `Unsupported cacheCycleLength unit: ${candidate.unit}`,
        );
    }

    return {
        value:
            amount,

        unit,
    };
}

function cacheCycleToMilliseconds({
    value,
    unit,
}) {
    const factors = {
        milliseconds:
            1,

        seconds:
            1_000,

        minutes:
            60_000,

        hours:
            3_600_000,

        days:
            86_400_000,

        weeks:
            604_800_000,
    };

    return (
        value *
        factors[unit]
    );
}

function isExactVersion(
    value,
) {
    return (
        Boolean(value) &&
        new RegExp(
            `^${SEMVER_SOURCE}$`,
            'i',
        ).test(
            String(value),
        )
    );
}

function escapeRegExp(
    value,
) {
    return String(value)
        .replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&',
        );
}

function getHeader(
    headers,
    name,
) {
    if (!headers) {
        return undefined;
    }

    if (
        typeof headers.get ===
        'function'
    ) {
        return (
            headers.get(name) ??
            headers.get(
                name.toLowerCase(),
            ) ??
            undefined
        );
    }

    const target =
        name.toLowerCase();

    for (
        const [
            key,
            value,
        ] of Object.entries(
            headers,
        )
    ) {
        if (
            key.toLowerCase() ===
            target
        ) {
            return value;
        }
    }

    return undefined;
}

/**
 * Convert relative, root-relative, and bare imports in cached source to
 * absolute URLs.
 */
function rewriteModuleSpecifiers(
    source,
    sourceURL,
    cdnBaseURL,
    URLImpl,
) {
    const rewrite =
        specifier => {
            if (
                !specifier ||
                specifier.startsWith(
                    'node:',
                ) ||
                specifier.startsWith(
                    'data:',
                ) ||
                specifier.startsWith(
                    'blob:',
                )
            ) {
                return specifier;
            }

            if (
                /^[A-Za-z][A-Za-z\d+.-]*:/
                    .test(
                        specifier,
                    )
            ) {
                return specifier;
            }

            if (
                specifier.startsWith(
                    '.',
                ) ||
                specifier.startsWith(
                    '/',
                )
            ) {
                return new URLImpl(
                    specifier,
                    sourceURL,
                ).href;
            }

            return new URLImpl(
                specifier,
                cdnBaseURL,
            ).href;
        };

    let result =
        String(source);

    result =
        result.replace(
            /(\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s*)?)(["'])([^"']+)\2/g,

            (
                full,
                prefix,
                quote,
                specifier,
            ) =>
                `${prefix
                }${quote
                }${rewrite(
                    specifier,
                )
                }${quote
                }`,
        );

    result =
        result.replace(
            /(\bimport\s*\(\s*)(["'])([^"']+)\2(\s*\))/g,

            (
                full,
                prefix,
                quote,
                specifier,
                suffix,
            ) =>
                `${prefix
                }${quote
                }${rewrite(
                    specifier,
                )
                }${quote
                }${suffix
                }`,
        );

    return result;
}

function definitelyTypedName(
    packageName,
) {
    if (
        packageName.startsWith(
            '@types/',
        )
    ) {
        return packageName;
    }

    if (
        packageName.startsWith(
            '@',
        )
    ) {
        return `@types/${packageName
            .slice(1)
            .replace(
                '/',
                '__',
            )
            }`;
    }

    return `@types/${packageName}`;
}

/**
 * Resolve package.json exports, including exact and single-star subpaths.
 */
function resolvePackageExport(
    exportsField,
    subpath,
    conditions,
) {
    if (
        exportsField ==
        null
    ) {
        return undefined;
    }

    const key =
        subpath
            ? `./${subpath}`
            : '.';

    let target;
    let wildcard;

    if (
        typeof exportsField ===
        'string' ||
        Array.isArray(
            exportsField,
        )
    ) {
        target =
            key === '.'
                ? exportsField
                : undefined;
    } else if (
        typeof exportsField ===
        'object'
    ) {
        const keys =
            Object.keys(
                exportsField,
            );

        const hasSubpathKeys =
            keys.some(
                item =>
                    item.startsWith(
                        '.',
                    ),
            );

        if (!hasSubpathKeys) {
            target =
                key === '.'
                    ? exportsField
                    : undefined;
        } else if (
            Object.hasOwn(
                exportsField,
                key,
            )
        ) {
            target =
                exportsField[
                key
                ];
        } else {
            for (
                const pattern of
                keys
            ) {
                if (
                    !pattern.includes(
                        '*',
                    )
                ) {
                    continue;
                }

                const [
                    prefix,
                    suffix,
                ] =
                    pattern.split(
                        '*',
                    );

                if (
                    key.startsWith(
                        prefix,
                    ) &&
                    key.endsWith(
                        suffix,
                    )
                ) {
                    wildcard =
                        key.slice(
                            prefix.length,
                            key.length -
                            suffix.length,
                        );

                    target =
                        exportsField[
                        pattern
                        ];

                    break;
                }
            }
        }
    }

    const result =
        unwrapConditionalExport(
            target,
            conditions,
        );

    return (
        typeof result ===
        'string' &&
        wildcard !==
        undefined
    )
        ? result.replaceAll(
            '*',
            wildcard,
        )
        : result;
}

function unwrapConditionalExport(
    target,
    conditions,
) {
    if (
        typeof target ===
        'string'
    ) {
        return target;
    }

    if (
        Array.isArray(
            target,
        )
    ) {
        for (
            const item of
            target
        ) {
            const value =
                unwrapConditionalExport(
                    item,
                    conditions,
                );

            if (value) {
                return value;
            }
        }

        return undefined;
    }

    if (
        !target ||
        typeof target !==
        'object'
    ) {
        return undefined;
    }

    for (
        const condition of
        conditions
    ) {
        const value =
            unwrapConditionalExport(
                target[
                condition
                ],
                conditions,
            );

        if (value) {
            return value;
        }
    }

    for (
        const value of
        Object.values(
            target,
        )
    ) {
        const unwrapped =
            unwrapConditionalExport(
                value,
                conditions,
            );

        if (unwrapped) {
            return unwrapped;
        }
    }

    return undefined;
}

function chooseTypeEntry(
    pkg,
    subpath,
) {
    const exportType =
        resolvePackageExport(
            pkg.exports,
            subpath,
            [
                'types',
                'typings',
                'import',
                'default',
                'node',
                'browser',
                'require',
            ],
        );

    if (exportType) {
        return toDeclarationPath(
            exportType,
        );
    }

    if (subpath) {
        return subpath;
    }

    return (
        pkg.types ??
        pkg.typings ??
        'index.d.ts'
    );
}

function toDeclarationPath(
    path,
) {
    const value =
        String(path);

    if (
        /\.d\.(?:ts|mts|cts)$/i
            .test(
                value,
            )
    ) {
        return value;
    }

    if (
        /\.mjs$/i.test(
            value,
        )
    ) {
        return value.replace(
            /\.mjs$/i,
            '.d.mts',
        );
    }

    if (
        /\.cjs$/i.test(
            value,
        )
    ) {
        return value.replace(
            /\.cjs$/i,
            '.d.cts',
        );
    }

    if (
        /\.(?:js|jsx|mts|cts|ts|tsx)$/i
            .test(
                value,
            )
    ) {
        return value.replace(
            /\.(?:js|jsx|mts|cts|ts|tsx)$/i,
            '.d.ts',
        );
    }

    return value;
}

function declarationCandidates(
    url,
) {
    const URLImpl =
        url.constructor;

    const candidates = [];

    const push =
        value => {
            const candidate =
                value instanceof
                    URLImpl
                    ? value
                    : new URLImpl(
                        value,
                    );

            if (
                !candidates.some(
                    existing =>
                        existing.href ===
                        candidate.href,
                )
            ) {
                candidates.push(
                    candidate,
                );
            }
        };

    const replaceExtension =
        extension => {
            const candidate =
                new URLImpl(
                    url.href,
                );

            candidate.pathname =
                candidate.pathname
                    .replace(
                        /\.[^/.]+$/,
                        extension,
                    );

            return candidate;
        };

    const appendPath =
        suffix => {
            const candidate =
                new URLImpl(
                    url.href,
                );

            candidate.pathname =
                `${candidate.pathname
                    .replace(
                        /\/$/,
                        '',
                    )
                }${suffix
                }`;

            return candidate;
        };

    const pathname =
        url.pathname;

    if (
        /\.d\.(?:ts|mts|cts)$/i
            .test(
                pathname,
            ) ||
        /\.(?:ts|tsx|mts|cts)$/i
            .test(
                pathname,
            )
    ) {
        push(
            url,
        );

        return candidates;
    }

    if (
        /\.cjs$/i.test(
            pathname,
        )
    ) {
        push(
            replaceExtension(
                '.d.cts',
            ),
        );

        push(
            replaceExtension(
                '.d.ts',
            ),
        );

        return candidates;
    }

    if (
        /\.mjs$/i.test(
            pathname,
        )
    ) {
        push(
            replaceExtension(
                '.d.mts',
            ),
        );

        push(
            replaceExtension(
                '.d.ts',
            ),
        );

        return candidates;
    }

    if (
        /\.(?:js|jsx)$/i
            .test(
                pathname,
            )
    ) {
        push(
            replaceExtension(
                '.d.ts',
            ),
        );

        push(
            replaceExtension(
                '.d.mts',
            ),
        );

        push(
            replaceExtension(
                '.d.cts',
            ),
        );

        return candidates;
    }

    push(
        appendPath(
            '.d.ts',
        ),
    );

    push(
        appendPath(
            '.d.mts',
        ),
    );

    push(
        appendPath(
            '.d.cts',
        ),
    );

    push(
        appendPath(
            '/index.d.ts',
        ),
    );

    push(
        appendPath(
            '/index.d.mts',
        ),
    );

    push(
        appendPath(
            '/index.d.cts',
        ),
    );

    return candidates;
}

async function runWithConcurrency(
    jobs,
    concurrency = 8,
) {
    if (!jobs.length) {
        return;
    }

    const limit =
        Math.max(
            1,
            Math.floor(
                concurrency,
            ),
        );

    let nextIndex =
        0;

    const workers =
        Array.from(
            {
                length:
                    Math.min(
                        limit,
                        jobs.length,
                    ),
            },

            async () => {
                while (true) {
                    const index =
                        nextIndex++;

                    if (
                        index >=
                        jobs.length
                    ) {
                        return;
                    }

                    await jobs[
                        index
                    ]();
                }
            },
        );

    await Promise.all(
        workers,
    );
}

function parseDeclarationDependencies(
    source,
) {
    const results = [];
    const seen = new Set();

    const add =
        (
            kind,
            value,
        ) => {
            const key =
                `${kind}:${value}`;

            if (
                !value ||
                seen.has(
                    key,
                )
            ) {
                return;
            }

            seen.add(
                key,
            );

            results.push({
                kind,
                value,
            });
        };

    const staticModuleRE =
        /\b(?:import|export)\s+(?:type\s+)?(?:[^;"']*?\s+from\s*)?["']([^"']+)["']/g;

    for (
        const match of
        source.matchAll(
            staticModuleRE,
        )
    ) {
        addModuleDependency(
            match[1],
            add,
        );
    }

    const expressionModuleRE =
        /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;

    for (
        const match of
        source.matchAll(
            expressionModuleRE,
        )
    ) {
        addModuleDependency(
            match[1],
            add,
        );
    }

    const pathRE =
        /\/\/\/\s*<reference\s+path=["']([^"']+)["'][^>]*>/g;

    for (
        const match of
        source.matchAll(
            pathRE,
        )
    ) {
        add(
            'path',
            match[1],
        );
    }

    const typesRE =
        /\/\/\/\s*<reference\s+types=["']([^"']+)["'][^>]*>/g;

    for (
        const match of
        source.matchAll(
            typesRE,
        )
    ) {
        add(
            'types',
            match[1],
        );
    }

    return results;
}

function addModuleDependency(
    value,
    add,
) {
    if (!value) {
        return;
    }

    if (
        value.startsWith(
            '.',
        ) ||
        value.startsWith(
            '/',
        )
    ) {
        add(
            'path',
            value,
        );

        return;
    }

    if (
        value.startsWith(
            'node:',
        )
    ) {
        add(
            'types',
            'node',
        );

        return;
    }

    add(
        'package',
        value,
    );
}
