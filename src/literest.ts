import { DurableObjectState } from "@cloudflare/workers-types";
import { createResponse } from './utils';
import { enqueueOperation, OperationQueueItem, processNextOperation } from './operation';

export class LiteREST {
    private sql: SqlStorage;
    private operationQueue: Array<OperationQueueItem>;
    private processingOperation: { value: boolean };
    private state: DurableObjectState;

    constructor(
        state: DurableObjectState,
        operationQueue: Array<OperationQueueItem>,
        processingOperation: { value: boolean },
        sql: any
    ) {
        this.state = state;
        this.sql = sql;
        this.operationQueue = operationQueue;
        this.processingOperation = processingOperation;
    }

    /**
     * Sanitizes an identifier by removing all non-alphanumeric characters except underscores.
     * @param identifier - The identifier to sanitize.
     * @returns The sanitized identifier.
     */
    private sanitizeIdentifier(identifier: string): string {
        return identifier.replace(/[^a-zA-Z0-9_]/g, '');
    }

    /**
     * Retrieves the primary key columns for a given table.
     * @param tableName - The name of the table.
     * @returns An array of primary key column names.
     */
    private getPrimaryKeyColumns(tableName: string): string[] {
        const cursor = this.sql.exec(`PRAGMA table_info(${tableName});`);
        const schemaInfo = cursor.toArray();
        const pkColumns = schemaInfo
            .filter(col => typeof col.pk === 'number' && col.pk > 0 && col.name !== null)
            .map(col => col.name as string);
        return pkColumns;
    }

    /**
     * Checks if the provided data is valid.
     * @param data - The data to validate.
     * @returns True if the data is valid, false otherwise.
     */
    private isDataValid(data: any): boolean {
        return data && typeof data === 'object' && !Array.isArray(data);
    }

    /**
     * Sanitizes an operator by mapping it to a valid SQL operator.
     * @param operator - The operator to sanitize.
     * @returns The sanitized operator.
     */
    private sanitizeOperator(operator: string | undefined): string {
        const allowedOperators: { [key: string]: string } = {
            'eq': '=',
            'ne': '!=',
            'gt': '>',
            'lt': '<',
            'gte': '>=',
            'lte': '<=',
            'like': 'LIKE',
            'in': 'IN'
        };
        return allowedOperators[operator || 'eq'] || '=';
    }

    /**
     * Retrieves the primary key conditions for a given table.
     * @param pkColumns - The primary key columns for the table.
     * @param id - The identifier for the record.
     * @param data - The data to use for primary key conditions.
     * @param searchParams - The search parameters.
     * @returns An object containing the conditions, parameters, and any error message.
     */
    private getPrimaryKeyConditions(pkColumns: string[], id: string | undefined, data: any, searchParams: URLSearchParams): { conditions: string[], params: any[], error?: string } {
        const conditions: string[] = [];
        const params: any[] = [];

        if (pkColumns.length === 1) {
            const pk = pkColumns[0];
            const pkValue = id || data[pk] || searchParams.get(pk);
            if (!pkValue) {
                return { conditions, params, error: `Missing primary key value for '${pk}'` };
            }
            conditions.push(`${pk} = ?`);
            params.push(pkValue);
        } else {
            // Composite primary key
            for (const pk of pkColumns) {
                const pkValue = data[pk] || searchParams.get(pk);
                if (!pkValue) {
                    return { conditions, params, error: `Missing primary key value for '${pk}'` };
                }
                conditions.push(`${pk} = ?`);
                params.push(pkValue);
            }
        }

        return { conditions, params };
    }

    /**
     * Executes a set of operations.
     * @param queries - The operations to execute.
     */
    private async executeOperation(queries: { sql: string, params: any[] }[]): Promise<{ result?: any, error?: string | undefined, status: number }> {
        return await enqueueOperation(
            queries,
            false,
            false,
            this.operationQueue,
            () => processNextOperation(this.sql, this.operationQueue, this.state, this.processingOperation)
        );
    }

    async handleRequest(request: Request): Promise<Response> {
        const { method, tableName, id, searchParams, body } = await this.parseRequest(request);

        try {
            switch (method) {
                case 'GET':
                    return await this.handleGet(tableName, id, searchParams);
                case 'POST':
                    return await this.handlePost(tableName, body);
                case 'PATCH':
                    return await this.handlePatch(tableName, id, body);
                case 'PUT':
                    return await this.handlePut(tableName, id, body);
                case 'DELETE':
                    return await this.handleDelete(tableName, id);
                default:
                    return createResponse(undefined, 'Method not allowed', 405);
            }
        } catch (error: any) {
            console.error('LiteREST Error:', error);
            return createResponse(undefined, error.message || 'An unexpected error occurred', 500);
        }
    }

