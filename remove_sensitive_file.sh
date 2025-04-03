#!/bin/bash
# Script to completely remove sensitive file from git history
# CAUTION: This rewrites git history - all collaborators will need to re-clone or use git pull --rebase

# First, create a backup branch
git checkout -b backup-before-filter
git checkout feature/trading-sim

# Run filter-branch to remove the file completely from history
git filter-branch --force --index-filter "git rm --cached --ignore-unmatch backend/.env.development" --prune-empty --tag-name-filter cat -- --all

# Push with force to overwrite history on the remote repository
# git push origin feature/trading-sim --force

echo "Review the changes locally first!"
echo "If everything looks good, run: git push origin feature/trading-sim --force"
echo "IMPORTANT: All collaborators will need to re-clone or run git pull --rebase after this!" 