# CloudMart Kubernetes Microservices Platform

A **learning-focused** cloud-native e-commerce platform demonstrating event-driven microservices architecture deployed on **k3d** (k3s in Docker). Built to explore Kubernetes, Helm, RabbitMQ, Redis, and microservice communication patterns.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           k3d Multi-Node Cluster                            │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────────────┐   │
│  │   Frontend   │───▶│   order-service  │───▶│       RabbitMQ           │   │
│  │   (nginx)    │    │   (Express.js)   │    │   (cloudmart.events)     │   │
│  │   Port 80    │    │   Port 8080      │    │   Exchange: topic        │   │
│  └──────────────┘    └────────┬─────────┘    └───────────┬──────────────┘   │
│                               │                            │                 │
│                    ┌──────────▼──────────┐                │                 │
│                    │      Redis Cache    │◀───────────────┘                 │
│                    │   (order:store)     │    ┌─────────────────────────┐  │
│                    └─────────────────────┘    │   payment-service       │  │
│                                               │   (Express.js Consumer) │  │
│                                               │   Port 8081             │  │
│                                               └───────────┬─────────────┘  │
│                                                           │               │
│                                               ┌───────────▼─────────────┐  │
│                                               │   Redis (payment:audit) │  │
│                                               └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                          ┌─────────▼─────────┐
                          │   Traefik Ingress │
                          │   Port 8080       │
                          └───────────────────┘
```

### Event Flow (Choreography Pattern)

| Event | Publisher | Consumer | Routing Key | Description |
|-------|-----------|----------|-------------|-------------|
| `order.created` | order-service | payment-service | `order.created` | New order placed, triggers payment processing |
| `payment.processed` | payment-service | order-service | `payment.processed` | Payment completed (success/failed), updates order status |
| `payment.*` | payment-service | order-service | `payment.*` | Wildcard binding for all payment events |

---

## 📦 Services

### 1. **frontend** (nginx)
- **Technology**: Nginx serving static HTML/CSS/JS
- **Port**: 80 (internal), 8080 (via Ingress)
- **Features**:
  - Product catalog with add-to-cart
  - Real-time transaction monitor
  - Live order status polling
  - Responsive design with custom CSS

### 2. **order-service** (Node.js/Express)
- **Technology**: Express.js, amqplib, ioredis
- **Port**: 8080
- **Endpoints**:
  - `POST /api/orders` — Create order (returns 202 Accepted, async)
  - `GET /api/orders/:id` — Check order status
  - `GET /healthz` — Kubernetes liveness/readiness probe
- **Behavior**:
  - Stores order in Redis (`order:{id}`)
  - Publishes `order.created` event to RabbitMQ
  - Consumes `payment.*` events to update order status

### 3. **payment-service** (Node.js/Express)
- **Technology**: Express.js, amqplib, ioredis
- **Port**: 8081 (health only, no public API)
- **Endpoints**:
  - `GET /healthz` — Kubernetes probe
- **Behavior**:
  - Consumes `order.created` from queue `orders.process-payment`
  - Simulates payment gateway (100ms latency)
  - Stores payment audit in Redis (`payment:{id}`)
  - Publishes `payment.processed` event
  - **Dead Letter Queue** configured for failed messages

### 4. **Infrastructure**

| Component | Version | Purpose |
|-----------|---------|---------|
| **RabbitMQ** | 4.3.6 | Message broker (topic exchange, DLX) |
| **Redis** | 7.0.11 | Order state cache + payment audit logs |
| **Traefik** | (ingress) | Ingress controller (port 8080) |

---

## 🚀 Quick Start (k3d)

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- [k3d](https://k3d.io/#installation)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Helm](https://helm.sh/docs/intro/install/)

### 1. Create k3d Cluster
```bash
# Create a multi-node cluster with Traefik ingress on port 8080
k3d cluster create cloudmart \
  --agents 2 \
  --servers 1 \
  -p "8080:80@loadbalancer" \
  -p "8443:443@loadbalancer" \
  --k3s-arg "--disable=traefik@server:0"  # We'll install Traefik via Helm if needed
```

> **Note**: The Helm chart expects Traefik as ingress class. Install Traefik if not present:
```bash
helm repo add traefik https://traefik.github.io/charts
helm repo update
helm install traefik traefik/traefik --namespace kube-system
```

### 2. Build Docker Images (load into k3d)
```bash
# Build each service image
docker build -t cloudmart/frontend:v1.0 ./services/frontend
docker build -t cloudmart/order-service:v1.1 ./services/order-service
docker build -t cloudmart/payment-service:v1.1 ./services/payment-service

