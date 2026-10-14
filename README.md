# ✨ Rust Lint Action

forked from https://github.com/wearerequired/lint-action

## Supported linters

- Rust: `clippy`, `rustfmt`
- JavaScript/TypeScript: `eslint`, `oxlint`, `oxfmt`, `prettier`, `tsc`, `svelte`
- Python: `mypy`, `ty`, `basedpyright`, `autopep8`, `ruff`, `black`

Linters run before formatters, so all auto-fixes end up in a single commit.

## Check status

A check run (or commit status on Forgejo) is queued for every enabled linter when the action starts, set to in progress while its linter runs and completed as soon as the linter finishes. Checks left over by a crashed or cancelled run are marked as failed by the action's post step.

## PRs from forks

`pull_request` runs from forks get a read-only token, so check runs can't be created there. Write the results to a file and publish them from a privileged `workflow_run` workflow, which never runs code from the fork:

```yaml
# checks.yml (on: pull_request)
- uses: profiidev/rust-lint-action@v4
  with:
    clippy: true
    results_file: lint-results.json
- uses: actions/upload-artifact@v7
  with:
    name: lint-results
    path: lint-results.json
```

```yaml
# checks-publish.yml
on:
  workflow_run:
    workflows: [Checks and Validation]
    types: [completed]
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      actions: read
      checks: write
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: lint-results
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}
      - uses: profiidev/rust-lint-action@v4
        with:
          publish_results: lint-results.json
```

The results file is treated as untrusted: only known linters are accepted, check names and directories come from the publishing workflow's inputs, and the commit is taken from the `workflow_run` event.
