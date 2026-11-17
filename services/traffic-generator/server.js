const express = require('express');
const crypto = require('crypto');
const promClient = require('prom-client');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8082;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://frontend:80';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order-service:8080';
const REQUESTS_PER_SECOND = parseFloat(process.env.REQUESTS_PER_SECOND || '1');
const ENABLED = process.env.ENABLED !== 'false';

const FRONTEND_PAGE_LOAD_RATIO = parseFloat(process.env.FRONTEND_PAGE_LOAD_RATIO || '0.3');
const CHECKOUT_RATIO = parseFloat(process.env.CHECKOUT_RATIO || '0.1');
const POLL_RATIO = parseFloat(process.env.POLL_RATIO || '0.6');

const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const httpRequestsTotal = new promClient.Counter({
  name: 'traffic_generator_http_requests_total',
  help: 'Total HTTP requests sent',
  labelNames: ['method', 'path', 'status', 'target'],
  registers: [register],
});

const httpRequestDuration = new promClient.Histogram({
  name: 'traffic_generator_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'target'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const userSessions = new promClient.Gauge({
  name: 'traffic_generator_active_sessions',
  help: 'Active user sessions (orders being polled)',
  registers: [register],
});

const ordersCreated = new promClient.Counter({
  name: 'traffic_generator_orders_created_total',
  help: 'Total orders created',
  registers: [register],
});

const ordersFailed = new promClient.Counter({
  name: 'traffic_generator_orders_failed_total',
  help: 'Total orders failed',
  registers: [register],
});

let intervalId = null;
let activeOrders = new Map();
let userIdCounter = 0;

function generateRandomOrder() {
  const products = [
    { id: 'prod-1', sku: 'KB-SRE-PRO', name: 'Mechanical SRE Keyboard', price: 149.00 },
    { id: 'prod-2', sku: 'HOODIE-OTEL', name: 'Distributed Tracing Hoodie', price: 65.00 },
    { id: 'prod-3', sku: 'CAP-AMQP', name: 'RabbitMQ Message Cap', price: 28.00 },
    { id: 'prod-4', sku: 'FIDO2-KEY', name: 'Cluster Key Security Token', price: 45.00 },
  ];
  
  const itemCount = Math.floor(Math.random() * 3) + 1;
  const items = [];
  let amount = 0;
  
  for (let i = 0; i < itemCount; i++) {
    const product = products[Math.floor(Math.random() * products.length)];
    const qty = Math.floor(Math.random() * 2) + 1;
    items.push({ sku: product.sku, qty, price: product.price });
    amount += product.price * qty;
  }

  return {
    userId: `web-shopper-${++userIdCounter}`,
    items,
    amount: parseFloat(amount.toFixed(2)),
  };
}

async function makeRequest(target, method, path, body = null, labels = {}) {
  const url = target === 'frontend' ? FRONTEND_URL : ORDER_SERVICE_URL;
  const startTime = Date.now();
  
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);
    
    const response = await fetch(`${url}${path}`, options);
    const duration = (Date.now() - startTime) / 1000;
    const status = response.status.toString();
    
    httpRequestsTotal.inc({ method, path, status, target, ...labels });
    httpRequestDuration.observe({ method, path, target, ...labels }, duration);
    
    return { ok: response.ok, status, data: response.ok ? await response.json() : await response.text(), duration };
  } catch (err) {
    const duration = (Date.now() - startTime) / 1000;
    httpRequestsTotal.inc({ method, path, status: 'error', target, ...labels });
    httpRequestDuration.observe({ method, path, target, ...labels }, duration);
    return { ok: false, status: 'error', error: err.message, duration };
  }
}

async function simulatePageLoad() {
  const result = await makeRequest('frontend', 'GET', '/', null, { scenario: 'page_load' });
  if (result.ok) {
    console.log(`[TrafficGen] Page load (${result.duration.toFixed(3)}s)`);
  } else {
    console.warn(`[TrafficGen] Page load failed:`, result.error);
  }
}

async function simulateCheckout() {
  const order = generateRandomOrder();
  const result = await makeRequest('order-service', 'POST', '/api/orders', order, { scenario: 'checkout' });
  
  if (result.ok) {
    ordersCreated.inc();
    const orderId = result.data.orderId;
    activeOrders.set(orderId, {
      orderId,
      userId: order.userId,
      amount: order.amount,
      pollsRemaining: 15,
      createdAt: Date.now(),
    });
    userSessions.set(activeOrders.size);
    console.log(`[TrafficGen] Checkout order ${orderId} for ${order.userId} ($${order.amount}) (${result.duration.toFixed(3)}s)`);
  } else {
    ordersFailed.inc();
    console.warn(`[TrafficGen] Checkout failed (${result.status}):`, result.data);
  }
}

async function simulatePolling() {
  if (activeOrders.size === 0) return;
  
  const orderIds = Array.from(activeOrders.keys());
  const orderId = orderIds[Math.floor(Math.random() * orderIds.length)];
  const session = activeOrders.get(orderId);
  
  const result = await makeRequest('order-service', 'GET', `/api/orders/${orderId}`, null, { scenario: 'poll' });
  
  if (result.ok) {
    session.pollsRemaining--;
    console.log(`[TrafficGen] Poll ${orderId}: ${result.data.status} (polls left: ${session.pollsRemaining}) (${result.duration.toFixed(3)}s)`);
    
    if (result.data.status === 'CONFIRMED' || result.data.status === 'FAILED' || session.pollsRemaining <= 0) {
      activeOrders.delete(orderId);
      userSessions.set(activeOrders.size);
      console.log(`[TrafficGen] Order ${orderId} completed (${result.data.status}), stopping polls`);
    }
  } else if (result.status === '404') {
    activeOrders.delete(orderId);
    userSessions.set(activeOrders.size);
  } else {
    console.warn(`[TrafficGen] Poll failed for ${orderId}:`, result.error);
  }
}

