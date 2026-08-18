# Cluster Detection (fail-die clusters) — Product Requirements

| Field            | Value                                                                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Document ID**  | `YWPS-CLD-PRD`                                                                                                                                                                                                                |
| **Version**      | 2.0                                                                                                                                                                                                                           |
| **Status**       | Approved for build — describes the implemented lightweight app                                                                                                                                                                |
| **Feature slug** | `cluster-detection`                                                                                                                                                                                                           |
| **Feature code** | `CLD`                                                                                                                                                                                                                         |
| **Module**       | yieldWerx Playground — Cluster Detection                                                                                                                                                                                      |
| **Depends on**   | `wafer-upload` (a wafer must have landed before anything can be detected)                                                                                                                                                     |
| **Consumed by**  | nothing — a detection is not persisted and is not a reportable result pass                                                                                                                                                    |
| **Supersedes**   | v1.0, which described the full production engine (Custom Signature / Pattern Rule / Policy, lifecycle and versioning, inking, automation, run queue, dashboard). Requirements were renumbered; v1.0 IDs do not carry forward. |

---

## 1. Why this exists

Defects on a wafer are not evenly scattered. A scratch, a particle or a handling mark
fails a _group_ of neighbouring dies, and that grouping is the evidence an engineer
needs: five failures in a row point at a physical cause, five failures scattered
across the wafer usually do not.

This release answers one question, precisely: **on this wafer, where do the failing
dies touch each other, and how big are those groups?** It finds the groups, counts
them, names their coordinates and highlights them on the wafer map.

It does **not** act on what it finds. Nothing is re-binned, no yield is given up, and
nothing is saved. That makes the feature cheap to reason about and safe to re-run:
the same wafer and the same settings always produce the same answer, and the wafer is
never touched.

## 2. Who uses it

| User                 | What they need                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| **Yield engineer**   | See whether a wafer's failures are clustered or scattered, and how large the largest cluster is.   |
| **Product engineer** | Compare adjacency settings and thresholds on a real wafer to decide what would count as a cluster. |
| **Quality engineer** | Read a cluster's exact die coordinates so a finding can be described unambiguously.                |

## 3. Scope

### In scope

- One detection mode: **contiguous components of failing dies**.
- **Adjacency**: `4-way (edges only)` or `8-way (edges and corners)`.
- A **minimum connected dies** threshold that decides which components count.
- A cluster list with each cluster's die count, and its coordinates on demand.
- The wafer map with the detected clusters highlighted.

### Out of scope

Present in the production product, deliberately absent here, and **not a defect if
absent**:

- The **Custom Signature / Pattern Rule / Policy** model. There is nothing to create,
  name, save, list, search or delete — a detection is a query, not a stored object.
- Lifecycle and versioning (`Draft` → `Evaluation` → `Active` → `Retired`), cloning,
  version history and the activation chain.
- **Inking**: layer counts, layering modes, re-binning cluster or neighbour dies,
  ink hard/soft bins, ink names and the pass/fail flag written onto a die.
- Yield impact: old yield, new yield, yield loss and dies inked. A detection reports
  no yield figures at all.
- Bin-based candidate selection: bin source, detect/skip modes, `All Fail` / `All Pass`
  / `Custom` bin lists. Candidates come from the die's pass/fail flag (CLD-07).
- Policies, scope levels, probe types, member-rule ordering and first-rule-wins.
- Automated detection on newly-landed wafers, and the scope-overlap rules that govern it.
- The analysis queue, run states, the results dashboard, per-policy summaries and
  processed-wafer lists.
- Simulation as a distinct mode — every detection in this app is already
  non-destructive and unsaved, so there is nothing to distinguish it from.
- Cluster Pattern and Cluster Matrix modes, the AI/ML engine, and spatial filters
  (reticle, radial zone, probe site, X/Y range).

## 4. The model

One stateless query.

| Input                  | Meaning                                          |
| ---------------------- | ------------------------------------------------ |
| **Wafer sequence**     | Which landed wafer to read.                      |
| **Adjacency**          | Whether diagonal neighbours count as touching.   |
| **Min connected dies** | The smallest component that counts as a cluster. |

| Output             | Meaning                                              |
| ------------------ | ---------------------------------------------------- |
| **Clusters found** | How many components met the threshold.               |
| **Cluster**        | Its ordinal, its die count, and its die coordinates. |

**CLD-01** — There is exactly one detection mode and it is not selectable. No
signature, rule or policy exists; a detection is fully described by the three inputs
above.

## 5. Functional requirements

### 5.1 Inputs

