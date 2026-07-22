# Architecture Document — AI Task Processing Platform

## 1. Overall System Architecture

The platform follows a decoupled, queue-based architecture:

```
                     ┌────────────┐
        HTTPS        │  Frontend  │  (React SPA, served by nginx)
   ┌────────────────►│  (nginx)   │
   │                  └─────┬──────┘
   │                        │ /api/*
   │                        ▼
   │                  ┌────────────┐        ┌───────────┐
   │                  │  Backend   │◄──────► │  MongoDB  │
   │                  │ (Express)  │         │  (tasks,  │
   │                  └─────┬──────┘         │   users)  │
   │                        │ LPUSH           └───────────┘
   │                        ▼                      ▲
   │                  ┌────────────┐               │
   │                  │   Redis    │               │
   │                  │  (queue)   │               │
   │                  └─────┬──────┘               │
   │                        │ BLPOP                 │
   │                        ▼                       │
   │                  ┌────────────┐                │
   │                  │  Worker(s) │────────────────┘
   │                  │  (Python)  │  writes status/result
   │                  └────────────┘
   │
Ingress (k8s) routes / → frontend, /api → backend
```

Key design decision: the backend never runs task logic itself. It only
persists the task record and enqueues the task ID. This keeps the API
tier fast and stateless (horizontally scalable) and isolates
long-running or CPU-bound work in the worker tier, which can scale
independently.

Each component is packaged as its own container, deployed to its own
Kubernetes Deployment/Service, and connected via ClusterIP DNS names
(`mongo`, `redis`, `backend`, `frontend`).

## 2. Worker Scaling Strategy

Workers are stateless consumers: any worker can pop the next task ID
from the shared Redis list (`BLPOP`), so scaling out is just adding
replicas — no partitioning or coordination logic is required.

- **Horizontal Pod Autoscaler** (`k8s/worker-hpa.yaml`) scales the
  worker Deployment between 2 and 15 replicas based on CPU
  utilization (target 65%).
- Because `BLPOP` is atomic in Redis, two workers can never dequeue
  the same task — this gives us safe at-most-once delivery per item
  without extra locking.
- Scale-up reacts quickly (30s stabilization window, +3 pods per
  step) since queue backlogs should drain fast; scale-down is slower
  (120s window) to avoid thrashing during bursty traffic.
- For extreme burst scenarios, `KEDA` (Kubernetes Event-Driven
  Autoscaling) could replace the CPU-based HPA with a scaler that
  reads Redis list length directly (`redis` scaler), scaling on queue
  depth rather than CPU — a natural next step if task volume grows
  further.

## 3. Handling High Task Volume (~100,000 tasks/day)

100k tasks/day ≈ 1.16 tasks/sec average, but real traffic is bursty
(e.g., concentrated in business hours), so we design for peak, not
average — assume a peak of ~20-30x average, i.e. ~30-35 tasks/sec.

- **Backend tier**: stateless Express pods behind a Service; scales
  horizontally with its own HPA (not shown by default, but identical
  pattern to the worker HPA, targeting CPU or requests-per-second).
- **Queue tier**: Redis easily handles tens of thousands of ops/sec
  on modest hardware; the queue acts as a shock absorber between
  bursty API traffic and worker throughput, so the API never blocks
  waiting on task execution.
- **Worker tier**: each simple string operation (uppercase, reverse,
  etc.) completes in microseconds, so throughput is bound by worker
  pod count and Redis round-trip latency, not by the operations
  themselves. At even 10ms per task per worker, 15 workers deliver
  ~1,500 tasks/sec — far beyond our peak estimate.
- **Database tier**: writes are two updates per task (RUNNING, then
  SUCCESS/FAILED) — well within MongoDB's write capacity for a single
  replica set at this volume. See indexing strategy below for read
  efficiency as task history grows.
- **Batching consideration**: if volume grows another order of
  magnitude, workers could use `LPOP` in small batches and process
  concurrently (asyncio) rather than one `BLPOP` per task, or shard
  the queue by hashing task ID into multiple Redis lists consumed by
  worker pools — deferred until actual load demands it (avoid
  premature complexity).

