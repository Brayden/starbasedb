import { DurableObject } from "cloudflare:workers";
import { createResponse, QueryRequest, QueryTransactionRequest } from './utils';

const DURABLE_OBJECT_ID = 'sql-durable-object';

export class DatabaseDurableObject extends DurableObject {
    public sql: SqlStorage;
    private operationQueue: Array<{
        queries: { sql: string; params?: any[] }[];
        isTransaction: boolean;
        resolve: (value: Response) => void;
        reject: (reason?: any) => void;
    }> = [];
    private processingOperation: boolean = false;

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
    }

    executeQuery(sql: string, params?: any[]): any[] {
        try {
            let cursor;

            if (params && params.length) {
                cursor = this.sql.exec(sql, params);
            } else {
                cursor = this.sql.exec(sql);
            }

            const result = cursor.toArray();
            return result;
        } catch (error) {
            console.error('SQL Execution Error:', error);
            throw error;
        }
    }

    async executeTransaction(queries: { sql: string; params?: any[] }[]): Promise<any[]> {
        const results = [];
        let transactionBookmark: any | null = null;

        try {
            // Create a storage bookmark before starting the transaction.
            transactionBookmark = await this.ctx.storage.getCurrentBookmark();

            for (const queryObj of queries) {
                const { sql, params } = queryObj;
                const result = this.executeQuery(sql, params);
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
                await this.ctx.storage.onNextSessionRestoreBookmark(transactionBookmark);
                await this.ctx.abort();
            }

            throw error;
        }
    }

    async enqueueOperation(
        queries: { sql: string; params?: any[] }[],
        isTransaction: boolean
    ): Promise<Response> {
        const MAX_WAIT_TIME = 25000;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(createResponse(undefined, 'Operation timed out.', 503));
            }, MAX_WAIT_TIME);

            this.operationQueue.push({
                queries,
                isTransaction,
                resolve: (value) => {
                    clearTimeout(timeout);
                    resolve(value);
                },
                reject: (reason) => {
                    clearTimeout(timeout);
                    reject(reason);
                }
            });

            this.processNextOperation().catch((err) => {
                console.error('Error processing operation queue:', err);
            });
        });
    }

    async processNextOperation() {
        if (this.processingOperation) {
            // Already processing an operation
            return;
        }

        if (this.operationQueue.length === 0) {
            // No operations remaining to process
            return;
        }

        this.processingOperation = true;

        const { queries, isTransaction, resolve, reject } = this.operationQueue.shift()!;

        try {
            let result;

            if (isTransaction) {
                result = await this.executeTransaction(queries);
            } else {
                const { sql, params } = queries[0];
                result = this.executeQuery(sql, params);
            }

            resolve(createResponse(result, undefined, 200));
        } catch (error: any) {
            console.error('Operation Execution Error:', error);
            reject(createResponse(undefined, error.message || 'Operation failed.', 500));
        } finally {
            this.processingOperation = false;
            await this.processNextOperation();
        }
    }

    async queryRoute(request: Request): Promise<Response> {
        try {
            const contentType = request.headers.get('Content-Type') || '';
            if (!contentType.includes('application/json')) {
                return createResponse(undefined, 'Content-Type must be application/json.', 400);
            }
    
            const { sql, params, transaction } = await request.json() as QueryRequest & QueryTransactionRequest;
    
            if (Array.isArray(transaction) && transaction.length) {
                const queries = transaction.map((queryObj: any) => {
                    const { sql, params } = queryObj;

                    if (typeof sql !== 'string' || !sql.trim()) {
                        throw new Error('Invalid or empty "sql" field in transaction.');
                    } else if (params !== undefined && !Array.isArray(params)) {
                        throw new Error('Invalid "params" field in transaction.');
                    }

                    return { sql, params };
                });

                const response = await this.enqueueOperation(queries, true);
                return response;
            } else if (typeof sql !== 'string' || !sql.trim()) {
                return createResponse(undefined, 'Invalid or empty "sql" field.', 400);
            } else if (params !== undefined && !Array.isArray(params)) {
                return createResponse(undefined, 'Invalid "params" field.', 400);
            }
    
            const queries = [{ sql, params }];
            const response = await this.enqueueOperation(queries, false);
            return response;
        } catch (error: any) {
            console.error('Query Route Error:', error);
            return createResponse(undefined, 'An unexpected error occurred.', 500);
        }
    }

    async statusRoute(_: Request): Promise<Response> {
        return createResponse({ 
            status: 'reachable',
            timestamp: Date.now(),
            usedDisk: await this.sql.databaseSize,
        }, undefined, 200)
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === 'POST' && url.pathname === '/query') {
            return this.queryRoute(request);
        } else if (request.method === 'GET' && url.pathname === '/status') {
            return this.statusRoute(request);
        } else {
            return createResponse(undefined, 'Unknown operation', 400);
        }
    }
}

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.toml
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx): Promise<Response> {
        /**
         * Prior to proceeding to the Durable Object, we can perform any necessary validation or
         * authorization checks here to ensure the request signature is valid and authorized to
         * interact with the Durable Object.
         */
        if (request.headers.get('Authorization') !== `Bearer ${env.AUTHORIZATION_TOKEN}`) {
            return createResponse(undefined, 'Unauthorized request', 401)
        }

        /**
         * Retrieve the Durable Object identifier from the environment bindings and instantiate a
         * Durable Object stub to interact with the Durable Object.
         */
        let id: DurableObjectId = env.DATABASE_DURABLE_OBJECT.idFromName(DURABLE_OBJECT_ID);
		let stub = env.DATABASE_DURABLE_OBJECT.get(id);

        /**
         * Pass the fetch request directly to the Durable Object, which will handle the request
         * and return a response to be sent back to the client.
         */
        return await stub.fetch(request);
	},
} satisfies ExportedHandler<Env>;
