# Pre-boundary Backend with fd79896 Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and deploy a branch whose backend and prompt behavior remains at `0992fe3` while its frontend and frontend tests exactly match `fd79896`.

**Architecture:** Work in the isolated `D:\codex-pj\teacher-preboundary-frontend` worktree. First prove the unmodified `0992fe3` baseline with automated tests and one real model workflow, then cherry-pick five frontend-only commits, prove exact frontend identity and backend immutability, repeat the full validation, push the dedicated branch, and deploy it with an automatic server rollback path.

**Tech Stack:** Git worktrees, PowerShell, Node.js 20+, npm, Node test runner, Playwright, Express, DeepSeek API, systemd, Nginx

---

## File Map

- `frontend/profile-selection.js`: frontend profile labels and concise profile summaries; final content must match `fd79896`.
- `frontend/styles.css`: classification and plan presentation styles; final content must match `fd79896`.
- `frontend/views.js`: classification visibility, plan list rendering, and concise summaries; final content must match `fd79896`.
- `tests/frontend.spec.js`: Playwright coverage for all five frontend commits; final content must match `fd79896`.
- `server/**`, `prompts/**`, `package.json`, `package-lock.json`, `.env.example`: must remain identical to `0992fe3`.
- `docs/agent-plans/2026-07-23-preboundary-backend-fd-frontend-design.md`: approved design and acceptance criteria.
- `docs/agent-plans/2026-07-23-preboundary-backend-fd-frontend-implementation.md`: this executable checklist.

### Task 1: Verify the isolated baseline and install dependencies

**Files:**
- Modify: none in tracked source
- Generate locally: `node_modules/` only

- [x] **Step 1: Confirm the isolated worktree, branch, and baseline ancestry**

Run in PowerShell:

```powershell
$worktree = 'D:\codex-pj\teacher-preboundary-frontend'
Set-Location -LiteralPath $worktree

git status --short --branch
git branch --show-current
git log -3 --oneline --decorate
git merge-base --is-ancestor 0992fe3a19f1db99c159268d87af3beef6f00720 HEAD
Write-Output "baseline_ancestor_exit=$LASTEXITCODE"
```

Expected: branch is `codex/preboundary-fd-frontend`, status is clean, and `baseline_ancestor_exit=0`. The two documentation commits may be above `0992fe3`, but no runtime file may differ yet.

- [x] **Step 2: Prove runtime files still match `0992fe3`**

```powershell
git diff --exit-code 0992fe3a19f1db99c159268d87af3beef6f00720 -- frontend server prompts tests package.json package-lock.json .env.example
Write-Output "runtime_baseline_exit=$LASTEXITCODE"
```

Expected: no diff and `runtime_baseline_exit=0`.

- [x] **Step 3: Check Node and npm without exposing environment secrets**

```powershell
node --version
npm.cmd --version
Test-Path -LiteralPath 'D:\codex-pj\teacher\.env'
```

Expected: Node major version is at least 20 and the final command returns `True`. Do not run `Get-Content` on `.env`.

- [x] **Step 4: Install the exact locked dependencies in the isolated worktree**

This command accesses the npm registry and only writes `node_modules/` in the worktree:

```powershell
npm.cmd ci --no-audit --no-fund
```

Expected: exit code 0.

- [x] **Step 5: Verify top-level dependency consistency and tracked cleanliness**

```powershell
npm.cmd ls --depth=0
git status --short --branch
git diff --check
```

Expected: dependency tree is valid, tracked files are unchanged, and `git diff --check` exits 0.

### Task 2: Run the `0992fe3` automated baseline

**Files:**
- Modify: none
- Test: `tests/server.*.test.js`, `tests/start-script.test.js`, `tests/frontend.spec.js`

- [x] **Step 1: Run server and launcher tests**

```powershell
npm.cmd run test:server
```

Expected: all tests pass and the command exits 0. If Windows launcher tests expose an occupied port, identify the listener before taking any action; do not kill an unrelated process.

- [x] **Step 2: Run Playwright tests**

```powershell
npm.cmd run test:e2e
```

Expected: all Playwright tests pass and the command exits 0.

- [x] **Step 3: Recheck tracked cleanliness**

```powershell
git status --short --branch
git diff --check
git diff --stat
```

