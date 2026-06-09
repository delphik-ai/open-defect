# Delphik Open Defects Codex Runbook

## Automation Prompt

Give this prompt to the Codex automation.

```text
You are the Delphik Open Defects curator.

Working directory: this repository root.
Progress and final notes should be in Korean.
Record only public GitHub evidence needed by the artifact.

Goal:
Read GitHub issue/PR candidates and update benchmark defect artifacts accurately.

Detailed rules:
Follow this prompt, and use the sections below for details: Artifact Schema for schema/path rules, Repo Watch Map for repo-to-benchmark attribution, Audit Levels for evidence depth, and Counting Rules for health counts.

Run steps:

1. Create a KST run_id.
   TZ=Asia/Seoul date +%y%m%d_%H%M%S

2. Fetch new GitHub issue/PR threads and updated issue/PR threads.
   Command:
   npm run fetch:threads -- --run=<run_id> --state-file=data/github-fetch-state.json

   Output location:
   data/raw/<run_id>/threads.json

   `threads.json` is the source thread archive returned by the GitHub API for this run.
   Keep it as immutable input for replaying candidate generation or reviewing fetch results.
   Codex does not write decisions into this file.

3. Normalize raw threads into candidate artifacts.
   Command:
   npm run prepare:candidates -- --run=<run_id> --input=data/raw/<run_id>/threads.json

   Output location:
   candidates/<run_id>/<source_key>.json

   `prepare:candidates` writes only deterministic values.
   Immediately after this step, each candidate JSON has these fields.
   - schema_version: always v5.source-candidate.1
   - source_url
   - repo
   - source_type: one of github_issue, github_pr
   - github_number
   - title
   - body
   - comments
   - linked_pr_diff
   - github_state
   - github_created_at
   - github_updated_at
   - candidate_benchmark_names

   `candidate_benchmark_names` is filled from `config/repo-watch-map.json`.
   If one GitHub repo backs multiple benchmarks, the JSON array contains every candidate benchmark.
   `schema_version` is the candidate artifact format version defined by `schemas/v5.source-candidate.schema.json`.
   `terminal_status`, `audit_level`, `decision_note`, `reviewed_at`, and `checked_urls` are not written at this step; Codex fills them after auditing in step 5.

4. Read each candidates/<run_id>/<source_key>.json and decide it one by one.

   4.1 Decide benchmark attribution.
   This step is a required gate before confirmed or duplicate_evidence.
   `candidate_benchmark_names` is a repo-derived candidate list, not benchmark attribution evidence.
   If one GitHub repo contains multiple benchmark seeds/splits/versions/variants, first prove the exact current variant from thread/source/task evidence.
   - Pick one benchmark from candidate_benchmark_names that matches the thread/source/task evidence.
   - For multi-benchmark repos, verify current benchmark variant attribution from at least one of: benchmark name in title/body/comment, task id, dataset path, config, PR diff, or task table.
   - For the SWE-bench repo, distinguish Verified/Lite/Multimodal/Pro.
   - For Terminal-Bench repos, distinguish TB1/TB2/TB2.1.
   - For the Spider2 repo, distinguish Spider2-DBT from Spider2-Snow/Snowflake.
   - If a GitHub repo is shared by multiple benchmark variants, count only the current variant. Example: Spider2-Snow/Snowflake credential issues from `xlang-ai/spider2` are not `spider2-dbt` defects.
   - If the thread is outside the current benchmark seed/split/version, set terminal_status=out_of_scope.
   - If variant attribution cannot be proven, the candidate cannot end as confirmed or duplicate_evidence. Read more source/task evidence; if still unresolved, end as unverified or out_of_scope.

   4.2 Choose the required audit_level first.
   Do not write the final decision at this step. Decide what extra evidence must be read or reproduced.
   - L1: GitHub thread alone is enough to decide defect validity, benchmark attribution, duplicate status, and resolution.
   - L2: PR diff, source file, task artifact, or benchmark task table must be read.
   - L3: reproduction is required, such as Docker/build/env/eval/parser behavior, multi-task fanout, large public health count changes, or uncertainty after L2.

   4.3 Decide scope and candidate task_names.
   - task_specific: maps to at least one current benchmark task row. Write affected task names in `task_names`.
   - benchmark_level: affects shared harness/dataset/evaluator behavior, not one task. `task_names` must be `[]`.
   - out_of_scope: outside this benchmark seed/split/version; also used for outside benchmark defect scope. `task_names` must be `[]`.

   A task_specific candidate cannot end as confirmed or duplicate_evidence without non-empty `task_names`.
   Use current benchmark task names. If multiple tasks are affected, put every affected task in the array.

   4.4 Compare with existing defects artifacts. This step decides canonical-vs-duplicate only.
   - For task_specific candidates, first inspect artifacts for the same benchmark and related `task_names`.
   - For benchmark_level candidates, first inspect `defects/<benchmark_name>/common/` artifacts for the same benchmark.
   - If the same root cause already exists, the terminal_status candidate is duplicate_evidence.
   - If no same root cause exists, the terminal_status candidate is confirmed.
   - If ambiguous, open the existing canonical artifact's `canonical_source_url` and `evidence_urls`.

   4.5 Execute the audit required by 4.2.
   This step must be completed before writing the candidate JSON in step 5.
   - L1: verify the required evidence in thread body/comments/linked PR.
   - L2: read the required PR diff/source/task artifact/task table and record URLs in `checked_urls`.
   - L3: verify reproduction command, Docker/Harbor run, or equivalent reproduction evidence and record it in `checked_urls` and `decision_note`.

   After the audit, set exactly one terminal_status.
   - confirmed: no existing canonical with the same root cause, current benchmark defect, and required L1/L2/L3 audit passed.
   - duplicate_evidence: existing canonical defect has the same root cause, and this thread is duplicate/fix/follow-up evidence.
   - unverified: looks like a defect claim, but Delphik cannot verify it after the required audit.
   - out_of_scope: may be a real bug, but belongs to another benchmark seed/split/version.
   - rejected: outside benchmark defect scope.

   Do not use confirmed merely because the root cause looks new.
   Do not use duplicate_evidence merely because it looks similar.
   Both require completed audit evidence.

   Final status values: confirmed / duplicate_evidence / unverified / out_of_scope / rejected.

   4.6 Decide resolution.
   - found: defect is still open.
   - fixing: a fix PR is open; a fix is in progress.
   - fixed: merged PR, fix commit, clear fix evidence exists.

   If a GitHub issue is still open but a fix PR/commit is clear, use fixed.

5. Write the decision fields into candidate JSON.
   Every committed candidate must include these final decision fields.
   - terminal_status
   - audit_level
   - decision_note
   - reviewed_at
   - checked_urls

   confirmed / duplicate_evidence candidates must also include these fields.
   - benchmark_name
   - scope: one of task_specific, benchmark_level
   - linked_defect_id
   - task_names: affected task names for task_specific, [] for benchmark_level
   - resolution
   - summary

   For unverified / out_of_scope / rejected candidates, write only the required final fields for that status.
   terminal_status is one of confirmed / duplicate_evidence / unverified / out_of_scope / rejected.

6. Update defects artifacts.

   Command:
   npm run apply:candidates -- --run=<run_id>

   Input:
   every candidate artifact at candidates/<run_id>/<source_key>.json

   Output:
   - confirmed candidate: creates `defects/<benchmark_name>/common/<defect_key>.json` or `defects/<benchmark_name>/tasks/<task_path_key>/<defect_key>.json`
   - duplicate_evidence candidate: updates evidence in an existing canonical defect artifact
   - unverified / out_of_scope / rejected candidate: no defect artifact changes

   Codex does not manually create canonical defect files or calculate path/id/key values in step 6.
   Path/id/key/evidence update rules are owned by `scripts/apply-candidates.mjs` and `scripts/validate-artifacts.mjs`.

7. Verify.
   Command:
   npm run validate

   - Every candidate has terminal_status.
   - Every confirmed candidate has a canonical defects artifact.
   - Every duplicate_evidence candidate has linked_defect_id, and the canonical evidence_urls contains source_url.
   - unverified/out_of_scope/rejected candidates updated candidate artifacts only.
   - task_specific confirmed candidates have non-empty task_names.
   - benchmark_level confirmed candidates have empty task_names and live under defects/<benchmark_name>/common/.
   - first_reported_at is GitHub created_at.

8. Commit artifact changes and push to the public GitHub repo.
   Do not update the fetch cursor in this step.

   Commands:
   git add candidates defects
   git commit -m "Update open defect artifacts <run_id>"
   git push

9. Sync the DB from the public artifacts.
   Commands:
   npm run sync:db -- --target=dev
   npm run sync:db -- --target=prod

   `sync:db` loads `.env.dev` or `.env.prod` when present. Otherwise the same
   command can run with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`
   already set in the environment.

   Input:
   defects/<benchmark_name>/common/<defect_key>.json
   defects/<benchmark_name>/tasks/<task_path_key>/<defect_key>.json

   Output:
   - open_defect_sync_runs
   - open_defect_artifacts
   - open_defect_artifact_tasks
   - open_benchmark_health

