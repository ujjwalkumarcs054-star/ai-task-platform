# AI Task Processing Platform

A production-shaped MERN + Python-worker application: users create text-processing
tasks (uppercase / lowercase / reverse / word count) that run asynchronously
via a Redis queue and a Python worker, with status/results tracked in MongoDB.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full architecture write-up.

## Project layout

```
ai-task-platform/
├── backend/        # Node.js + Express API
├── worker/          # Python background worker
├── frontend/        # React (Vite) SPA
├── docker-compose.yml
├── k8s/             # Kubernetes manifests
├── argocd/          # Argo CD Application (GitOps)
└── .github/workflows/ci-cd.yml
```

---

## 1. Local development with Docker Compose

**Prerequisites:** Docker + Docker Compose installed.

```bash
cd ai-task-platform
cp .env.example .env
# edit .env and set a real JWT_SECRET, e.g.:
#   JWT_SECRET=$(openssl rand -hex 32)

docker compose up --build
```

This starts:
- `mongo` on `localhost:27017`
- `redis` on `localhost:6379`
- `backend` on `localhost:5000`
- `worker` (2 replicas)
- `frontend` on `localhost:3000`

Open **http://localhost:3000**, register a user, create a task, and watch its
status move from `PENDING` → `RUNNING` → `SUCCESS` (the dashboard polls every
3 seconds).

To stop: `docker compose down` (add `-v` to also wipe the Mongo volume).

---

## 2. Running components individually (no Docker)

**Backend**
```bash
cd backend
npm install
cp ../.env.example .env   # add MONGO_URI=mongodb://localhost:27017/ai_task_platform
                          #     REDIS_URL=redis://localhost:6379
npm run dev
```

**Worker**
```bash
cd worker
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export MONGO_URI=mongodb://localhost:27017/ai_task_platform
export REDIS_URL=redis://localhost:6379
python worker.py
```

**Frontend**
```bash
cd frontend
npm install
npm run dev   # http://localhost:3000, proxies /api to backend via vite or nginx in prod
```

You'll need a local MongoDB and Redis running (e.g. via `docker run -p 27017:27017 mongo:7`
and `docker run -p 6379:6379 redis:7-alpine`).

---

## 3. Building & pushing container images

```bash
docker build -t YOUR_REGISTRY/ai-task-backend:latest ./backend
docker build -t YOUR_REGISTRY/ai-task-worker:latest ./worker
docker build -t YOUR_REGISTRY/ai-task-frontend:latest ./frontend

docker push YOUR_REGISTRY/ai-task-backend:latest
docker push YOUR_REGISTRY/ai-task-worker:latest
docker push YOUR_REGISTRY/ai-task-frontend:latest
```

Replace `YOUR_REGISTRY` in `k8s/backend.yaml`, `k8s/worker.yaml`, and
`k8s/frontend.yaml` with your actual registry/namespace (e.g. `docker.io/yourname`).

---

## 4. Kubernetes deployment (step by step)

**Prerequisites:** a running cluster (k3s is fine) and `kubectl` configured against it.

```bash
# 1. Create the namespace
kubectl apply -f k8s/namespace.yaml

# 2. Create config (non-secret values)
kubectl apply -f k8s/configmap.yaml

# 3. Create the JWT secret (do NOT use the placeholder in git)
kubectl create secret generic app-secrets \
  --namespace ai-task-platform \
  --from-literal=JWT_SECRET=$(openssl rand -hex 32)

# 4. Deploy stateful dependencies
kubectl apply -f k8s/mongo.yaml
kubectl apply -f k8s/redis.yaml

# 5. Deploy the application tiers
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/worker.yaml
kubectl apply -f k8s/frontend.yaml

# 6. Enable worker autoscaling
kubectl apply -f k8s/worker-hpa.yaml

# 7. Expose via ingress (requires an nginx ingress controller installed)
kubectl apply -f k8s/ingress.yaml
```

