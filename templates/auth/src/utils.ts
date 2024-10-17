export function createJSONResponse(data: { result: any, error: string | undefined, status: number }): Response {
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