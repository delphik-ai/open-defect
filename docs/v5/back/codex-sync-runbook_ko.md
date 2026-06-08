# Delphik Open Defects Codex Runbook

## Automation Prompt

Codex automation에는 아래 프롬프트를 그대로 준다.

```text
너는 Delphik Open Defects curator다.

작업 디렉터리: 이 repository root.
진행/최종 보고는 한국어.
공개 artifact에 필요한 GitHub evidence만 기록한다.

목표:
GitHub issue/PR 후보를 읽고, benchmark defect artifact를 정확히 갱신한다.

주의사항:
실행시 터미널에 secret 등은 절대 노출하지 않는다. 

이번 run 절차:

1. KST run_id를 만든다.
   TZ=Asia/Seoul date +%y%m%d_%H%M%S

2. GitHub에서 새 issue/PR과 updated issue/PR thread를 가져온다.
   명령:
   npm run fetch:threads -- --run=<run_id> --state-file=data/github-fetch-state.json

   출력 위치:
   data/raw/<run_id>/threads.json

   `threads.json`은 이 run에서 GitHub API가 반환한 source thread archive다.
   이 파일은 fetch 결과를 재검토하거나 candidate 생성 규칙을 다시 적용할 때 쓰는 immutable input으로 남긴다.
   Codex는 이 파일에 판정 결과를 쓰지 않는다.

3. raw thread를 candidate artifact로 정규화한다.
   명령:
   npm run prepare:candidates -- --run=<run_id> --input=data/raw/<run_id>/threads.json

   출력 위치:
   candidates/<run_id>/<source_key>.json

   `prepare:candidates`는 deterministic한 값만 쓴다.
   이 단계 직후 후보 JSON은 아래 필드를 가진다.
   - schema_version: 현재는 항상 v5.source-candidate.1
   - source_url
   - repo
   - source_type: github_issue, github_pr 중 하나
   - github_number
   - title
   - body
   - comments
   - linked_pr_diff
   - github_state
   - github_created_at
   - github_updated_at
   - candidate_benchmark_names

   `candidate_benchmark_names`는 `config/repo-watch-map.json`에서 채운다.
   같은 GitHub repo를 여러 benchmark가 공유하면 JSON 배열에 모든 후보 benchmark를 넣는다.
   `schema_version`은 `schemas/v5.source-candidate.schema.json`의 candidate artifact 포맷 버전이다.
   `terminal_status`, `audit_level`, `decision_note`, `reviewed_at`, `checked_urls`는 이 단계에서 쓰지 않고 5번에서 Codex가 audit 후 채운다.

4. 각 candidates/<run_id>/<source_key>.json 을 읽고 하나씩 판정한다.

   4.1 benchmark를 정한다.
   이 단계는 confirmed/duplicate_evidence 이전의 필수 gate다.
   `candidate_benchmark_names`는 repo 기반 후보 목록일 뿐이고, benchmark 귀속 증거가 아니다.
   같은 GitHub repo가 여러 benchmark seed/split/version/variant를 담으면 thread/source/task evidence로 정확한 variant를 먼저 확정한다.
   - candidate_benchmark_names 안에서 thread/source/task evidence와 맞는 benchmark 하나를 고른다.
   - multi-benchmark repo에서는 title/body/comment에 나온 benchmark 이름, task id, dataset path, config, PR diff, task table 중 하나 이상으로 current benchmark variant 귀속을 확인한다.
   - SWE-bench repo는 Verified/Lite/Multimodal/Pro 구분을 확인한다.
   - Terminal-Bench 계열은 TB1/TB2/TB2.1 구분을 확인한다.
   - Spider2 repo는 Spider2-DBT와 Spider2-Snow/Snowflake를 구분한다.
   - 같은 GitHub repo라도 benchmark variant가 다르면 out_of_scope다. 예: `xlang-ai/spider2` 후보 중 Spider2-Snow/Snowflake credential 문제는 `spider2-dbt`로 count하지 않는다.
   - 현재 benchmark seed/split/version 밖이면 terminal_status=out_of_scope.
   - variant 귀속을 확정할 수 없으면 confirmed나 duplicate_evidence로 끝낼 수 없다. 필요한 source/task evidence를 더 읽고, 그래도 확정할 수 없으면 unverified 또는 out_of_scope로 끝낸다.

   4.2 필요한 audit_level을 먼저 고른다.
   이 단계에서는 최종 판정을 쓰지 않는다. 어떤 evidence를 추가로 읽거나 실행해야 하는지 정한다.
   - L1: GitHub thread만 읽어도 defect 여부, benchmark 귀속, duplicate 여부, resolution이 모두 명확한 경우.
   - L2: PR diff, source file, task artifact, benchmark task table 중 하나 이상을 읽어야 정확히 판단 가능한 경우.
   - L3: Docker/build/env/eval/parser 재현, multi-task fanout, 큰 public health count 변경, 또는 L2 evidence만으로 불확실한 경우.

   4.3 scope와 task_names 후보를 정한다.
   - task_specific: current benchmark task row 하나 이상에 연결되는 defect. 연결된 task 이름을 반드시 `task_names` 배열에 적는다.
   - benchmark_level: 특정 task가 아니라 harness/dataset/evaluator 공통 문제. `task_names`는 반드시 빈 배열 `[]`이다.
   - out_of_scope: 현재 benchmark seed/split/version 밖이거나 benchmark defect 범위 밖. `task_names`는 빈 배열 `[]`이다.

   task_specific 후보는 `task_names`가 없으면 confirmed나 duplicate_evidence로 끝낼 수 없다.
   task 이름은 current benchmark의 실제 task name을 쓴다. 여러 task면 모든 affected task를 배열에 넣는다.

   4.4 기존 defects artifact와 비교한다. 이 단계는 canonical/duplicate 판단만 한다.
   - task_specific이면 같은 benchmark의 같은 `task_names` 관련 artifact를 먼저 본다.
   - benchmark_level이면 같은 benchmark의 `defects/<benchmark_name>/common/` artifact를 먼저 본다.
   - 같은 root cause가 이미 있으면 terminal_status 후보는 duplicate_evidence다.
   - 같은 root cause가 없으면 terminal_status 후보는 confirmed다.
   - 애매하면 기존 canonical artifact의 `canonical_source_url`과 `evidence_urls`를 직접 열어본다.

   4.5 4.2에서 정한 audit_level대로 audit을 실제 수행한다.
   이 단계는 5번 candidate JSON을 쓰기 전에 반드시 끝낸다.
   - L1이면 thread body/comments/linked PR 안에서 필요한 근거를 확인한다.
   - L2이면 필요한 PR diff/source/task artifact/task table을 읽고 `checked_urls`에 기록한다.
   - L3이면 reproduction command, Docker/Harbor run, 또는 equivalent reproduction evidence를 확인하고 `checked_urls`와 `decision_note`에 기록한다.

   audit이 끝난 뒤 terminal_status를 하나로 확정한다.
   - confirmed: 같은 root cause가 기존 canonical에 없고, current benchmark defect이며, 필요한 L1/L2/L3 audit을 통과했을 때.
   - duplicate_evidence: 같은 root cause의 existing canonical defect가 있고, 이번 thread가 duplicate/fix/follow-up evidence로 확인됐을 때.
   - unverified: defect claim처럼 보였지만 필요한 audit 뒤에도 결함 확인 실패 (재구현 실패 또는 이해불가).
   - out_of_scope: 실제 bug일 수 있으나 현재 benchmark seed/split/version 밖.
   - rejected: benchmark defect 범위 밖.

   confirmed는 "같은 root cause가 없음"만으로 쓰지 않는다.
   duplicate_evidence는 "비슷해 보임"만으로 쓰지 않는다.
   둘 다 audit_level에 맞는 확인이 끝난 뒤에만 쓴다.

   최종 status 값: confirmed / duplicate_evidence / unverified / out_of_scope / rejected.

   4.6 resolution을 정한다.
   - found: 아직 열린 defect.
   - fixing: fix PR이 열려 있거나 fix가 진행 중.
   - fixed: merged PR, fix commit, 명확한 fix evidence 중 하나가 있음.

   GitHub issue가 open이어도 fix PR/commit이 명확하면 fixed다.

5. candidate JSON에 판정 결과를 쓴다.
   모든 committed candidate에는 아래 final decision 필드를 반드시 쓴다.
   - terminal_status
   - audit_level
   - decision_note
   - reviewed_at
   - checked_urls

   confirmed / duplicate_evidence candidate에는 아래 필드도 반드시 쓴다.
   - benchmark_name
   - scope: task_specific, benchmark_level 중 하나
   - linked_defect_id
   - task_names: task_specific이면 affected task names, benchmark_level이면 []
   - resolution
   - summary

   unverified / out_of_scope / rejected candidate에는 status별 required final fields만 쓴다.
   terminal_status는 confirmed / duplicate_evidence / unverified / out_of_scope / rejected 중 하나다.

6. defects artifact를 갱신한다.

   명령:
   npm run apply:candidates -- --run=<run_id>

   입력:
   candidates/<run_id>/<source_key>.json 형식의 candidate artifact 전체

   출력:
   - confirmed candidate: `defects/<benchmark_name>/common/<defect_key>.json` 또는 `defects/<benchmark_name>/tasks/<task_path_key>/<defect_key>.json` 생성
   - duplicate_evidence candidate: 기존 canonical defect artifact의 evidence 갱신
   - unverified / out_of_scope / rejected candidate: defect artifact 변경 없음

   Codex는 6단계에서 canonical defect 파일을 직접 만들거나 path/id/key를 직접 계산하지 않는다.
   path/id/key/evidence 갱신 규칙은 `scripts/apply-candidates.mjs`와 `scripts/validate-artifacts.mjs`를 따른다.

7. 검증한다.
   명령:
   npm run validate

   - 모든 candidate에 terminal_status가 있다.
   - confirmed candidate마다 canonical defects artifact가 있다.
   - duplicate_evidence candidate는 linked_defect_id가 있고, canonical evidence_urls에 source_url이 있다.
   - unverified/out_of_scope/rejected candidate는 candidate artifact만 갱신했다.
   - task_specific confirmed는 task_names가 비어 있지 않다.
   - benchmark_level confirmed는 task_names가 비어 있고 defects/<benchmark_name>/common/ 아래에 있다.
   - first_reported_at은 GitHub created_at이다.

8. artifact 변경사항을 commit하고 public GitHub repo에 push한다.
   이 단계에서는 fetch cursor를 갱신하지 않는다.

   명령:
   git add candidates defects
   git commit -m "Update open defect artifacts <run_id>"
   git push

9. DB를 공개 artifact 기준으로 동기화한다.
   명령:
   npm run sync:db -- --target=dev
   npm run sync:db -- --target=prod

   `sync:db`는 `.env.dev` 또는 `.env.prod`가 있으면 읽는다.
   파일이 없으면 `NEXT_PUBLIC_SUPABASE_URL`과 `SUPABASE_SECRET_KEY`가
   실행 환경에 이미 설정되어 있어야 한다.

   입력:
   defects/<benchmark_name>/common/<defect_key>.json
   defects/<benchmark_name>/tasks/<task_path_key>/<defect_key>.json

   출력:
   - open_defect_sync_runs
   - open_defect_artifacts
   - open_defect_artifact_tasks
   - open_benchmark_health

10. dev/prod DB sync가 모두 성공한 뒤에만 GitHub fetch cursor를 갱신한다.
   DB sync가 실패하면 이 단계를 실행하지 않는다.

   명령:
   npm run update:fetch-state -- --run=<run_id> --state-file=data/github-fetch-state.json
   git add data/github-fetch-state.json
   git commit -m "Update GitHub fetch cursor <run_id>"
   git push

11. 최종 보고를 한국어로 짧게 작성한다.
   - run_id
   - candidate 수
   - confirmed / duplicate_evidence / unverified / out_of_scope / rejected 개수
   - 생성/수정한 defect artifact 수
   - artifact commit/push 여부
   - DB sync 여부
   - fetch cursor commit/push 여부
   - 주요 판단과 남은 리스크
```

