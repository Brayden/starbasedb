import { WorkerEntrypoint } from "cloudflare:workers";
import { login as emailLogin, signup as emailSignup } from "./email";
import { createResponse } from "./utils";

const DURABLE_OBJECT_ID = 'sql-durable-object';

export default class AuthEntrypoint extends WorkerEntrypoint {
    private stub: any;

    // Currently, entrypoints without a named handler are not supported
    async fetch() { return new Response(null, {status: 404}); }

    /**
     * Sets up the auth tables if they don't exist
     * @returns 
     */
    async setupAuthTables() {
        const createUserTableQuery = `
            CREATE TABLE IF NOT EXISTS auth_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT NOT NULL,
                email TEXT UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted_at TIMESTAMP DEFAULT NULL,
                email_confirmed_at TIMESTAMP DEFAULT NULL,
                CHECK ((username IS NOT NULL AND email IS NULL) OR (username IS NULL AND email IS NOT NULL) OR (username IS NOT NULL AND email IS NOT NULL))
            );
        `;

        const createSessionTableQuery = `
            CREATE TABLE IF NOT EXISTS auth_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                session_token TEXT NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted_at TIMESTAMP DEFAULT NULL,
                FOREIGN KEY (user_id) REFERENCES auth_users (id)
            );
        `;

        // Make a request to the binded database
        let response = await this.stub.executeExternalQuery(`${createUserTableQuery} ${createSessionTableQuery}`, []);
        return response;
    }

    /**
     * Handles the auth requests, forwards to the appropriate handler
     * @param pathname 
     * @param verb 
     * @param body 
     * @returns 
     */
    async handleAuth(pathname: string, verb: string, body: any) {
        console.log('Handling Auth in Service Binding: ', body)

        let id: DurableObjectId = this.env.DATABASE_DURABLE_OBJECT.idFromName(DURABLE_OBJECT_ID);
		this.stub = this.env.DATABASE_DURABLE_OBJECT.get(id);

        await this.setupAuthTables();

        if (verb === "POST" && pathname === "/auth/signup") {
            return emailSignup(this.stub, this.env, body);
        } else if (verb === "POST" && pathname === "/auth/login") {
            return emailLogin(this.stub, body);
        }

        return new Response(null, {status: 405});
    }

    /**
     * Handles logging out a user by invalidating all sessions for the user
     * @param request 
     * @param body 
     * @returns 
     */
    async handleLogout(request: Request, body: any) {
        await this.stub.executeExternalQuery(`UPDATE auth_sessions SET deleted_at = CURRENT_TIMESTAMP WHERE user_id = ?`, [body.user_id]);
        return createResponse(JSON.stringify({
            success: true,
        }), undefined, 200);
    }
}