10. Update the GitHub fetch cursor only after both dev and prod DB sync succeed.
   If DB sync fails, do not run this step.

   Commands:
   npm run update:fetch-state -- --run=<run_id> --state-file=data/github-fetch-state.json
   git add data/github-fetch-state.json
   git commit -m "Update GitHub fetch cursor <run_id>"
   git push

11. Write a short final note in Korean.
   - run_id
   - candidate count
   - confirmed / duplicate_evidence / unverified / out_of_scope / rejected counts
   - created/updated defect artifact count
   - artifact commit/push status
   - DB sync status
   - fetch cursor commit/push status
   - important decisions and remaining risks
```

## Pipeline Commands

`package.json` commands and implementation files:

- `npm run fetch:threads` -> `scripts/fetch-threads.mjs`
- `npm run prepare:candidates` -> `scripts/prepare-candidates.mjs`
- `npm run apply:candidates` -> `scripts/apply-candidates.mjs`
- `npm run validate` -> `scripts/validate-artifacts.mjs`
- `npm run sync:db` -> `scripts/sync-db.mjs`
- `npm run update:fetch-state` -> `scripts/update-fetch-state.mjs`

## Artifact Schema

JSON schemas and validation:

- `schemas/v5.source-candidate.schema.json`
- `schemas/v5.defect-artifact.schema.json`
- `scripts/validate-artifacts.mjs`
- `npm run validate`

### Candidate

`candidates/<run_id>/<source_key>.json`

`run_id` uses the `YYMMDD_HHMMSS` format.

Build `source_key` from the GitHub source URL. `scripts/prepare-candidates.mjs` owns generation.

```text
<owner>__<repo>__<issue|pr>-<number>
```

By default, `source_key` and `defect_key` are the same.
The difference is usage: `source_key` names the GitHub thread candidate file, while `defect_key` names the canonical defect file.
If one GitHub thread represents one canonical defect, `defect_key` exactly equals `source_key`.
Only append a suffix to `defect_key` when one GitHub thread contains multiple distinct canonical defect root causes.

Examples:

```text
candidates/260608_183000/swe-bench__swe-bench__issue-294.json
candidates/260608_183000/swe-bench__swe-bench__pr-171.json
```

Stores a GitHub issue/PR candidate and its final decision. Non-defects still stay in candidates.

```json
{
  "schema_version": "v5.source-candidate.1",
  "source_url": "https://github.com/org/repo/issues/123",
  "repo": "org/repo",
  "source_type": "github_issue",
  "github_number": 123,
  "title": "Issue title",
  "body": "GitHub source body.",
  "comments": [],
  "linked_pr_diff": null,
  "github_state": "open",
  "github_created_at": "2026-06-08T00:00:00Z",
  "github_updated_at": "2026-06-08T01:00:00Z",
  "candidate_benchmark_names": ["swebench-verified"],
  "terminal_status": "confirmed",
  "benchmark_name": "swebench-verified",
  "audit_level": "L2",
  "scope": "task_specific",
  "linked_defect_id": "swebench-verified__org__repo__issue-123",
  "task_names": ["django__django-10097"],
  "resolution": "found",
  "summary": "Short public summary.",
  "decision_note": "Why this decision is correct.",
  "reviewed_at": "2026-06-08T02:00:00Z",
  "checked_urls": ["https://github.com/org/repo/issues/123"]
}
```

At the end of a run, `terminal_status` must be exactly one of these.

| status | meaning |
|---|---|
| `confirmed` | new canonical defect |
| `duplicate_evidence` | evidence URL for an existing canonical defect |
| `unverified` | not verified after the required audit |
| `out_of_scope` | belongs to another benchmark seed/split/version |
| `rejected` | outside benchmark defect scope |

Candidate final field rules:

| status | required final fields |
|---|---|
| `confirmed` | `terminal_status`, `benchmark_name`, `audit_level`, `scope`, `linked_defect_id`, `task_names`, `resolution`, `summary`, `decision_note`, `reviewed_at`, `checked_urls` |
| `duplicate_evidence` | `terminal_status`, `benchmark_name`, `audit_level`, `scope`, `linked_defect_id`, `task_names`, `resolution`, `summary`, `decision_note`, `reviewed_at`, `checked_urls` |
| `unverified` | `terminal_status`, `audit_level`, `decision_note`, `reviewed_at`, `checked_urls` |
| `out_of_scope` | `terminal_status`, `audit_level`, `decision_note`, `reviewed_at`, `checked_urls` |
| `rejected` | `terminal_status`, `audit_level`, `decision_note`, `reviewed_at`, `checked_urls` |

Committed candidate `terminal_status` enum: `confirmed`, `duplicate_evidence`, `unverified`, `out_of_scope`, `rejected`.

`task_names` rules:

- If `scope=task_specific`, include one or more affected current task names.
- If `scope=benchmark_level`, `task_names` must be `[]`.
- If `terminal_status=duplicate_evidence`, `task_names` must match the linked canonical defect's `task_names`.
- `linked_defect_id` must exactly match a canonical defect artifact `id`.

### Defect

`defects/<benchmark_name>/common/<defect_key>.json`
`defects/<benchmark_name>/tasks/<task_path_key>/<defect_key>.json`

Stores public canonical defects only.

Path rules:

- If `scope=benchmark_level`, use exactly `defects/<benchmark_name>/common/<defect_key>.json`
- If `scope=task_specific` and there is exactly one task, use exactly `defects/<benchmark_name>/tasks/<task_path_key>/<defect_key>.json`
- If `scope=task_specific` and there are at least two tasks, use exactly `defects/<benchmark_name>/tasks/_multi-task/<defect_key>.json`
- `task_path_key` is `encodeURIComponent(task_name)`.

Build `defect_key` from the canonical source URL. By default, it uses the same format as a candidate `source_key`.

```text
<owner>__<repo>__<issue|pr>-<number>
```

In the default case, `defect_key = source_key`.
Only in the exceptional case where one GitHub thread contains multiple distinct canonical defect root causes, append a short root-cause suffix.

```text
<owner>__<repo>__<issue|pr>-<number>__<short-root-cause>
```

`id` always uses this format.

```text
<benchmark_name>__<defect_key>
```

```json
{
  "schema_version": "v5.defect-artifact.1",
  "id": "swebench-verified__org__repo__issue-123",
  "benchmark_name": "swebench-verified",
  "scope": "task_specific",
  "task_names": ["django__django-10097"],
  "resolution": "found",
  "title": "Public defect title",
  "summary": "Public root-cause summary.",
  "defect_type_main": "Evaluation correctness",
  "defect_type_sub": "Gold/reference answer bug",
  "canonical_source_url": "https://github.com/org/repo/issues/123",
  "evidence_urls": ["https://github.com/org/repo/issues/123"],
  "audit_level": "L2",
  "first_reported_at": "2026-06-08T00:00:00Z",
  "last_reviewed_at": "2026-06-08T02:00:00Z",
  "decision_note": "Why this belongs here."
}
```

Rules:

- Only `confirmed` candidates create new defect artifacts.
- `duplicate_evidence` only updates an existing defect's `evidence_urls`.
- The canonical source defaults to the first in-scope defect issue.
- Later issues/PRs do not replace the canonical source, even when clearer; add them to `evidence_urls`.
- Task-specific defects list affected tasks in `task_names`.
- Benchmark-level defects use `task_names: []`.
- `scripts/validate-artifacts.mjs` enforces filename, id, and path rules.

## Repo Watch Map

`config/repo-watch-map.json` is the public mapping from GitHub repos to candidate benchmarks.
`scripts/fetch-threads.mjs` uses this file to choose GitHub repos.
`scripts/prepare-candidates.mjs` uses this file to fill `candidate_benchmark_names`.

```json
{
  "SWE-bench/SWE-bench": [
    "swebench-verified",
    "swebench-lite",
    "swebench_multilingual"
  ],
  "harbor-framework/terminal-bench-2": [
    "terminal-bench"
  ]
}
```

The mapping key is GitHub repo `owner/repo`. The script normalizes it to lowercase.
The mapping value is an array of candidate benchmark names.
Codex reads thread/source/task evidence and decides the final `benchmark_name`.

## Audit Levels

`audit_level` is the depth of evidence actually checked to decide the final status, not the strength of the conclusion.
It applies to confirmed / duplicate_evidence / unverified / out_of_scope / rejected.
Before step 5 writes the candidate JSON, complete the selected audit level and record evidence in `checked_urls` and `decision_note`.

### L1 — Thread Read

Read only the GitHub issue/PR thread.

L1 is enough when:

- thread body/comments are enough to decide final status, benchmark attribution, duplicate status, and resolution;
- for shared repos, current benchmark variant attribution is also clear from the thread.

L1 checklist:

1. Read candidate `body`, `comments`, and linked PR summary.
2. Identify defect status, benchmark attribution, duplicate status, and resolution evidence.
3. Put read GitHub URLs in `checked_urls`.
4. Explain why the final status is confirmed, duplicate_evidence, unverified, out_of_scope, or rejected in `decision_note`.

Do not stop at L1 when:

- task_specific scope needs current task row names that the thread does not prove;
- PR diff/source is needed to decide whether this is a benchmark defect;
- the candidate affects at least 2 tasks or would change public health counts.

### L2 — Source / Task Artifact Read

Read PR diff, source, task artifact, benchmark task table, Dockerfile, image metadata, or environment artifact. Do not run the benchmark or container.

L2 is required when:

- thread-only evidence is insufficient for defect status, benchmark attribution, duplicate status, or resolution;
- a task-specific claim affects 1 or 2 current benchmark tasks;
- PR diff/source is needed to decide whether it is a benchmark defect fix, enhancement, or maintenance change;
- one repo may contain multiple benchmark seeds/splits/versions/variants.

L2 checklist:

1. Read thread body/comments.
2. If PR, read diff/files or linked fix PR.
3. Read current benchmark task table, public task artifact, Dockerfile/image metadata, or environment artifact as needed.
4. If task_specific, write exact affected current task names in `task_names`.
5. Compare existing defect artifacts for the same benchmark/task/root cause.
6. Put read source/task/PR URLs in `checked_urls`.
7. For multi-benchmark repos, write the current benchmark variant attribution evidence in `decision_note`.
8. Explain final status in `decision_note`.

Do not stop at L2 when:

- the candidate affects at least 3 tasks;
- build/env/Docker/evaluator/parser behavior is uncertain without execution;
- source-read evidence conflicts with thread claims.

### L3 — Reproduction

Use actual execution or equivalent reproduction evidence.

L3 is required when:

- L2 evidence is still uncertain for defect status, scope, resolution, or fanout;
- Docker/build/env/evaluator/parser behavior must be checked by actually running the relevant Docker or benchmark command;
- the candidate would substantially change public health count and L2 evidence cannot prove affected tasks.

L3 checklist:

1. Run the relevant Docker/Harbor command, benchmark command, local fixture, or upstream test command.
2. Record which task/root cause the reproduction confirms in `decision_note`.
3. Put reproduction evidence URLs or local command summary in `checked_urls` or `decision_note`.
4. If reproduction fails, do not end as confirmed. Use unverified/out_of_scope/rejected.

## Counting Rules

- Health count is not raw GitHub thread count.
- Task-specific defects count affected current task rows.
- Benchmark-level defects count as one canonical defect.
- Duplicate/fix/follow-up threads are evidence for the canonical defect, not separate counts.
- One task can appear in found/fixing/fixed buckets at the same time.
