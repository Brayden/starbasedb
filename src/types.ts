import { QueryResponse } from './operation'

export enum Source {
    internal = 'internal', // Durable Object's SQLite instance
    external = 'external', // External data source (e.g. Outerbase)
}

export type DataSource = {
    source: Source
    request: Request
    internalConnection?: InternalConnection
    externalConnection?: {
        outerbaseApiKey: string
    }
    context?: Record<string, any>
}

export interface InternalConnection {
    durableObject: DatabaseStub
}

export type DatabaseStub = DurableObjectStub & {
    fetch: (init?: RequestInit | Request) => Promise<Response>
    executeQuery(
        sql: string,
        params: any[] | undefined,
        isRaw: boolean
    ): QueryResponse
    executeTransaction(
        queries: { sql: string; params?: any[] }[],
        isRaw: boolean
    ): any[]
}

export enum RegionLocationHint {
    AUTO = 'auto',
    WNAM = 'wnam', // Western North America
    ENAM = 'enam', // Eastern North America
    SAM = 'sam', // South America
    WEUR = 'weur', // Western Europe
    EEUR = 'eeur', // Eastern Europe
    APAC = 'apac', // Asia Pacific
    OC = 'oc', // Oceania
    AFR = 'afr', // Africa
    ME = 'me', // Middle East
}