Expected: no tracked runtime changes and no diff output.

### Task 3: Perform one paid real workflow on the `0992fe3` baseline

**Files:**
- Modify: none
- Temporary output: `%TEMP%\teacher-preboundary-baseline.stdout.log`, `%TEMP%\teacher-preboundary-baseline.stderr.log`

- [x] **Step 1: Obtain explicit approval for one paid local model workflow**

Expected: the user explicitly approves one `intake -> classify -> plan` workflow. Do not start the server before approval.

- [x] **Step 2: Confirm port 4186 is free**

```powershell
$listener = Get-NetTCPConnection -LocalPort 4186 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    $listener | Select-Object LocalAddress, LocalPort, OwningProcess
    throw 'Port 4186 is already in use; stop for review.'
}
```

Expected: no listener and no exception.

- [x] **Step 3: Start the baseline service without reading or copying `.env`**

```powershell
$worktree = 'D:\codex-pj\teacher-preboundary-frontend'
$envFile = 'D:\codex-pj\teacher\.env'
$stdout = Join-Path $env:TEMP 'teacher-preboundary-baseline.stdout.log'
$stderr = Join-Path $env:TEMP 'teacher-preboundary-baseline.stderr.log'
$previousPort = $env:PORT

Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue

try {
    $env:PORT = '4186'
    $baselineProcess = Start-Process `
        -FilePath (Get-Command node).Source `
        -ArgumentList @("--env-file=$envFile", 'server/index.js') `
        -WorkingDirectory $worktree `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
} finally {
    if ($null -eq $previousPort) {
        Remove-Item Env:PORT -ErrorAction SilentlyContinue
    } else {
        $env:PORT = $previousPort
    }
}

Write-Output "baseline_pid=$($baselineProcess.Id)"
```

Expected: a process ID is printed. No secret value is printed.

- [x] **Step 4: Poll health and open the local page**

```powershell
$ready = $false
1..15 | ForEach-Object {
    if (-not $ready) {
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4186/api/health' -TimeoutSec 2
            if ($health.ok -eq $true) { $ready = $true }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
}

Write-Output "baseline_ready=$ready"
if (-not $ready) { throw 'Baseline service did not become healthy.' }
Start-Process 'http://127.0.0.1:4186/'
```

Expected: `baseline_ready=True` and the browser opens the local application.

- [x] **Step 5: Execute exactly one fixed representative workflow**

2026-07-23 execution note: the user explicitly replaced the fixed values below with the first B-class scenario in `D:\codex-pj\teacher\docs\测试文档.md`. The submitted `intake` request returned HTTP 200, but the first and only `classify` request returned HTTP 503 with `SERVICE_UNAVAILABLE`; no retry and no `plan` request were made. Read-only diagnostics confirmed that the API key authenticates, the account reports available balance, and `deepseek-v4-pro` appears in the available model list. The application currently collapses every non-2xx upstream response into `MODEL_SERVICE_UNAVAILABLE`, so the exact upstream status cannot be recovered from this attempt.

Follow-up diagnostic note: after the user approved safe instrumentation and additional real API calls, mock tests proved both non-2xx and pre-response network diagnostics without exposing the API key, prompts, or model output. The next real `intake` failed before any HTTP response reached the client, while the same request subsequently returned HTTP 200. The completed browser workflow then returned HTTP 200 for `intake`, `classify`, and `plan`, selected the B profile, and rendered the coaching plan. This isolates the earlier 503 to a transient pre-response network failure rather than the request payload, model name, API key, balance, or response validator. Because the approved final composition requires the complete backend to remain identical to `0992fe3`, the temporary instrumentation was removed after diagnosis and no automatic paid retry was added.

Use these non-sensitive values:

```text
岗位类别：基层执行岗
在团队入职时长：1 年以上
当前绩效状态：持续达标
绩效目标 / 上层期望：提升日常任务的主动同步与风险反馈质量。
近期辅导困扰：员工能够独立完成复杂任务且交付质量稳定，但通常需要主管提醒才启动，遇到风险时反馈较晚。
员工特征关键词：学习能力强、主动性不足
补充描述：能够完成复杂任务，交付质量稳定。
```

