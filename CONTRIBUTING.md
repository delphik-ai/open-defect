# Contributing

Delphik accepts PRs that improve benchmark defect curation.

Useful contributions:

- mark a candidate artifact as `confirmed`, `duplicate_evidence`, `not_present`, `unverified`, `out_of_scope`, or `rejected`
- fix benchmark attribution
- fix task attribution in a defect artifact's `task_names`
- provide stronger source evidence for L2/L3 audit
- correct summaries, root-cause taxonomy, or resolution state
- improve the sync runbook or schema docs

## Curation Rules

Use [docs/v5/back/codex-sync-runbook.md](docs/v5/back/codex-sync-runbook.md) as the curation guide.

Short version:

- A GitHub thread is not counted just because it exists.
- `confirmed` means it is a current Delphik/Harbor seed defect.
- `duplicate_evidence` means it supports an existing canonical defect but should not be counted separately.
- `not_present` means the claim may be historical or plausible, but the current artifact no longer contains the root cause.
- `out_of_scope` means it may be real, but belongs to a different seed/split/version.
- `rejected` means it is not a benchmark defect.
- `unverified` means Delphik could not verify the claim after the required audit.

## PR Checklist

- Link every changed defect decision to upstream GitHub evidence.
- For task-specific defects, list exact current task names.
- For shared repos, verify seed/split/version before marking `confirmed`.
- Do not add secrets, tokens, env files, private dumps, or personal scratch files.
