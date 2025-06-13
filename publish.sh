#!/usr/bin/env bash
set -eou pipefail

next_version="$(git cliff --bumped-version | rg 'v(\d+\.\d+\.\d+)' --only-matching --replace='$1' --color=never)"
echo "publishing version $next_version"

jq ".version = \"$next_version\"" package.json > package.json.tmp
jq ".version = \"$next_version\"" package-lock.json > package-lock.tmp1.json
jq ".packages.\"\".version = \"$next_version\"" package-lock.tmp1.json > package-lock.json.tmp

mv package.json.tmp package.json
mv package-lock.json.tmp package-lock.json
rm package-lock.tmp1.json

commit_msg="chore: publish version $next_version";

npm ci
npm run build

git cliff --bump --with-commit="$commit_msg" -o CHANGELOG.md
git add package.json package-lock.json dist CHANGELOG.md
git commit -m "$commit_msg"
git tag -a -m "v$next_version" "v$next_version"
git push --follow-tags
