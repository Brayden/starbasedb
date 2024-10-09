import { createResponse } from './utils';

export type OperationQueueItem = {
    queries: { sql: string; params?: any[] }[];
    isTransaction: boolean;
    isRaw: boolean;
    resolve: (value: Response) => void;
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
            cursor = sqlInstance.exec(sql, params);
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
    const results = [];
    let transactionBookmark: any | null = null;

    try {
        // Create a storage bookmark before starting the transaction.
        transactionBookmark = await ctx.storage.getCurrentBookmark();

        for (const queryObj of queries) {
            const { sql, params } = queryObj;
            const result = executeQuery(sql, params, isRaw, sqlInstance);
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
    operationQueue: any[],
    processNextOperation: () => Promise<void>
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

        processNextOperation().catch((err) => {
            console.error('Error processing operation queue:', err);
        });
    });
}

export async function processNextOperation(
    sql: any,
    operationQueue: Array<OperationQueueItem>,
    state: DurableObjectState,
    processingOperation: { value: boolean }
) {
    if (processingOperation.value || operationQueue.length === 0) {
        return;
    }

    processingOperation.value = true;

    const operation = operationQueue[0];
    try {
        if (operation.isTransaction) {
            sql.exec('BEGIN;');
        }

        for (const query of operation.queries) {
            const params = query.params ? query.params.flat() : [];
            console.log('Executing SQL Query:', query.sql, 'with params:', params);
            if (params.length > 0) {
                sql.exec(query.sql, ...params);
            } else {
                sql.exec(query.sql);
            }
        }

        if (operation.isTransaction) {
            sql.exec('COMMIT;');
        }

        operation.resolve(new Response('Operation successful'));
    } catch (error) {
        console.error('SQL Execution Error:', error);
        if (operation.isTransaction) {
            sql.exec('ROLLBACK;');
        }
        operation.reject(error);
    } finally {
        operationQueue.shift();
        processingOperation.value = false;
        if (operationQueue.length > 0) {
            processNextOperation(sql, operationQueue, state, processingOperation);
        }
    }
}