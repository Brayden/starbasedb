export type QueryTransaction = {
    transaction?: Query[];
}

export type Query = {
    // The SQL query to execute
    sql: string;
    // The parameters to pass to the query
    params?: any[];
    // Whether to allow query deduplication. If a query with the same SQL and parameters is already in the queue, 
    //the result of the existing query will be returned instead of enqueuing a new operation.
    allowQueryDedupe?: boolean;
};

export type ServerResponse = {
    result?: any[];
    error?: string;
    status: number;
}

export function createJSONResponse(data: ServerResponse): Response {
    return new Response(JSON.stringify({
        result: data.result,
        error: data.error,
    }), {
        status: data.status,
        headers: {
            'Content-Type': 'application/json',
        },
    });
}

export function createResponse(result: any, error: string | undefined, status: number): Response {
    return createJSONResponse({
        result,
        error,
        status,
    });
};

export function createResponseFromOperationResponse(response: { result?: any, error?: string | undefined, status: number }): Response {
    return createResponse(response.result, response.error, response.status);
}