function pickAction() {
  const rand = Math.random();
  if (rand < FRONTEND_PAGE_LOAD_RATIO) return 'page_load';
  if (rand < FRONTEND_PAGE_LOAD_RATIO + CHECKOUT_RATIO) return 'checkout';
  return 'poll';
}

function runTrafficTick() {
  const action = pickAction();
  
  switch (action) {
    case 'page_load':
      simulatePageLoad();
      break;
    case 'checkout':
      simulateCheckout();
      break;
    case 'poll':
      simulatePolling();
      break;
  }
}

function startTrafficGeneration() {
  if (intervalId) return;
  
  const intervalMs = 1000 / REQUESTS_PER_SECOND;
  console.log(`[TrafficGen] Starting traffic generation at ${REQUESTS_PER_SECOND} req/s (${intervalMs}ms interval)`);
  console.log(`[TrafficGen] Ratios - Page Load: ${FRONTEND_PAGE_LOAD_RATIO}, Checkout: ${CHECKOUT_RATIO}, Poll: ${POLL_RATIO}`);
  console.log(`[TrafficGen] Frontend: ${FRONTEND_URL}, Order Service: ${ORDER_SERVICE_URL}`);
  
  intervalId = setInterval(runTrafficTick, intervalMs);
  runTrafficTick();
}

function stopTrafficGeneration() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    activeOrders.clear();
    userSessions.set(0);
    console.log('[TrafficGen] Stopped traffic generation');
  }
}

app.get('/healthz', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    enabled: ENABLED,
    requestsPerSecond: REQUESTS_PER_SECOND,
    frontendUrl: FRONTEND_URL,
    orderServiceUrl: ORDER_SERVICE_URL,
    activeSessions: activeOrders.size,
  });
});

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

app.post('/control/start', (req, res) => {
  startTrafficGeneration();
  res.json({ status: 'started', requestsPerSecond: REQUESTS_PER_SECOND });
});

app.post('/control/stop', (req, res) => {
  stopTrafficGeneration();
  res.json({ status: 'stopped' });
});

app.post('/control/rate', (req, res) => {
  const { requestsPerSecond } = req.body;
  if (typeof requestsPerSecond !== 'number' || requestsPerSecond <= 0) {
    return res.status(400).json({ error: 'requestsPerSecond must be a positive number' });
  }
  
  const wasRunning = !!intervalId;
  stopTrafficGeneration();
  
  process.env.REQUESTS_PER_SECOND = requestsPerSecond.toString();
  const newIntervalMs = 1000 / requestsPerSecond;
  
  if (wasRunning) {
    startTrafficGeneration();
  }
  
  res.json({ status: 'updated', requestsPerSecond, intervalMs: newIntervalMs });
});

app.post('/control/ratios', (req, res) => {
  const { pageLoad, checkout, poll } = req.body;
  const ratios = { pageLoad, checkout, poll };
  
  for (const [key, value] of Object.entries(ratios)) {
    if (value !== undefined && (typeof value !== 'number' || value < 0 || value > 1)) {
      return res.status(400).json({ error: `${key} must be a number between 0 and 1` });
    }
  }
  
  const sum = (pageLoad || FRONTEND_PAGE_LOAD_RATIO) + (checkout || CHECKOUT_RATIO) + (poll || POLL_RATIO);
  if (Math.abs(sum - 1) > 0.001) {
    return res.status(400).json({ error: 'Ratios must sum to 1' });
  }
  
  process.env.FRONTEND_PAGE_LOAD_RATIO = (pageLoad || FRONTEND_PAGE_LOAD_RATIO).toString();
  process.env.CHECKOUT_RATIO = (checkout || CHECKOUT_RATIO).toString();
  process.env.POLL_RATIO = (poll || POLL_RATIO).toString();
  
  res.json({ 
    status: 'updated', 
    ratios: {
      pageLoad: parseFloat(process.env.FRONTEND_PAGE_LOAD_RATIO),
      checkout: parseFloat(process.env.CHECKOUT_RATIO),
      poll: parseFloat(process.env.POLL_RATIO),
    }
  });
});

app.get('/control/status', (req, res) => {
  res.json({
    running: !!intervalId,
    requestsPerSecond: REQUESTS_PER_SECOND,
    frontendUrl: FRONTEND_URL,
    orderServiceUrl: ORDER_SERVICE_URL,
    activeSessions: activeOrders.size,
    ratios: {
      pageLoad: FRONTEND_PAGE_LOAD_RATIO,
      checkout: CHECKOUT_RATIO,
      poll: POLL_RATIO,
    },
  });
});

if (ENABLED) {
  startTrafficGeneration();
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[traffic-generator] Listening on port ${PORT}`);
  console.log(`[traffic-generator] Frontend: ${FRONTEND_URL}`);
  console.log(`[traffic-generator] Order Service: ${ORDER_SERVICE_URL}`);
  console.log(`[traffic-generator] Rate: ${REQUESTS_PER_SECOND} req/s`);
  console.log(`[traffic-generator] Enabled: ${ENABLED}`);
});

process.on('SIGTERM', () => {
  console.log('[TrafficGen] SIGTERM received, stopping...');
  stopTrafficGeneration();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[TrafficGen] SIGINT received, stopping...');
  stopTrafficGeneration();
  process.exit(0);
});