import { createResponse } from './utils';

export type OperationQueueItem = {
    queries: { sql: string; params?: any[] }[];
    isTransaction: boolean;
    isRaw: boolean;
    resolve: (value: Response) => void;
    reject: (reason?: any) => void;
};

export function executeQuery(sql: string, params: any[] | undefined, sqlInstance: any): any[] {
    try {
        const cursor = params && params.length ? sqlInstance.exec(sql, params) : sqlInstance.exec(sql);
        return cursor.toArray();
    } catch (error) {
        console.error('SQL Execution Error:', error);
        throw error;
    }
}

export async function executeTransaction(
    queries: { sql: string; params?: any[] }[],
    sqlInstance: any,
    ctx: any
): Promise<any[]> {
    const results = [];
    let transactionBookmark: any | null = null;

    try {
        transactionBookmark = await ctx.storage.getCurrentBookmark();

        for (const queryObj of queries) {
            const result = executeQuery(queryObj.sql, queryObj.params, sqlInstance);
            results.push(result);
        }

        transactionBookmark = null;
        return results;
    } catch (error) {
        console.error('Transaction Execution Error:', error);

        if (transactionBookmark) {
            await ctx.storage.onNextSessionRestoreBookmark(transactionBookmark);
            await ctx.abort();
        }

        throw error;
    }
}

export async function enqueueOperation(
    queries: { sql: string; params?: any[] }[],
    isTransaction: boolean,
    isRaw: boolean,
    operationQueue: OperationQueueItem[],
    workerPool: Set<Promise<void>>,
    maxWorkers: number,
    sqlInstance: any,
    ctx: any
): Promise<Response> {
    const MAX_WAIT_TIME = 25000;

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(createResponse(undefined, 'Operation timed out.', 503));
        }, MAX_WAIT_TIME);

        operationQueue.push({
            queries,
            isTransaction,
            isRaw,
            resolve: (value: Response) => {
                clearTimeout(timeout);
                resolve(value);
            },
            reject: (reason?: any) => {
                clearTimeout(timeout);
                reject(reason);
            }
        });

        processNextOperations(workerPool, maxWorkers, sqlInstance, ctx, operationQueue);
    });
}

async function processNextOperations(
    workerPool: Set<Promise<void>>,
    maxWorkers: number,
    sqlInstance: any,
    ctx: any,
    operationQueue: OperationQueueItem[]
) {
    while (workerPool.size < maxWorkers && operationQueue.length > 0) {
        const operation = operationQueue.shift();
        if (operation) {
            const worker = processOperation(operation, sqlInstance, ctx);
            workerPool.add(worker);

            worker.finally(() => {
                workerPool.delete(worker);
                processNextOperations(workerPool, maxWorkers, sqlInstance, ctx, operationQueue);
            });
        }
    }
}

async function processOperation(operation: OperationQueueItem, sqlInstance: any, ctx: any) {
    const { queries, isTransaction, resolve, reject } = operation;
    try {
        const result = isTransaction
            ? await executeTransaction(queries, sqlInstance, ctx)
            : executeQuery(queries[0].sql, queries[0].params, sqlInstance);
        resolve(createResponse(result, undefined, 200));
    } catch (error: any) {
        reject(createResponse(undefined, error.message || 'Operation failed.', 500));
    }
}
