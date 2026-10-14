# Agent Rules - Learning Mode

## 🔒 Immutable Rule
**NEVER mutate, edit, write, or delete any file in this workspace.**

### Allowed Operations (Read-Only)
- `read` - Read file contents
- `bash` - Run commands that **do not mutate state**:
  - `ls`, `find`, `tree` - Directory exploration
  - `cat`, `head`, `tail`, `less` - File viewing
  - `grep`, `rg` - Searching
  - `helm lint`, `helm template`, `helm dependency list` - Helm validation (dry-run only)
  - `kubectl get`, `kubectl describe`, `kubectl logs` - Cluster inspection (if cluster exists)
  - `docker images`, `docker ps` - Docker inspection
  - `git status`, `git log`, `git diff` - Git history (no commits)

### Forbidden Operations
- `edit` - Any file modification
- `write` - Creating new files
- `bash` with mutating commands: `rm`, `mv`, `cp`, `helm install`, `helm upgrade`, `kubectl apply`, `kubectl delete`, `docker build`, `git commit`, etc.

---

## 🎯 Learning Objective
Explore and understand the existing codebase:
- Helm chart structure and templating
- Kubernetes manifests and best practices
- Microservice code (Node.js, nginx)
- Dockerfiles
- Observability stack plans

Ask questions, request explanations, run read-only commands to inspect. No changes will be made.