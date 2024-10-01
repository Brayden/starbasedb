export type QueryTransactionRequest = {
    transaction?: QueryRequest[];
}

export type QueryRequest = {
    sql: string;
    params?: any[];
};

export type QueryResponse = {
    result?: any[];
    error?: string;
    status: number;
}

export function createJSONResponse(data: QueryResponse): Response {
    return new Response(JSON.stringify({
        result: data.result,
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