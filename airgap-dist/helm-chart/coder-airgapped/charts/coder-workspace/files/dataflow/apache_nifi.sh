#!/usr/bin/env bash
# Apache NiFi in the workspace (coder_script.nifi in ../main.tf: the ubuntu-dataflow template's, in place of
# code-server, with no network). Its own script, beside the startup script and the others (the workspace's Logs show it
# as Apache NiFi). Runs at every start; each step is safe to repeat.
# From /opt/nifi as the workspace image installed it (its NARs unpacked there, read-only); everything it writes is a
# link into ~/.nifi: conf (the image's, the first time; then the user's flows and settings), logs, state, repositories,
# work areas. NiFi listens on local HTTP, while Coder provides the authenticated
# external app origin and replaces proxy host, scheme and port headers. No
# dashboard prefix is exposed to the application.
# templatefile() supplies path and access_host.
set -e
NIFI_PATH='${path}'          # empty for an isolated app origin
ACCESS_HOST='${access_host}' # this app's host, as browsers reach it
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
# Refresh the allowed app origin after a workspace rename.
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
