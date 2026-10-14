const PRODUCTS = [
  {
    id: 'prod-1',
    sku: 'KB-SRE-PRO',
    name: 'Mechanical SRE Keyboard',
    price: 149.00,
    icon: '⌨️',
    desc: 'Hot-swappable tactile switches tuned for fast Kubernetes incident response.'
  },
  {
    id: 'prod-2',
    sku: 'HOODIE-OTEL',
    name: 'Distributed Tracing Hoodie',
    price: 65.00,
    icon: '👕',
    desc: 'Heavyweight black cotton featuring OpenTelemetry trace context propagation.'
  },
  {
    id: 'prod-3',
    sku: 'CAP-AMQP',
    name: 'RabbitMQ Message Cap',
    price: 28.00,
    icon: '🧢',
    desc: 'Low-latency headwear with durable topic exchange routing key patch.'
  },
  {
    id: 'prod-4',
    sku: 'FIDO2-KEY',
    name: 'Cluster Key Security Token',
    price: 45.00,
    icon: '🔑',
    desc: 'Hardware token for zero-trust Kubernetes API server access.'
  }
];

let cart = [];

function init() {
  renderProducts();
}

function renderProducts() {
  const grid = document.getElementById('products-grid');
  grid.innerHTML = PRODUCTS.map(p => `
    <div class="product-card">
      <div>
        <div class="product-icon">${p.icon}</div>
        <h4 class="product-title">${p.name}</h4>
        <p class="product-desc">${p.desc}</p>
      </div>
      <div class="product-price-row">
        <span class="product-price">$${p.price.toFixed(2)}</span>
        <button class="btn-add" onclick="addToCart('${p.id}')">+ Add to Cart</button>
      </div>
    </div>
  `).join('');
}

function addToCart(productId) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return;

  const existing = cart.find(item => item.id === productId);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...product, qty: 1 });
  }

  updateCartUI();
}

function updateCartUI() {
  const itemsContainer = document.getElementById('cart-items');
  const countEl = document.getElementById('cart-count');
  const totalEl = document.getElementById('total-amount');
  const checkoutBtn = document.getElementById('checkout-btn');

  const totalCount = cart.reduce((acc, item) => acc + item.qty, 0);
  const totalPrice = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);

  countEl.textContent = `${totalCount} items`;
  totalEl.textContent = `$${totalPrice.toFixed(2)}`;
  checkoutBtn.disabled = cart.length === 0;

  if (cart.length === 0) {
    itemsContainer.innerHTML = '<p class="empty-cart">Your cart is empty. Click an item to add it!</p>';
    return;
  }

  itemsContainer.innerHTML = cart.map(item => `
    <div class="cart-item">
      <span class="cart-item-title">${item.name} × ${item.qty}</span>
      <span class="cart-item-price">$${(item.price * item.qty).toFixed(2)}</span>
    </div>
  `).join('');
}

async function checkout() {
  const checkoutBtn = document.getElementById('checkout-btn');
  checkoutBtn.disabled = true;
  checkoutBtn.textContent = 'Ingesting Order...';

  const orderPayload = {
    userId: 'web-shopper-1',
    amount: cart.reduce((acc, item) => acc + (item.price * item.qty), 0),
    items: cart.map(item => ({ sku: item.sku, qty: item.qty, price: item.price }))
  };

  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });

    if (!response.ok) {
      throw new Error(`Order failed with status ${response.status}`);
    }

    const data = await response.json();
    console.log('[Storefront] Order placed:', data);

    // Clear cart
    cart = [];
    updateCartUI();
    checkoutBtn.textContent = 'Place Order (Async Ingress)';

    // Start real-time tracking
    trackOrder(data.orderId, orderPayload.amount);
  } catch (err) {
    console.error('[Storefront] Checkout error:', err);
    alert('Failed to place order: ' + err.message);
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = 'Place Order (Async Ingress)';
  }
}

function trackOrder(orderId, amount) {
  const feed = document.getElementById('tracker-feed');
  const empty = feed.querySelector('.empty-feed');
  if (empty) empty.remove();

  const box = document.createElement('div');
  box.className = 'order-box';
  box.id = `box-${orderId}`;
  box.innerHTML = `
    <div class="order-box-header">
      <span class="order-id">${orderId}</span>
      <span class="status-badge pending" id="badge-${orderId}">PENDING</span>
    </div>
    <div class="order-timeline">
      <div class="timeline-step done" id="step-1-${orderId}">
        <span class="step-icon">✔</span>
        <span>1. Ingress Accepted (HTTP 202)</span>
      </div>
      <div class="timeline-step done" id="step-2-${orderId}">
        <span class="step-icon">✔</span>
        <span>2. Published to RabbitMQ (cloudmart.events)</span>
      </div>
      <div class="timeline-step" id="step-3-${orderId}">
        <span class="step-icon">⏳</span>
        <span>3. Payment Worker Processing...</span>
      </div>
      <div class="timeline-step" id="step-4-${orderId}">
        <span class="step-icon">⏳</span>
        <span>4. Order Confirmed in Redis</span>
      </div>
    </div>
  `;

  feed.prepend(box);

  // Poll order status
  let pollAttempts = 0;
  const interval = setInterval(async () => {
    pollAttempts++;
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (!res.ok) return;

      const order = await res.json();
      if (order.status === 'CONFIRMED') {
        clearInterval(interval);

        // Update UI
        const badge = document.getElementById(`badge-${orderId}`);
        if (badge) {
          badge.className = 'status-badge confirmed';
          badge.textContent = 'CONFIRMED';
        }

        const step3 = document.getElementById(`step-3-${orderId}`);
        if (step3) {
          step3.className = 'timeline-step done';
          step3.innerHTML = `<span class="step-icon">✔</span><span>3. Payment Verified (${order.paymentId})</span>`;
        }

        const step4 = document.getElementById(`step-4-${orderId}`);
        if (step4) {
          step4.className = 'timeline-step done';
          step4.innerHTML = `<span class="step-icon">✔</span><span>4. State Confirmed in Redis Cache</span>`;
        }
      }
    } catch (e) {
      console.warn('Poll error:', e);
    }

    if (pollAttempts > 20) {
      clearInterval(interval);
    }
  }, 350);
}

window.addEventListener('DOMContentLoaded', init);
