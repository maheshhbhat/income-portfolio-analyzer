# Trusted merge gate

Pull requests targeting `main` must pass `merge-gate`. The workflow tests the
pull-request head, but the verdict is computed by `merge_gate.py` as it already
exists on `main`, so a proposed gate change cannot weaken its own evaluation.

The gate requires:

- exactly one `Story: #N` line in the pull-request body;
- a linked issue labeled `type:story`;
- every changed path to match the story's unbulleted `### Scope` globs; and
- a green product test result computed inside the workflow run.

`merge-gate-surface` is advisory and must never be required. It calls attention
to gate-logic changes and fails loudly when the workflow runner itself changes,
because a check cannot protect the pull-request version of its own workflow.

Run the evaluator tests with:

```sh
python3 -m unittest discover -s .github/merge-gate -p 'test_*.py' -v
```
