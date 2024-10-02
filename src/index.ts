import { DurableObject } from "cloudflare:workers";
import { createResponse, QueryRequest, QueryTransactionRequest } from './utils';
import { enqueueOperation, processNextOperation } from './operation';

const DURABLE_OBJECT_ID = 'sql-durable-object';

export class DatabaseDurableObject extends DurableObject {
    // Durable storage for the SQL database
    public sql: SqlStorage;

    // Queue of operations to be processed, with each operation containing a list of queries to be executed
    private operationQueue: Array<{
        queries: { sql: string; params?: any[] }[];
        isTransaction: boolean;
        resolve: (value: Response) => void;
        reject: (reason?: any) => void;
    }> = [];

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

                const response = await enqueueOperation(
                    queries,
                    true,
                    this.operationQueue,
                    () => processNextOperation(this.sql, this.operationQueue, this.ctx, this.processingOperation)
                );
                return response;
            } else if (typeof sql !== 'string' || !sql.trim()) {
                return createResponse(undefined, 'Invalid or empty "sql" field.', 400);
            } else if (params !== undefined && !Array.isArray(params)) {
                return createResponse(undefined, 'Invalid "params" field.', 400);
            }
    
            const queries = [{ sql, params }];
            const response = await enqueueOperation(
                queries,
                false,
                this.operationQueue,
                () => processNextOperation(this.sql, this.operationQueue, this.ctx, this.processingOperation)
            );
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