## Pipeline Commands

`package.json` 명령과 실행 파일:

- `npm run fetch:threads` -> `scripts/fetch-threads.mjs`
- `npm run prepare:candidates` -> `scripts/prepare-candidates.mjs`
- `npm run apply:candidates` -> `scripts/apply-candidates.mjs`
- `npm run validate` -> `scripts/validate-artifacts.mjs`
- `npm run sync:db` -> `scripts/sync-db.mjs`
- `npm run update:fetch-state` -> `scripts/update-fetch-state.mjs`

## Artifact Schema

JSON Schema와 검증:

- `schemas/v5.source-candidate.schema.json`
- `schemas/v5.defect-artifact.schema.json`
- `scripts/validate-artifacts.mjs`
- `npm run validate`

### Candidate

`candidates/<run_id>/<source_key>.json`

`run_id`는 `YYMMDD_HHMMSS` 형식이다.

`source_key`는 GitHub source URL에서 만든다. 생성은 `scripts/prepare-candidates.mjs`가 담당한다.

```text
<owner>__<repo>__<issue|pr>-<number>
```

기본적으로 `source_key`와 `defect_key`는 같다.
차이는 용도다. `source_key`는 GitHub thread candidate 파일명이고, `defect_key`는 canonical defect 파일명이다.
한 GitHub thread가 하나의 canonical defect만 나타내면 `defect_key`는 `source_key`와 정확히 같다.
한 GitHub thread가 서로 다른 root cause의 canonical defect 여러 개를 포함할 때만 `defect_key`에 suffix를 붙인다.

