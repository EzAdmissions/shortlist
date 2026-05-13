const IORedis = require('ioredis');

function normalizeRedisUrl(value) {
  const raw = String(value || '').trim();

  if (!raw) {
    throw new Error('REDIS_URL is not set');
  }

  if (raw.startsWith('redis://') || raw.startsWith('rediss://')) {
    return raw;
  }

  if (raw.startsWith('//')) {
    return `redis:${raw}`;
  }

  return `redis://${raw}`;
}

function getRedisUrlScheme(url) {
  const match = url.match(/^(rediss?:\/\/)/);
  return match ? match[1] : 'missing';
}

function createRedisConnection() {
  const redisUrl = normalizeRedisUrl(process.env.REDIS_URL);
  console.log('[redis] URL scheme:', getRedisUrlScheme(redisUrl));

  return new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
}

module.exports = {
  createRedisConnection,
  normalizeRedisUrl,
};
