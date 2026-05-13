const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const discoveryQueue = new Queue('discovery', { connection });

module.exports = { discoveryQueue };
