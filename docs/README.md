# Docs

This repo keeps its documentation lean. The app, the framework, and the PROBE
process each have their own home.

## Where to look

| Want to…                                 | Go to                                                   |
| ---------------------------------------- | ------------------------------------------------------- |
| Run the app / its API + CSV format       | [`probe-lab-app/README.md`](../probe-lab-app/README.md) |
| Run the BDD tests (`npm test`)           | root [`README.md`](../README.md)                        |
| Working agreements + architecture        | [`CLAUDE.md`](../CLAUDE.md)                             |
| PROBE skills, agents, process authority  | `vendor/probe/docs/` (vendored plugin)                  |
| The three workflows' requirements (PRDs) | [`PRDs/`](./PRDs)                                       |
| PROBE feature ledgers + gate evidence    | `qa/` (empty by design — fill per feature)              |

## PRDs

The requirements the lightweight app + starter BDD suite implement:

- [`PRDs/wafer-upload/wafer-upload-requirements.md`](./PRDs/wafer-upload/wafer-upload-requirements.md)
- [`PRDs/cluster-detection/cluster-detection-requirements.md`](./PRDs/cluster-detection/cluster-detection-requirements.md)
- [`PRDs/bin-pareto/bin-pareto-requirements.md`](./PRDs/bin-pareto/bin-pareto-requirements.md)

`probe.config.yaml` points PROBE's `paths.requirements` here. PROBE Spec reads
these as the requirement authority; product/domain knowledge comes from the
`yieldwerx-knowledgebase` plugin via `/yw:ask-yieldwerx`.
