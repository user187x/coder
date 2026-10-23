#!/usr/bin/env bash
# Apache Airflow in the workspace (coder_script.airflow in ../main.tf: the ubuntu-dataflow template's, in place of
# code-server, with no network). Its own script, beside the startup script and the others (the workspace's Logs show it
# as Apache Airflow). Runs at every start; each step is safe to repeat.
# Standalone (its API server, scheduler, DAG processor and triggerer; SQLite in ~/airflow) under the full app path
# (base_url), every user an admin (the app is its owner's alone), with Airflow's example DAGs. The same settings in
# ~/.airflowrc, which ~/.bashrc reads, for the airflow command in terminals.
# main.tf renders this with templatefile(): path and access_host are the template's values (a shell variable in braces
# is written with two dollar signs).
set -e
AIRFLOW_BASE='${path}'       # the app's path: /@<owner>/<workspace>.main/apps/airflow
ACCESS_HOST='${access_host}' # Coder's host, as browsers reach it (Airflow makes its links with it)

if [ ! -x /opt/airflow/bin/airflow ]; then
 echo "Apache Airflow is not in this image (/opt/airflow): skipped"
 exit 0
fi
cat >/home/coder/.airflowrc <<AIRFLOWRC
export AIRFLOW_HOME=/home/coder/airflow
export AIRFLOW__API__HOST=127.0.0.1
export AIRFLOW__API__PORT=8090
export AIRFLOW__API__WORKERS=1
export AIRFLOW__API__BASE_URL=https://$ACCESS_HOST$AIRFLOW_BASE
export AIRFLOW__CORE__EXECUTION_API_SERVER_URL=http://127.0.0.1:8090$AIRFLOW_BASE/execution/
export AIRFLOW__CORE__SIMPLE_AUTH_MANAGER_ALL_ADMINS=True
export AIRFLOW__CORE__LOAD_EXAMPLES=True
export PATH="/opt/airflow/bin:\$PATH"
AIRFLOWRC

# ~/.bashrc reads it. The startup script, which runs beside this one, puts the workspace image's default ~/.bashrc in
# place where there is none or only Ubuntu's stock one: the line goes in once that is done (added before, it would keep
# the default out) - waited for in the background, up to a minute.
bashrc_line() {
 grep -qs "airflowrc" /home/coder/.bashrc || echo '[ -f ~/.airflowrc ] && . ~/.airflowrc' >>/home/coder/.bashrc
}
bashrc_ready() {
 [ ! -f /usr/share/coder-workspace/bashrc ] ||
  { [ -e /home/coder/.bashrc ] && ! cmp -s /home/coder/.bashrc /usr/share/coder-workspace/ubuntu-bashrc; }
}
if bashrc_ready; then
 bashrc_line
else
 # The whole subshell redirected: a background job holding the agent's output keeps the script from ending (a start
 # error).
 (
  for _ in $(seq 120); do
   bashrc_ready && break
   sleep 0.5
  done
  bashrc_line
 ) </dev/null >/dev/null 2>&1 &
fi

if curl -fs "http://127.0.0.1:8090$AIRFLOW_BASE/api/v2/monitor/health" >/dev/null; then
 echo "Apache Airflow: running already"
else
 # Redirected and exec'd, for the same reason.
 (. /home/coder/.airflowrc && mkdir -p "$AIRFLOW_HOME/dags" && exec airflow standalone) </dev/null >/tmp/airflow.log 2>&1 &
 echo "Apache Airflow: starting (log: /tmp/airflow.log)"
fi
