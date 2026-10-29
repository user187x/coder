#!/usr/bin/env python3
"""Checks that every releasable is at the release version in RELEASE_VERSION (the repository's root).

A release has one version: every image of ours (docker.io/mrshll187/...) is tagged with it, and both charts
(airgap-dist/helm-chart/coder-airgapped, helm/coder-platform) carry it as version and appVersion; the example Argo CD
Applications install that chart version. Editions and variants differ by repository name (coder-platform,
coder-platform-agpl, coder-upstream), never by a tag suffix.

    airgap-dist/development/tools/verify/release_version.py     exits 1 and lists what differs
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
OURS = re.compile(r"docker\.io/mrshll187/([a-z0-9-]+):([A-Za-z0-9._-]+)")


def read(path):
    with open(os.path.join(ROOT, path)) as f:
        return f.read()


def main():
    release = read("RELEASE_VERSION").strip()
    problems = []
    if not re.fullmatch(r"\d+\.\d+\.\d+", release):
        problems.append("RELEASE_VERSION: %r is not MAJOR.MINOR.PATCH" % release)
    for chart in ("airgap-dist/helm-chart/coder-airgapped/Chart.yaml", "helm/coder-platform/Chart.yaml"):
        text = read(chart)
        for key in ("version", "appVersion"):
            m = re.search(r'^%s: *"?([^"\s]+)"?' % key, text, re.M)
            if not m or m.group(1) != release:
                problems.append("%s: %s is %s" % (chart, key, m.group(1) if m else "missing"))
    for app in ("coder-airgapped-application.yaml", "coder-decorated-application.yaml", "coder-plain-application.yaml"):
        path = "airgap-dist/helm-chart/argocd/" + app
        for n, line in enumerate(read(path).splitlines(), 1):
            m = re.match(r"\s+targetRevision: (\S+)", line)
            if m and m.group(1) != release:
                problems.append("%s:%d: targetRevision %s" % (path, n, m.group(1)))
    pinned = ("airgap-dist/helm-chart/images.txt",
              "airgap-dist/helm-chart/coder-airgapped/values.yaml",
              "airgap-dist/helm-chart/coder-airgapped/charts/coder-workspace/values.yaml")
    for path in pinned:
        for n, line in enumerate(read(path).splitlines(), 1):
            if line.lstrip().startswith("#"):
                continue
            for name, tag in OURS.findall(line):
                if tag != release:
                    problems.append("%s:%d: %s:%s" % (path, n, name, tag))
    values = read("airgap-dist/helm-chart/coder-airgapped/values.yaml")
    for which in ("fork", "upstream"):
        m = re.search(r"^    %s:\n(?:      .*\n)*?      tag: \"?([^\"\s]+)" % which, values, re.M)
        if not m or m.group(1) != release:
            problems.append("coder-airgapped values.yaml: global.coderImages.%s.tag is %s" % (which, m.group(1) if m else "missing"))
    if not re.search(r'^image:\n(?:  .*\n)*?  tag: ""', read("helm/coder-platform/values.yaml"), re.M):
        problems.append("helm/coder-platform/values.yaml: image.tag must be empty (the chart's appVersion)")
    for p in problems:
        print("NOT AT %s: %s" % (release, p))
    if problems:
        return 1
    print("every releasable is at %s" % release)
    return 0


if __name__ == "__main__":
    sys.exit(main())