    private async parseRequest(request: Request): Promise<{ method: string, tableName: string, id?: string, searchParams: URLSearchParams, body?: any }> {
        const liteRequest = new Request(request.url.replace('/lite', ''), request);
        const url = new URL(liteRequest.url);
        const pathParts = url.pathname.split('/').filter(Boolean);

        if (pathParts.length === 0) {
            throw new Error('Invalid route');
        }

        const tableName = this.sanitizeIdentifier(pathParts[0]);
        const id = pathParts[1];
        const body = ['POST', 'PUT', 'PATCH'].includes(liteRequest.method) ? await liteRequest.json() : undefined;

        return {
            method: liteRequest.method,
            tableName,
            id,
            searchParams: url.searchParams,
            body
        };
    }

    private buildSelectQuery(tableName: string, id: string | undefined, searchParams: URLSearchParams): { query: string, params: any[] } {
        let query = `SELECT * FROM ${tableName}`;
        const params: any[] = [];
        const conditions: string[] = [];
        const pkColumns = this.getPrimaryKeyColumns(tableName);
        const { conditions: pkConditions, params: pkParams, error } = this.getPrimaryKeyConditions(pkColumns, id, {}, searchParams);
    
        if (!error) {
            conditions.push(...pkConditions);
            params.push(...pkParams);
        }
    
        // Extract special parameters
        const sortBy = searchParams.get('sort_by');
        const orderParam = searchParams.get('order');
        const limitParam = searchParams.get('limit');
        const offsetParam = searchParams.get('offset');
    
        // Remove special parameters from searchParams
        ['sort_by', 'order', 'limit', 'offset'].forEach(param => searchParams.delete(param));
    
        // Handle other search parameters
        for (const [key, value] of searchParams.entries()) {
            if (pkColumns.includes(key)) continue; // Skip primary key columns
            const [column, op] = key.split('.');
            const sanitizedColumn = this.sanitizeIdentifier(column);
            const operator = this.sanitizeOperator(op);
    
            if (operator === 'IN') {
                const values = value.split(',').map(val => val.trim());
                const placeholders = values.map(() => '?').join(', ');
                conditions.push(`${sanitizedColumn} IN (${placeholders})`);
                params.push(...values);
            } else {
                conditions.push(`${sanitizedColumn} ${operator} ?`);
                params.push(value);
            }
        }
    
        // Add WHERE clause if there are conditions
        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }
    
        // Add ORDER BY clause
        if (sortBy) {
            const sanitizedSortBy = this.sanitizeIdentifier(sortBy);
            const order = orderParam?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
            query += ` ORDER BY ${sanitizedSortBy} ${order}`;
        }
    
        // Add LIMIT and OFFSET clauses
        if (limitParam) {
            const limit = parseInt(limitParam, 10);
            if (limit > 0) {
                query += ` LIMIT ?`;
                params.push(limit);
    
                if (offsetParam) {
                    const offset = parseInt(offsetParam, 10);
                    if (offset > 0) {
                        query += ` OFFSET ?`;
                        params.push(offset);
                    }
                }
            }
        }
    
