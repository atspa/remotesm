
## Usage
```ts
const { getStorageQuota } = await import("https://esm.sh/gh/atspa/remotesm?exports=getStorageQuota");
const quota = await getStorageQuota();
console.debug(quota)
console.info(...Object.entries(quota.storageManager).map(([k, v]) => ({ [k]: v })))
```