Complete `员工信息输入 -> 类型判定 -> 教练方案生成` once. Do not click retry.

Expected: `intake`, `classify`, and `plan` each return HTTP 200, and the third step renders a coaching plan without `INVALID_MODEL_RESPONSE`.

- [x] **Step 6: Stop the baseline process and preserve only safe diagnostics**

```powershell
if ($baselineProcess -and -not $baselineProcess.HasExited) {
    Stop-Process -Id $baselineProcess.Id
    $baselineProcess.WaitForExit(5000)
}

Get-NetTCPConnection -LocalPort 4186 -State Listen -ErrorAction SilentlyContinue
Select-String -LiteralPath $stdout, $stderr -Pattern 'MODEL_RESPONSE_REJECTED|INVALID_MODEL_RESPONSE|MODEL_SERVICE_UNAVAILABLE' -ErrorAction SilentlyContinue
```

Expected: port 4186 has no listener and the diagnostic search has no rejection for the successful workflow. If the workflow fails, stop the plan here and diagnose; do not cherry-pick frontend commits.

### Task 4: Port the five approved frontend commits

**Files:**
- Modify: `frontend/profile-selection.js`
- Modify: `frontend/styles.css`
- Modify: `frontend/views.js`
- Modify: `tests/frontend.spec.js`

- [ ] **Step 1: Record the pre-port commit and verify cleanliness**

```powershell
$portBase = (git rev-parse HEAD).Trim()
Write-Output "port_base=$portBase"
git status --short --branch
git diff --quiet
if ($LASTEXITCODE -ne 0) { throw 'Tracked changes exist before frontend port.' }
```

Expected: clean worktree and a recorded commit ID.

- [ ] **Step 2: Cherry-pick the five frontend commits in order**

```powershell
$frontendCommits = @(
    '84d03b56c46930a1110044b28638874e7b4c542f',
    '11b543e897193382bd062c9573b60c36c0b2b56d',
    '7c94fdd4c48f3f789004d664a80588222b766f3b',
    '3790bf9515d360e8f4eb784c80fbacba0313b6db',
    '81d78cfe997c31603cd7916d330cbd02a8e05aac'
)

foreach ($commit in $frontendCommits) {
    git cherry-pick $commit
    if ($LASTEXITCODE -ne 0) {
        Write-Output "cherry_pick_failed=$commit"
        throw 'Stop for conflict review. Do not resolve by guessing.'
    }
}
```

Expected: five cherry-picks succeed without conflicts.

- [ ] **Step 3: Verify the port changed only approved paths**

```powershell
$changed = git diff --name-only "$portBase..HEAD"
$changed

$allowed = @(
    'frontend/profile-selection.js',
    'frontend/styles.css',
    'frontend/views.js',
    'tests/frontend.spec.js'
)

$unexpected = $changed | Where-Object { $_ -notin $allowed }
if ($unexpected) {
    $unexpected
    throw 'Unexpected path changed during frontend port.'
}
```

Expected: only the four approved paths appear.

### Task 5: Prove exact version composition and run full regression

**Files:**
- Modify: none beyond Task 4
- Test: all repository tests

- [ ] **Step 1: Prove frontend and frontend tests match `fd79896`**

```powershell
git diff --exit-code fd798968c89c4a77f189a0bf240546db40bf7a68 -- frontend tests/frontend.spec.js
Write-Output "frontend_identity_exit=$LASTEXITCODE"
```

Expected: no diff and `frontend_identity_exit=0`.

- [ ] **Step 2: Prove backend, prompts, contracts, and dependencies remain at `0992fe3`**

```powershell
git diff --exit-code 0992fe3a19f1db99c159268d87af3beef6f00720 -- server prompts package.json package-lock.json .env.example
Write-Output "backend_identity_exit=$LASTEXITCODE"
```

Expected: no diff and `backend_identity_exit=0`.

- [ ] **Step 3: Run the complete automated suite**

```powershell
npm.cmd test
```

Expected: server and Playwright tests all pass with exit code 0.

- [ ] **Step 4: Verify repository integrity**

```powershell
git status --short --branch
git diff --check
git log -8 --oneline --decorate
```

Expected: clean tracked status, no whitespace errors, and the five frontend commits appear above the documentation commits and `0992fe3`.

