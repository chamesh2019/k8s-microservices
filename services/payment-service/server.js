const express = require('express');
const amqp = require('amqplib');
const Redis = require('ioredis');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8081;
const REDIS_HOST = process.env.REDIS_HOST || 'redis-cache';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
// const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const USERNAME = process.env.RABBITMQ_USERNAME || 'guest';
const PASSWORD = process.env.RABBITMQ_PASSWORD || 'guest';
const RABBITMQ_HOST = process.env.RABBITMQ_HOST || 'rabbitmq';
const RABBITMQ_PORT = process.env.RABBITMQ_PORT || '5672';
const RABBITMQ_URL = `amqp://${USERNAME}:${PASSWORD}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;

const EXCHANGE_NAME = process.env.RABBITMQ_EXCHANGE || 'cloudmart.events';
const DLX_EXCHANGE = process.env.DLX_EXCHANGE || 'cloudmart.dlx';
const DLQ_NAME = 'cloudmart.dlq';
const PAYMENT_QUEUE = 'orders.process-payment';

// Connect to Redis for transaction audit logs
const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  retryStrategy(times) {
    return Math.min(times * 500, 3000);
  },
});

redis.on('connect', () => console.log(`[Payment] Redis connected to ${REDIS_HOST}:${REDIS_PORT}`));
redis.on('error', (err) => console.error('[Payment] Redis error:', err.message));

let amqpChannel = null;

async function startConsumer() {
  while (!amqpChannel) {
    try {
      console.log(`[Payment] Connecting to RabbitMQ at ${RABBITMQ_URL}...`);
      const connection = await amqp.connect(RABBITMQ_URL);
      const channel = await connection.createChannel();

      // 1. Assert Primary Topic Exchange
      await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

      // 2. Assert Dead Letter Exchange (fanout) and DLQ
      await channel.assertExchange(DLX_EXCHANGE, 'fanout', { durable: true });
      await channel.assertQueue(DLQ_NAME, { durable: true });
      await channel.bindQueue(DLQ_NAME, DLX_EXCHANGE, '');

      // 3. Assert Work Queue with Dead Letter routing configured
      await channel.assertQueue(PAYMENT_QUEUE, {
        durable: true,
        deadLetterExchange: DLX_EXCHANGE,
      });
      await channel.bindQueue(PAYMENT_QUEUE, EXCHANGE_NAME, 'order.created');

      // 4. Set prefetch limit (only process up to 5 messages concurrently per pod)
      await channel.prefetch(5);

      console.log(`[Payment] Listening for 'order.created' on queue '${PAYMENT_QUEUE}'...`);

      channel.consume(PAYMENT_QUEUE, async (msg) => {
        if (!msg) return;

        let event;
        try {
          event = JSON.parse(msg.content.toString());
        } catch (parseErr) {
          console.error('[Payment] Corrupt message payload, rejecting to DLQ:', parseErr.message);
          // Poison pill rejection: requeue=false sends directly to DLX
          return channel.nack(msg, false, false);
        }

        console.log(`[Payment] Processing payment for Order ${event.orderId}, Amount: $${event.amount}`);

        try {
          // Simulate Payment Gateway call (e.g. Stripe, Visa) with 100ms latency
          await new Promise((resolve) => setTimeout(resolve, 100));

          const paymentId = `pay-${crypto.randomBytes(4).toString('hex')}`;
          const isSuccessful = true; // In production, evaluate charge result

          const paymentRecord = {
            paymentId,
            orderId: event.orderId,
            amount: event.amount,
            currency: event.currency || 'USD',
            status: isSuccessful ? 'SUCCESS' : 'FAILED',
            timestamp: Date.now(),
            gatewayRef: `mock_gw_${crypto.randomBytes(6).toString('hex')}`,
          };

          // Store payment audit record in Redis
          await redis.set(`payment:${paymentId}`, JSON.stringify(paymentRecord));
          console.log(`[Payment] Payment ${paymentId} completed for Order ${event.orderId}`);

          // Publish payment.processed event
          const resultEvent = {
            eventId: `evt-${crypto.randomUUID()}`,
            eventType: 'payment.processed',
            orderId: event.orderId,
            paymentId,
            status: paymentRecord.status,
            amount: paymentRecord.amount,
            timestamp: paymentRecord.timestamp,
          };

          channel.publish(
            EXCHANGE_NAME,
            'payment.processed',
            Buffer.from(JSON.stringify(resultEvent)),
            {
              persistent: true,
              contentType: 'application/json',
              headers: {
                // W3C trace context will be attached here
              },
            }
          );

          // Acknowledge message after successful processing & publishing
          channel.ack(msg);
          console.log(`[Payment] ACK sent for Order ${event.orderId}. Event 'payment.processed' published.`);
        } catch (procErr) {
          console.error(`[Payment] Processing error for Order ${event.orderId}:`, procErr.message);
          // Route to DLQ if fatal
          channel.nack(msg, false, false);
        }
      });

      amqpChannel = channel;
    } catch (err) {
      console.error('[Payment] RabbitMQ connection failed, retrying in 3s...', err.message);
      await new Promise((res) => setTimeout(res, 3000));
    }
  }
}

startConsumer();

// Health Check for Kubernetes probes
app.get('/healthz', (req, res) => {
  const redisHealthy = redis.status === 'ready';
  const amqpHealthy = amqpChannel !== null;

  if (redisHealthy && amqpHealthy) {
    return res.status(200).json({ status: 'ok', worker: 'payment-service', queue: PAYMENT_QUEUE });
  }
  return res.status(503).json({ status: 'degraded', redis: redisHealthy, rabbitmq: amqpHealthy });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[payment-service] Health server running on port ${PORT}`);
});
