#!/usr/bin/env bash
# Worbus P5: no upstream name left where a person reads the app's name (design §6.2, ruling R1).
# Greps tracked files for the fixed strings paige.navic, paige/navic, org.jeffvli and the
# case-sensitive whole words Navic and Feishin. Each hit must match a line of check-names.allow
# ("<path glob> <TAB> <extended regex> <TAB> <reason>"), else it is printed and the script exits 1.
# Run from anywhere inside the repo: tools/check-names.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
allow=tools/check-names.allow

hits=$( { git grep -n -I -F -e 'paige.navic' -e 'paige/navic' -e 'org.jeffvli' || true
          git grep -n -I -w -e 'Navic' -e 'Feishin' || true; } | sort -u )

bad=0
while IFS= read -r hit; do
    [ -z "$hit" ] && continue
    path=${hit%%:*}
    rest=${hit#*:}; text=${rest#*:}
    ok=0
    while IFS=$'\t' read -r glob pattern _reason; do
        case "$glob" in ''|'#'*) continue ;; esac
        # shellcheck disable=SC2254
        case "$path" in $glob) printf '%s\n' "$text" | grep -q -E -- "$pattern" && { ok=1; break; } ;; esac
    done < "$allow"
    if [ "$ok" = 0 ]; then
        printf '%s\n' "$hit"
        bad=1
    fi
done <<< "$hits"

if [ "$bad" = 1 ]; then
    echo "check-names: upstream names above are not in $allow" >&2
    exit 1
fi
echo "check-names: clean"