### Task 6: Perform one paid real workflow on the combined local branch

**Files:**
- Modify: none
- Temporary output: `%TEMP%\teacher-preboundary-combined.stdout.log`, `%TEMP%\teacher-preboundary-combined.stderr.log`

- [ ] **Step 1: Obtain explicit approval for the second paid local workflow**

Expected: the user explicitly approves one combined-branch workflow. Do not reuse the earlier approval automatically.

- [ ] **Step 2: Start the combined service on port 4186**

```powershell
$worktree = 'D:\codex-pj\teacher-preboundary-frontend'
$envFile = 'D:\codex-pj\teacher\.env'
$stdout = Join-Path $env:TEMP 'teacher-preboundary-combined.stdout.log'
$stderr = Join-Path $env:TEMP 'teacher-preboundary-combined.stderr.log'
$previousPort = $env:PORT

if (Get-NetTCPConnection -LocalPort 4186 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 4186 is already in use; stop for review.'
}

Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue

try {
    $env:PORT = '4186'
    $combinedProcess = Start-Process `
        -FilePath (Get-Command node).Source `
        -ArgumentList @("--env-file=$envFile", 'server/index.js') `
        -WorkingDirectory $worktree `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
} finally {
    if ($null -eq $previousPort) {
        Remove-Item Env:PORT -ErrorAction SilentlyContinue
    } else {
        $env:PORT = $previousPort
    }
}
```

Expected: the process starts without exposing environment values.

- [ ] **Step 3: Poll health and execute the same fixed workflow once**

```powershell
$ready = $false
1..15 | ForEach-Object {
    if (-not $ready) {
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4186/api/health' -TimeoutSec 2
            if ($health.ok -eq $true) { $ready = $true }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
}
if (-not $ready) { throw 'Combined service did not become healthy.' }
Start-Process 'http://127.0.0.1:4186/'
```

Use exactly the Task 3, Step 5 values and complete one workflow without retry.

Expected: all three requests return HTTP 200 and the newer frontend renders the coaching plan correctly without overflow, hidden required information, or `INVALID_MODEL_RESPONSE`.

- [ ] **Step 4: Stop the combined process and check safe diagnostics**

```powershell
if ($combinedProcess -and -not $combinedProcess.HasExited) {
    Stop-Process -Id $combinedProcess.Id
    $combinedProcess.WaitForExit(5000)
}

Get-NetTCPConnection -LocalPort 4186 -State Listen -ErrorAction SilentlyContinue
Select-String -LiteralPath $stdout, $stderr -Pattern 'MODEL_RESPONSE_REJECTED|INVALID_MODEL_RESPONSE|MODEL_SERVICE_UNAVAILABLE' -ErrorAction SilentlyContinue
```

Expected: no listener and no rejection for the successful workflow. If this gate fails after the baseline succeeded, compare frontend request payload construction before modifying backend code.

### Task 7: Audit and publish the tested branch

**Files:**
- Modify: remote branch metadata only

- [ ] **Step 1: Audit status, commits, changed paths, and secret exclusions**

```powershell
git status --short --branch
git diff --check
git log --oneline --decorate 0992fe3a19f1db99c159268d87af3beef6f00720..HEAD
git diff --name-only 0992fe3a19f1db99c159268d87af3beef6f00720..HEAD

$unsafeTracked = git ls-files |
    Where-Object { $_ -notmatch '(^|/)\.env\.example$' } |
    Select-String -Pattern '(^|/)\.env($|\.)|\.log$|node_modules'
$unsafeTracked
if ($unsafeTracked) { throw 'Unsafe generated or secret-like file is tracked.' }
```

Expected: clean status; only the two planning documents, three frontend files, and `tests/frontend.spec.js` differ from `0992fe3`; no secret, log, or dependency directory is tracked.

- [ ] **Step 2: Record and push the exact deployment commit**

```powershell
$deployCommit = (git rev-parse HEAD).Trim()
Write-Output "deploy_commit=$deployCommit"

git push --set-upstream origin codex/preboundary-fd-frontend
if ($LASTEXITCODE -ne 0) { throw 'Push failed.' }

$remoteLine = git ls-remote --heads origin codex/preboundary-fd-frontend
$remoteCommit = ($remoteLine -split '\s+')[0]
Write-Output "remote_commit=$remoteCommit"

if ($remoteCommit -ne $deployCommit) {
    throw 'Remote commit does not match the tested local commit.'
}
```

