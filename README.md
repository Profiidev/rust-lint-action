# ✨ Rust Lint Action

forked from https://github.com/wearerequired/lint-action

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
