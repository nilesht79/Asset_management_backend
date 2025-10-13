const Redis = require('redis');
require('dotenv').config();

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryDelayOnFailover: 100,
  retryDelayOnClusterDown: 300,
  retryDelayOnReconnect: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  keepAlive: 30000,
  family: 4
};

let client = null;

const connectRedis = async () => {
  try {
    if (client && client.isOpen) {
      return client;
    }

    client = Redis.createClient({
      socket: {
        host: redisConfig.host,
        port: redisConfig.port,
        keepAlive: redisConfig.keepAlive,
        family: redisConfig.family
      },
      password: redisConfig.password,
      retryDelayOnFailover: redisConfig.retryDelayOnFailover
    });

    client.on('connect', () => {
      console.log('✅ Connected to Redis server');
    });

    client.on('ready', () => {
      console.log('✅ Redis client ready');
    });

    client.on('error', (error) => {
      console.error('❌ Redis connection error:', error.message);
    });

    client.on('end', () => {
      console.log('Redis connection ended');
    });

    await client.connect();
    return client;
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error.message);
    throw error;
  }
};

const closeRedis = async () => {
  try {
    if (client && client.isOpen) {
      await client.quit();
      client = null;
      console.log('Redis connection closed');
    }
  } catch (error) {
    console.error('Error closing Redis connection:', error.message);
  }
};

const getRedisClient = () => {
  if (!client || !client.isOpen) {
    throw new Error('Redis not initialized. Call connectRedis first.');
  }
  return client;
};

const isRedisConnected = () => {
  return client && client.isOpen;
};

process.on('SIGINT', async () => {
  await closeRedis();
});

process.on('SIGTERM', async () => {
  await closeRedis();
});

module.exports = {
  connectRedis,
  closeRedis,
  getRedisClient,
  isRedisConnected,
  redisConfig
};