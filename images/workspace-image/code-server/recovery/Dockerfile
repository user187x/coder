ARG BASE
FROM ${BASE}
USER root
COPY install.cjs client.js /tmp/editor-recovery/
RUN /usr/lib/code-server/lib/node /tmp/editor-recovery/install.cjs /usr/lib/code-server /tmp/editor-recovery/client.js \
    && /usr/lib/code-server/lib/node --check /usr/lib/code-server/lib/vscode/out/vs/code/browser/workbench/workbench.js
USER 1000:1000
