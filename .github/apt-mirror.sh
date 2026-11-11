#!/usr/bin/env bash
# Keeps apt off a mirror that serves its indexes but not its packages.
#
# A GitHub runner fetches from the mirrors /etc/apt/apt-mirrors.txt lists,
# Azure's first. When that mirror answers `apt-get update` but not the
# packages, apt waits on each of them in turn and the install lasts hours.
# Run after `apt-get update`: it fetches the first KiB of one package from
# each mirror in turn, 15 s at most, and removes from the list every mirror
# before the first that serves it. apt then installs from that one. If no
# mirror serves it, it fails at once.
set -euo pipefail

list=/etc/apt/apt-mirrors.txt
[ -f "$list" ] || { echo "no $list on this runner: apt keeps its sources"; exit 0; }

# The package's path in the archive, the same on every mirror.
package=$(apt-get download --print-uris patchelf | cut -d"'" -f2 | sed 's|.*/pool/|pool/|')

# shellcheck disable=SC2013 # one URL per line, its first field, never a space in it
for mirror in $(awk '{print $1}' "$list"); do
  if curl -fsS -m 15 -r 0-1023 -o /dev/null "${mirror%/}/$package"; then
    echo "$mirror serves packages"
    exit 0
  fi
  echo "::warning::$mirror does not serve packages, it leaves the list"
  sudo sed -i "\|^$mirror|d" "$list"
done

echo "::error::no Ubuntu mirror serves packages to this runner"
exit 1
