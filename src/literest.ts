import { DurableObjectState } from "@cloudflare/workers-types";
import { createResponse } from './utils';

export class LiteREST {
    private sql: any;

    constructor(private state: DurableObjectState) {
        this.sql = state.storage.sql;
    }

    private sanitizeIdentifier(identifier: string): string {
        return identifier.replace(/[^a-zA-Z0-9_]/g, '');
    }

    async handleRequest(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const pathParts = url.pathname.split('/').filter(Boolean);

        if (pathParts.length === 0) {
            return createResponse(undefined, 'Invalid route', 400);
        }

        const tableName = this.sanitizeIdentifier(pathParts[0]);
        const id = pathParts[1];

        try {
            switch (request.method) {
                case 'GET':
                    return this.handleGet(tableName, id, url.searchParams);
                case 'POST':
                    return this.handlePost(tableName, await request.json());
                case 'PATCH':
                    return this.handlePatch(tableName, id, await request.json());
                case 'DELETE':
                    return this.handleDelete(tableName, id);
                default:
                    return createResponse(undefined, 'Method not allowed', 405);
            }
        } catch (error: any) {
            console.error('LiteREST Error:', error);
            return createResponse(undefined, error.message || 'An unexpected error occurred', 500);
        }
    }

    private handleGet(tableName: string, id: string | undefined, searchParams: URLSearchParams): Response {
        let query = `SELECT * FROM ${tableName}`;
        const params: any[] = [];
        const conditions: string[] = [];

        if (id) {
            conditions.push(`id = ?`);
            params.push(id);
        } else {
            for (const [key, value] of searchParams.entries()) {
                const sanitizedKey = this.sanitizeIdentifier(key);
                conditions.push(`${sanitizedKey} = ?`);
                params.push(value);
            }
        }

        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }

        console.log('Executing GET SQL Query:', query, 'with params:', params);

        try {
            const cursor = this.sql.exec(query, ...params);
            const resultArray = cursor.toArray();
            console.log('GET SQL Result:', resultArray);
            return createResponse(resultArray, undefined, 200);
        } catch (error) {
            console.error('GET Operation Error:', error);
            return createResponse(undefined, error.message || 'Failed to retrieve data', 500);
        }
    }

    private handlePost(tableName: string, data: any): Response {
        if (!this.isDataValid(data)) {
            console.error('Invalid data format for POST:', data);
            return createResponse(undefined, 'Invalid data format', 400);
        }

        const dataKeys = Object.keys(data);
        if (dataKeys.length === 0) {
            console.error('No data provided for POST');
            return createResponse(undefined, 'No data provided', 400);
        }

        // Sanitize column names
        const columns = dataKeys.map(col => this.sanitizeIdentifier(col));
        const placeholders = columns.map(() => '?').join(', ');
        const query = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;

        // Map parameters using original data keys to get correct values
        const params = dataKeys.map(key => data[key]);

        console.log('Executing POST SQL Query:', query, 'with params:', params);

        try {
            this.sql.exec(query, ...params);
            console.log('POST Operation Success - Inserted Data:', data);
            return createResponse({ message: 'Resource created successfully', data }, undefined, 201);
        } catch (error) {
            console.error('POST Operation Error:', error);
            return createResponse(undefined, error.message || 'Failed to create resource', 500);
        }
    }

    private handlePatch(tableName: string, id: string | undefined, data: any): Response {
        if (!id) {
            console.error('Missing resource identifier for PATCH');
            return createResponse(undefined, 'Missing resource identifier', 400);
        }

        if (!this.isDataValid(data)) {
            console.error('Invalid data format for PATCH:', data);
            return createResponse(undefined, 'Invalid data format', 400);
        }

        const dataKeys = Object.keys(data);
        if (dataKeys.length === 0) {
            console.error('No data provided for PATCH');
            return createResponse(undefined, 'No data provided', 400);
        }

        // Sanitize column names
        const columns = dataKeys.map(col => this.sanitizeIdentifier(col));
        const setClause = columns.map(col => `${col} = ?`).join(', ');
        const query = `UPDATE ${tableName} SET ${setClause} WHERE id = ?`;

        // Map parameters using original data keys to get correct values
        const params = dataKeys.map(key => data[key]);
        params.push(id);

        console.log('Executing PATCH SQL Query:', query, 'with params:', params);

        try {
            this.sql.exec(query, ...params);
            console.log('PATCH Operation Success - Updated Data:', data);
            return createResponse({ message: 'Resource updated successfully', data }, undefined, 200);
        } catch (error) {
            console.error('PATCH Operation Error:', error);
            return createResponse(undefined, error.message || 'Failed to update resource', 500);
        }
    }

    private handleDelete(tableName: string, id: string | undefined): Response {
        if (!id) {
            console.error('Missing resource identifier for DELETE');
            return createResponse(undefined, 'Missing resource identifier', 400);
        }

        const query = `DELETE FROM ${tableName} WHERE id = ?`;

        console.log('Executing DELETE SQL Query:', query, 'with params:', [id]);

        try {
            this.sql.exec(query, id);
            console.log('DELETE Operation Success - Deleted ID:', id);
            return createResponse({ message: 'Resource deleted successfully', id }, undefined, 200);
        } catch (error) {
            console.error('DELETE Operation Error:', error);
            return createResponse(undefined, error.message || 'Failed to delete resource', 500);
        }
    }

    private isDataValid(data: any): boolean {
        return data && typeof data === 'object' && !Array.isArray(data);
    }
}
