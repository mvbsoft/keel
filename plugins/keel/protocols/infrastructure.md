# Protocol: infrastructure and configuration

Topic of the `env` specialist group. Question: will build, CI or deploy break, and does the change
leak secrets or widen access?

## Checklist
**Configuration and environment variables**
1. Every new variable the code reads (`process.env.X`, `os.environ`, `getenv`, `${X}` in compose or
   Kubernetes) appears where the project documents them: `.env.example`, README or docs table,
   compose or Helm values, CI env, deploy manifests.
2. A required variable fails fast and clearly when missing, instead of a silent unsafe default.
3. No real secret (token, password, private key, credentials in a URL) in configs, Dockerfile `ENV` or
   `ARG`, compose, CI or IaC files. Example files hold placeholders.

**Docker**
4. Base image pinned to a tag or digest, not `latest` or untagged (when the change touches `FROM`).
5. The image runs as a non-root `USER` (new production images).
6. Copied paths, build arguments, entrypoints and `COPY --from` stage names still exist after the
   change; `.dockerignore` does not exclude what is copied.
7. Build-time secrets not passed through `ARG`/`ENV` (they persist in the image; use secret mounts).
8. Long-running service images have a healthcheck (or orchestrator probes), and the health command
   exists inside the image.

**Compose and Kubernetes**
9. `depends_on` with a health condition has a healthcheck on the dependency; `env_file` entries exist;
   ports, volumes and service names match what the application expects.
10. Kubernetes: no `privileged`, `hostNetwork` or `hostPath` added without reason; `runAsNonRoot`,
    no privilege escalation, dropped capabilities for new workloads; fixed image tags; probes and
    resource requests for new production workloads; referenced ConfigMaps and Secrets exist.

**Terraform and other IaC**
11. Provider versions constrained and the lock file updated; secrets not committed in `*.tfvars`;
    `sensitive` understood as hiding output only (values still land in state).
12. No new ingress open to `0.0.0.0/0` on admin ports; storage encrypted; no `*` IAM actions.

**CI (GitHub Actions and similar)**
13. `permissions:` declared (read-only by default, write per job).
14. Third-party actions pinned to a full commit SHA in workflows with write permissions, secrets or
    releases.
15. No `pull_request_target` or `workflow_run` that checks out and runs untrusted pull-request code.
16. No untrusted `${{ github.event.* }}` (titles, bodies, branch names) interpolated into `run:`; use an
    intermediate environment variable.
17. Secrets not echoed; `persist-credentials: false` when no push is needed.
18. The pipeline still works: referenced scripts, path filters, matrix values, artifact names,
    `needs:` chains, cache keys against the lock file name, runtime versions against the manifest.

**Deploy**
19. The image or tag deployed is the one CI builds; migrations run before the new code needs them;
    ports and health paths agree across Dockerfile, compose, Kubernetes and load balancer config.

## Evidence
- Missing documentation of a variable: the new read at `file:line` and each documented place you
  checked without finding it.
- Hard-coded secret: `file:line` and why it is real rather than a placeholder (known prefixes such as
  `AKIA`, `ghp_`, a private key header, high entropy). Never copy the secret; give a redacted prefix.
- CI injection or pwn request: the trigger line, the checkout ref, the executing step and the
  attacker-controlled field.
- Deploy break: the reference (path, entrypoint, image, port, variable, health path), proof that its
  target is missing or different, and the command that will fail (`docker build`, `kubectl apply`,
  `terraform validate`).

## Do not flag
- Pinning conventions the project already uses everywhere when the change does not touch `FROM`.
- Linter-owned style rules (consecutive `RUN`, label style).
- Missing healthchecks on one-shot, job or init images, or where the orchestrator defines probes.
- Placeholders in example files; dummy secrets in test fixtures or CI-only services.
- Tag-pinned first-party actions where the repository uses tags everywhere.
- Missing `permissions:` when the repository default may already be restricted (unknown from files:
  minor at most).
- Local-development compose files (`*.dev.yml`, overrides) not used by deploy.
- Cost or sizing opinions without a stated requirement.
- Infrastructure code the change did not touch.

## Severity
- **critical**: a real secret committed; a pwn-request workflow or script injection in a privileged
  workflow; a deploy-breaking reference; admin ports open to the internet; a privileged container,
  `hostPath` or host network without reason; public unencrypted storage with data.
- **important**: a new required variable without documentation or example; a write-capable token on a
  workflow handling external input; a mutable third-party action tag in a release or deploy workflow;
  a root user or `latest` base in a new production image; secrets through `ARG`/`ENV`; missing probes
  on a new production deployment; the IaC lock not updated.
- **minor**: missing healthcheck on a non-critical image; `ADD` instead of `COPY`; shell-form `CMD`;
  missing resource limits on a small workload; a variable in README but missing from `.env.example`.

## Principles
- Configuration comes from the environment, never from code.
- CI and workloads get least privilege: pinned versions, minimal permissions, no secrets in images.
- Check the platform's current security rules before relying on a specific field.
