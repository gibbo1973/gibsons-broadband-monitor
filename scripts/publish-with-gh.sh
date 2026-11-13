#!/bin/sh
# Use from a Mac/Linux terminal with Git and GitHub CLI installed and signed in.
# Creates the PUBLIC GitHub repository and pushes source, then triggers a GHCR build.
set -eu
cd "$(dirname "$0")/.."
if ! command -v gh >/dev/null 2>&1; then
  echo 'Install GitHub CLI (gh) and sign in with: gh auth login'
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo 'Git is required.'
  exit 1
fi
gh auth status
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init -b main
fi
if ! git config user.name >/dev/null || ! git config user.email >/dev/null; then
  echo 'Set git user.name and user.email once before publishing.'
  exit 1
fi
git add .
if ! git diff --cached --quiet; then
  git commit -m 'Initial beta of Gibsons Broadband Monitor'
fi
gh repo create gibbo1973/gibsons-broadband-monitor --public --source . --remote origin --push
if ! git rev-parse v0.1.0-beta.1 >/dev/null 2>&1; then
  git tag v0.1.0-beta.1
fi
git push origin v0.1.0-beta.1
printf '\nSource is on GitHub. Open Actions to verify the image build.\n'
printf 'Then make the GHCR package public before sharing the install link.\n'
