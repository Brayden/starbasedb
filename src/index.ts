import { createResponse } from './utils';
import handleStudioRequest from "./studio";
import { Handler } from "./handler";
import { DatabaseStub, DataSource, RegionLocationHint, Source } from './types';
import { corsPreflight } from './cors';
export { DatabaseDurableObject } from './do'; 

import jwt from "@tsndr/cloudflare-worker-jwt"

const DURABLE_OBJECT_ID = 'sql-durable-object';

export interface Env {
    AUTHORIZATION_TOKEN: string;
    DATABASE_DURABLE_OBJECT: DurableObjectNamespace;
    REGION: string;
  
    // Studio credentials
    STUDIO_USER?: string;
    STUDIO_PASS?: string;
  
    // External database source details
    OUTERBASE_API_KEY?: string;
    EXTERNAL_DB_TYPE?: string;
    EXTERNAL_DB_HOST?: string;
    EXTERNAL_DB_PORT?: number;
    EXTERNAL_DB_USER?: string;
    EXTERNAL_DB_PASS?: string;
    EXTERNAL_DB_DATABASE?: string;
    EXTERNAL_DB_DEFAULT_SCHEMA?: string;

    EXTERNAL_DB_MONGODB_URI?: string;
    EXTERNAL_DB_TURSO_URI?: string;
    EXTERNAL_DB_TURSO_TOKEN?: string;
    EXTERNAL_DB_STARBASEDB_URI?: string;
    EXTERNAL_DB_STARBASEDB_TOKEN?: string;
    EXTERNAL_DB_CLOUDFLARE_API_KEY?: string;
    EXTERNAL_DB_CLOUDFLARE_ACCOUNT_ID?: string;
    EXTERNAL_DB_CLOUDFLARE_DATABASE_ID?: string;

    AUTH_JWT_SECRET?: string;
  
    // ## DO NOT REMOVE: TEMPLATE INTERFACE ##
    ALLOWLIST: {
        isQueryAllowed(sql: string): Promise<boolean | Error>;
    },
    RLS: {
        applyRLS(sql: string, context?: Record<string, any>, dialect?: string): Promise<string | Error>
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
        try {
            const url = new URL(request.url);
            const pathname = url.pathname;
            const isWebSocket = request.headers.get("Upgrade") === "websocket";
            let jwtPayload;

            // Authorize the request with CORS rules before proceeding.
            if (request.method === 'OPTIONS') {
                const preflightResponse = corsPreflight(request)
                
                if (preflightResponse) {
                    return preflightResponse;
                }
            }

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
            if (!isWebSocket) {
                const authorizationValue = request.headers.get('Authorization')

                // The `AUTHORIZATION_TOKEN` is like an admin path of automatically authorizing the
                // incoming request as verified. If this does not match then we next want to check
                // if the `Authorization` header contains a JWT session token we can verify before
                // allowing the user to proceed to our request handler.
                if (authorizationValue !== `Bearer ${env.AUTHORIZATION_TOKEN}`) {
                    const authorizationWithoutBearer = authorizationValue?.replace('Bearer ', '');

                    if (!env.AUTH_JWT_SECRET || authorizationWithoutBearer === undefined) {
                        return createResponse(undefined, 'Unauthorized request', 400)
                    }

                    const { payload } = await jwt.decode(authorizationWithoutBearer) as any  
                    // const verifiedPayload = await jwt.verify(authorizationWithoutBearer, env?.AUTH_JWT_SECRET) as any
                    
                    if (!payload.sub) {
                        return createResponse(undefined, 'Unauthorized request', 401)
                    } else {
                        jwtPayload = payload;
                    }
                }
            } else if (isWebSocket) {
                /**
                 * Web socket connections cannot pass in an Authorization header into their requests,
                 * so we can use a query parameter to validate the connection.
                 */
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

            const source: Source = request.headers.get('X-Starbase-Source') as Source ?? url.searchParams.get('source') as Source ?? 'internal';
            const dataSource: DataSource = {
                source: source,
                request: request.clone(),
                internalConnection: {
                    durableObject: stub as unknown as DatabaseStub,
                },
                externalConnection: {
                    outerbaseApiKey: env.OUTERBASE_API_KEY ?? ''
                },
                context: {
                    ...jwtPayload
                }
            };

            return await new Handler().handle(request, dataSource, env);
        } catch (error) {
            // Return error response to client
            return createResponse(
                undefined, 
                error instanceof Error ? error.message : 'An unexpected error occurred',
                400
            );
        }
	},
} satisfies ExportedHandler<Env>;
