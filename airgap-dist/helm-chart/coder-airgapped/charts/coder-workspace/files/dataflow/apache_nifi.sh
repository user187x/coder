#!/usr/bin/env bash
# Apache NiFi in the workspace (coder_script.nifi in ../main.tf: the ubuntu-dataflow template's, in place of
# code-server, with no network). Its own script, beside the startup script and the others (the workspace's Logs show it
# as Apache NiFi). Runs at every start; each step is safe to repeat.
# From /opt/nifi as the workspace image installed it (its NARs unpacked there, read-only); everything it writes is a
# link into ~/.nifi: conf (the image's, the first time; then the user's flows and settings), logs, state, repositories,
# work areas. Unsecured HTTP on 127.0.0.1:8080, for this workspace only (the app is its owner's alone). The app's path
# reaches it in X-Forwarded-Prefix (Coder's app proxy), the scheme, host and port in the headers the chart's one NiFi
# route adds (coder-enhanced-nifi), so its pages and API calls go through Coder's proxy; it accepts them for this path
# and Coder's host only.
# main.tf renders this with templatefile(): path and access_host are the template's values (a shell variable in braces
# is written with two dollar signs).
set -e
NIFI_PATH='${path}'          # the app's path: /@<owner>/<workspace>.main/apps/nifi
ACCESS_HOST='${access_host}' # Coder's host, as browsers reach it (NiFi makes its links with it)
NIFI_HOME=/home/coder/.nifi

if [ ! -x /opt/nifi/bin/nifi.sh ]; then
 echo "Apache NiFi is not in this image (/opt/nifi): skipped"
 exit 0
fi
mkdir -p "$NIFI_HOME"
(cd "$NIFI_HOME" && mkdir -p logs run state database_repository flowfile_repository content_repository \
 provenance_repository status_repository nar_repository assets connector_assets diagnostics \
 work/uploads work/python work/jetty work/docs)
if [ ! -f "$NIFI_HOME/conf/nifi.properties" ]; then
 cp -r /opt/nifi/conf.dist "$NIFI_HOME/conf"
 # A key of its own for the flows' sensitive properties (kept with them).
 NIFI_KEY="$(head -c 32 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 32)"
 sed -i "s|^nifi.sensitive.props.key=.*|nifi.sensitive.props.key=$NIFI_KEY|" "$NIFI_HOME/conf/nifi.properties"
fi
# Its path and Coder's host, every start: renaming the workspace changes the path.
sed -i -e "s|^nifi.web.proxy.context.path=.*|nifi.web.proxy.context.path=$NIFI_PATH|" \
 -e "s|^nifi.web.proxy.host=.*|nifi.web.proxy.host=$ACCESS_HOST,$ACCESS_HOST:443|" "$NIFI_HOME/conf/nifi.properties"
if curl -fs http://127.0.0.1:8080/nifi-api/flow/about >/dev/null; then
 echo "Apache NiFi: running already"
elif JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 /opt/nifi/bin/nifi.sh start </dev/null >/tmp/nifi-start.log 2>&1; then
 echo "Apache NiFi: starting (log: ~/.nifi/logs/nifi-app.log)"
else
 echo "Apache NiFi: did not start (/tmp/nifi-start.log):"
 tail -n 20 /tmp/nifi-start.log
 exit 1
fi
