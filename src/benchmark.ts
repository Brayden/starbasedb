// benchmark.ts

import { Env } from './env'; // Adjust the import path as necessary
import { createResponse } from './utils';

const DURABLE_OBJECT_ID = 'sql-durable-object';

// Function to run the benchmark
export async function runBenchmark(env: Env): Promise<Response> {
    const NUM_REQUESTS = [1, 10, 100];
    const CONCURRENT_REQUESTS = [1, 10, 100];
    const QUERY = 'SELECT 1;';
  
    const results = [];
  
    for (let i = 0; i < NUM_REQUESTS.length; i++) {
      const numRequests = NUM_REQUESTS[i];
      const concurrency = CONCURRENT_REQUESTS[i];
      const individualResults = [];
      const totalRequests = numRequests;
      const startTime = Date.now();
  
      console.log(`\n--- Benchmark: ${numRequests} Requests with ${concurrency} Concurrent ---`);
  
      // Prepare an array of promises
      const promises = [];
      for (let j = 0; j < numRequests; j++) {
        promises.push(sendRequestToDO(env, QUERY));
      }
  
      // Split the promises into chunks based on concurrency
      const chunkSize = Math.ceil(numRequests / concurrency);
      const chunks = [];
      for (let k = 0; k < promises.length; k += chunkSize) {
        chunks.push(promises.slice(k, k + chunkSize));
      }
  
      // Execute chunks sequentially to respect concurrency limit
      for (const chunk of chunks) {
        await Promise.all(chunk).then((responses) => {
          individualResults.push(...responses);
        });
      }
  
      const elapsedTime = (Date.now() - startTime) / 1000;
      const successCount = individualResults.filter((res) => res.status === 'success').length;
      const failedCount = totalRequests - successCount;
      const averageTimePerRequest = elapsedTime / totalRequests;
      const averageRequestsPerSecond = totalRequests / elapsedTime;
  
      console.log(`Total Requests: ${totalRequests}`);
      console.log(`Successful Requests: ${successCount}`);
      console.log(`Failed Requests: ${failedCount}`);
      console.log(`Total Time Taken: ${elapsedTime.toFixed(3)} seconds`);
      console.log(`Average Time per Request: ${averageTimePerRequest.toFixed(4)} seconds`);
      console.log(`Average Requests per Second: ${averageRequestsPerSecond.toFixed(2)} requests/sec`);
  
      results.push({
        numRequests: totalRequests,
        concurrency,
        totalTime: elapsedTime,
        averageTimePerRequest,
        averageRequestsPerSecond,
        successCount,
        failedCount,
      });
    }
  
    // Return the results as a JSON response
    return new Response(JSON.stringify(results, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  

// Function to send a single request to the Durable Object
async function sendRequestToDO(env: Env, query: string): Promise<any> {
  const startTime = Date.now();
  try {
    const id = env.DATABASE_DURABLE_OBJECT.idFromName(DURABLE_OBJECT_ID);
    const stub = env.DATABASE_DURABLE_OBJECT.get(id);

    const request = new Request('https://dummy.url/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.AUTHORIZATION_TOKEN}`,
      },
      body: JSON.stringify({ sql: query }),
    });

    const response = await stub.fetch(request);
    const elapsedTime = (Date.now() - startTime) / 1000;

    if (response.ok) {
      const data = await response.json();
      return {
        status: 'success',
        time: elapsedTime,
        responseSize: JSON.stringify(data).length,
      };
    } else {
      const errorData = await response.text();
      return {
        status: 'failed',
        time: elapsedTime,
        error: errorData,
      };
    }
  } catch (error: any) {
    const elapsedTime = (Date.now() - startTime) / 1000;
    return {
      status: 'failed',
      time: elapsedTime,
      error: error.message,
    };
  }
}
