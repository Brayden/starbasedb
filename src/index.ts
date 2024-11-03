import { DurableObject } from "cloudflare:workers";
import { createResponse, createResponseFromOperationResponse, QueryRequest, QueryTransactionRequest } from './utils';
import { LiteREST } from './literest';
import handleStudioRequest from "./studio";
import { dumpDatabaseRoute } from './export/dump';
import { exportTableToJsonRoute } from './export/json';
import { exportTableToCsvRoute } from './export/csv';
import { importDumpRoute } from './import/dump';
import { importTableFromJsonRoute } from './import/json';
import { importTableFromCsvRoute } from './import/csv';
import { handleApiRequest } from "./api";
import { Handler } from "./handler";
import { QueryResponse } from "./operation";
export { DatabaseDurableObject } from './do'; 

const DURABLE_OBJECT_ID = 'sql-durable-object';

interface Env {
    AUTHORIZATION_TOKEN: string;
    DATABASE_DURABLE_OBJECT: DurableObjectNamespace;
    STUDIO_USER?: string;
    STUDIO_PASS?: string;
    // ## DO NOT REMOVE: TEMPLATE INTERFACE ##
}

export enum Source {
    internal = 'internal',  // Durable Object's SQLite instance
    external = 'external'   // External data source (e.g. Outerbase)
}

export type DataSource = {
    source: Source;
    request: Request;
    internalConnection?: InternalConnection;
    externalConnection?: {
        // API Key for Outerbase which currently controls querying external data sources
        outerbaseApiKey: string;
    };
}

type DatabaseStub = DurableObjectStub & {
    fetch: (init?: RequestInit | Request) => Promise<Response>;
    executeQuery(sql: string, params: any[] | undefined, isRaw: boolean): QueryResponse;
    executeTransaction(queries: { sql: string; params?: any[] }[], isRaw: boolean): any[];
};

interface InternalConnection {
    durableObject: DatabaseStub;
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
        // Get location hint from wrangler.toml environment variables
        // const locationHint = env.DATABASE_LOCATION_HINT ?? 'enam';
        // let stub = env.DATABASE_DURABLE_OBJECT.get(id, { locationHint: "enam" });
        let id: DurableObjectId = env.DATABASE_DURABLE_OBJECT.idFromName(DURABLE_OBJECT_ID);
		let stub = env.DATABASE_DURABLE_OBJECT.get(id);

        const source: Source = request.headers.get('X-Starbase-Source') as Source ?? 'internal';
        const dataSource: DataSource = {
            source: source,
            request: request.clone(),
            internalConnection: {
                durableObject: stub as unknown as DatabaseStub,
            },
            externalConnection: {
                outerbaseApiKey: request.headers.get('X-Outerbase-Source-Token') ?? '',
            },
        };

        const response = await new Handler().handle(request, dataSource);

        // ## DO NOT REMOVE: TEMPLATE ROUTING ##

        return response;
	},
} satisfies ExportedHandler<Env>;
