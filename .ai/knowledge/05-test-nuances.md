# Test Nuances & Known Flakes

## TreeShaking Tests
**File**: `packages/common/test/TreeShaking.test.ts`

### Issue
Bundle size measurements can fluctuate slightly (typically < 20 bytes) between different environments (local dev vs CI vs `bun verify`).

### Cause
Likely differences in compression/minification details or environment-specific overhead in the test runner.

### Mitigation
- If checks fail on size mismatch, use `bun test -u packages/common/test/TreeShaking.test.ts` to update snapshots locally.
- Be aware that `verify` might fail purely due to this flake even if logic is correct.

## Bun Verify vs Bun Test
`bun verify` runs the full monorepo check sequence. Sometimes `bun test` passes in isolation while `verify` fails due to cache/state issues.
**Fix**: Run `bun run clean` in the failing package before retrying verification.
