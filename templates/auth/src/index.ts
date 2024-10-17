import { WorkerEntrypoint } from "cloudflare:workers";
import { createResponse } from "./utils";

const DURABLE_OBJECT_ID = 'sql-durable-object';

export default class AuthEntrypoint extends WorkerEntrypoint {
    private stub: any;

    // Currently, entrypoints without a named handler are not supported
    async fetch() { return new Response(null, {status: 404}); }

    // TEMPORARY: Setup auth tables via a shell script instead of in here.
    async setupAuthTables() {
        const createUserTableQuery = `
            CREATE TABLE IF NOT EXISTS auth_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT NOT NULL,
                email TEXT UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted_at TIMESTAMP DEFAULT NULL,
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

    async handleAuth(pathname: string, verb: string, body: any) {
        console.log('Handling Auth in Service Binding: ', body)

        let id: DurableObjectId = this.env.DATABASE_DURABLE_OBJECT.idFromName(DURABLE_OBJECT_ID);
		this.stub = this.env.DATABASE_DURABLE_OBJECT.get(id);

        await this.setupAuthTables();

        if (verb === "POST" && pathname === "/auth/signup") {
            return this.handleSignup(body);
        } 

        return new Response(null, {status: 405});
    }

    verifyPassword(password: string): boolean {
        if (password.length < this.env.PASSWORD_REQUIRE_LENGTH) {
            return false;
        }

        if (this.env.PASSWORD_REQUIRE_UPPERCASE && !/[A-Z]/.test(password)) {
            return false;
        }

        if (this.env.PASSWORD_REQUIRE_LOWERCASE && !/[a-z]/.test(password)) {
            return false;
        }

        if (this.env.PASSWORD_REQUIRE_NUMBER && !/[0-9]/.test(password)) {
            return false;
        }

        if (this.env.PASSWORD_REQUIRE_SPECIAL && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
            return false;
        }

        return true;
    }

    async encryptPassword(password: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return btoa(String.fromCharCode(...new Uint8Array(hash)));
    }

    async decryptPassword(encryptedPassword: string): Promise<string> {
        const decoder = new TextDecoder();
        const data = new Uint8Array(atob(encryptedPassword).split('').map(c => c.charCodeAt(0)));
        const hash = await crypto.subtle.digest('SHA-256', data);
        return decoder.decode(hash);
    }

    async handleSignup(body: any) {
        console.log("Handling Signup: ", body);

        // Check if the email and password are provided
        // Only email or username is required, not both
        if ((!body.email && !body.username) || !body.password) {
            return new Response(JSON.stringify({error: "Missing required fields"}), {status: 400});
        }

        const isValidPassword = this.verifyPassword(body.password);
        console.log("Password is valid: ", isValidPassword);
        if (!isValidPassword) {
            const errorMessage = `Password must be at least ${this.env.PASSWORD_REQUIRE_LENGTH} characters, ` +
                `contain at least one uppercase letter, ` +
                `one lowercase letter, ` +
                `one number, and ` +
                `one special character`;
            return createResponse(undefined, errorMessage, 400);
        }

        // // Check to see if the username or email already exists
        let verifyUserResponse = await this.stub.executeExternalQuery(`SELECT * FROM auth_users WHERE username = ? OR email = ?`, [body.username, body.email]);
        console.log("Verify User Response: ", JSON.stringify(verifyUserResponse));
        if (verifyUserResponse.result.length > 0) {
            return new Response(JSON.stringify({error: "Username or email already exists"}), {status: 400});
        }

        // // Create the user
        const encryptedPassword = await this.encryptPassword(body.password);
        console.log("Encrypted Password: ", encryptedPassword);
        let createUserResponse = await this.stub.executeExternalQuery(
          `INSERT INTO auth_users (username, password, email) 
           VALUES (?, ?, ?) 
           RETURNING id, username, email`,
          [body.username, encryptedPassword, body.email]
        );
        console.log("Create User Response: ", JSON.stringify(createUserResponse));
        if (createUserResponse.result.length === 0) {
            return new Response(JSON.stringify({error: "Failed to create user"}), {status: 500});
        }

        // // Create a session for the user
        const sessionToken = crypto.randomUUID();
        let createSessionResponse = await this.stub.executeExternalQuery(
          `INSERT INTO auth_sessions (user_id, session_token) 
           VALUES (?, ?) 
           RETURNING id, user_id, session_token, created_at`,
          [createUserResponse.result[0].id, sessionToken]
        );
        console.log("Create Session Response: ", JSON.stringify(createSessionResponse));
        if (createSessionResponse.result.length === 0) {
            return new Response(JSON.stringify({error: "Failed to create session"}), {status: 500});
        }

        // Make a request to the binded database
        let response = await this.stub.executeExternalQuery('SELECT * FROM auth_users', []);
        return new Response(JSON.stringify({
            allUsers: response,
            newUser: createUserResponse.result[0],
            newSession: createSessionResponse.result[0]
        }), {status: 200, headers: {'Content-Type': 'application/json'}});
    }

    async handleVerifyEmail(request: Request) {
        return new Response(`${request.json()}`, {status: 200});
    }

    async handleResendEmail(request: Request) {
        return new Response(`${request.json()}`, {status: 200});
    }

    async handleForgotPassword(request: Request) {
        return new Response(`${request.json()}`, {status: 200});
    }

    async handleResetPassword(request: Request) {
        return new Response(`${request.json()}`, {status: 200});
    }

    async handleLogin(request: Request) {
        return new Response(`${request.json()}`, {status: 200});
    }

    async handleLogout(request: Request) {
        return new Response(`${request.json()}`, {status: 200});
    }
}
