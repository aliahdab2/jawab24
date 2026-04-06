import { Queue } from 'bullmq';
import { config } from '../config';

export const CUSTOMER_NOTIFICATION_QUEUE = 'customer-notifications';

export interface CustomerNotificationJobData {
    notificationLogId: string;
}

const connection = {
    host: config.redis.host,
    port: parseInt(String(config.redis.port || 6379)),
    password: config.redis.password,
};

export const customerNotificationQueue = new Queue<CustomerNotificationJobData>(CUSTOMER_NOTIFICATION_QUEUE, {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: 200,
    },
});
