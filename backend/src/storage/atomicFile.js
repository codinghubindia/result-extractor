import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Async Mutex to serialize concurrent operations in the Node.js event loop.
 */
export class Mutex {
    constructor() {
        this._queue = Promise.resolve();
    }

    /**
     * Executes the given callback exclusively after all previously queued tasks complete.
     * @template T
     * @param {() => Promise<T> | T} fn
     * @returns {Promise<T>}
     */
    runExclusive(fn) {
        const next = this._queue.then(() => fn());
        this._queue = next.catch(() => {});
        return next;
    }
}

/**
 * Helper to pause for ms milliseconds.
 * @param {number} ms
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Atomically writes data to a target file using a temporary file and atomic rename.
 * Handles Windows-specific EPERM / EBUSY edge cases with exponential retry backoff.
 * 
 * @param {string} filePath Absolute or relative path to target file
 * @param {string} content Stringified content to write
 * @param {number} [maxRetries=5] Maximum retry attempts for rename on Windows
 */
export async function atomicWriteFile(filePath, content, maxRetries = 5) {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    await fs.promises.writeFile(tempPath, content, 'utf-8');

    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            await fs.promises.rename(tempPath, filePath);
            return;
        } catch (err) {
            attempt++;
            if (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EEXIST') {
                if (attempt >= maxRetries) {
                    // Fallback for Windows file system locks: copyFile then unlink temp
                    try {
                        await fs.promises.copyFile(tempPath, filePath);
                        await fs.promises.unlink(tempPath).catch(() => {});
                        return;
                    } catch (copyErr) {
                        await fs.promises.unlink(tempPath).catch(() => {});
                        throw copyErr;
                    }
                }
                await sleep(attempt * 25);
            } else {
                await fs.promises.unlink(tempPath).catch(() => {});
                throw err;
            }
        }
    }
}

/**
 * Safely reads a JSON file from disk. If the file does not exist, returns the default value.
 * If JSON parsing fails, logs a warning and returns the default value.
 * 
 * @param {string} filePath Path to the JSON file
 * @param {any} [defaultValue=[]] Fallback default value if missing or invalid
 * @returns {Promise<any>}
 */
export async function safeReadJson(filePath, defaultValue = []) {
    try {
        const data = await fs.promises.readFile(filePath, 'utf-8');
        const trimmed = data.trim();
        if (!trimmed) {
            return defaultValue;
        }
        return JSON.parse(trimmed);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return defaultValue;
        }
        console.warn(`[safeReadJson] Warning reading ${filePath}: ${err.message}. Using fallback.`);
        return defaultValue;
    }
}

/**
 * Thread-safe, atomic JSON file repository wrapper.
 * Combines in-memory caching with serialized atomic writes to disk.
 */
export class AtomicJsonFile {
    /**
     * @param {string} filePath File path to persist data
     * @param {any} [defaultValue=[]] Default value (array or object)
     */
    constructor(filePath, defaultValue = []) {
        this.filePath = path.resolve(filePath);
        this.defaultValue = defaultValue;
        this.mutex = new Mutex();
        this._cache = null;
        this._isLoaded = false;
    }

    /**
     * Ensures data is loaded from disk into memory.
     * @returns {Promise<void>}
     */
    async ensureLoaded() {
        if (!this._isLoaded) {
            const data = await safeReadJson(this.filePath, this.defaultValue);
            this._cache = data;
            this._isLoaded = true;
        }
    }

    /**
     * Reads the current cached data (loading from disk if not yet loaded).
     * @returns {Promise<any>}
     */
    async read() {
        return this.mutex.runExclusive(async () => {
            await this.ensureLoaded();
            return this._cache;
        });
    }

    /**
     * Atomically mutates the cached data and writes it back to disk.
     * Mutex guarantees that concurrent mutate calls are queued sequentially.
     * 
     * @template T
     * @param {(data: any) => Promise<T> | T} modifierFn Callback receiving current data
     * @returns {Promise<T>} Result returned by the modifier callback
     */
    async mutate(modifierFn) {
        return this.mutex.runExclusive(async () => {
            await this.ensureLoaded();
            const result = await modifierFn(this._cache);
            const serialized = JSON.stringify(this._cache, null, 2);
            await atomicWriteFile(this.filePath, serialized);
            return result;
        });
    }

    /**
     * Directly replaces the current data and writes to disk.
     * @param {any} newData
     * @returns {Promise<void>}
     */
    async write(newData) {
        return this.mutex.runExclusive(async () => {
            this._cache = newData;
            this._isLoaded = true;
            const serialized = JSON.stringify(this._cache, null, 2);
            await atomicWriteFile(this.filePath, serialized);
        });
    }

    /**
     * Forces a reload from disk, bypassing current memory cache.
     * @returns {Promise<any>}
     */
    async reload() {
        return this.mutex.runExclusive(async () => {
            this._cache = await safeReadJson(this.filePath, this.defaultValue);
            this._isLoaded = true;
            return this._cache;
        });
    }
}
