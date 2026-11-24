# Changelog

All notable changes to this project are documented here.

---

## 0.2.0 — 2026-11-24

### Highlights

- Compare one flag across every environment at once with `compareFlagEnvironments`, which lists the fields that differ somewhere. ([a2e660c](https://github.com/kud/harness-fme/commit/a2e660c94898a1abfcf56301af2cdf07faec5229))
- Read a flag's change history with `getFlagHistory`, with before and after default rules per change. It is built from change requests, so only changes that went through an approval flow appear; direct edits do not. ([a2e660c](https://github.com/kud/harness-fme/commit/a2e660c94898a1abfcf56301af2cdf07faec5229))
- Epoch times now come with readable ISO twins (`withIsoTimes`), and owners and workspaces can be shown and given by name (`withOwnerNames`, `resolveWorkspaceId`). ([a2e660c](https://github.com/kud/harness-fme/commit/a2e660c94898a1abfcf56301af2cdf07faec5229))

<details>
<summary>Internal (1 commit)</summary>

- Package homepage now points to the project site. ([02afcd8](https://github.com/kud/harness-fme/commit/02afcd801025e7185075e8b1235a4c2871c9dd4b))

</details>

---
