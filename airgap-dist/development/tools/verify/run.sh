#!/usr/bin/env bash
# The verification suite: runs the chosen suites and writes out/<date>/report.md (+ results.jsonl).
#
#   ./run.sh [SUITE...] [--url URL --domain DOMAIN --ca CA] [--context KUBECTX] [--workspace /@user/ws]
#            [--fork ~/workspace/coder] [--go fork|full] [--soak-minutes N] [--load "ARGS"]
#
# Suites (default: static unit):
#   static     the deliverable: chart renders, every image pinned and bundled, no floating tags, nothing online
#   unit       the fork's tests: go test of every package the fork changed (--go full: the whole upstream suite) and
#              the dashboard's vitest suite; the platform service's unit tests
#   live       Coder's own capabilities and the fork's, end to end on a deployment (live.py: throwaway user and
#              workspace, deleted afterwards)
#   ui         the dashboard in Chromium: pages, egress (nothing outside DOMAIN), the fork's views, memory soak
#   rollback   upstream Coder on a copy of the deployment's database, and back (rollback.sh)
#   load       many users' dashboards polling at once (load.py; --load passes its options)
#   all        all of the above
#
# Live, ui, rollback and load need a deployment: --url (and --ca when its CA is not trusted), --context for kubectl.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
suites=(); url=""; domain=""; ca=""; ctx=""; ws=""; fork="${HOME}/workspace/coder"; go=fork; soak=0; loadargs=""
while (($#)); do case "$1" in
	--url) url=$2; shift ;; --domain) domain=$2; shift ;; --ca) ca=$2; shift ;; --context) ctx=$2; shift ;;
	--workspace) ws=$2; shift ;; --fork) fork=$2; shift ;; --go) go=$2; shift ;; --soak-minutes) soak=$2; shift ;;
	--load) loadargs=$2; shift ;; all) suites=(static unit live ui rollback load) ;; -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
	*) suites+=("$1") ;; esac; shift; done
((${#suites[@]})) || suites=(static unit)
out="$here/out/$(date -u +%Y%m%d-%H%M)"; mkdir -p "$out"; J="$out/results.jsonl"; : >"$J"
rec() { python3 -c 'import json,sys; print(json.dumps({"suite":sys.argv[1],"name":sys.argv[2],"ok":sys.argv[3]=="0","detail":sys.argv[4][:600],"seconds":None}))' "$@" >>"$J"; }
node_path() { PATH="${NODE_BIN:-$HOME/.config/nvm/versions/node/v24.21.0/bin}:$PATH" "$@"; }
need_url() { [[ -n "$url" ]] || { echo "the $1 suite needs --url" >&2; exit 2; }; }

for s in "${suites[@]}"; do
	echo; echo "=== $s"
	case "$s" in
	static) python3 "$here/chart_checks.py" --jsonl "$J" ;;
	unit)
		python3 -m unittest discover -s "$here" -p 'platform_unit_test.py' >"$out/platform-unit.log" 2>&1
		rec unit "platform service unit tests" $? "$(tail -1 "$out/platform-unit.log")"
		base=$(cd "$fork" && git merge-base HEAD 70bc2e554 2>/dev/null || echo 70bc2e554)
		if [[ "$go" == full ]]; then pkgs=(./...)
		else mapfile -t pkgs < <(cd "$fork" && git diff --name-only "$base" HEAD -- '*.go' | xargs -r -n1 dirname | sort -u |
			while read -r d; do [[ -d "$fork/$d" ]] && ls "$fork/$d"/*.go >/dev/null 2>&1 && echo "./$d"; done)
		fi
		for p in "${pkgs[@]}"; do
			log="$out/go-$(echo "$p" | tr '/.' '__').log"
			(cd "$fork" && timeout 3600 go test -count=1 "$p" >"$log" 2>&1); rc=$?
			rec unit "go test $p" "$rc" "$(grep -E '^(ok|FAIL|---)' "$log" | tail -3 | tr '\n' ' ')"
			echo "$([[ $rc == 0 ]] && echo PASS || echo FAIL) go test $p"
		done
		(cd "$fork/site" && DISPLAY= WAYLAND_DISPLAY= node_path pnpm exec vitest run --project unit >"$out/vitest.log" 2>&1); rc=$?
		rec unit "dashboard unit tests (vitest, upstream + fork)" "$rc" "$(grep -E 'Test Files|Tests ' "$out/vitest.log" | tr -s ' ' | tr '\n' ' ')"
		echo "$([[ $rc == 0 ]] && echo PASS || echo FAIL) vitest"
		;;
	live) need_url live; python3 "$here/live.py" --url "$url" ${ca:+--ca "$ca"} --jsonl "$J" ;;
	ui) need_url ui; (cd "$fork/site" && node_path node "$here/ui.mjs" --url "$url" --domain "${domain:-${url#https://coder.}}" \
			${ws:+--workspace "$ws"} --soak-minutes "$soak" --jsonl "$J" --require "$fork/site/package.json") ;;
	rollback) "$here/rollback.sh" ${ctx:+--context "$ctx"} --jsonl "$J" ;;
	load) need_url load; python3 "$here/load.py" --url "$url" ${ca:+--ca "$ca"} --json "$out/load.json" $loadargs; rc=$?
		rec load "load: $(python3 -c 'import json,sys; L=json.load(open(sys.argv[1])); print("%d req, %.2f%% errors, worst p95 %.3fs" % (L["requests"], 100*L["errorRate"], L["worstP95"]))' "$out/load.json" 2>/dev/null)" "$rc" "" ;;
	*) echo "unknown suite $s" >&2 ;;
	esac
done
python3 "$here/report.py" "$J" --out "$out/report.md" $([[ -f "$out/load.json" ]] && echo --load "$out/load.json") --title "Verification report"
echo "report: $out/report.md"
