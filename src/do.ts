import { DurableObject } from "cloudflare:workers";
import { OperationQueueItem, QueryResponse } from "./operation";
import { createResponse } from "./utils";

export class DatabaseDurableObject extends DurableObject {
    // Durable storage for the SQL database
    public sql: SqlStorage;
    public storage: DurableObjectStorage;

    // Queue of operations to be processed, with each operation containing a list of queries to be executed
    private operationQueue: Array<OperationQueueItem> = [];

    // Flag to indicate if an operation is currently being processed
    private processingOperation: { value: boolean } = { value: false };

	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
	 *
	 * @param ctx - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 */
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.sql = ctx.storage.sql;
        this.storage = ctx.storage;
    }

    /**
     * Execute a raw SQL query on the database, typically used for external requests
     * from other service bindings (e.g. auth). This serves as an exposed function for
     * other service bindings to query the database without having to have knowledge of
     * the current operation queue or processing state.
     * 
     * @param sql - The SQL query to execute.
     * @param params - Optional parameters for the SQL query.
     * @returns A response containing the query result or an error message.
     */
    async executeExternalQuery(sql: string, params: any[] | undefined): Promise<any> {
        try {
            const queries = [{ sql, params }];
            const response = await this.enqueueOperation(
                queries,
                false,
                false,
                this.operationQueue,
                () => this.processNextOperation(this.sql, this.operationQueue, this.ctx, this.processingOperation)
            );

            return response;
        } catch (error: any) {
            console.error('Execute External Query Error:', error);
            return null;
        }
    }

    public executeQuery(sql: string, params: any[] | undefined, isRaw: boolean): QueryResponse {
        try {
            let cursor;
            
            if (params && params.length) {
                cursor = this.sql.exec(sql, ...params);
            } else {
                cursor = this.sql.exec(sql);
            }

            let result;

            if (isRaw) {
                result = {
                    columns: cursor.columnNames,
                    rows: Array.from(cursor.raw()),
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

    public executeTransaction(queries: { sql: string; params?: any[] }[], isRaw: boolean): any[] {
        return this.storage.transactionSync(() => {
            const results = [];

            try {
                for (const queryObj of queries) {
                    const { sql, params } = queryObj;
                    const result = this.executeQuery(sql, params, isRaw);
                    results.push(result);
                }

                return results;
            } catch (error) {
                console.error('Transaction Execution Error:', error);
                throw error;
            }
        });
    }

    enqueueOperation(
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

    async processNextOperation(
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
                result = await this.executeTransaction(queries, isRaw);
            } else {
                const { sql, params } = queries[0];
                result = this.executeQuery(sql, params, isRaw);
            }

            resolve(result);
        } catch (error: any) {
            reject(error.message || 'Operation failed.');
        } finally {
            processingOperation.value = false;
            await this.processNextOperation(sqlInstance, operationQueue, ctx, processingOperation);
        }
    }
}