Examples:

```text
candidates/260608_183000/swe-bench__swe-bench__issue-294.json
candidates/260608_183000/swe-bench__swe-bench__pr-171.json
```

GitHub issue/PR 후보와 최종 판정을 함께 저장한다. defect가 아니어도 candidate에는 남긴다.

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

`terminal_status`는 run 종료 시 반드시 아래 중 하나다.

| status | meaning |
|---|---|
| `confirmed` | 새 canonical defect |
| `duplicate_evidence` | 기존 canonical defect의 근거 URL |
| `unverified` | 필요한 audit 뒤에도 확인 실패 |
| `out_of_scope` | 다른 benchmark seed/split/version 문제 |
| `rejected` | benchmark defect 범위 밖 |

Candidate final field 규칙:

| status | required final fields |
|---|---|
| `confirmed` | `terminal_status`, `benchmark_name`, `audit_level`, `scope`, `linked_defect_id`, `task_names`, `resolution`, `summary`, `decision_note`, `reviewed_at`, `checked_urls` |
| `duplicate_evidence` | `terminal_status`, `benchmark_name`, `audit_level`, `scope`, `linked_defect_id`, `task_names`, `resolution`, `summary`, `decision_note`, `reviewed_at`, `checked_urls` |
| `unverified` | `terminal_status`, `audit_level`, `decision_note`, `reviewed_at`, `checked_urls` |
| `out_of_scope` | `terminal_status`, `audit_level`, `decision_note`, `reviewed_at`, `checked_urls` |
| `rejected` | `terminal_status`, `audit_level`, `decision_note`, `reviewed_at`, `checked_urls` |

