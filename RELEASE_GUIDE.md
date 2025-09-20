# Release Guide

This document contains instructions for publishing the `web-sharing` package to the npm registry.

## Prerequisites

- Ensure you have an npm account and are logged in
- Have push access to the GitHub repository
- All changes are committed and pushed to the main branch

## Publishing Steps

Run these commands in order to publish the package:

### Step 1: Verify Package Structure
```bash
cd <path-to>/web-sharing
npm pack --dry-run
```
This will show you what files will be included in the package without actually creating it.

### Step 2: Verify npm Login
```bash
npm whoami
# If not logged in, run:
npm login
```
Follow the prompts to authenticate with your npm account if needed.

### Step 3: Version Management
```bash
# Check current version
npm version

# Choose appropriate version bump:
npm version patch    # For bug fixes (0.0.1 -> 0.0.2)
# npm version minor  # For new features (0.0.1 -> 0.1.0)  
# npm version major  # For breaking changes (0.0.1 -> 1.0.0)
```
This will automatically update `package.json` and create a git commit and tag.

### Step 4: Test Package Locally
```bash
# Create a tarball and test installation
npm pack
PACKAGE_VERSION=$(npm pkg get version | tr -d '"')
npm install -g "web-sharing-${PACKAGE_VERSION}.tgz"
web-sharing --help
npm uninstall -g web-sharing
rm "web-sharing-${PACKAGE_VERSION}.tgz"
```

### Step 5: Publish to npm Registry
```bash
npm publish
```
The package is configured with `"access": "public"` in `publishConfig`, so it will be publicly available.

### Step 6: Verify Publication
```bash
# Check if package is published
npm view web-sharing

# Test global installation from npm
npm install -g web-sharing
web-sharing --help
```

### Step 7: Push Git Tags
```bash
# Push the version tag created by npm version
git push origin main --tags
```

## Complete Publishing Script

You can also run all steps at once with this script:

```bash
#!/bin/bash
set -e

echo "Step 1: Verifying package structure..."
npm pack --dry-run

echo "Step 2: Checking npm login..."
npm whoami || { echo "Please run 'npm login' first"; exit 1; }

echo "Step 3: Current version:"
npm version

read -p "Bump version? (patch/minor/major/skip): " VERSION_BUMP
if [ "$VERSION_BUMP" != "skip" ]; then
    npm version $VERSION_BUMP
fi

echo "Step 4: Testing package locally..."
npm pack
PACKAGE_VERSION=$(npm pkg get version | tr -d '"')
npm install -g "web-sharing-${PACKAGE_VERSION}.tgz"
web-sharing --help
npm uninstall -g web-sharing
rm "web-sharing-${PACKAGE_VERSION}.tgz"

echo "Step 5: Publishing to npm..."
npm publish

echo "Step 6: Verifying publication..."
npm view web-sharing

echo "Step 7: Pushing git tags..."
git push origin main --tags

echo "✅ Package published successfully!"
```

## Troubleshooting

### Package Name Conflicts
If the package name `web-sharing` is already taken on npm:

```bash
# Option 1: Use a scoped package name
# Update package.json name to "@yourusername/web-sharing"

# Option 2: Choose a different name
# Update package.json name field
```

### Version Issues
- Always increment the version number for each publish
- Use semantic versioning (semver): MAJOR.MINOR.PATCH
- Consider using pre-release versions for testing: `npm version prerelease`

### Publishing Errors
- Check npm login status: `npm whoami`
- Verify package name availability: `npm view <package-name>`
- Ensure all required fields are in package.json

## Post-Release

1. Update README.md if needed
2. Create a GitHub release with changelog
3. Consider setting up automated publishing with GitHub Actions
4. Update documentation with new version information

## Automated Publishing (Future Enhancement)

Consider setting up GitHub Actions to automatically publish on version tags:

1. Add `.github/workflows/publish.yml`
2. Set up npm token in GitHub secrets
3. Configure automatic publishing on tag push

## Notes

- The CLI binary `web-sharing` will be available globally after installation
- The package includes: `web-sharing.mjs`, `src/`, `public/`, `README.md`, `LICENSE`
- Minimum Node.js version required: 18.0.0