import { DurableObject } from "cloudflare:workers";
import { createResponse, createResponseFromOperationResponse, QueryRequest, QueryTransactionRequest } from './utils';
import { enqueueOperation, OperationQueueItem, processNextOperation } from './operation';
import { LiteREST } from './literest';
import handleStudioRequest from "./studio";
import { dumpDatabaseRoute } from './export/dump';
import { exportTableToJsonRoute } from './export/json';
import { exportTableToCsvRoute } from './export/csv';
import { importDumpRoute } from './import/dump';
import { importTableFromJsonRoute } from './import/json';
import { importTableFromCsvRoute } from './import/csv';
import { handleApiRequest } from "./api";

const DURABLE_OBJECT_ID = 'sql-durable-object';

export interface Env {
    AUTHORIZATION_TOKEN: string;
    DATABASE_DURABLE_OBJECT: DurableObjectNamespace;
    REGION: string;
    STUDIO_USER?: string;
    STUDIO_PASS?: string;
    // ## DO NOT REMOVE: TEMPLATE INTERFACE ##
}

enum RegionLocationHint {
    AUTO = 'auto',
    WNAM = 'wnam', // Western North America
    ENAM = 'enam', // Eastern North America
    SAM = 'sam', // South America
    WEUR = 'weur', // Western Europe
    EEUR = 'eeur', // Eastern Europe
    APAC = 'apac', // Asia Pacific
    OC = 'oc', // Oceania
    AFR = 'afr', // Africa
    ME = 'me', // Middle East
}

export class DatabaseDurableObject extends DurableObject<Env> {
    // Durable storage for the SQL database
    public sql: SqlStorage;

    // Queue of operations to be processed, with each operation containing a list of queries to be executed
    private operationQueue: Array<OperationQueueItem> = [];

    // Flag to indicate if an operation is currently being processed
    private processingOperation: { value: boolean } = { value: false };

    // Map of WebSocket connections to their corresponding session IDs
    private connections = new Map<string, WebSocket>();

    // Instantiate LiteREST
    private liteREST: LiteREST;

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

        // Initialize LiteREST for handling /lite routes
        this.liteREST = new LiteREST(
            ctx,
            this.operationQueue,
            this.processingOperation,
            this.sql
        );
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
            const response = await enqueueOperation(
                queries,
                false,
                false,
                this.operationQueue,
                () => processNextOperation(this.sql, this.operationQueue, this.ctx, this.processingOperation, this.env)
            );