Committed candidate의 `terminal_status` enum: `confirmed`, `duplicate_evidence`, `unverified`, `out_of_scope`, `rejected`.

`task_names` 규칙:

- `scope=task_specific`이면 affected current task name을 1개 이상 넣는다.
- `scope=benchmark_level`이면 `task_names`는 반드시 `[]`이다.
- `terminal_status=duplicate_evidence`이면 `task_names`는 linked canonical defect의 `task_names`와 일치해야 한다.
- `linked_defect_id`는 canonical defect artifact의 `id`와 정확히 일치해야 한다.

### Defect

`defects/<benchmark_name>/common/<defect_key>.json`
`defects/<benchmark_name>/tasks/<task_path_key>/<defect_key>.json`

Public canonical defect만 저장한다.

경로 규칙:

- `scope=benchmark_level`이면 반드시 `defects/<benchmark_name>/common/<defect_key>.json`
- `scope=task_specific`이고 task가 1개면 반드시 `defects/<benchmark_name>/tasks/<task_path_key>/<defect_key>.json`
- `scope=task_specific`이고 task가 2개 이상이면 반드시 `defects/<benchmark_name>/tasks/_multi-task/<defect_key>.json`
- `task_path_key`는 `encodeURIComponent(task_name)` 값이다.

`defect_key`는 canonical source URL에서 만든다. 기본 형식은 candidate의 `source_key`와 같다.

```text
<owner>__<repo>__<issue|pr>-<number>
```

기본 case에서는 `defect_key = source_key`다.
한 GitHub thread가 서로 다른 canonical defect 여러 개를 포함하는 예외 case에서만 짧은 root-cause suffix를 붙인다.

```text
<owner>__<repo>__<issue|pr>-<number>__<short-root-cause>
```

`id`는 항상 아래 형식이다.

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

