const express = require('express');
const amqp = require('amqplib');
const Redis = require('ioredis');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const REDIS_HOST = process.env.REDIS_HOST || 'redis-cache';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
// const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';

const USERNAME = process.env.RABBITMQ_USERNAME || 'guest';
const PASSWORD = process.env.RABBITMQ_PASSWORD || 'guest';
const RABBITMQ_HOST = process.env.RABBITMQ_HOST || 'rabbitmq';
const RABBITMQ_PORT = process.env.RABBITMQ_PORT || '5672';
const RABBITMQ_URL = `amqp://${USERNAME}:${PASSWORD}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;
const EXCHANGE_NAME = process.env.RABBITMQ_EXCHANGE || 'cloudmart.events';

// Initialize Redis client with automatic retry
const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  retryStrategy(times) {
    const delay = Math.min(times * 500, 3000);
    return delay;
  },
});

redis.on('connect', () => console.log(`[Redis] Connected to ${REDIS_HOST}:${REDIS_PORT}`));
redis.on('error', (err) => console.error('[Redis] Error:', err.message));

let amqpChannel = null;

// Connect to RabbitMQ with retry
async function connectRabbitMQ() {
  while (!amqpChannel) {
    try {
      console.log(`[RabbitMQ] Connecting to ${RABBITMQ_URL}...`);
      const connection = await amqp.connect(RABBITMQ_URL);
      const channel = await connection.createChannel();

      // Assert durable topic exchange
      await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

      // Assert and bind queue for receiving payment status updates
      const statusQueue = 'orders.order-status-update';
      await channel.assertQueue(statusQueue, { durable: true });
      await channel.bindQueue(statusQueue, EXCHANGE_NAME, 'payment.*');

      // Consume payment status updates
      channel.consume(statusQueue, async (msg) => {
        if (!msg) return;
        try {
          const event = JSON.parse(msg.content.toString());
          console.log(`[RabbitMQ] Received payment update for order ${event.orderId}: status=${event.status}`);

          // Update order status in Redis
          const existingData = await redis.get(`order:${event.orderId}`);
          if (existingData) {
            const order = JSON.parse(existingData);
            order.status = event.status === 'SUCCESS' ? 'CONFIRMED' : 'FAILED';
            order.paymentId = event.paymentId;
            order.updatedAt = Date.now();
            await redis.set(`order:${event.orderId}`, JSON.stringify(order));
          }

          channel.ack(msg);
        } catch (err) {
          console.error('[RabbitMQ] Error processing payment event:', err.message);
          channel.nack(msg, false, false); // Route to DLQ if configured
        }
      });

      amqpChannel = channel;
      console.log(`[RabbitMQ] Connected and exchange '${EXCHANGE_NAME}' ready.`);
    } catch (err) {
      console.error('[RabbitMQ] Connection failed, retrying in 3s...', err.message);
      await new Promise((res) => setTimeout(res, 3000));
    }
  }
}

connectRabbitMQ();

// Health Check endpoint for Kubernetes probes
app.get('/healthz', (req, res) => {
  const redisHealthy = redis.status === 'ready';
  const amqpHealthy = amqpChannel !== null;

  if (redisHealthy && amqpHealthy) {
    return res.status(200).json({ status: 'ok', redis: true, rabbitmq: true });
  }
  return res.status(503).json({ status: 'degraded', redis: redisHealthy, rabbitmq: amqpHealthy });
});

// POST /api/orders - Create order & publish event
app.post('/api/orders', async (req, res) => {
  try {
    const { items, userId, amount } = req.body;
    if (!items || !items.length || !amount) {
      return res.status(400).json({ error: 'Missing required order fields: items, amount' });
    }

    const orderId = `ord-${crypto.randomBytes(4).toString('hex')}`;
    const orderData = {
      orderId,
      userId: userId || 'anonymous',
      items,
      amount: parseFloat(amount),
      currency: 'USD',
      status: 'PENDING',
      createdAt: Date.now(),
    };

    // 1. Commit initial state to Redis
    await redis.set(`order:${orderId}`, JSON.stringify(orderData));

    // 2. Publish order.created event to RabbitMQ
    const eventPayload = {
      eventId: `evt-${crypto.randomUUID()}`,
      eventType: 'order.created',
      timestamp: Date.now(),
      orderId,
      userId: orderData.userId,
      amount: orderData.amount,
      currency: orderData.currency,
      items: orderData.items,
    };

    if (amqpChannel) {
      amqpChannel.publish(
        EXCHANGE_NAME,
        'order.created',
        Buffer.from(JSON.stringify(eventPayload)),
        {
          persistent: true,
          contentType: 'application/json',
          headers: {
            // W3C trace context will be attached here
          },
        }
      );
      console.log(`[Order API] Order ${orderId} placed (status=PENDING), event published.`);
    } else {
      console.warn(`[Order API] Warning: RabbitMQ not connected, event not published.`);
    }

    // 3. Immediately return HTTP 202 Accepted (Non-blocking)
    return res.status(202).json({
      orderId,
      status: 'PENDING',
      message: 'Order received and queued for payment processing.',
    });
  } catch (err) {
    console.error('[Order API] Error creating order:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/:id - Check order status
app.get('/api/orders/:id', async (req, res) => {
  try {
    const data = await redis.get(`order:${req.params.id}`);
    if (!data) {
      return res.status(404).json({ error: 'Order not found' });
    }
    return res.json(JSON.parse(data));
  } catch (err) {
    console.error('[Order API] Error retrieving order:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[order-service] Listening on port ${PORT}`);
});