| ID         | Requirement                                                                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CLD-02** | **Wafer sequence** is required and is a whole number of `1` or greater.                                                                                                                                                                |
| **CLD-03** | **Adjacency** offers exactly two values, `4-way` and `8-way`, and defaults to `4-way`. Any other value is refused with `400` `FST_ERR_VALIDATION` `querystring/adjacency must be equal to one of the allowed values`.                  |
| **CLD-04** | **Min connected dies** is a whole number from `1` to `100` and defaults to `2`. Below or above that range the request is refused with `400` `FST_ERR_VALIDATION` `querystring/minimumConnectedDies must be >= 1` / `… must be <= 100`. |
| **CLD-05** | A wafer sequence that does not exist is refused with `404` `WAFER_NOT_FOUND` `Wafer was not found.` A non-integer sequence is refused with `400` `FST_ERR_VALIDATION` `params/waferSequence must be integer`.                          |
| **CLD-06** | Detecting requires only the `viewer` role — it reads and changes nothing. A caller with no valid token receives `401` `UNAUTHORIZED` `Authentication is required.`                                                                     |

### 5.2 The engine

This is the calculation. Every step is deterministic.

| ID         | Requirement                                                                                                                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CLD-07** | **Candidates.** A die is a candidate when its pass/fail flag is `F`. Bin numbers play no part: there is no detect set, no skip set, and no bin source. Every failing die on the wafer is a candidate, whatever its hard or soft bin.                            |
| **CLD-08** | **Adjacency.** Two candidates are connected when their coordinates differ by one step. `4-way` counts the four edge neighbours (±1 in `x`, or ±1 in `y`). `8-way` also counts the four corner neighbours.                                                       |
| **CLD-09** | **Components.** Candidates are grouped into maximal connected sets. Every candidate belongs to exactly one component, and a lone candidate forms a component of one.                                                                                            |
| **CLD-10** | **Clusters.** A component is a cluster when its die count is **greater than or equal to** Min connected dies. Smaller components are dropped and reported nowhere. With the minimum at `1`, every failing die is a cluster, isolated ones included.             |
| **CLD-11** | **Gaps break adjacency.** A grid position carrying no die is not a candidate and cannot join two components. Two failing dies either side of a missing position are separate clusters. There is no wrap-around at the edge of the data.                         |
| **CLD-12** | **Coordinate order.** A cluster's coordinates are ordered by ascending `y`, then ascending `x`.                                                                                                                                                                 |
| **CLD-13** | **Cluster order.** Clusters are ordered by **descending die count**; ties are broken by the first coordinate of the cluster under the same ascending-`y`-then-`x` rule. Ordinals are assigned `1..n` in that final order, so the largest cluster is always `1`. |
| **CLD-14** | **Clusters found** equals the number of clusters returned.                                                                                                                                                                                                      |
| **CLD-15** | **Nothing is written.** A detection creates no result row and modifies no die. The wafer's dies, part count, pass count and yield are byte-for-byte unchanged after any number of detections, and every detection is repeatable.                                |
| **CLD-16** | **Determinism.** The same wafer and the same two settings always produce identical output, including the ordinal assigned to each cluster and the order of coordinates within it.                                                                               |
| **CLD-17** | The response echoes the `adjacency` and `minimumConnectedDies` that produced it, so a reader can always see the settings in force.                                                                                                                              |

**Worked example — the sample wafer** (`probe-lab-app/database/sample-wafer.csv`,
25 dies, 20 passing, 5 failing at `(2,1) (1,2) (2,2) (3,2) (2,3)`):

| Adjacency | Min | Clusters found | Cluster 1                                            |
| --------- | --- | -------------- | ---------------------------------------------------- |
| `4-way`   | 2   | 1              | 5 dies, coordinates in `y`-then-`x` order            |
| `8-way`   | 2   | 1              | 5 dies — the same, the plus shape needs no diagonals |
| `4-way`   | 6   | 0              | —                                                    |

### 5.3 The screen

| ID         | Requirement                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CLD-18** | The Detection screen carries `Wafer sequence` (number, default `1`), `Adjacency` (default `4-way`), `Min connected dies` (number, default `2`) and a `Detect clusters` button. Nothing is requested until the button is pressed, and before the first run the screen states that no detection has run yet. Arriving from a wafer detail's `Detect clusters` action pre-fills that wafer's sequence. |
| **CLD-19** | After a detection the screen shows a summary of `Clusters found`, `Largest cluster`, `Dies in clusters` and the `Wafer` it ran against, then the wafer map beside a `Detected clusters` table of `#`, `Dies` and `Size` — a bar sized against the largest cluster — in the order of CLD-13. The map heading names the count: `Wafer map (3 clusters)`, or `Wafer map (1 cluster)` in the singular.  |
| **CLD-20** | With no cluster selected, the dies of **every** cluster are highlighted at once.                                                                                                                                                                                                                                                                                                                    |
| **CLD-21** | Selecting a cluster row highlights only that cluster, changes the heading to `Wafer map (cluster <n>)`, and lists that cluster's coordinates as `(x,y)` pairs under `Cluster <n> — <count> dies`. Selecting the same row again clears the selection and returns to CLD-20.                                                                                                                          |
| **CLD-22** | On the canvas a highlighted die is ringed, and dies outside every cluster are dimmed so the clusters carry the eye. In the machine-readable mirror of `UPL-37` a highlighted die carries `data-cluster="true"`; dies outside every cluster carry no `data-cluster` attribute. The map legend gains a `Cluster` entry with its die count.                                                            |
| **CLD-23** | When no component meets the threshold the screen shows `No clusters meet the minimum size.` and still renders the wafer map.                                                                                                                                                                                                                                                                        |
| **CLD-24** | A failed request — an unknown wafer, an expired session — is shown in an alert carrying the API's message.                                                                                                                                                                                                                                                                                          |

