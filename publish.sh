#!/bin/zsh

set -e

# increment version
if [ "$1" = "major" ]; then
    jq '.version = (.version | split(".") | map(tonumber) | "\(.[0] + 1).\(.[1]).\(.[2])")' package.json > package.json.tmp
elif [ "$1" = "minor" ]; then
    jq '.version = (.version | split(".") | map(tonumber) | "\(.[0]).\(.[1] + 1).\(.[2])")' package.json > package.json.tmp
else
    jq '.version = (.version | split(".") | map(tonumber) | "\(.[0]).\(.[1]).\(.[2] + 1)")' package.json > package.json.tmp
fi

mv package.json.tmp package.json

new_version=$(jq -r .version package.json)

npm i
npm run build
git add package.json package-lock.json dist
git commit -v -m "chore: publish version $new_version"
git tag -a -m "v$new_version" "v$new_version"
git push --follow-tags
