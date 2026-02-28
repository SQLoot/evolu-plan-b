# Integration Lane Checklist (Astro -> TanStack -> React Native -> Expo)

This checklist enforces sequential delivery (`WIP = 1`) and explicit Definition
of Done for each lane.

## Rules

- Only one active lane at a time.
- Next lane starts only after previous lane reaches `done`.
- If blocked for more than one business day, stop lane and open a follow-up issue.

## Lane Status

| Lane | Status | Owner | Branch | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| Astro | done | SQLoot | `feat/new-integrations` | TBD | `coverage:lane:astro` + gate pass, example build pass. |
| TanStack | done | SQLoot | `feat/new-integrations` | TBD | `coverage:lane:tanstack` + gate pass, example build pass. |
| React Native | done | SQLoot | `feat/new-integrations` | TBD | `coverage:lane:react-native` + gate pass, package build pass. |
| Expo | done | SQLoot | `feat/new-integrations` | TBD | `coverage:lane:expo` + web export pass; `expo-doctor` kept informational due Bun workspace duplicate-module false positives. |

## DoD Checklist Template

- [ ] Unit tests cover server/client/wrapper paths
- [ ] Error contract (`name`, `code`, message) is asserted
- [ ] Lane coverage command passes
- [ ] Lane coverage gate passes at `100/100/100/100`
- [ ] Example smoke build passes
- [ ] CI lane is green
- [ ] Knowledge log updated with snapshot and decisions