- `confirmed` candidate만 새 defect artifact를 만든다.
- `duplicate_evidence`는 기존 defect의 `evidence_urls`만 수정한다.
- canonical source는 가장 먼저 올라온 in-scope defect issue를 기본값으로 한다.
- 나중 issue/PR이 더 잘 설명해도 canonical을 바꾸지 않고 `evidence_urls`에 추가한다.
- task-specific defect는 영향을 받는 task들을 `task_names` 배열에 넣는다.
- benchmark-level defect는 `task_names: []`로 둔다.
- 파일명, id, path가 위 규칙과 다르면 artifact를 만들지 말고 먼저 고친다.

## Repo Watch Map

`config/repo-watch-map.json`은 GitHub repo와 candidate benchmark 목록의 공개 매핑이다.
`scripts/fetch-threads.mjs`는 이 파일로 GitHub fetch 대상 repo를 정한다.
`scripts/prepare-candidates.mjs`는 이 파일로 `candidate_benchmark_names`를 채운다.

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

매핑 key는 GitHub repo `owner/repo`다. 스크립트가 lowercase로 normalize한다.
매핑 value는 candidate benchmark name 배열이다.
Codex가 thread/source/task evidence를 읽고 최종 `benchmark_name`을 정한다.

## Candidate Fetch

`scripts/fetch-threads.mjs`는 `config/repo-watch-map.json`의 repo를 읽고 GitHub Issues API를 호출한다.
fetch 기준은 GitHub `updated_at`이다.
local cursor file인 `data/github-fetch-state.json`의 `last_synced_at` 이후에 새로 생성되었거나 업데이트된 GitHub issue/PR을 가져온다.
`scripts/prepare-candidates.mjs`가 raw thread의 source_url에서 source_key와 candidate 파일 경로를 계산한다.

Daily fetch command:

```bash
npm run fetch:threads -- --run=<run_id> --state-file=data/github-fetch-state.json
```

First run command:

```bash
npm run fetch:threads -- --run=<run_id> --since=<ISO8601>
```

Backfill command:

```bash
npm run fetch:threads -- --run=<run_id> --full-backfill
```

Fetch behavior:

- watched repo 목록: `config/repo-watch-map.json`
- GitHub endpoint: `/repos/<owner>/<repo>/issues?state=all&sort=updated&direction=asc&since=<cursor>`
- GitHub issue와 PR을 모두 가져온다. GitHub REST API에서 PR은 issue payload의 `pull_request` 필드로 구분한다.
- issue/PR comments를 함께 가져온다.
- PR은 diff를 함께 가져온다. 큰 diff는 changed-file summary로 대체한다.
- raw thread output: `data/raw/<run_id>/threads.json`
- next cursor output: `data/raw/<run_id>/next-fetch-state.json`
- cursor는 validate 이후 `npm run update:fetch-state`가 `data/github-fetch-state.json`에 저장한다.
- `data/github-fetch-state.json`은 commit 대상이다.
- `data/raw/<run_id>/`는 scratch output이고 `.gitignore` 대상이다.
- commit 대상 daily artifact는 `candidates/`와 `defects/`다.

Prepare command:

```bash
npm run prepare:candidates -- --run=<run_id> --input=data/raw/<run_id>/threads.json
```

Update cursor command:

```bash
npm run update:fetch-state -- --run=<run_id> --state-file=data/github-fetch-state.json
```

## Audit Levels

`audit_level`은 "필요해 보이는 수준"이 아니라 실제로 끝낸 확인 수준이다.
confirmed 또는 duplicate_evidence candidate는 5번 candidate JSON을 쓰기 전에 해당 level의 audit을 완료해야 한다.

### L1 — Thread Read

GitHub issue/PR thread만 읽고 판단한다.

L1로 confirmed 또는 duplicate_evidence가 가능한 조건:

- thread body/comments 안에 maintainer acknowledgement, reproduced note, duplicate marker, linked fix PR 중 하나가 명확하다.
- PR 자체가 작고 명확한 benchmark defect fix다.
- issue가 merged PR과 명확히 linked되어 있고 root cause가 같은지 thread 안에서 확인된다.
- benchmark seed/split/version 귀속이 thread만으로 명확하다.
- shared repo라도 current benchmark variant 귀속이 thread 안에서 명시적으로 확인된다.

