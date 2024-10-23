CREATE TABLE IF NOT EXISTS auth_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT COLLATE NOCASE,
    password TEXT NOT NULL,
    email TEXT COLLATE NOCASE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP DEFAULT NULL,
    email_confirmed_at TIMESTAMP DEFAULT NULL,
    UNIQUE(username),
    UNIQUE(email),
    CHECK ((username IS NOT NULL AND email IS NULL) OR (username IS NULL AND email IS NOT NULL) OR (username IS NOT NULL AND email IS NOT NULL))
);

CREATE TRIGGER IF NOT EXISTS prevent_username_email_overlap 
BEFORE INSERT ON auth_users
BEGIN
    SELECT CASE 
        WHEN EXISTS (
            SELECT 1 FROM auth_users 
            WHERE (NEW.username IS NOT NULL AND (NEW.username = username OR NEW.username = email))
               OR (NEW.email IS NOT NULL AND (NEW.email = username OR NEW.email = email))
        )
    THEN RAISE(ABORT, 'Username or email already exists')
    END;
END;

CREATE TABLE IF NOT EXISTS auth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES auth_users (id)
);