Expected: push succeeds and both commit IDs are identical.

### Task 8: Validate the exact branch in an isolated server candidate

**Files:**
- Server candidate worktree: `/opt/apps/teacher-candidate-preboundary-fd`
- Production directory remains: `/opt/apps/teacher`

- [ ] **Step 1: Obtain explicit approval before server mutation**

Expected: the user approves candidate creation and later production switch. Candidate checks do not stop the current service.

- [ ] **Step 2: Fetch and verify the exact remote commit**

Run on the server in Bash:

```bash
cd /opt/apps/teacher

git fetch origin \
  'refs/heads/codex/preboundary-fd-frontend:refs/remotes/origin/codex/preboundary-fd-frontend'

deploy_commit="$(git rev-parse origin/codex/preboundary-fd-frontend)"
echo "deploy_commit=$deploy_commit"

git show --no-patch \
  --format='subject=%s' \
  "$deploy_commit"

git status -sb
systemctl is-active teacher
curl -fsS --max-time 5 http://127.0.0.1:4173/api/health
```

Expected: commit matches Task 7, production status is clean, service is active, and health is `{"ok":true}`.

- [ ] **Step 3: Confirm dependencies are unchanged from production**

```bash
git diff --name-only \
  HEAD.."$deploy_commit" \
  -- package.json package-lock.json .env.example
```

Expected: no output. If any dependency or environment example differs, stop and create a separate dependency plan.

- [ ] **Step 4: Create and test the server candidate worktree**

```bash
candidate='/opt/apps/teacher-candidate-preboundary-fd'

if [ -e "$candidate" ]; then
  echo "candidate_path_exists=$candidate"
  exit 70
fi

git worktree add --detach "$candidate" "$deploy_commit" || exit $?
ln -s /opt/apps/teacher/node_modules "$candidate/node_modules" || exit $?

source /root/.nvm/nvm.sh
cd "$candidate"

node --version
npm ls --depth=0
time timeout 120s node --test tests/server.*.test.js
echo "candidate_server_test_exit=$?"
```

Expected: Node 20, valid dependencies, all Linux-compatible server tests pass, and exit code is 0. Do not run Windows-only launcher tests or Playwright on the low-memory server.

- [ ] **Step 5: Smoke-test the candidate on port 4187**

```bash
if ss -ltn | grep -q ':4187\b'; then
  echo 'candidate_port_4187_in_use'
  exit 71
fi

PORT=4187 node server/index.js \
  >/tmp/teacher-candidate-preboundary-fd.log 2>&1 &
candidate_pid=$!

candidate_ready=0
for i in $(seq 1 15); do
  if curl -fsS --max-time 2 http://127.0.0.1:4187/api/health; then
    candidate_ready=1
    echo
    break
  fi
  sleep 1
done

echo "candidate_ready=$candidate_ready"
curl -sS -o /dev/null --max-time 5 \
  -w 'candidate_home_http=%{http_code}\n' \
  http://127.0.0.1:4187/

kill "$candidate_pid" 2>/dev/null || true
wait "$candidate_pid" 2>/dev/null || true

systemctl is-active teacher
curl -fsS --max-time 5 http://127.0.0.1:4173/api/health
```

Expected: candidate health succeeds, home returns 200, candidate stops, and current production remains active and healthy.

### Task 9: Switch production with automatic rollback

**Files:**
- Modify: server Git branch and runtime process only
- Preserve rollback branch: `server-main-fd79896`
- Create: `server-preboundary-fd-frontend`

- [ ] **Step 1: Prepare server branch and record rollback state**

```bash
cd /opt/apps/teacher

rollback_branch="$(git branch --show-current)"
rollback_commit="$(git rev-parse HEAD)"
target_branch='server-preboundary-fd-frontend'
target_commit="$(git rev-parse origin/codex/preboundary-fd-frontend)"

echo "rollback_branch=$rollback_branch"
echo "rollback_commit=$rollback_commit"
echo "target_commit=$target_commit"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo 'tracked_changes_detected'
  exit 80
fi

if git show-ref --verify --quiet "refs/heads/$target_branch"; then
  [ "$(git rev-parse "$target_branch")" = "$target_commit" ] || exit 81
else
  git branch "$target_branch" "$target_commit" || exit $?
fi
```

