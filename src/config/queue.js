require('dotenv').config();

module.exports = {
  redis: {
    host: process.env.QUEUE_REDIS_HOST || process.env.REDIS_HOST || 'localhost',
    port: process.env.QUEUE_REDIS_PORT || process.env.REDIS_PORT || 6379,
    password: process.env.QUEUE_REDIS_PASSWORD || process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableReadyCheck: false,
    lazyConnect: true
  },
  
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 20,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  },
  
  queues: {
    notification: {
      name: 'notification-queue',
      concurrency: 5,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 5,
        delay: 1000
      }
    },
    
    email: {
      name: 'email-queue',
      concurrency: 3,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        delay: 2000
      }
    },
    
    sms: {
      name: 'sms-queue',
      concurrency: 2,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 25,
        attempts: 3,
        delay: 3000
      }
    },
    
    report: {
      name: 'report-queue',
      concurrency: 2,
      defaultJobOptions: {
        removeOnComplete: 20,
        removeOnFail: 10,
        attempts: 2,
        delay: 5000
      }
    },
    
    asset: {
      name: 'asset-queue',
      concurrency: 3,
      defaultJobOptions: {
        removeOnComplete: 30,
        removeOnFail: 15,
        attempts: 3
      }
    },
    
    sla: {
      name: 'sla-queue',
      concurrency: 10,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 2,
        repeat: {
          every: 60000 // Check every minute
        }
      }
    },
    
    maintenance: {
      name: 'maintenance-queue',
      concurrency: 1,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 5,
        attempts: 1
      }
    },
    
    backup: {
      name: 'backup-queue',
      concurrency: 1,
      defaultJobOptions: {
        removeOnComplete: 5,
        removeOnFail: 3,
        attempts: 2
      }
    }
  },
  
  worker: {
    concurrency: 10,
    settings: {
      stalledInterval: 30 * 1000,
      maxStalledCount: 1
    }
  },
  
  dashboard: {
    port: process.env.QUEUE_DASHBOARD_PORT || 3001,
    basePath: '/admin/queues'
  }
};