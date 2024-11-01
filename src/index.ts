import handleStudioRequest from "./studio";
import { createResponse } from "./utils";

// We need to export the DO here so that it can be used in the wrangler.toml file if 
// someone is directly deploying Starbase from the repository.
export { StarbaseDurableObject } from "./starbase";

const DURABLE_OBJECT_ID = "sql-durable-object";

export default {
  /**
   * This is the standard fetch handler for a Cloudflare Worker
   *
   * @param request - The request submitted to the Worker from the client
   * @param env - The interface to reference bindings declared in wrangler.toml
   * @param ctx - The execution context of the Worker
   * @returns The response to be sent back to the client
   */
  async fetch(request, env, _ctx): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const isWebSocket = request.headers.get("Upgrade") === "websocket";

    /**
     * If the request is a GET request to the /studio endpoint, we can handle the request
     * directly in the Worker to avoid the need to deploy a separate Worker for the Studio.
     * Studio provides a user interface to interact with the SQLite database in the Durable
     * Object.
     */
    if (
      env.STUDIO_USER &&
      env.STUDIO_PASS &&
      request.method === "GET" &&
      pathname === "/studio"
    ) {
      return handleStudioRequest(request, {
        username: env.STUDIO_USER,
        password: env.STUDIO_PASS,
        apiToken: env.AUTHORIZATION_TOKEN,
      });
    }

    /**
     * Prior to proceeding to the Durable Object, we can perform any necessary validation or
     * authorization checks here to ensure the request signature is valid and authorized to
     * interact with the Durable Object.
     */
    if (
      request.headers.get("Authorization") !==
        `Bearer ${env.AUTHORIZATION_TOKEN}` &&
      !isWebSocket
    ) {
      return createResponse(undefined, "Unauthorized request", 401);
    } else if (isWebSocket) {
      /**
       * Web socket connections cannot pass in an Authorization header into their requests,
       * so we can use a query parameter to validate the connection.
       */
      const url = new URL(request.url);
      const token = url.searchParams.get("token");

      if (token !== env.AUTHORIZATION_TOKEN) {
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
    let id: DurableObjectId =
      env.STARBASE_DURABLE_OBJECT.idFromName(DURABLE_OBJECT_ID);
    let stub = env.STARBASE_DURABLE_OBJECT.get(id);

    // ## DO NOT REMOVE: TEMPLATE ROUTING ##

    /**
     * Pass the fetch request directly to the Durable Object, which will handle the request
     * and return a response to be sent back to the client.
     */
    return await stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
