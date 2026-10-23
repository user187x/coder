#!/bin/sh
# The official image's entrypoint (registry:3.1.2): a config file serves it, a registry command runs as given.
set -e

case "$1" in
    *.yaml|*.yml) set -- registry serve "$@" ;;
    serve|garbage-collect|help|-*) set -- registry "$@" ;;
esac

exec "$@"
