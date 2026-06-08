# Delphik Open Defects
다양한 agentic benchmark들의 defect artifact 저장소입니다. 태스크별로 defect를 분류하여 브라우징이 쉽습니다.
BFCL, SWE-bench Verified, Terminal Bench 등 Delphik이 추적하는 agentic benchmark defect artifact를 관리합니다.
[Agentic Benchmark Checklist (ABC)](https://arxiv.org/html/2507.02825)가 강조하는 benchmark reporting 원칙과 맞닿아 있으며, benchmark 결함을 투명하게 공개하고 evidence와 task impact를 추적 가능하게 만들어 Continuous QA 하기 위한 공개 레포지토리입니다.

## When to use
- 벤치마크를 돌렸는데, 자기 모델이 틀린건지, 태스크가 틀린건지를 빠르게 확인하고 싶을 때
- 새로운 벤치마크를 돌려보려 하는데, 결함이 얼마나 있는지 확인하고 싶을 때 - health badge(https://posttrain.dev/benchmarks)를 확인해보세요
- 결함있는 task를 발견하고 report 하고 싶을 때 - /report-defect (posttrain.dev/researchers) 스킬을 활용해보세요

## 추적 항목
- 어떤 GitHub thread가 실제 benchmark defect인지
- task-specific defect인 경우 어떤 task row에 영향을 주는지
- 각 defect가 현재 found, fixing, fixed 중 어떤 상태인지
- 어떤 duplicate/fix/evidence thread가 canonical defect를 뒷받침하는지
- 어떤 benchmark seed/split/version에 영향을 주는지. 예: SWE-bench Verified와 SWE-bench Lite 구분, Terminal-Bench 2와 2.1 구분

## Start Here

- [docs/v5/back/codex-sync-runbook_ko.md](docs/v5/back/codex-sync-runbook_ko.md)

## Layout

```text
candidates/   GitHub issue/PR candidate와 terminal audit decision
defects/      confirmed canonical defect artifact
docs/         curation runbook
```

공개 GUI는 [posttrain.dev/benchmarks](https://posttrain.dev/benchmarks)에서 확인할 수 있습니다.

## Workflow

```text
GitHub upstream thread
→ Codex가 thread/source/task evidence를 audit
→ candidates/와 defects/ artifact 업데이트
→ public GUI가 posttrain.dev/benchmarks에 결과를 표시
```

## Corrections

잘못됐거나 누락된 항목은 PR로 제보할 수 있습니다. Codex가 해당 PR을 확인한 뒤 merge 또는 close합니다.

## Contributing

[CONTRIBUTING_ko.md](CONTRIBUTING_ko.md)를 참고하세요.