## 6. Interfaces

### 6.1 API

| Method | Path                                                                       | Purpose                              | Min role |
| ------ | -------------------------------------------------------------------------- | ------------------------------------ | -------- |
| `GET`  | `/api/cd/wafers/{waferSequence}/clusters?adjacency=&minimumConnectedDies=` | Detect contiguous fail-die clusters. | viewer   |

The response is:

```json
{
  "waferSequence": 5,
  "adjacency": "4-way",
  "minimumConnectedDies": 2,
  "clustersFound": 1,
  "clusters": [{ "ordinal": 1, "dieCount": 5, "coordinates": [{ "x": 2, "y": 1 }] }]
}
```

**CLD-25** — There is no `POST`, `PUT` or `DELETE` under `/api/cd`. The feature has no
writable surface.

**CLD-26** — Every error response is `{ statusCode, code, message }`, as in `UPL-44`.

**CLD-27** — The endpoint is described by the OpenAPI 3.1 document at `/openapi.json`,
and that document matches the implementation: the path, every status code, every
required field, and both adjacency values.

### 6.2 Screens

| Screen        | Route        | Purpose            |
| ------------- | ------------ | ------------------ |
| **Detection** | `/detection` | The screen in 5.3. |

**CLD-28** — The screen needs a signed-in session; without one the app redirects to
`/login`.

## 7. Non-functional requirements

| ID         | Requirement                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **CLD-29** | A detection over a 730-die wafer returns within 3 seconds.                                                                           |
| **CLD-30** | Detections are stateless and share no mutable data, so concurrent detections over the same wafer cannot affect each other's results. |
| **CLD-31** | A detection holds no lock on the wafer: an upload or a report may run against the same data at the same time.                        |

## 8. Open questions

| ID           | Question                                                                                                                                                                                                                                                          | Affects        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Q-CLD-01** | Candidates come from the pass/fail flag, so every failing bin clusters together — a bin-2 die and a bin-7 die can form one cluster even though they failed for different reasons. Should the detector accept a candidate bin list, as the production engine does? | CLD-07         |
| **Q-CLD-02** | Adjacency defaults to `4-way`. The two settings give materially different cluster counts on the same wafer, so the default decides what an engineer gets when they do not think about it. Is `4-way` right?                                                       | CLD-03, CLD-08 |
| **Q-CLD-03** | A minimum of `1` is accepted, which makes every isolated failing die a "cluster" and the count meaningless as a grouping signal. Should the floor be `2`, as the production signature requires?                                                                   | CLD-04, CLD-10 |
| **Q-CLD-04** | Nothing is persisted, so there is no record of what was detected, when, or with which settings — two engineers cannot compare findings except by re-running. Is a saved detection needed before the feature is decision-grade?                                    | CLD-15         |
| **Q-CLD-05** | Clusters are ordered by size. Would position-ordered output (top-left to bottom-right) be more useful when an engineer is comparing the list against a physical wafer?                                                                                            | CLD-13         |
| **Q-CLD-06** | Because failing dies are never re-binned, a cluster carries no consequence — the yield cost of screening it out is not shown anywhere. Should the detection at least report the yield that _would_ be lost if the clusters were inked?                            | CLD-15         |

## 9. Developer-owned verification

Internal to the implementation, not reachable through the UI or the API, and
belonging in the development team's own tests:

- The connected-components search, proven directly on small hand-built grids for both
  adjacency settings, including an L shape, a diagonal-only chain, a ring with a hole,
  and two components separated by exactly one gap.
- The neighbour offset tables, proven to be the four and the eight expected steps.
- The ordering comparator of CLD-12 and CLD-13, proven on components of equal size
  whose first coordinates differ only in `x`, and only in `y`.
- Behaviour on a wafer with no failing dies, and on a wafer whose every die fails.
- The candidate-set lookup at scale, so detection stays linear in die count.

## 10. Glossary

| Term          | Meaning                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------- |
| **Candidate** | A die whose pass/fail flag is `F`.                                                           |
| **Component** | A maximal set of candidates connected under the chosen adjacency.                            |
| **Cluster**   | A component whose die count meets the minimum.                                               |
| **Adjacency** | Whether diagonal neighbours count as touching.                                               |
| **Ordinal**   | A cluster's position in the reported order — `1` is always the largest.                      |
| **Detection** | One evaluation of one wafer under one pair of settings. It is read-only and is never stored. |
