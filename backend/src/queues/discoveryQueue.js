const { Queue } = require('bullmq');
const { createRedisConnection } = require('./redisConnection');

const connection = createRedisConnection();

const discoveryQueue = new Queue('discovery', { connection });

module.exports = { discoveryQueue };
