# Claudian Project Instructions

## Workflows

### Dev Branch
- **Dev Release**: Every time a push is made to the `dev` branch, a "dev release" must be updated or uploaded.
  - This typically involves building the project and attaching the artifacts to a GitHub Release tagged as `dev` or similar.
  - **Command**: `npm run build && gh release upload dev main.js manifest.json styles.css --clobber` (or `gh release create dev ...` if it doesn't exist).

