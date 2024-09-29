import { DurableObject } from "cloudflare:workers";

const AUTHORIZATION = 'Bearer ABC123';
const DURABLE_OBJECT_ID = 'sql-durable-object';

type QueryRequest = {
    sql: string;
    params?: any[];
};

export class DatabaseDurableObject extends DurableObject {
    public sql: SqlStorage

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

    async executeQuery(sql: string, params?: any[]): Promise<any[]> {
        try {
            let cursor = this.sql.exec(sql).toArray();
            return cursor;
        } catch (error) {
            console.error('SQL Execution Error:', error);
            throw new Error('Database operation failed.');
        }
    }

    async queryRoute(request: Request): Promise<Response> {
        try {
            const { sql, params } = await request.json() as QueryRequest;

            // Validate that the request body contains the necessary fields in the correct format
            if (typeof sql !== 'string') {
                return new Response('Invalid "sql" field.', { status: 400 });
            } else if (params !== undefined && !Array.isArray(params)) {
                return new Response('Invalid "params" field.', { status: 400 });
            }

            const result = await this.executeQuery(sql, params);
            return new Response(JSON.stringify(result), {
                headers: { 'Content-Type': 'application/json' },
            });
        } catch (error) {
            return new Response(JSON.stringify({ error }), { status: 500 });
        }
    }

    async statusRoute(_: Request): Promise<Response> {
        return new Response(JSON.stringify({ 
            status: 'reachable',
            timestamp: Date.now(),
            // availableDisk: await this.sql.getAvailableDisk(),
            usedDisk: await this.sql.databaseSize,
        }));
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === 'POST' && url.pathname === '/query') {
            return this.queryRoute(request);
        } else if (request.method === 'GET' && url.pathname === '/status') {
            return this.statusRoute(request);
        } else {
            return new Response("Unknown operation", { status: 400 });
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
        if (request.headers.get('Authorization') !== AUTHORIZATION) {
            return new Response('Unauthorized', { status: 401 });
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
