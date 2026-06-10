# Audit Queue

This directory preserves public defect evidence that is not counted in `defects/` yet.

Files here are not health-count source of truth. They are re-audit inputs. Move an item
back into `defects/` only after the current runbook evidence threshold is met.

Current queue files:

- `non_l3_multitask_legacy.json`: legacy multi-task L2 artifacts removed from counted
  health because they need L3 reproduction or explicit social proof under the current
  policy.
