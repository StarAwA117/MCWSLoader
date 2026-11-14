#!/usr/bin/env bash
# Publish wiki/*.md to the GitHub Wiki repository.
#
# GitHub creates the wiki git repository only after the first page exists.
# If the clone fails, open the URL below once, save a placeholder page, then
# re-run this script.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIKI_URL="${WIKI_URL:-git@github.com:StarAwA117/MCWSLoader.wiki.git}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

if ! git clone "$WIKI_URL" "$WORK_DIR/wiki" 2>/dev/null; then
	echo "Wiki repository not found: $WIKI_URL"
	echo "Create the first page once at:"
	echo "  https://github.com/StarAwA117/MCWSLoader/wiki/_new"
	echo "Then re-run: bash scripts/publish-wiki.sh"
	exit 1
fi

cp "$REPO_ROOT"/wiki/*.md "$WORK_DIR/wiki"/

cd "$WORK_DIR/wiki"
git add -A
if git diff --cached --quiet; then
	echo "Wiki is already up to date."
	exit 0
fi

git -c user.name="${GIT_AUTHOR_NAME:-MCWSLoader}" \
	-c user.email="${GIT_AUTHOR_EMAIL:-mcws@local}" \
	commit -m "docs: sync wiki from repository"
git push
echo "Wiki published."
