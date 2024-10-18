import { createResponse, encryptPassword, verifyPassword } from "../utils";

export async function signup(stub: any, env: any, body: any) {
    if ((!body.email && !body.username) || !body.password) {
        return new Response(JSON.stringify({error: "Missing required fields"}), {status: 400, headers: {'Content-Type': 'application/json'}});
    }

    const isValidPassword = verifyPassword(env, body.password);
    if (!isValidPassword) {
        const errorMessage = `Password must be at least ${env.PASSWORD_REQUIRE_LENGTH} characters, ` +
            `contain at least one uppercase letter, ` +
            `one lowercase letter, ` +
            `one number, and ` +
            `one special character`;
        return createResponse(undefined, errorMessage, 400);
    }

    // Check to see if the username or email already exists
    let verifyUserResponse = await stub.executeExternalQuery(`SELECT * FROM auth_users WHERE username = ? OR email = ?`, [body.username, body.email]);
    if (verifyUserResponse.result.length > 0) {
        return createResponse(undefined, "Username or email already exists", 400);
    }

    // Create the user
    const encryptedPassword = await encryptPassword(body.password);
    let createUserResponse = await stub.executeExternalQuery(
      `INSERT INTO auth_users (username, password, email) 
       VALUES (?, ?, ?) 
       RETURNING id, username, email`,
      [body.username, encryptedPassword, body.email]
    );
    if (createUserResponse.result.length === 0) {
        return createResponse(undefined, "Failed to create user", 500);
    }

    // Create a session for the user
    const sessionToken = crypto.randomUUID();
    let createSessionResponse = await stub.executeExternalQuery(
      `INSERT INTO auth_sessions (user_id, session_token) 
       VALUES (?, ?) 
       RETURNING user_id, session_token, created_at`,
      [createUserResponse.result[0].id, sessionToken]
    );
    if (createSessionResponse.result.length === 0) {
        return createResponse(undefined, "Failed to create session", 500);
    }

    return createResponse(createSessionResponse.result[0], undefined, 200);
}

export async function login(stub: any, body: any) {
    if ((!body.email && !body.username) || !body.password) {
        return createResponse(undefined, "Missing required fields", 400);
    }

    const encryptedPassword = await encryptPassword(body.password);
    let verifyUserResponse = await stub.executeExternalQuery(`SELECT * FROM auth_users WHERE (username = ? OR email = ?) AND password = ?`, [body.username, body.email, encryptedPassword]);
    if (verifyUserResponse.result.length === 0) {
        return createResponse(undefined, "User not found", 404);
    }

    const user = verifyUserResponse.result[0];

    // Create a session for the user
    const sessionToken = crypto.randomUUID();
    let createSessionResponse = await stub.executeExternalQuery(
      `INSERT INTO auth_sessions (user_id, session_token) 
       VALUES (?, ?) 
       RETURNING user_id, session_token, created_at`,
      [user.id, sessionToken]
    );

    if (createSessionResponse.result.length === 0) {
        return createResponse(undefined, "Failed to create session", 500);
    }

    return createResponse(createSessionResponse.result[0], undefined, 200);
}
