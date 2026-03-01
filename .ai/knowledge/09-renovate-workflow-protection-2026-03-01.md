# Renovate Workflow Protection Issue

## Date
2026-03-01

## Issue
Renovate onboarding PR shows a warning:
```
Could not determine new digest for update (github-tags package changesets/action)
Files affected: `.github/workflows/release.yaml`
```

## Root Cause
The `.github/workflows/release.yaml` file references an invalid commit SHA for `changesets/action`:
```yaml
uses: changesets/action@aba2c841fbc6b30f889c450c3995817c1bf05285 # v1
```

This commit SHA (`aba2c841fbc6b30f889c450c3995817c1bf05285`) does not exist in the `changesets/action` repository, which prevents Renovate from determining updates.

## Attempted Fix
Tried to update the action to the latest v1.7.0 release with valid commit SHA:
```yaml
uses: changesets/action@6a0a831ff30acef54f2c6aa1cbbc1096b066edaf # v1.7.0
```

However, the `.github/workflows/release.yaml` file is protected by repository rules (GH013), preventing direct modifications via PR.

## Solution Applied
Configured Renovate to ignore `changesets/action` updates in `renovate.json`:
```json
{
  "packageRules": [
    {
      "description": "Ignore changesets/action due to invalid commit SHA in release.yaml (workflow file is protected)",
      "matchManagers": ["github-actions"],
      "matchPackageNames": ["changesets/action"],
      "enabled": false
    }
  ]
}
```

This suppresses the Renovate warning while the workflow file remains protected.

## Manual Fix Required
A repository administrator with workflow file modification permissions needs to:

1. Update `.github/workflows/release.yaml` line 34:
   ```yaml
   # Before
   uses: changesets/action@aba2c841fbc6b30f889c450c3995817c1bf05285 # v1
   
   # After (latest stable as of 2026-03-01)
   uses: changesets/action@6a0a831ff30acef54f2c6aa1cbbc1096b066edaf # v1.7.0
   ```

2. After the manual fix, remove the `changesets/action` ignore rule from `renovate.json` to re-enable automatic updates.

## Alternative Solutions
1. Use the moving `v1` branch reference (less secure but automatically updates):
   ```yaml
   uses: changesets/action@v1
   ```

2. Request bypass for the workflow protection rule specifically for this fix.

## Related
- changesets/action releases: https://github.com/changesets/action/releases
- Latest release (as of 2026-03-01): v1.7.0
- Commit SHA: `6a0a831ff30acef54f2c6aa1cbbc1096b066edaf`
