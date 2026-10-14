# Kubernetes Microservices & Cloud-Native Observability

A production-grade, hands-on project deploying a distributed, event-driven microservices platform into **Kubernetes**, instrumented with end-to-end cloud-native observability (**Prometheus Operator**, **Loki**, **Tempo**, and **OpenTelemetry**).

---

## 🎯 Mission & Learning Objectives

1. **Master Core Kubernetes Primitives**: Translate Docker Compose mental models to Pods, Deployments, Services, ConfigMaps, Secrets, and Ingress.
2. **Event-Driven Microservices Architecture**: Decouple synchronous service-to-service calls using **RabbitMQ** (AMQP) for asynchronous order and payment processing with Dead Letter Queues (DLQ).
3. **Enterprise Monitoring with Prometheus Operator**: Deploy `kube-prometheus-stack` via Helm, replacing static scrapers with declarative `ServiceMonitor` & `PodMonitor` Custom Resource Definitions (CRDs).
4. **Cluster Health & Message Queue SRE Observability**: Monitor Node pressure, Pod restarts, OOMKills, and RabbitMQ consumer lag / queue depth using Prometheus exporters.
5. **Full 3-Pillar Observability across Asynchronous Boundaries**:
   - **Metrics**: `kube-prometheus-stack` + RabbitMQ Prometheus plugin
   - **Logs**: Promtail DaemonSet streaming pod stdout to Grafana Loki
   - **Traces**: OpenTelemetry auto-instrumentation & manual AMQP header propagation to Grafana Tempo
   - **Unified Correlation**: Trace an asynchronous order from HTTP Ingress ➔ Message Queue Publish ➔ Consumer Processing ➔ Database Write in Grafana flame graphs.

---

## 🏗️ Services & Infrastructure

| Service / Component | Role | Runtime / Image | Ports |
|---|---|---|---|
| **frontend** | Web UI (Single Page App) | Nginx / Alpine | HTTP :80 |
| **order-service** | Ingress API, order management & AMQP publisher/consumer | Node.js | HTTP :8080 |
| **payment-service** | Payment processor & AMQP consumer/publisher | Node.js | HTTP :8081 |
| **rabbitmq** | Asynchronous Message Broker & Event Bus | `rabbitmq:3-management-alpine` | AMQP :5672, UI :15672, Metrics :15692 |
| **redis-cache** | High-speed cache and temporary datastore | `redis:7-alpine` | TCP :6379 |

---

## 📂 Project Structure (Planned)

```
k8s-microservices/
├── README.md               # Project documentation and setup guide
├── ROADMAP.md              # Phased execution checklist
├── ARCHITECTURE.md         # Architecture diagrams & service contracts
├── docs/                   # Visual architectural diagrams & assets
├── cluster/                # k3d / cluster initialization scripts
├── services/               # Microservice source code & Dockerfiles
│   ├── frontend/
│   ├── order-service/
│   └── payment-service/
├── k8s/                    # Raw Kubernetes manifests
│   ├── namespaces/
│   ├── base/
│   │   ├── frontend/
│   │   ├── order-service/
│   │   ├── payment-service/
│   │   ├── rabbitmq/       # RabbitMQ Deployment, Service, ConfigMap
│   │   ├── redis/
│   │   └── ingress/
│   └── overlays/
└── observability/          # Helm values & CRD manifests
    ├── prometheus-operator/
    ├── loki/
    └── tempo/
```

---

## 🛠️ Prerequisites for the Next Session

- **Docker**: Installed and running.
- **kubectl**: Kubernetes CLI (to be installed in `~/.local/bin`).
- **k3d**: Lightweight Kubernetes in Docker engine (to be installed in `~/.local/bin`).
- **Helm**: Kubernetes package manager for deploying the Prometheus Operator.

*See [ROADMAP.md](./ROADMAP.md) for the phased plan to pick up in the next conversation.*
