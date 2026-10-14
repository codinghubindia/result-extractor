import { EventEmitter } from 'node:events';

/**
 * AsyncQueue manages concurrent execution of asynchronous tasks with worker pooling,
 * rate-limiting delay between tasks, and graceful cancellation.
 */
export class AsyncQueue extends EventEmitter {
    /**
     * @param {object} [options={}]
     * @param {number} [options.concurrency=2] Number of parallel workers
     * @param {number} [options.taskDelayMs=300] Politeness delay in ms between consecutive tasks per worker
     */
    constructor(options = {}) {
        super();
        this.concurrency = Math.max(1, Math.min(options.concurrency || 2, 6));
        this.taskDelayMs = options.taskDelayMs ?? 300;
        this.tasks = [];
        this.activeCount = 0;
        this.completedCount = 0;
        this.failedCount = 0;
        this.isCancelled = false;
        this.isPaused = false;
        this.results = [];
        this.errors = [];
    }

    /**
     * Adds an item or array of items to the work queue.
     * @param {any|any[]} items
     */
    add(items) {
        if (Array.isArray(items)) {
            this.tasks.push(...items);
        } else {
            this.tasks.push(items);
        }
    }

    /**
     * Total number of tasks in the batch.
     * @returns {number}
     */
    get total() {
        return this.tasks.length + this.activeCount + this.completedCount + this.failedCount;
    }

    /**
     * Clears all pending tasks and signals workers to halt.
     */
    cancel() {
        this.isCancelled = true;
        const remaining = this.tasks.length;
        this.tasks = [];
        this.emit('cancelled', { remaining });
    }

    /**
     * Runs the queue using a processor function: async (item, workerIndex, queue) => Promise<any>
     * 
     * @param {(item: any, workerIndex: number, queue: AsyncQueue) => Promise<any>} processor
     * @returns {Promise<{ results: any[], errors: any[], isCancelled: boolean }>}
     */
    async run(processor) {
        this.isCancelled = false;
        const workers = [];
        const workerCount = Math.min(this.concurrency, this.tasks.length || 1);

        for (let i = 0; i < workerCount; i++) {
            workers.push(this._spawnWorker(i, processor));
        }

        await Promise.all(workers);

        this.emit('drain', {
            completed: this.completedCount,
            failed: this.failedCount,
            results: this.results,
            errors: this.errors,
            isCancelled: this.isCancelled,
        });

        return {
            results: this.results,
            errors: this.errors,
            isCancelled: this.isCancelled,
        };
    }

    /**
     * Internal worker loop.
     * @private
     */
    async _spawnWorker(workerIndex, processor) {
        while (this.tasks.length > 0 && !this.isCancelled) {
            const item = this.tasks.shift();
            if (!item) break;

            this.activeCount++;
            this.emit('task:start', { item, workerIndex });

            try {
                const res = await processor(item, workerIndex, this);
                this.completedCount++;
                this.results.push(res);
                this.emit('task:success', { item, result: res, workerIndex });
            } catch (err) {
                this.failedCount++;
                this.errors.push({ item, error: err.message, stack: err.stack });
                this.emit('task:error', { item, error: err, workerIndex });
            } finally {
                this.activeCount--;
                this.emit('task:settled', {
                    item,
                    workerIndex,
                    completed: this.completedCount,
                    failed: this.failedCount,
                    remaining: this.tasks.length,
                });
            }

            // Politeness delay between tasks to avoid rapid-fire requests
            if (this.taskDelayMs > 0 && this.tasks.length > 0 && !this.isCancelled) {
                await new Promise((r) => setTimeout(r, this.taskDelayMs));
            }
        }
    }
}
