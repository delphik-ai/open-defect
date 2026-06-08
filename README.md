# Delphik Open Defects

Open defect ledger for agentic benchmarks. Defects are organized by task so they are easy to browse.

The repository covers benchmark defect artifacts for Delphik-tracked agentic benchmarks, including BFCL, SWE-bench Verified, and Terminal-Bench.

This repository curates public upstream benchmark issues and PRs into reviewable JSON artifacts for continuous benchmark QA. It aligns with the reporting goals described in the [Agentic Benchmark Checklist (ABC)](https://arxiv.org/html/2507.02825): making benchmark defects transparent, traceable, and easier to interpret.

## When to use

- You ran a benchmark and want to quickly check whether your model failed or the task is defective.
- You are evaluating a new benchmark and want to understand its defect rate. Check the health badge at [posttrain.dev/benchmarks](https://posttrain.dev/benchmarks).
- You found a defective task and want to report it. Use the `/report-defect` skill at [posttrain.dev/researchers](https://posttrain.dev/researchers).

## What this tracks

- which GitHub threads are real benchmark defects
- which task rows they affect, when task-specific
- whether each defect is currently found, fixing, or fixed
- which duplicate/fix/evidence threads support a canonical defect
- which benchmark seed/split/version they affect, such as SWE-bench Verified vs. SWE-bench Lite, or Terminal-Bench 2 vs. 2.1

## Start Here

- [docs/v5/back/codex-sync-runbook.md](docs/v5/back/codex-sync-runbook.md)

## Layout

```text
candidates/   GitHub issue/PR candidates and terminal audit decisions
defects/      confirmed canonical defect artifacts
docs/         curation runbook
```

The public GUI is available at [posttrain.dev/benchmarks](https://posttrain.dev/benchmarks).

## Workflow

```text
GitHub upstream thread
→ Codex audits thread/source/task evidence
→ candidates/ and defects/ artifacts are updated
→ public GUI shows the results at posttrain.dev/benchmarks
```

## Corrections

Incorrect or missing entries can be reported through PRs. Codex verifies those PRs and then merges or closes them.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