        return { query, params };
    }

    private async handleGet(tableName: string, id: string | undefined, searchParams: URLSearchParams): Promise<Response> {
        const { query, params } = this.buildSelectQuery(tableName, id, searchParams);
        console.log('Executing GET SQL Query:', query, 'with params:', params);

        try {
            const response = await this.executeOperation([{ sql: query, params }]);
            const resultArray = response.result;
            console.log('GET SQL Result:', resultArray);
            return createResponse(resultArray, undefined, 200);
        } catch (error: any) {
            console.error('GET Operation Error:', error);
            return createResponse(undefined, error.message || 'Failed to retrieve data', 500);
        }
    }

    // private async handleGet(tableName: string, id: string | undefined, searchParams: URLSearchParams): Promise<Response> {
    //     let query = `SELECT * FROM ${tableName}`;
    //     const params: any[] = [];
    //     const conditions: string[] = [];
    //     const pkColumns = this.getPrimaryKeyColumns(tableName);
    //     const { conditions: pkConditions, params: pkParams, error } = this.getPrimaryKeyConditions(pkColumns, id, {}, searchParams);
    
    //     if (error && id) {
    //         return createResponse(undefined, error, 400);
    //     } else if (!error) {
    //         conditions.push(...pkConditions);
    //         params.push(...pkParams);
    //     }
    
    //     // Extract special parameters and remove them from searchParams
    //     const sortBy = searchParams.get('sort_by');
    //     if (sortBy) {
    //         searchParams.delete('sort_by');
    //     }
    
    //     const orderParam = searchParams.get('order');
    //     let order = 'ASC';
    //     if (orderParam) {
    //         order = orderParam.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    //         searchParams.delete('order');
    //     }
    
    //     const limitParam = searchParams.get('limit');
    //     let limit = 0;
    //     if (limitParam) {
    //         limit = parseInt(limitParam, 10);
    //         searchParams.delete('limit');
    //     }
    
    //     const offsetParam = searchParams.get('offset');
    //     let offset = 0;
    //     if (offsetParam) {
    //         offset = parseInt(offsetParam, 10);
    //         searchParams.delete('offset');
    //     }
    
    //     // Handle other search parameters
    //     for (const [key, value] of searchParams.entries()) {
    //         if (pkColumns.includes(key)) continue; // Skip primary key columns
    //         const [column, op] = key.split('.');
    //         const sanitizedColumn = this.sanitizeIdentifier(column);
    //         const operator = this.sanitizeOperator(op);
    
    //         if (operator === 'IN') {
    //             const values = value.split(',').map(val => val.trim());
    //             const placeholders = values.map(() => '?').join(', ');
    //             conditions.push(`${sanitizedColumn} IN (${placeholders})`);
    //             params.push(...values);
    //         } else {
    //             conditions.push(`${sanitizedColumn} ${operator} ?`);
    //             params.push(value);
    //         }
    //     }
    
    //     if (conditions.length > 0) {
    //         query += ` WHERE ${conditions.join(' AND ')}`;
    //     }
    
    //     // Sorting
    //     if (sortBy) {
    //         const sanitizedSortBy = this.sanitizeIdentifier(sortBy);
    //         query += ` ORDER BY ${sanitizedSortBy} ${order}`;
    //     }
    
    //     // Pagination
    //     if (limit > 0) {
    //         query += ` LIMIT ?`;
    //         params.push(limit);
    //         if (offset > 0) {
    //             query += ` OFFSET ?`;
    //             params.push(offset);
    //         }
    //     }
    
    //     console.log('Executing GET SQL Query:', query, 'with params:', params);
    
    //     try {
    //         const response = await this.executeOperation([{ sql: query, params }]);
    //         const resultArray = response.result;
    //         // const cursor = this.sql.exec(query, ...params);
    //         // const resultArray = cursor.toArray();
    //         console.log('GET SQL Result:', resultArray);
    //         return createResponse(resultArray, undefined, 200);
    //     } catch (error: any) {
    //         console.error('GET Operation Error:', error);
    //         return createResponse(undefined, error.message || 'Failed to retrieve data', 500);
    //     }
    // }    

    private async handlePost(tableName: string, data: any): Promise<Response> {
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

        console.log('Enqueueing POST SQL Query:', query, 'with params:', params);

        const queries = [{ sql: query, params }];

        try {
            await enqueueOperation(
                queries,
                false, // isTransaction
                false, // isRaw
                this.operationQueue,
                () => processNextOperation(this.sql, this.operationQueue, this.state, this.processingOperation)
            );
    
            console.log('POST Operation Success - Inserted Data:', data);
            return createResponse({ message: 'Resource created successfully', data }, undefined, 201);
        } catch (error: any) {
            console.error('POST Operation Error:', error);
            const errorMessage = error.message || error.error || JSON.stringify(error) || 'Failed to create resource';
            return createResponse(undefined, errorMessage, 500);
        }
    }


    private async handlePatch(tableName: string, id: string | undefined, data: any): Promise<Response> {
        const pkColumns = this.getPrimaryKeyColumns(tableName);

        const { conditions: pkConditions, params: pkParams, error } = this.getPrimaryKeyConditions(pkColumns, id, data, new URLSearchParams());

        if (error) {
            console.error('PATCH Operation Error:', error);
            return createResponse(undefined, error, 400);
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

        // Remove primary key columns from dataKeys
        const updateKeys = dataKeys.filter(key => !pkColumns.includes(key));

        if (updateKeys.length === 0) {
            console.error('No updatable data provided for PATCH');
            return createResponse(undefined, 'No updatable data provided', 400);
        }

        // Sanitize column names
        const columns = updateKeys.map(col => this.sanitizeIdentifier(col));
        const setClause = columns.map(col => `${col} = ?`).join(', ');
        const query = `UPDATE ${tableName} SET ${setClause} WHERE ${pkConditions.join(' AND ')}`;

        // Map parameters using original data keys to get correct values
        const params = updateKeys.map(key => data[key]);
        params.push(...pkParams);

        console.log('Enqueueing PATCH SQL Query:', query, 'with params:', params);

        const queries = [{ sql: query, params }];

        try {
            await enqueueOperation(
                queries,
                false,
                false,
                this.operationQueue,
                () => processNextOperation(this.sql, this.operationQueue, this.state, this.processingOperation)
            );

            console.log('PATCH Operation Success - Updated Data:', data);
            return createResponse({ message: 'Resource updated successfully', data }, undefined, 200);
        } catch (error) {
            console.error('PATCH Operation Error:', error);
            return createResponse(undefined, error.message || 'Failed to update resource', 500);
        }
    }
    
    private async handlePut(tableName: string, id: string | undefined, data: any): Promise<Response> {
        const pkColumns = this.getPrimaryKeyColumns(tableName);

        const { conditions: pkConditions, params: pkParams, error } = this.getPrimaryKeyConditions(pkColumns, id, data, new URLSearchParams());

        if (error) {
            console.error('PUT Operation Error:', error);
            return createResponse(undefined, error, 400);
        }

        if (!this.isDataValid(data)) {
            console.error('Invalid data format for PUT:', data);
            return createResponse(undefined, 'Invalid data format', 400);
        }

        const dataKeys = Object.keys(data);
        if (dataKeys.length === 0) {
            console.error('No data provided for PUT');
            return createResponse(undefined, 'No data provided', 400);
        }

        // Sanitize column names
        const columns = dataKeys.map(col => this.sanitizeIdentifier(col));
        const setClause = columns.map(col => `${col} = ?`).join(', ');
        const query = `UPDATE ${tableName} SET ${setClause} WHERE ${pkConditions.join(' AND ')}`;

        // Map parameters using original data keys to get correct values
        const params = dataKeys.map(key => data[key]);
        params.push(...pkParams);

        console.log('Enqueueing PUT SQL Query:', query, 'with params:', params);

        const queries = [{ sql: query, params }];

        try {
            const response = await enqueueOperation(
                queries,
                false,
                false,
                this.operationQueue,
                () => processNextOperation(this.sql, this.operationQueue, this.state, this.processingOperation)
            );

            // Check if any rows were affected
            // You might need to adjust how you check for affected rows based on your implementation

            console.log('PUT Operation Success - Replaced Data:', data);
            return createResponse({ message: 'Resource replaced successfully', data }, undefined, 200);
        } catch (error) {
            console.error('PUT Operation Error:', error);
            return createResponse(undefined, error.message || 'Failed to replace resource', 500);
        }
    }

    private async handleDelete(tableName: string, id: string | undefined): Promise<Response> {
        const pkColumns = this.getPrimaryKeyColumns(tableName);

        const { conditions: pkConditions, params: pkParams, error } = this.getPrimaryKeyConditions(pkColumns, id, {}, new URLSearchParams());

        if (error) {
            console.error('DELETE Operation Error:', error);
            return createResponse(undefined, error, 400);
        }

        const query = `DELETE FROM ${tableName} WHERE ${pkConditions.join(' AND ')}`;

        console.log('Enqueueing DELETE SQL Query:', query, 'with params:', pkParams);

        const queries = [{ sql: query, params: pkParams }];

        try {
            await enqueueOperation(
                queries,
                false,
                false,
                this.operationQueue,
                () => processNextOperation(this.sql, this.operationQueue, this.state, this.processingOperation)
            );
            console.log('DELETE Operation Success');
            return createResponse({ message: 'Resource deleted successfully' }, undefined, 200);
        } catch (error) {
            console.error('DELETE Operation Error:', error);
            return createResponse(undefined, error.message || 'Failed to delete resource', 500);
        }
    }
}