Check rollout status:
```bash
kubectl -n ai-task-platform get pods
kubectl -n ai-task-platform rollout status deployment/backend
```

If you don't have an ingress controller yet:
```bash
# k3s ships with Traefik by default; for nginx-ingress instead:
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.2/deploy/static/provider/cloud/deploy.yaml
```

Add `ai-task-platform.local` to `/etc/hosts` pointing at your ingress
controller's external IP (or `127.0.0.1` for local k3s/kind) to browse the app.

---

## 5. GitOps with Argo CD (step by step)

1. **Create a separate infrastructure repository** (e.g.
   `ai-task-platform-infra`) and copy the `k8s/` folder into it at the repo
   root or under `k8s/` — this repo is what Argo CD watches, kept separate
   from application source so CI can update image tags without touching app
   code.

2. **Install Argo CD** into your cluster:
   ```bash
   kubectl create namespace argocd
   kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
   ```

3. **Access the Argo CD UI**:
   ```bash
   kubectl -n argocd port-forward svc/argocd-server 8080:443
   # https://localhost:8080
   # username: admin
   # password:
   kubectl -n argocd get secret argocd-initial-admin-secret \
     -o jsonpath="{.data.password}" | base64 -d
   ```

4. **Register the Application**: edit `argocd/application.yaml`, set
   `repoURL` to your real infra repo URL, then:
   ```bash
   kubectl apply -f argocd/application.yaml
   ```

5. **Verify auto-sync**: the Application has
   `syncPolicy.automated.{prune,selfHeal}` enabled, so it will
   automatically apply manifests from the infra repo and revert any manual
   `kubectl` drift. Confirm in the UI that the app shows **Synced** and
   **Healthy**, then take the required dashboard screenshot for submission.

---

## 6. CI/CD pipeline (GitHub Actions)

The workflow at `.github/workflows/ci-cd.yml` runs on every push to `main`:

1. **Lint** backend and frontend.
2. **Build & push** Docker images for backend, worker, and frontend, tagged
   with both `latest` and the short git SHA.
3. **Update the infrastructure repo**: checks out the infra repo, replaces
   the image tags in its `k8s/*.yaml` manifests with the new SHA, and pushes
   the commit — Argo CD then picks up that change automatically.

**Required GitHub secrets** (Settings → Secrets and variables → Actions):

| Secret | Purpose |
|---|---|
| `DOCKERHUB_USERNAME` | Registry login |
| `DOCKERHUB_TOKEN` | Registry auth token |
| `INFRA_REPO_PAT` | Personal access token with push rights to the infra repo |

Also update the placeholders in the workflow file:
- `env.IMAGE_NAMESPACE` → your Docker Hub username/org
- `YOUR_ORG/ai-task-platform-infra` → your actual infra repo path

---

## 7. Security notes

- Passwords hashed with bcrypt (cost factor 12).
- JWT-based auth, 7-day expiry, verified on every `/api/tasks` route.
- `helmet` sets standard security headers; CORS is configurable via
  `CORS_ORIGIN`.
- Global + auth-specific rate limiting (`express-rate-limit`) to blunt
  brute-force and abuse.
- No secrets committed to git — `k8s/secret.yaml` is a placeholder template
  only; real secrets are created imperatively (see step 3 above) or via a
  secrets manager in a real production setup.
- All containers run as non-root users (see each `Dockerfile`).

## 8. API reference (quick summary)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | – | Create account, returns JWT |
| POST | `/api/auth/login` | – | Login, returns JWT |
| POST | `/api/tasks` | ✔ | Create a task (status `PENDING`) |
| POST | `/api/tasks/:id/run` | ✔ | Enqueue task for execution |
| GET | `/api/tasks` | ✔ | List current user's tasks |
| GET | `/api/tasks/:id` | ✔ | Get single task status/result/logs |
| GET | `/healthz` / `/readyz` | – | Liveness/readiness checks |
