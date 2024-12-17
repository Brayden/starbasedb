import { createResponse } from "./utils";
import { StarbaseDB, StarbaseDBConfiguration } from "./handler";
import { DataSource, RegionLocationHint } from "./types";
import { createRemoteJWKSet, jwtVerify } from "jose";

export { StarbaseDBDurableObject } from "./do";

const DURABLE_OBJECT_ID = "sql-durable-object";

export interface Env {
  ADMIN_AUTHORIZATION_TOKEN: string;
  CLIENT_AUTHORIZATION_TOKEN: string;
  DATABASE_DURABLE_OBJECT: DurableObjectNamespace<
    import("./do").StarbaseDBDurableObject
  >;
  REGION: string;

  // Studio credentials
  STUDIO_USER?: string;
  STUDIO_PASS?: string;

  ENABLE_ALLOWLIST?: boolean;
  ENABLE_RLS?: boolean;

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

  AUTH_ALGORITHM?: string;
  AUTH_JWT_SECRET?: string;
  AUTH_JWKS_ENDPOINT?: string;

  // ## DO NOT REMOVE: TEMPLATE INTERFACE ##
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
      const isWebSocket = request.headers.get("Upgrade") === "websocket";
      let jwtPayload;

      /**
       * Prior to proceeding to the Durable Object, we can perform any necessary validation or
       * authorization checks here to ensure the request signature is valid and authorized to
       * interact with the Durable Object.
       */
      if (!isWebSocket) {
        const authorizationValue = request.headers.get("Authorization");

        // The `AUTHORIZATION_TOKEN` is like an admin path of automatically authorizing the
        // incoming request as verified. If this does not match then we next want to check
        // if the `Authorization` header contains a JWT session token we can verify before
        // allowing the user to proceed to our request handler.
        if (
          authorizationValue !== `Bearer ${env.ADMIN_AUTHORIZATION_TOKEN}` &&
          authorizationValue !== `Bearer ${env.CLIENT_AUTHORIZATION_TOKEN}`
        ) {
          const authorizationWithoutBearer = authorizationValue?.replace(
            "Bearer ",
            ""
          );

          // If the above case failed (no admin or client token) and you're not using JWT authentication
          // then we will just fail overall. Some form of Authorization is required to proceed.
          if (
            (!env.AUTH_JWT_SECRET && !env.AUTH_JWKS_ENDPOINT) ||
            authorizationWithoutBearer === undefined
          ) {
            return createResponse(undefined, "Unauthorized request", 400);
          }

          if (env.AUTH_JWKS_ENDPOINT && env?.AUTH_ALGORITHM) {
            try {
              const JWKS = createRemoteJWKSet(new URL(env.AUTH_JWKS_ENDPOINT));
              const { payload } = await jwtVerify(
                authorizationWithoutBearer,
                JWKS,
                {
                  algorithms: [env?.AUTH_ALGORITHM],
                }
              );

              if (!payload.sub) {
                return createResponse(undefined, "Unauthorized request", 401);
              } else {
                jwtPayload = payload;
              }
            } catch (error: any) {
              console.error("JWT Verification failed: ", error.message);
              throw new Error("JWT verification failed");
            }
          }
        }
      } else if (isWebSocket) {
        /**
         * Web socket connections cannot pass in an Authorization header into their requests,
         * so we can use a query parameter to validate the connection.
         */
        const token = url.searchParams.get("token");

        if (
          token !== env.ADMIN_AUTHORIZATION_TOKEN &&
          token !== env.CLIENT_AUTHORIZATION_TOKEN
        ) {
          return new Response(
            "WebSocket connections are not supported at this endpoint.",
            { status: 440 }
          );
        }
      }

      /**
       * Retrieve the Durable Object identifier from the environment bindings and instantiate a
       * Durable Object stub to interact with the Durable Object.
       */
      const region = env.REGION ?? RegionLocationHint.AUTO;
      const id: DurableObjectId =
        env.DATABASE_DURABLE_OBJECT.idFromName(DURABLE_OBJECT_ID);
      const stub =
        region !== RegionLocationHint.AUTO
          ? env.DATABASE_DURABLE_OBJECT.get(id, {
              locationHint: region as DurableObjectLocationHint,
            })
          : env.DATABASE_DURABLE_OBJECT.get(id);

      // Create a new RPC Session on the Durable Object.
      using rpc = await stub.init();

      // Get the source type from headers/query params.
      const source = request.headers.get("X-Starbase-Source") || url.searchParams.get("source");

      const dataSource: DataSource = {
        rpc,
        source: source ? source.toLowerCase().trim() === "external" ? "external" : "internal" : "internal",
        cache: request.headers.get("X-Starbase-Cache") === "true",
        context: {
          ...jwtPayload,
        },
      };

      if (env.EXTERNAL_DB_TYPE === "postgres" || env.EXTERNAL_DB_TYPE === "mysql") {
        dataSource.external = {
          dialect: env.EXTERNAL_DB_TYPE,
          host: env.EXTERNAL_DB_HOST!,
          port: env.EXTERNAL_DB_PORT!,
          user: env.EXTERNAL_DB_USER!,
          password: env.EXTERNAL_DB_PASS!,
          database: env.EXTERNAL_DB_DATABASE!,
          defaultSchema: env.EXTERNAL_DB_DEFAULT_SCHEMA,
        };
      }

      if (env.EXTERNAL_DB_TYPE === "sqlite") {
        if (env.EXTERNAL_DB_CLOUDFLARE_API_KEY) {
          dataSource.external = {
            dialect: "sqlite",
            provider: "cloudflare-d1",
            apiKey: env.EXTERNAL_DB_CLOUDFLARE_API_KEY,
            accountId: env.EXTERNAL_DB_CLOUDFLARE_ACCOUNT_ID!,
            databaseId: env.EXTERNAL_DB_CLOUDFLARE_DATABASE_ID!,
          }
        }

        if (env.EXTERNAL_DB_STARBASEDB_URI) {
          dataSource.external = {
            dialect: "sqlite",
            provider: "starbase",
            apiKey: env.EXTERNAL_DB_STARBASEDB_URI,
            token: env.EXTERNAL_DB_STARBASEDB_TOKEN!,
            defaultSchema: env.EXTERNAL_DB_DEFAULT_SCHEMA,
          }
        }

        if (env.EXTERNAL_DB_TURSO_URI) {
          dataSource.external = {
            dialect: "sqlite",
            provider: "turso",
            uri: env.EXTERNAL_DB_TURSO_URI,
            token: env.EXTERNAL_DB_TURSO_TOKEN!,
            defaultSchema: env.EXTERNAL_DB_DEFAULT_SCHEMA,
          }
        }
      }

      const config: StarbaseDBConfiguration = {
        outerbaseApiKey: env.OUTERBASE_API_KEY,
        role: 'admin',
        features: {
          allowlist: env.ENABLE_ALLOWLIST,
          rls: env.ENABLE_RLS,
          studio: false,
        },
      };

      if (env.STUDIO_USER && env.STUDIO_PASS) {
        config.features!.studio = true;
        config.studio = {
          username: env.STUDIO_USER,
          password: env.STUDIO_PASS,
        };
      }

      // Return the final response to our user
      return await new StarbaseDB({
        dataSource,
        config,
      }).handle(request, ctx);
    } catch (error) {
      // Return error response to client
      return createResponse(
        undefined,
        error instanceof Error ? error.message : "An unexpected error occurred",
        400
      );
    }
  },
} satisfies ExportedHandler<Env>;
