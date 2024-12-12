import { DataSource, Source } from "../types";
const parser = new (require('node-sql-parser').Parser)();

async function createCacheTable(dataSource?: DataSource) {
    const statement = `
    CREATE TABLE IF NOT EXISTS "main"."tmp_cache"(
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "timestamp" REAL NOT NULL,
        "ttl" INTEGER NOT NULL,
        "query" TEXT UNIQUE NOT NULL,
        "results" TEXT
    )`

    await dataSource?.internalConnection?.durableObject.executeQuery(statement, undefined, false)
}

export async function beforeQueryCache(sql: string, params?: any[], dataSource?: DataSource): Promise<any | null> {
    if (dataSource?.source === Source.external && dataSource?.request.headers.has('X-Starbase-Cache')) {
        // Currently we do not support caching queries that have dynamic parameters
        if (params?.length) return null
        await createCacheTable(dataSource)
        const fetchCacheStatement = `SELECT timestamp, ttl, query, results FROM tmp_cache WHERE query='${sql}'`
        const result = await dataSource.internalConnection?.durableObject.executeQuery(fetchCacheStatement, undefined, false) as any[];

        if (result?.length) {
            const { timestamp, ttl, results } = result[0];
            const expirationTime = new Date(timestamp).getTime() + (ttl * 1000);
            
            if (Date.now() < expirationTime) {
                return JSON.parse(results)
            }
        }
    }

    return null
}

// Serialized RPC arguemnts are limited to 1MiB in size at the moment for Cloudflare
// Workers. An error may occur if we attempt to cache a value result that is greater
// than that size but putting this here to disclose these restrictions.
export async function afterQueryCache(sql: string, params: any[] | undefined, result: any, dataSource?: DataSource) {
    // Currently we do not support caching queries that have dynamic parameters
    if (params?.length) return;

    try {
        let ast = parser.astify(sql);
        const statementType = Array.isArray(ast) && ast.length ? ast[0].type : ast.type

        if (statementType !== 'select' || 
            !(dataSource?.source === Source.external && dataSource?.request.headers.has('X-Starbase-Cache'))) return;

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