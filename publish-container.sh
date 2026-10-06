#!/bin/bash
# This script tags and pushes your container to GHCR
# Usage: ./publish-container.sh 2.0.0-platform.2

TAG=${1:-2.0.0-platform.2}

echo "Publishing container: ghcr.io/user187x/coder-platform:$TAG"
echo ""
echo "Steps:"
echo "1. Creating tag: $TAG"
git tag "$TAG"

echo "2. Pushing tag to GitHub (this will trigger the workflow)"
git push origin "$TAG"

echo ""
echo "✓ Tag pushed! GitHub Actions will now build and publish your container."
echo "✓ Image will be available at: ghcr.io/user187x/coder-platform:$TAG"
echo ""
echo "Monitor progress at: https://github.com/user187x/coder/actions"
