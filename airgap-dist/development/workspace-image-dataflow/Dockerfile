# The workspace image of the ubuntu-dataflow template: the DEFAULT template's image (../workspace-image) and
#   - Apache NiFi (/opt/nifi, its NARs unpacked here, read-only: each workspace keeps only its own conf, flows,
#     repositories and logs in ~/.nifi) with a Java 21 runtime; NiFi learns the app's path from the proxy headers
#     the cluster's Gateway adds (the template's HTTPRoute);
#   - Apache Airflow (/opt/airflow, a virtual environment pinned with Airflow's own constraints, but for the newer
#     releases airflow-overrides.txt names, which fix vulnerabilities).
# NiFi's own libraries with vulnerabilities fixed in a compatible release are replaced by that release before its first
# start (patch-nifi-jars.py: in lib/bootstrap, in the NARs and in the WARs inside them; versions and SHA-256 pinned),
# and the two jars that bundle a relocated vulnerable Jackson with no newer release (hazelcast, parquet-jackson) are
# re-shaded with the fixed Jackson, relocated by their own build's rules (checked against what they ship first).
# Built by ../tools/build-dataflow-image.sh, which downloads NiFi (checked against Apache's SHA-512) beforehand: the
# build itself needs the network only for apt, pip and those jars (Maven Central).
ARG BASE=ghcr.io/user187x/coder-workspace:1.9.4
FROM ${BASE}
ARG NIFI_VERSION=2.12.0
ARG AIRFLOW_VERSION=3.3.2
USER root

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openjdk-21-jre-headless unzip \
 && rm -rf /var/lib/apt/lists/*

# NiFi: unsecured HTTP on 127.0.0.1:8080 (only Coder's app proxy, through the agent, reaches it; the app is the owner's alone), no login.
# Its NARs are unpacked once here (a first start), into /opt/nifi/work/nar, which every workspace reads (owned by the
# workspace's user: NiFi refuses a NAR directory it may not write, though it writes nothing there when the NARs are
# unpacked already; were it to, the write would stay in that pod's own container layer), from the NARs as
# patch-nifi-jars.py patched them before (no unpacked copy exists before that start; its check afterwards fails on any
# replaced jar left, unpacked, in a NAR or in a WAR). It runs
# from /opt/nifi as installed (its bootstrap reads lib/ as a real directory); everything it writes - conf, logs, pid,
# state, repositories, work areas - is a link into the workspace's /home/coder/.nifi, which the startup script fills
# (conf from conf.dist, the first time). The archive is mounted for the build only: no layer keeps it.
ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
RUN --mount=type=bind,source=nifi-${NIFI_VERSION}-bin.zip,target=/tmp/nifi.zip \
    --mount=type=bind,source=patch-nifi-jars.py,target=/tmp/patch-nifi-jars.py \
    unzip -q /tmp/nifi.zip -d /opt \
 && mv /opt/nifi-${NIFI_VERSION} /opt/nifi \
 && python3 /tmp/patch-nifi-jars.py patch /opt/nifi \
 && cd /opt/nifi \
 && sed -i \
      -e 's|^nifi.web.http.host=.*|nifi.web.http.host=127.0.0.1|' \
      -e 's|^nifi.web.http.port=.*|nifi.web.http.port=8080|' \
      -e 's|^nifi.web.https.host=.*|nifi.web.https.host=|' \
      -e 's|^nifi.web.https.port=.*|nifi.web.https.port=|' \
      -e 's|^nifi.security.keystore=.*|nifi.security.keystore=|' \
      -e 's|^nifi.security.keystoreType=.*|nifi.security.keystoreType=|' \
      -e 's|^nifi.security.keystorePasswd=.*|nifi.security.keystorePasswd=|' \
      -e 's|^nifi.security.keyPasswd=.*|nifi.security.keyPasswd=|' \
      -e 's|^nifi.security.truststore=.*|nifi.security.truststore=|' \
      -e 's|^nifi.security.truststoreType=.*|nifi.security.truststoreType=|' \
      -e 's|^nifi.security.truststorePasswd=.*|nifi.security.truststorePasswd=|' \
      -e 's|^nifi.security.user.authorizer=.*|nifi.security.user.authorizer=|' \
      -e 's|^nifi.security.user.login.identity.provider=.*|nifi.security.user.login.identity.provider=|' \
      -e 's|^nifi.remote.input.secure=.*|nifi.remote.input.secure=false|' \
      -e 's|^nifi.nar.working.directory=.*|nifi.nar.working.directory=/opt/nifi/work/nar/|' \
      -e 's|^nifi.sensitive.props.key=.*|nifi.sensitive.props.key=coder-workspace-build-only|' \
      conf/nifi.properties \
 && sed -i -e 's|^java.arg.2=.*|java.arg.2=-Xms512m|' -e 's|^java.arg.3=.*|java.arg.3=-Xmx1g|' conf/bootstrap.conf \
 && ./bin/nifi.sh start \
 && for i in $(seq 1 240); do grep -q "Started Application\|NiFi has started" logs/nifi-app.log 2>/dev/null && break; sleep 2; done \
 && grep -q "Started Application\|NiFi has started" logs/nifi-app.log \
 && curl -fs http://127.0.0.1:8080/nifi-api/flow/about >/dev/null \
 && ./bin/nifi.sh stop \
 && test -d work/nar \
 && python3 /tmp/patch-nifi-jars.py check /opt/nifi \
 && rm -f conf/flow.json.gz conf/flow.xml.gz && rm -rf conf/archive \
 && mv conf conf.dist \
 && for d in conf logs run state database_repository flowfile_repository content_repository provenance_repository \
             status_repository nar_repository assets connector_assets diagnostics; do \
      rm -rf "$d"; ln -s "/home/coder/.nifi/$d" "$d"; \
    done \
 && for d in uploads python jetty docs; do rm -rf "work/$d"; ln -s "/home/coder/.nifi/work/$d" "work/$d"; done \
 && chmod -R a+rX /opt/nifi \
 && chown -R 1000:1000 /opt/nifi/work

# Airflow, with Airflow's constraints for this Python, each package airflow-overrides.txt names at its version there
# instead (pip, which the virtual environment brings, too); pip check then confirms every requirement still holds.
# pip itself then leaves the environment: its newer releases list the libraries they vendor (an SBOM in their
# dist-info, which scanners read) and those lag behind their fixes, while the image never needs it (/opt/airflow is
# root's; with sudo, the system's pip still manages it: python3 -m pip --python /opt/airflow/bin/python ...).
RUN --mount=type=bind,source=airflow-constraints.txt,target=/tmp/airflow-constraints.txt \
    --mount=type=bind,source=airflow-overrides.txt,target=/tmp/airflow-overrides.txt \
    cp /tmp/airflow-constraints.txt /tmp/constraints.txt \
 && grep -vE '^[[:space:]]*(#|$)' /tmp/airflow-overrides.txt | while IFS= read -r pin; do \
      grep -viE "^${pin%%==*}==" /tmp/constraints.txt >/tmp/constraints.new || true; \
      echo "$pin" >>/tmp/constraints.new; mv /tmp/constraints.new /tmp/constraints.txt; \
    done \
 && python3 -m venv /opt/airflow \
 && /opt/airflow/bin/pip install --no-cache-dir -q --upgrade pip --constraint /tmp/constraints.txt \
 && /opt/airflow/bin/pip install --no-cache-dir -q "apache-airflow==${AIRFLOW_VERSION}" --constraint /tmp/constraints.txt \
 && /opt/airflow/bin/pip check \
 && grep -vE '^[[:space:]]*(#|$)' /tmp/airflow-overrides.txt | while IFS= read -r pin; do \
      /opt/airflow/bin/pip freeze --all | grep -qixF "$pin" || { echo "not installed: $pin" >&2; exit 1; }; \
    done \
 && /opt/airflow/bin/python -m pip uninstall -y -q pip \
 && rm /tmp/constraints.txt \
 && /opt/airflow/bin/airflow version \
 && chmod -R a+rX /opt/airflow

# What is in this image, beside the base's (the Images view's add-ons list).
RUN python3 - <<'PY'
import json
p = "/usr/share/coder-workspace/addons.json"
d = json.load(open(p))
d["software"] += [{"name": "Apache NiFi", "what": "The NiFi app: data flows (/opt/nifi)", "group": "Apps",
                   "version": "__NIFI__"},
                  {"name": "Apache Airflow", "what": "The Airflow app: workflows (/opt/airflow)", "group": "Apps",
                   "version": "__AIRFLOW__"},
                  {"name": "OpenJDK", "what": "Java runtime for NiFi", "group": "Languages", "version": "21"}]
json.dump(d, open(p, "w"), indent=1)
PY
RUN sed -i -e "s/__NIFI__/${NIFI_VERSION}/" -e "s/__AIRFLOW__/${AIRFLOW_VERSION}/" /usr/share/coder-workspace/addons.json

USER coder
