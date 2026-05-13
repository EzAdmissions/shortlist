require('dotenv').config();

console.log('REDIS_URL loaded?', !!process.env.REDIS_URL);

const { Worker } = require('bullmq');
const { buildQueries } = require('./src/services/queryBuilder');
const { searchBrave } = require('./src/services/searchProvider');
const { extractRecords } = require('./src/services/resultExtractor');
const { saveRawProfiles } = require('./src/services/supabaseWriter');
const { normalizeSearchInput } = require('./src/services/searchInput');
const { createRedisConnection } = require('./src/queues/redisConnection');

const connection = createRedisConnection();

const worker = new Worker(
  'discovery',
  async (job) => {
    const searchInput = normalizeSearchInput(job.data);

    console.log('[worker] Processing job:', searchInput);

    const queries = buildQueries(searchInput);
    const discoveredResults = [];

    for (const query of queries) {
      const results = await searchBrave(query);

      const searchResults = results.web?.results || [];

      discoveredResults.push(
        ...searchResults.map((result) => ({
          query,
          title: result.title,
          url: result.url,
          description: result.description,
        }))
      );
    }

    console.log(JSON.stringify(discoveredResults, null, 2));

    const extractedRecords = extractRecords(discoveredResults, searchInput);
    const saveResult = await saveRawProfiles(extractedRecords);

    console.log('[worker] Raw profile save summary:', {
      attempted: saveResult.attempted,
      saved: saveResult.saved,
      skipped: saveResult.skipped,
    });

    return {
      success: true,
      count: saveResult.saved,
      attempted: saveResult.attempted,
      saved: saveResult.saved,
      skipped: saveResult.skipped,
      results: saveResult.records,
    };
  },
  { connection }
);

worker.on('completed', (job) => {
  console.log(`[worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err.message);
});
