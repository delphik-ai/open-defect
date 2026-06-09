import json
import os
import pathlib
import shutil
import sys
from textwrap import dedent, indent

from datasets import load_dataset
from swebench.harness.test_spec.test_spec import make_test_spec

sys.path.insert(0, os.getcwd())
from adapter import SWEBenchTask


TEMPLATE_DIR = pathlib.Path(__file__).resolve().parents[1] / "tmp" / "l3-template-unused"


def clean_text(value: str) -> str:
    return "".join(ch for ch in value if ch in "\n\r\t" or ord(ch) >= 32)


def write_text(path: pathlib.Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: l3-generate-swebench-multilingual-task.py <task_name> <output_dir>")

    task_name = sys.argv[1]
    output_root = pathlib.Path(sys.argv[2])
    records = {ex["instance_id"]: ex for ex in load_dataset("SWE-bench/SWE-bench_Multilingual", split="test")}
    record = records[task_name]
    spec = make_test_spec(record, namespace="swebench")

    task_dir = output_root / task_name
    shutil.rmtree(task_dir, ignore_errors=True)
    task_dir.mkdir(parents=True, exist_ok=True)

    task = SWEBenchTask(**record)
    write_text(
        task_dir / "task.yaml",
        f"""instruction: |
{indent(dedent(clean_text(task.problem_statement)).strip(), "  ")}
author_email: unknown
author_name: SWE-bench
difficulty: hard
category: debugging
tags:
  - debugging
  - swe-bench
  - swe-bench-multilingual
  - ruby
parser_name: swebench
max_agent_timeout_sec: 3000.0
max_test_timeout_sec: 3000.0
run_tests_in_same_shell: false
""",
    )

    write_text(
        task_dir / "Dockerfile",
        f"""FROM {spec.instance_image_key.replace("arm64", "x86_64")}
RUN apt-get update && apt-get install -y git tmux asciinema
RUN curl -LsSf https://astral.sh/uv/0.7.13/install.sh | sh
RUN mkdir -p /logs
WORKDIR /testbed
""",
    )
    write_text(
        task_dir / "docker-compose.yaml",
        """services:
  client:
    build:
      dockerfile: Dockerfile
    image: ${T_BENCH_TASK_DOCKER_CLIENT_IMAGE_NAME}
    container_name: ${T_BENCH_TASK_DOCKER_CLIENT_CONTAINER_NAME}
    command: [ "sh", "-c", "sleep infinity" ]
    volumes:
      - ${T_BENCH_TASK_LOGS_PATH}:${T_BENCH_CONTAINER_LOGS_PATH}
      - ${T_BENCH_TASK_AGENT_LOGS_PATH}:${T_BENCH_CONTAINER_AGENT_LOGS_PATH}
    deploy:
      resources:
        limits:
          cpus: '1'
""",
    )

    write_text(task_dir / "solution.sh", f"#!/bin/bash\nset -euo pipefail\ncd /testbed\ngit apply <<'PATCH'\n{task.patch.strip()}\nPATCH\n")
    write_text(task_dir / "tests" / "config.json", json.dumps(record, indent=2))
    write_text(
        task_dir / "run-tests.sh",
        f"""#!/bin/bash
set -uo pipefail

LOG_FILE=$(mktemp)
export LOG_FILE
exec 3>&1 4>&2
exec > >(tee "$LOG_FILE") 2>&1

{spec.eval_script}

exec 1>&3 2>&4
cat > parser.py <<'PY_EOF'
import json
import os
import re
import sys
from swebench.harness.constants import (
    END_TEST_OUTPUT,
    FAIL_ONLY_REPOS,
    FAIL_TO_PASS,
    KEY_INSTANCE_ID,
    PASS_TO_PASS,
    START_TEST_OUTPUT,
    EvalType,
    ResolvedStatus,
)
from swebench.harness.grading import get_eval_tests_report, get_logs_eval, get_resolution_status
from swebench.harness.test_spec.test_spec import make_test_spec

with open("/tests/config.json", "r") as file:
    datum = json.load(file)

test_spec = make_test_spec(datum)
instance_id = datum[KEY_INSTANCE_ID]
test_log_path = os.environ["LOG_FILE"]

with open(test_log_path, "r+") as f:
    content = f.read()
    content = re.sub(r"^\\+\\s*:\\s*'(>>>>>.*)'", r"\\1", content, flags=re.MULTILINE)
    if START_TEST_OUTPUT not in content:
        content = f"{{START_TEST_OUTPUT}}\\n{{content}}\\n{{END_TEST_OUTPUT}}"
    f.seek(0)
    f.write(content)
    f.truncate()

eval_status_map, found = get_logs_eval(test_spec, test_log_path)
resolved = False
report = {{}}
if found:
    eval_ref = {{
        KEY_INSTANCE_ID: test_spec.instance_id,
        FAIL_TO_PASS: test_spec.FAIL_TO_PASS,
        PASS_TO_PASS: test_spec.PASS_TO_PASS,
    }}
    eval_type = EvalType.FAIL_ONLY if test_spec.repo in FAIL_ONLY_REPOS else EvalType.PASS_AND_FAIL
    report = get_eval_tests_report(eval_status_map, eval_ref, eval_type=eval_type)
    resolved = get_resolution_status(report) == ResolvedStatus.FULL.value

print("SWEBench Multilingual results starts here")
print("PASSED" if resolved else "FAILED")
print("SWEBench Multilingual results ends here")
print(json.dumps({{"instance_id": instance_id, "found": found, "resolved": resolved, "tests_status": report}}, indent=2))
sys.exit(0 if resolved else 1)
PY_EOF

chmod +x parser.py
set +e
export PATH="/root/.local/bin:/root/.cargo/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
uv run --with 'swebench>=4.1.0' --with 'datasets>=4.0.0' parser.py | tee -a "$LOG_FILE"
exit_code=${{PIPESTATUS[0]}}
set -e

mkdir -p /logs/verifier
if [ "$exit_code" -eq 0 ]; then
  echo 1 > /logs/verifier/reward.txt
else
  echo 0 > /logs/verifier/reward.txt
fi
exit "$exit_code"
""",
    )


if __name__ == "__main__":
    main()