## 4. MongoDB Indexing Strategy

Two compound/single-field indexes back the app's real query patterns:

| Index | Purpose |
|---|---|
| `{ userId: 1, createdAt: -1 }` on `tasks` | Powers "list my tasks, most recent first" — the dashboard's primary and most frequent query. Compound index lets Mongo satisfy both the filter and the sort without an in-memory sort. |
| `{ status: 1 }` on `tasks` | Supports operational queries/dashboards that count or list tasks by status (e.g., "how many PENDING tasks are backing up"), and could support a future admin view. |
| unique index on `users.email` | Enforced via schema (`unique: true`), guarantees no duplicate accounts and gives O(log n) login lookups. |

As data grows past tens of millions of documents, we would add:
- TTL index on `finishedAt` for old completed tasks if the product
  only needs recent history (or move old tasks to a cold-storage/
  archive collection).
- Sharding on `userId` if a single replica set's write capacity or
  working set size becomes a bottleneck (userId is a good shard key
  here because nearly all queries are scoped to a single user).

## 5. Redis Failure Handling and Recovery Strategy

Redis in this design holds only ephemeral, replayable state (a queue
of task IDs) — the source of truth for task existence is always
MongoDB. This makes Redis failures recoverable by design:

- **Container restart**: Kubernetes liveness probes restart the Redis
  pod automatically if it becomes unresponsive.
- **Data durability**: Redis is run with `--appendonly yes` (AOF) so
  queued-but-unprocessed task IDs survive a pod restart rather than
  being lost with an in-memory-only cache.
- **Worker resilience**: `worker.py` wraps its Redis calls in
  try/except and reconnects with backoff (`connect_redis()`) rather
  than crashing, so a transient Redis blip doesn't kill worker pods.
- **Backend resilience**: if `enqueueTask` fails (Redis down when a
  user clicks "Run"), the task record remains in MongoDB with status
  `PENDING`. A lightweight **reconciliation sweep** (recommended
  addition: a scheduled Job or worker startup routine that re-queues
  any `PENDING` tasks older than N minutes) re-enqueues orphaned
  tasks once Redis recovers — this guards against the narrow window
  where a task was saved to Mongo but never made it onto the queue.
- **High availability path**: for production-grade durability beyond
  a single pod, move to a managed Redis (e.g., Redis Sentinel/Cluster
  or a cloud provider's managed Redis with replication) so a single
  node failure doesn't cause queue downtime at all.

## 6. Deployment Strategy

### Staging
- Separate namespace (`ai-task-platform-staging`) or separate
  cluster, deployed from a `staging` branch/overlay.
- Argo CD Application watching the `staging` path/branch of the infra
  repo with **automated sync** so every merge to `staging` deploys
  immediately — this is where integration testing happens before
  production.
- Uses smaller resource requests/limits and single replicas to
  control cost, but otherwise mirrors production topology (same
  Docker images, same manifests structure) so staging is a reliable
  predictor of production behavior.

### Production
- Deployed from the `main` branch via the CI/CD pipeline
  (`.github/workflows/ci-cd.yml`): lint → build & tag images with the
  git SHA → push to registry → update image tags in the **separate
  infrastructure repository**.
- Argo CD's Application (`argocd/application.yaml`) auto-syncs
  production from that infra repo, with `selfHeal: true` so any
  manual `kubectl` drift is automatically reverted to match git — git
  is the single source of truth (GitOps).
- Promotion path: staging validates a build; merging/promoting the
  infra repo change (or a PR from staging overlay to production
  overlay) triggers the production sync — a deliberate, auditable
  step rather than deploying directly from CI.
- Rollbacks are just `git revert` on the infra repo (or using Argo
  CD's built-in history/rollback UI), since the desired state is
  always defined declaratively in git.
- Secrets (`JWT_SECRET`, DB credentials) are managed via Kubernetes
  Secrets, provisioned out-of-band (e.g., via `kubectl` or a secrets
  manager/External Secrets Operator) — never committed to either
  repo.