# Import into k3d cluster
k3d image import cloudmart/frontend:v1.0 cloudmart/order-service:v1.1 cloudmart/payment-service:v1.1 -c cloudmart
```

### 3. Deploy with Helm
```bash
cd deploy/helm/k8s
helm install cloudmart . --namespace cloudmart --create-namespace
```

### 4. Access the Application
- **Frontend**: http://localhost:8080
- **Order API**: http://localhost:8080/api/orders
- **RabbitMQ Management**: `kubectl port-forward -n cloudmart svc/cloudmart-rabbitmq-service 15672:15672` → http://localhost:15672 (user: chames, pass: chames)

---

## 🛠️ Development

### Project Structure
```
k8s-microservices/
├── AGENT.md                    # Agent rules (read-only workspace)
├── README.md                   # This file
├── deploy/
│   └── helm/
│       └── k8s/                # Helm chart
│           ├── Chart.yaml
│           ├── values.yaml
│           └── templates/
│               ├── ingress.yaml
│               ├── frontend-deployment.yaml
│               ├── frontend-service.yaml
│               ├── order-deployment.yaml
│               ├── order-service.yaml
│               ├── payment-deployment.yaml
│               ├── payment-service.yaml
│               ├── rabbitmq-deployment.yaml
│               ├── rabbitmq-service.yaml
│               ├── rabbitmq-secrets.yaml
│               ├── redis-deployment.yaml
│               └── redis-service.yaml
└── services/
    ├── frontend/               # Nginx static site
    │   ├── Dockerfile
    │   ├── nginx.conf
    │   └── src/
    │       ├── index.html
    │       ├── style.css
    │       └── app.js
    ├── order-service/          # Express.js API
    │   ├── Dockerfile
    │   ├── package.json
    │   └── server.js
    └── payment-service/        # Express.js Consumer
        ├── Dockerfile
        ├── package.json
        └── server.js
```

### Local Development (without k3d)
```bash
# Start infrastructure
docker-compose up -d redis rabbitmq

# Run services locally
cd services/order-service && npm install && npm start
cd services/payment-service && npm install && npm start
cd services/frontend && python3 -m http.server 8080  # or use nginx
```

---

## 🔍 Key Learning Concepts Demonstrated

### Kubernetes Patterns
- **Helm templating** with values.yaml for environment configuration
- **Secrets management** (RabbitMQ credentials via Kubernetes secrets)
- **Health probes** (liveness/readiness) on all services
- **Resource quotas** (CPU/memory requests & limits)
- **Ingress routing** with path-based rules (Traefik)

### Microservice Patterns
- **Event-driven choreography** (no central orchestrator)
- **Async request-reply** via message broker (202 Accepted → poll for status)
- **Dead Letter Queue** for poison message handling
- **Idempotent consumers** (payment service acknowledges only after processing)
- **Distributed tracing headers** (W3C trace-context ready)

### Observability Ready
- Structured JSON logging
- Health endpoints with dependency checks
- Correlation IDs in events (`eventId`, `orderId`)
- RabbitMQ management UI for queue monitoring

---

## 📚 Helm Chart Details

### Configuration (`values.yaml`)

```yaml
# Key customization points:
frontend:
  replicaCount: 1
  image: { repository, tag, pullPolicy }
  resources: { limits, requests }

orderService:
  replicaCount: 1
  image: { repository, tag, pullPolicy }
  resources: { limits, requests }

paymentService:
  replicaCount: 1
  image: { repository, tag, pullPolicy }
  resources: { limits, requests }

rabbitmq:
  auth: { username, password, erlangCookie }
  persistence: { enabled: false }

redis:
  persistence: { enabled: false }

ingress:
  enabled: true
  className: traefik
  paths: [...]
```

### Template Functions Used
- `.Release.Name` — Unique release prefix for all resources
- `.Values.<service>.image` — Configurable image/tag/pullPolicy
- `valueFrom.secretKeyRef` — Inject RabbitMQ credentials from secret
- Range iteration over `.Values.ingress.paths`

---

## 🧪 Testing the Flow

### 1. Place an Order
```bash
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{"items": [{"id": "gpu-4090", "qty": 1}], "userId": "user-123", "amount": 1599.99}'
```
Response: `202 Accepted` with `orderId` and `status: PENDING`

### 2. Check Order Status
```bash
curl http://localhost:8080/api/orders/<orderId>
```
Watch status transition: `PENDING` → `CONFIRMED` (or `FAILED`)

### 3. Monitor via RabbitMQ UI
- Queue: `orders.process-payment` — messages consumed by payment-service
- Queue: `orders.order-status-update` — payment events consumed by order-service
- DLQ: `cloudmart.dlq` — failed messages after retries exhausted

---

## 🧹 Cleanup
```bash
helm uninstall cloudmart -n cloudmart
kubectl delete namespace cloudmart
k3d cluster delete cloudmart
```

---

## 📖 Learning Resources Referenced

- [k3d Documentation](https://k3d.io/)
- [Helm Chart Best Practices](https://helm.sh/docs/chart_best_practices/)
- [RabbitMQ AMQP 0-9-1 Model](https://www.rabbitmq.com/tutorials/amqp-concepts.html)
- [Kubernetes Probe Patterns](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Event-Driven Architecture](https://microservices.io/patterns/data/event-driven-architecture.html)

---

## 📄 License

This project is for **educational/learning purposes only**. No warranty provided.

---

*Built with ❤️ for learning Kubernetes, microservices, and cloud-native patterns on k3d.*