import { DataSource, Source } from "../types";
const parser = new (require('node-sql-parser').Parser)();

function hasModifyingStatement(ast: any): boolean {
    // Check if current node is a modifying statement
    if (ast.type && ['insert', 'update', 'delete'].includes(ast.type.toLowerCase())) {
        return true;
    }

    // Recursively check all properties of the AST
    for (const key in ast) {
        if (typeof ast[key] === 'object' && ast[key] !== null) {
            if (Array.isArray(ast[key])) {
                if (ast[key].some(item => hasModifyingStatement(item))) {
                    return true;
                }
            } else if (hasModifyingStatement(ast[key])) {
                return true;
            }
        }
    }

    return false;
}

export async function beforeQueryCache(sql: string, params?: any[], dataSource?: DataSource, dialect?: string): Promise<any | null> {
    // Currently we do not support caching queries that have dynamic parameters
    if (params?.length) return null
    if (dataSource?.source === Source.internal || !dataSource?.request.headers.has('X-Starbase-Cache')) return null

    if (!dialect) dialect = 'sqlite'
    if (dialect.toLowerCase() === 'postgres') dialect = 'postgresql'

    let ast = parser.astify(sql, { database: dialect });
    if (hasModifyingStatement(ast)) return null
    
    const fetchCacheStatement = `SELECT timestamp, ttl, query, results FROM tmp_cache WHERE query = ?`
    const result = await dataSource.internalConnection?.durableObject.executeQuery(fetchCacheStatement, [sql], false) as any[];

    if (result?.length) {
        const { timestamp, ttl, results } = result[0];
        const expirationTime = new Date(timestamp).getTime() + (ttl * 1000);
        
        if (Date.now() < expirationTime) {
            return JSON.parse(results)
        }
    }

    return null
}

// Serialized RPC arguemnts are limited to 1MiB in size at the moment for Cloudflare
// Workers. An error may occur if we attempt to cache a value result that is greater
// than that size but putting this here to disclose these restrictions. Potential optimizations
// to look into include using Cloudflare Cache but need to find a good way to cache the
// response in a safe way for our use case. Another option is another service for queues
// or another way to ingest it directly to the Durable Object.
export async function afterQueryCache(sql: string, params: any[] | undefined, result: any, dataSource?: DataSource, dialect?: string) {
    // Currently we do not support caching queries that have dynamic parameters
    if (params?.length) return;
    if (dataSource?.source === Source.internal || !dataSource?.request.headers.has('X-Starbase-Cache')) return null

    try {
        if (!dialect) dialect = 'sqlite'
        if (dialect.toLowerCase() === 'postgres') dialect = 'postgresql'

        let ast = parser.astify(sql, { database: dialect });
        
        // If any modifying query exists within our SQL statement then we shouldn't proceed
        if (hasModifyingStatement(ast)) return;

        const timestamp = Date.now();
        const results = JSON.stringify(result);
        
        const exists = await dataSource.internalConnection?.durableObject.executeQuery(
            'SELECT 1 FROM tmp_cache WHERE query = ? LIMIT 1',
            [sql],
            false
        ) as any[];

        const query = exists?.length 
            ? { sql: 'UPDATE tmp_cache SET timestamp = ?, results = ? WHERE query = ?', params: [timestamp, results, sql] }
            : { sql: 'INSERT INTO tmp_cache (timestamp, ttl, query, results) VALUES (?, ?, ?, ?)', params: [timestamp, 60, sql, results] };

        await dataSource.internalConnection?.durableObject.executeQuery(query.sql, query.params, false);
    } catch (error) {
        console.error('Error in cache operation:', error);
        return;
    }
}