L1에서 해야 할 일:

1. candidate의 `body`, `comments`, `linked_pr_diff` summary를 읽는다.
2. defect claim, benchmark 귀속, duplicate 여부, resolution 근거를 찾는다.
3. 읽은 GitHub URL을 `checked_urls`에 넣는다.
4. maintainer/social proof 또는 linked PR 근거를 `decision_note`에 적는다.

L1로 끝내면 안 되는 경우:

- shared repo에서 current benchmark variant 귀속이 thread만으로 명확하지 않다.
- task_specific인데 current task row 이름을 thread만으로 확정할 수 없다.
- PR diff/source를 읽지 않으면 benchmark defect인지 알 수 없다.
- multi-task fanout이나 큰 health count 변경이 있다.

### L2 — Source / Task Artifact Read

직접 실행은 하지 않고 PR diff, source, task artifact, benchmark task table을 읽어 확인한다.

L2가 필요한 조건:

- social proof가 약하거나 thread claim만으로 defect 여부가 부족하다.
- task-specific claim을 current benchmark task에 연결해야 한다.
- task id, instance id, failing test, gold patch, expected output, dataset row가 언급된다.
- PR diff를 읽어야 benchmark defect fix인지 알 수 있다.
- SWE-bench처럼 한 repo에 여러 seed/split/version이 섞인다.
- Terminal-Bench처럼 TB1/TB2/TB2.1 scope가 섞일 수 있다.
- Spider2처럼 같은 repo 안에서 DBT/Snow 등 benchmark variant가 섞일 수 있다.

L2에서 해야 할 일:

1. thread body/comments를 읽는다.
2. PR이면 diff/files 또는 linked fix PR을 읽는다.
3. current benchmark task table 또는 public task artifact를 읽는다.
4. task_specific이면 affected current task name을 `task_names`에 정확히 넣는다.
5. 같은 benchmark/task/root cause의 existing defect artifact를 비교한다.
6. 읽은 source/task/PR URL을 `checked_urls`에 넣는다.
7. multi-benchmark repo이면 current benchmark variant로 귀속한 근거를 `decision_note`에 적는다.
8. 왜 confirmed, duplicate_evidence, unverified, out_of_scope, rejected인지 `decision_note`에 쓴다.

L2로 끝내면 안 되는 경우:

- task fanout 수가 크고 task 목록을 source-read만으로 검증하기 어렵다.
- build/env/Docker/evaluator/parser 동작이 실제 실행 없이는 불확실하다.
- source-read 결과와 thread claim이 충돌한다.

### L3 — Reproduction

읽기만으로 부족해서 실제 실행 또는 equivalent reproduction evidence가 필요한 경우다.

L3가 필요한 조건:

- 하나의 thread가 여러 task에 영향을 준다고 주장한다.
- Docker/build/env/setup defect가 핵심이다.
- evaluator/parser/scorer가 실제 어떤 task를 망가뜨리는지 확인해야 한다.
- social proof가 없고 L2 artifact만으로 defect 여부가 불확실하다.
- open issue인데 실제로는 이미 고쳐졌는지 확인해야 한다.
- public health number를 크게 바꿀 후보이다.

L3에서 해야 할 일:

1. reproduction command, Docker/Harbor run, local fixture, upstream test command 중 해당 defect를 확인할 수 있는 방법을 실행하거나 equivalent reproduction evidence를 읽는다.
2. 실행 또는 reproduction evidence가 어떤 task/root cause를 확인했는지 `decision_note`에 적는다.
3. reproduction evidence URL이나 local command summary를 `checked_urls` 또는 `decision_note`에 남긴다.
4. 재현 실패면 confirmed로 끝내지 않는다. unverified/out_of_scope/rejected 중 하나로 끝낸다.

Confirmed/duplicate로 끝내려면 해당 level의 확인을 실제로 끝낸 뒤 `checked_urls`와 `decision_note`에 근거를 남긴다.

## Counting Rules

- Health count는 canonical defect와 affected task 기준이다.
- task-specific defect는 영향을 받는 current task row 기준으로 센다.
- benchmark-level defect는 canonical defect 1개로 센다.
- duplicate/fix/follow-up thread는 canonical defect의 evidence로만 계산한다.
- 한 task가 found/fixing/fixed 여러 bucket에 동시에 들어갈 수 있다.