Expected: rollback and target commits print, tracked status is clean, and the target branch points to the exact tested commit.

- [ ] **Step 2: Stop, switch, start, and poll direct health**

```bash
restart_at="$(date '+%Y-%m-%d %H:%M:%S')"

systemctl stop teacher || exit 82

if ! git switch "$target_branch"; then
  git switch "$rollback_branch"
  systemctl start teacher
  exit 83
fi

if ! systemctl start teacher; then
  git switch "$rollback_branch"
  systemctl start teacher
  exit 84
fi

direct_ready=0
for i in $(seq 1 15); do
  if curl -fsS --max-time 2 http://127.0.0.1:4173/api/health; then
    direct_ready=1
    echo
    break
  fi
  sleep 1
done

if [ "$direct_ready" -ne 1 ]; then
  systemctl stop teacher 2>/dev/null || true
  git switch "$rollback_branch"
  systemctl start teacher
  exit 85
fi
```

Expected: target service becomes healthy. Any failure returns to the recorded branch.

- [ ] **Step 3: Verify Nginx, commit, service state, and startup logs**

```bash
if ! curl -fsS --max-time 5 http://127.0.0.1:4175/api/health; then
  echo
  echo 'nginx_health_failed'
  systemctl stop teacher 2>/dev/null || true
  git switch "$rollback_branch"
  systemctl start teacher
  exit 86
fi
echo
echo 'nginx_ready=1'

systemctl is-active teacher
systemctl show teacher \
  --property=MainPID \
  --property=ActiveEnterTimestamp \
  --property=NRestarts \
  --no-pager

git status -sb
git log -1 --oneline --decorate

journalctl -u teacher \
  --since "15 minutes ago" \
  --no-pager -n 40
```

Expected: both health endpoints succeed, service is active, `NRestarts=0`, branch is `server-preboundary-fd-frontend`, and HEAD equals the tested remote commit.

### Task 10: Perform final production validation and close the deployment

**Files:**
- Modify: none

- [ ] **Step 1: Obtain explicit approval for one paid production workflow**

Expected: user explicitly approves exactly one production `intake -> classify -> plan` workflow after infrastructure health passes.

- [ ] **Step 2: Run the fixed representative workflow once in the production browser**

Use the exact Task 3, Step 5 values. Do not retry.

Expected: `intake`, `classify`, and `plan` return 200 and the new frontend renders the plan.

- [ ] **Step 3: Collect fresh production evidence**

```bash
date

grep '/api/coach/' /var/log/nginx/access.log |
tail -n 8 |
awk '{print $4, $5, $6, $7, $9}'

journalctl -u teacher \
  --since "15 minutes ago" \
  --no-pager |
grep -A 15 -B 2 -E \
'MODEL_RESPONSE_REJECTED|INVALID_MODEL_RESPONSE|MODEL_SERVICE_UNAVAILABLE' || true

systemctl is-active teacher
curl -fsS --max-time 5 http://127.0.0.1:4173/api/health
curl -fsS --max-time 5 http://127.0.0.1:4175/api/health
git status -sb
git log -1 --oneline --decorate
```

Expected: three latest business requests are 200, no rejection appears for the final workflow, both health checks succeed, and the exact tested branch remains active.

- [ ] **Step 4: Mark the deployment complete or roll back**

If every Task 10 check passes, report completion with exact commit, automated test counts, three real-workflow results, service state, and rollback branch.

If the final production workflow fails, do not claim success. Run:

```bash
rollback_branch='server-main-fd79896'

systemctl stop teacher
git switch "$rollback_branch"
systemctl start teacher

for i in $(seq 1 15); do
  curl -fsS --max-time 2 http://127.0.0.1:4173/api/health && break
  sleep 1
done

curl -fsS --max-time 5 http://127.0.0.1:4175/api/health
git log -1 --oneline --decorate
```

Expected on rollback: prior commit is restored and both health endpoints succeed.
