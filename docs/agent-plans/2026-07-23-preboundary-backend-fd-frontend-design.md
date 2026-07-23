# Pre-boundary Backend with fd79896 Frontend Design

## Goal

Build and verify a deployment branch that keeps the model and server behavior from commit `0992fe3a19f1db99c159268d87af3beef6f00720` while making the frontend exactly match commit `fd798968c89c4a77f189a0bf240546db40bf7a68`.

The immediate product goal is to restore successful coaching plan generation without losing the approved newer frontend presentation.

## Confirmed Root Cause

Production requests on `fd79896` reached the model successfully but the `plan` response was rejected twice by the fact-boundary validator with `UNSUPPORTED_NUMBER` and `UNSUPPORTED_CAUSALITY`. The fact-boundary implementation entered the main history after `0992fe3`, beginning with `3cd11d5`.

This design therefore removes the validator by selecting the last pre-boundary backend commit instead of trying another partial validator repair.

## Scope

### Included

- Use `0992fe3` as the complete baseline for prompts, server code, contracts, and existing frontend.
- Prove the baseline with automated tests and one paid, real local model workflow.
- Port the five frontend-only commits between `0992fe3` and `fd79896`, including their `tests/frontend.spec.js` changes.
- Verify that the resulting `frontend/` tree and frontend test file exactly match `fd79896`.
- Run the full automated suite and one additional paid, real local model workflow after the frontend port.
- Push a dedicated deployment branch only after all local gates pass.
- Deploy with the current server branch retained as a rollback point.

### Excluded

- No fact-boundary validator code, retry guidance, or diagnostics from commits after `0992fe3`.
- No changes to prompts, model parameters, API contracts, environment variable values, Nginx, or systemd configuration unless live preflight proves an existing configuration is incompatible.
- No unrelated refactoring, dependency upgrades, cleanup of current untracked documents, or changes to `main`.

## Version Composition

### Backend and prompt baseline

Use the complete tree from:

```text
0992fe3a19f1db99c159268d87af3beef6f00720
test: preserve coach assistant branding
```

### Frontend port

Cherry-pick these commits in their original order:

1. `84d03b56c46930a1110044b28638874e7b4c542f` — hide internal classification details.
2. `11b543e897193382bd062c9573b60c36c0b2b56d` — style plan list markers.
3. `7c94fdd4c48f3f789004d664a80588222b766f3b` — preserve frontend rendering boundaries.
4. `3790bf9515d360e8f4eb784c80fbacba0313b6db` — add concise profile summaries.
5. `81d78cfe997c31603cd7916d330cbd02a8e05aac` — show concise classification summary.

Each commit is frontend-only apart from its corresponding `tests/frontend.spec.js` update. Cherry-picking preserves the original intent and test history better than copying final files manually.

## Isolation and Secrets

- Work only in `D:\codex-pj\teacher-preboundary-frontend` on branch `codex/preboundary-fd-frontend`.
- Preserve the current primary checkout and all of its untracked documents.
- Do not copy, print, parse, or commit `.env` contents.
- For real local verification, launch Node with the existing primary checkout `.env` path and an explicit isolated port. Existing process environment must override the file's `PORT` value.
- Stop the local verification process immediately after each real workflow.

## Verification Flow

### Gate 1: Baseline automation

- Confirm Node.js satisfies `>=20`.
- Confirm dependency manifests are unchanged between `0992fe3` and the currently installed dependency source.
- Install or reuse dependencies only after consistency checks.
- Run server tests and Playwright tests from the isolated worktree.
- Stop on any baseline failure.

### Gate 2: Baseline real model workflow

- Start the isolated `0992fe3` service on a non-production local port.
- Perform exactly one representative `intake -> classify -> plan` workflow.
- Require HTTP 200 for all three routes and a rendered coaching plan.
- This gate is a paid API test and must not be retried automatically.
- If it fails, collect safe error codes, stop the process, and do not port the frontend.

### Gate 3: Frontend port and deterministic comparison

- Cherry-pick the five approved commits in order.
- Resolve no conflict by guessing. Any conflict stops the operation for review.
- Require no changes outside `frontend/` and `tests/frontend.spec.js` from these commits.
- Require the final `frontend/` tree and `tests/frontend.spec.js` to have no diff from `fd79896`.
- Require server, prompt, contract, and model-client files to remain identical to `0992fe3`.

### Gate 4: Full regression

- Run the complete repository test command.
- Confirm zero failures and no unexpected tracked changes.
- Start the combined local service on the isolated port.
- Perform exactly one additional paid `intake -> classify -> plan` workflow.
- Require successful plan rendering and HTTP 200 responses.

### Gate 5: Publication and deployment

- Review `git status`, the complete diff, commit history, and secret exclusions.
- Push only the dedicated deployment branch to `lixiaobai405-spec/teacher`.
- On the server, verify live branch, commit, tracked cleanliness, dependencies, service state, ports, disk, and memory before mutation.
- Prepare a server-local branch at the exact tested commit.
- Stop `teacher`, switch the working tree, start it, and poll direct and Nginx health endpoints.
- If switching, startup, or health checks fail, automatically switch back to the recorded server branch and commit.
- After infrastructure health passes, perform one final explicitly approved production workflow before declaring success.

## Failure Handling

- Automated test failure: stop and diagnose before any real model call.
- Real baseline model failure: retain `0992fe3` evidence and stop; do not port the frontend.
- Cherry-pick conflict: abort the cherry-pick and review the conflicting dependency instead of forcing a resolution.
- Frontend identity mismatch: stop and compare the missing commit or test change.
- Real combined model failure: stop and compare request payloads between the baseline and combined frontend before changing backend rules.
- Deployment failure: execute the recorded server rollback and verify both health endpoints.

## Acceptance Criteria

- The final backend, prompts, and model client are identical to `0992fe3`.
- The final `frontend/` directory and `tests/frontend.spec.js` are identical to `fd79896`.
- All automated tests pass locally.
- Both approved local real model workflows succeed without automatic retries by the operator.
- The branch contains no `.env`, credentials, logs, caches, or unrelated documents.
- The production deployment passes direct and Nginx health checks and one approved real workflow.
- The previous server branch and exact rollback commit remain available.
