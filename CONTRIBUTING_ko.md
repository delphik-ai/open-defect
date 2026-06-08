# Contributing

Delphik은 benchmark defect curation을 개선하는 PR을 받습니다.

유용한 기여 예시는 다음과 같습니다.

- candidate artifact를 `confirmed`, `duplicate_evidence`, `unverified`, `out_of_scope`, `rejected` 중 하나로 표시
- benchmark attribution 수정
- defect artifact의 `task_names`에서 task attribution 수정
- L2/L3 audit을 위한 더 강한 source evidence 제공
- summary, root-cause taxonomy, resolution state 수정
- sync runbook 또는 schema docs 개선

## Curation Rules

[docs/v5/back/codex-sync-runbook_ko.md](docs/v5/back/codex-sync-runbook_ko.md)를 curation guide로 사용하세요.

짧게 요약하면 다음과 같습니다.

- GitHub thread가 존재한다는 이유만으로 count하지 않습니다.
- `confirmed`는 current Delphik/Harbor seed의 defect라는 뜻입니다.
- `duplicate_evidence`는 기존 canonical defect를 뒷받침하지만 별도로 count하지 않아야 한다는 뜻입니다.
- `out_of_scope`는 실제 문제일 수 있지만 다른 seed/split/version에 속한다는 뜻입니다.
- `rejected`는 benchmark defect가 아니라는 뜻입니다.
- `unverified`는 필요한 audit 이후에도 Delphik이 claim을 확인하지 못했다는 뜻입니다.

## PR Checklist

- 변경된 모든 defect decision을 upstream GitHub evidence에 연결하세요.
- task-specific defect의 경우 정확한 current task name을 나열하세요.
- shared repo의 경우 `confirmed`로 표시하기 전에 seed/split/version을 확인하세요.
- secret, token, env file, private dump, 개인 scratch file을 추가하지 마세요.
