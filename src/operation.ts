import { createResponse } from './utils';

export type OperationQueueItem = {
    queries: { sql: string; params?: any[] }[];
    isTransaction: boolean;
    isRaw: boolean;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
}

export type RawQueryResponse = {
    columns: string[];
    rows: any[];
    meta: {
        rows_read: number;
        rows_written: number;
    }
}

export type QueryResponse = any[] | RawQueryResponse;

export function executeQuery(sql: string, params: any[] | undefined, isRaw: boolean, sqlInstance: any): QueryResponse {
    try {
        let cursor;
        
        if (params && params.length) {
            cursor = sqlInstance.exec(sql, ...params);
        } else {
            cursor = sqlInstance.exec(sql);
        }

        let result;

        if (isRaw) {
            result = {
                columns: cursor.columnNames,
                rows: cursor.raw().toArray(),
                meta: {
                    rows_read: cursor.rowsRead,
                    rows_written: cursor.rowsWritten,
                },
            };        
        } else {
            result = cursor.toArray();
        }

        return result;
    } catch (error) {
        console.error('SQL Execution Error:', error);
        throw error;
    }
}

export async function executeTransaction(queries: { sql: string; params?: any[] }[], isRaw: boolean, sqlInstance: any, ctx: any): Promise<any[]> {
    return ctx.storage.transactionSync(() => {
        const results = [];

        try {
            for (const queryObj of queries) {
                const { sql, params } = queryObj;
                const result = executeQuery(sql, params, isRaw, sqlInstance);
                results.push(result);
            }

            return results;
        } catch (error) {
            console.error('Transaction Execution Error:', error);
            throw error;
        }
    });
}

export async function enqueueOperation(
    queries: { sql: string; params?: any[] }[],
    isTransaction: boolean,
    isRaw: boolean,
    operationQueue: any[],
    processNextOperation: () => Promise<void>
): Promise<{ result?: any, error?: string | undefined, status: number }> {
    const MAX_WAIT_TIME = 25000;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(createResponse(undefined, 'Operation timed out.', 503));
        }, MAX_WAIT_TIME);

        operationQueue.push({
            queries,
            isTransaction,
            isRaw,
            resolve: (value: any) => {
                clearTimeout(timeout);

                resolve({
                    result: value,
                    error: undefined,
                    status: 200
                })
            },
            reject: (reason?: any) => {
                clearTimeout(timeout);

                reject({
                    result: undefined,
                    error: reason ?? 'Operation failed.',
                    status: 500
                })
            }
        });

        processNextOperation().catch((err) => {
            console.error('Error processing operation queue:', err);
        });
    });
}

export async function processNextOperation(
    sqlInstance: any,
    operationQueue: OperationQueueItem[],
    ctx: any,
    processingOperation: { value: boolean }
) {
    if (processingOperation.value) {
        // Already processing an operation
        return;
    }

    if (operationQueue.length === 0) {
        // No operations remaining to process
        return;
    }

    processingOperation.value = true;
    const { queries, isTransaction, isRaw, resolve, reject } = operationQueue.shift()!;

    try {
        let result;

        if (isTransaction) {
            result = await executeTransaction(queries, isRaw, sqlInstance, ctx);
        } else {
            const { sql, params } = queries[0];
            result = executeQuery(sql, params, isRaw, sqlInstance);
        }

        resolve(result);
    } catch (error: any) {
        console.error('Operation Execution Error:', error);
        reject(error || 'Operation failed.');
    } finally {
        processingOperation.value = false;
        await processNextOperation(sqlInstance, operationQueue, ctx, processingOperation);
    }
}