            return response;
        } catch (error: any) {
            console.error('Execute External Query Error:', error);
            return null;
        }
    }

    async queryRoute(request: Request, isRaw: boolean): Promise<Response> {
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

                try {
                    const response = await enqueueOperation(
                        queries,
                        true,
                        isRaw,
                        this.operationQueue,
                        () => processNextOperation(this.sql, this.operationQueue, this.ctx, this.processingOperation, this.env)
                    );

                    return createResponseFromOperationResponse(response);
                } catch (error: any) {
                    return createResponse(undefined, error.error || 'An unexpected error occurred.', error.status || 500);
                }
            } else if (typeof sql !== 'string' || !sql.trim()) {
                return createResponse(undefined, 'Invalid or empty "sql" field.', 400);
            } else if (params !== undefined && !Array.isArray(params)) {
                return createResponse(undefined, 'Invalid "params" field.', 400);
            }

            try {
                const queries = [{ sql, params }];
                const response = await enqueueOperation(
                    queries,
                    false,
                    isRaw,
                    this.operationQueue,
                    () => processNextOperation(this.sql, this.operationQueue, this.ctx, this.processingOperation, this.env)
                );
                
                return createResponseFromOperationResponse(response);
            } catch (error: any) {
                return createResponse(undefined, error.error || 'An unexpected error occurred.', error.status || 500);
            }
        } catch (error: any) {
            console.error('Query Route Error:', error);
            return createResponse(undefined, error || 'An unexpected error occurred.', 500);
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

        if (request.method === 'POST' && url.pathname === '/query/raw') {
            return this.queryRoute(request, true);
        } else if (request.method === 'POST' && url.pathname === '/query') {
            return this.queryRoute(request, false);
        } else if (url.pathname === '/socket') {
            return this.clientConnected();
        } else if (request.method === 'GET' && url.pathname === '/status') {
            return this.statusRoute(request);
        } else if (request.method === 'GET' && url.pathname === '/status/trace') {
            const response = await fetch('https://cloudflare.com/cdn-cgi/trace');
            return new Response(response.body, {
                headers: response.headers
            });
        } else if (url.pathname.startsWith('/rest')) {
            return await this.liteREST.handleRequest(request);
        } else if (request.method === 'GET' && url.pathname === '/export/dump') {
            return dumpDatabaseRoute(this.sql, this.operationQueue, this.ctx, this.processingOperation);
        } else if (request.method === 'GET' && url.pathname.startsWith('/export/json/')) {
            const tableName = url.pathname.split('/').pop();
            if (!tableName) {
                return createResponse(undefined, 'Table name is required', 400);
            }
            return exportTableToJsonRoute(this.sql, this.operationQueue, this.ctx, this.processingOperation, tableName);
        } else if (request.method === 'GET' && url.pathname.startsWith('/export/csv/')) {
            const tableName = url.pathname.split('/').pop();
            if (!tableName) {
                return createResponse(undefined, 'Table name is required', 400);
            }
            return exportTableToCsvRoute(this.sql, this.operationQueue, this.ctx, this.processingOperation, tableName);
        } else if (request.method === 'POST' && url.pathname === '/import/dump') {
            return importDumpRoute(request, this.sql, this.operationQueue, this.ctx, this.processingOperation);
        } else if (request.method === 'POST' && url.pathname.startsWith('/import/json/')) {
            const tableName = url.pathname.split('/').pop();
            if (!tableName) {
                return createResponse(undefined, 'Table name is required', 400);
            }
            return importTableFromJsonRoute(this.sql, this.operationQueue, this.ctx, this.processingOperation, tableName, request);
        } else if (request.method === 'POST' && url.pathname.startsWith('/import/csv/')) {
            const tableName = url.pathname.split('/').pop();
            if (!tableName) {
                return createResponse(undefined, 'Table name is required', 400);
            }
            return importTableFromCsvRoute(this.sql, this.operationQueue, this.ctx, this.processingOperation, tableName, request);
        } else if (url.pathname.startsWith('/api')) {
            return await handleApiRequest(request);
        } else {
            return createResponse(undefined, 'Unknown operation', 400);
        }
    }

    clientConnected() {
        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);
        const wsSessionId = crypto.randomUUID();

        this.ctx.acceptWebSocket(server, [wsSessionId]);
        this.connections.set(wsSessionId, client);

        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws: WebSocket, message: any) {
        const { sql, params, action } = JSON.parse(message);
    
        if (action === 'query') {
            const queries = [{ sql, params }];
            const response = await enqueueOperation(
                queries,
                false,
                false,
                this.operationQueue,
                () => processNextOperation(this.sql, this.operationQueue, this.ctx, this.processingOperation, this.env)
            );

            ws.send(JSON.stringify(response.result));
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        // If the client closes the connection, the runtime will invoke the webSocketClose() handler.
        ws.close(code, "StarbaseDB is closing WebSocket connection");

        // Remove the WebSocket connection from the map
        const tags = this.ctx.getTags(ws);
        if (tags.length) {
            const wsSessionId = tags[0];
            this.connections.delete(wsSessionId);
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
        const pathname = new URL(request.url).pathname;
        const isWebSocket = request.headers.get("Upgrade") === "websocket";

        /**
         * If the request is a GET request to the /studio endpoint, we can handle the request
         * directly in the Worker to avoid the need to deploy a separate Worker for the Studio.
         * Studio provides a user interface to interact with the SQLite database in the Durable
         * Object.
         */
        if (env.STUDIO_USER && env.STUDIO_PASS && request.method === 'GET' && pathname === '/studio') {
            return handleStudioRequest(request, {
                username: env.STUDIO_USER,
                password: env.STUDIO_PASS, 
                apiToken: env.AUTHORIZATION_TOKEN
            });
        }

        /**
         * Prior to proceeding to the Durable Object, we can perform any necessary validation or
         * authorization checks here to ensure the request signature is valid and authorized to
         * interact with the Durable Object.
         */
        if (request.headers.get('Authorization') !== `Bearer ${env.AUTHORIZATION_TOKEN}` && !isWebSocket) {
            return createResponse(undefined, 'Unauthorized request', 401)
        } else if (isWebSocket) {
            /**
             * Web socket connections cannot pass in an Authorization header into their requests,
             * so we can use a query parameter to validate the connection.
             */
            const url = new URL(request.url);
            const token = url.searchParams.get('token');

            if (token !== env.AUTHORIZATION_TOKEN) {
                return new Response('WebSocket connections are not supported at this endpoint.', { status: 440 });
            }
        }

        /**
         * Retrieve the Durable Object identifier from the environment bindings and instantiate a
         * Durable Object stub to interact with the Durable Object.
         */
        const region = env.REGION ?? RegionLocationHint.AUTO;
        const id: DurableObjectId = env.DATABASE_DURABLE_OBJECT.idFromName(DURABLE_OBJECT_ID);
        const stub = region !== RegionLocationHint.AUTO ? env.DATABASE_DURABLE_OBJECT.get(id, { locationHint: region as DurableObjectLocationHint }) : env.DATABASE_DURABLE_OBJECT.get(id);

        // ## DO NOT REMOVE: TEMPLATE ROUTING ##

        /**
         * Pass the fetch request directly to the Durable Object, which will handle the request
         * and return a response to be sent back to the client.
         */
        return await stub.fetch(request);
	},
} satisfies ExportedHandler<Env>;
