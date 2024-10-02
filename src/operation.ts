import { createResponse } from "./utils";

export function executeQuery(_: any, sql: string, params?: any[]): any[] {
    try {
        let cursor;

        if (params && params.length) {
            cursor = _.sql.exec(sql, params);
        } else {
            cursor = _.sql.exec(sql);
        }

        const result = cursor.toArray();
        return result;
    } catch (error) {
        console.error('SQL Execution Error:', error);
        throw error;
    }
}

export async function executeTransaction(_: any, queries: { sql: string; params?: any[] }[]): Promise<any[]> {
    const results = [];
    let transactionBookmark: any | null = null;

    try {
        // Create a storage bookmark before starting the transaction.
        transactionBookmark = await _.ctx.storage.getCurrentBookmark();

        for (const queryObj of queries) {
            const { sql, params } = queryObj;
            const result = executeQuery(_, sql, params);
            results.push(result);
        }

        transactionBookmark = null;
        return results;
    } catch (error) {
        console.error('Transaction Execution Error:', error);

        /**
         * If an error occurs during the transaction, we can restore the storage to the state
         * before the transaction began by using the bookmark we created before starting the
         * transaction.
         */
        if (transactionBookmark) {
            await _.ctx.storage.onNextSessionRestoreBookmark(transactionBookmark);
            await _.ctx.abort();
        }

        throw error;
    }
}

export async function enqueueOperation(
    _: any,
    queries: { sql: string; params?: any[] }[],
    isTransaction: boolean
): Promise<Response> {
    const MAX_WAIT_TIME = 25000;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(createResponse(undefined, 'Operation timed out.', 503));
        }, MAX_WAIT_TIME);

        _.operationQueue.push({
            queries,
            isTransaction,
            resolve: (value: any) => {
                clearTimeout(timeout);
                resolve(value);
            },
            reject: (reason: any) => {
                clearTimeout(timeout);
                reject(reason);
            }
        });

        processNextOperation(_).catch((err: any) => {
            console.error('Error processing operation queue:', err);
        });
    });
}

export async function processNextOperation(_: any) {
    if (_.processingOperation) {
        // Already processing an operation
        return;
    }

    if (_.operationQueue.length === 0) {
        // No operations remaining to process
        return;
    }

    _.processingOperation = true;

    const { queries, isTransaction, resolve, reject } = _.operationQueue.shift()!;

    try {
        let result;

        if (isTransaction) {
            result = await executeTransaction(_, queries);
        } else {
            const { sql, params } = queries[0];
            result = executeQuery(_, sql, params);
        }

        resolve(createResponse(result, undefined, 200));
    } catch (error: any) {
        console.error('Operation Execution Error:', error);
        reject(createResponse(undefined, error.message || 'Operation failed.', 500));
    } finally {
        _.processingOperation = false;
        await processNextOperation(_);
    }
}