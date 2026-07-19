/// <reference lib="WebWorker"/>
/// <reference lib="ESNext"/>
/// <reference lib="DOM"/>
/// <reference no-default-lib="true"/>
/// <reference types="typescript"/>


export type NavStorageEstimage = StorageEstimate & { usageDetails?: Object | null }

export async function getStorageQuota() {

    const results: Record<string, unknown> = {}

    if (navigator.storage?.estimate) {
        try {

            const estimate: NavStorageEstimage = await navigator.storage.estimate();
            const { usage = 0, quota = 0 } = estimate;

            results.storageManager = {
                usageBytes: estimate.usage,
                quotaBytes: estimate.quota,
                usageMiB: usage / 1024 ** 2,
                quotaMiB: quota / 1024 ** 2,
                availableMiB:
                    (quota - usage) / 1024 ** 2,
                availableGiB: (quota - usage) / 1024 ** 2 / 10240,

                usageDetails: estimate.usageDetails ?? null,
            };
        } catch (error) {
            results.storageManagerError = {
                name: error?.name,
                message: error?.message,
            };
        }
    }

    if (navigator.webkitTemporaryStorage?.queryUsageAndQuota) {
        try {
            results.legacyTemporaryStorage = await new Promise(
                (resolve, reject) => {
                    navigator.webkitTemporaryStorage.queryUsageAndQuota(
                        (usage, quota) => {
                            resolve({
                                usageBytes: usage,
                                quotaBytes: quota,
                                usageMiB: usage / 1024 ** 2,
                                quotaMiB: quota / 1024 ** 2,
                                availableMiB: (quota - usage) / 1024 ** 2,
                                availableGiB: (quota - usage) / 1024 ** 2 / 10240
                            });
                        },
                        reject,
                    );
                },
            );
        } catch (error) {
            results.legacyTemporaryStorageError = {
                name: error?.name,
                message: error?.message,
            };
        }
    }

    return results;
}
