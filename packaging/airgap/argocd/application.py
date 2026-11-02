#!/usr/bin/env python3
"""The Argo CD decorator install's Application (coder-decorated-application.yaml), as text: its plain variant (the
same without the customization layer) and the copy filled in with an install's values (./make --argocd).

    application.py [--plain] [--no-credentials] [--set KEY=VALUE ...] IN OUT

    --plain           drop source 2 (coder-airgapped-layer) and set global.decorator.layer to false: the plain
                      Coder; applied to a decorated install it takes the layer off (coder-plain-application.yaml)
    --no-credentials  drop the repository credentials document (./make --argocd creates that Secret itself, so the
                      password is never written to a file)
    --set KEY=VALUE   chartRepo (where Argo CD reaches the charts, when not <registry>/charts; give it first),
                      registry, revision, domain, issuer, storageClass, pullSecret (a Secret name), keycloakView
                      (true/false), kubeletInsecureTLS (true/false): each replaces the file's example value

Text, not YAML: the file's comments and layout are kept, and every change must hit exactly what it expects (else it
stops), so a changed template cannot be filled in half.
"""

import re
import sys

SOURCE2 = re.compile(r"\n  # ---- 2\. The customization layer.*?(?=\n\n  destination:)", re.S)


def sub(text, pattern, repl, count=1, flags=re.M):
    new, n = re.subn(pattern, repl, text, flags=flags)
    if n != count:
        sys.exit(f"application.py: expected {count} match(es) of {pattern!r}, found {n}")
    return new


def plain(text):
    text = sub(text, SOURCE2.pattern, "", flags=re.S)
    text = sub(text, r"^        global: &global$", "        global:")
    text = sub(text, r"^            # The customization layer \(source 2\) decorates this Coder\. false once you remove source 2\.\n"
                     r"            layer: true$",
               "            # The customization layer is not installed: upstream Coder. true (with source 2,\n"
               "            # coder-decorated-application.yaml) to decorate it again.\n"
               "            layer: false")
    head = ("# Argo CD Application: plain Coder - coder-decorated-application.yaml without its customization layer\n"
            "# (source 2, coder-airgapped-layer), and with global.decorator.layer: false. Applied to a decorated\n"
            "# install it takes the layer off: Argo CD prunes everything the layer added and restarts Coder as upstream\n"
            "# Coder; the data stays (database, users, templates, workspaces and their homes). Apply\n"
            "# coder-decorated-application.yaml to put the layer back. Made from it by application.py --plain.\n#\n")
    text = sub(text, r"\A# Argo CD Application: Coder, decorated.*?\n(?=#   source 1)", head, flags=re.S)
    return text


def no_credentials(text):
    return sub(text, r"^---\n# Credentials for the OCI chart repository\..*?\n(?=---\napiVersion: argoproj\.io)", "",
               flags=re.S | re.M)


def fill(text, key, value, decorated):
    layer_sources = 2 if decorated else 1
    if key == "chartRepo":  # where Argo CD reaches the charts, when not <registry>/charts (give it before registry)
        text = sub(text, r"harbor\.example\.com/coder-airgapped/charts", value,
                   count=len(re.findall(r"harbor\.example\.com/coder-airgapped/charts", text)) or 1)
    elif key == "registry":
        text = sub(text, r"harbor\.example\.com/coder-airgapped(?=/charts|\s)", value,
                   count=len(re.findall(r"harbor\.example\.com/coder-airgapped(?=/charts|\s)", text)) or 1)
    elif key == "revision":
        text = sub(text, r"^    targetRevision: \S+$", f"    targetRevision: {value}", count=layer_sources)
    elif key == "domain":
        text = sub(text, r"^          domain: example\.com ", f"          domain: {value} ")
    elif key == "issuer":
        text = sub(text, r"^            issuerUrl: https://keycloak\.example\.com/realms/master ",
                   f"            issuerUrl: {value} ")
    elif key == "storageClass":
        n = len(re.findall(r"storageClass: gp3 ", text))
        text = sub(text, r"storageClass: gp3 ", f"storageClass: {value} ", count=n or 1)
    elif key == "pullSecret":
        if value:
            text = sub(text, r"^          imagePullSecrets: \[\] ", f"          imagePullSecrets: [{{name: {value}}}] ")
    elif key == "keycloakView" and decorated:
        text = sub(text, r"^            enabled: false( +# true when Keycloak runs in this cluster)",
                   rf"            enabled: {value}\1")
    elif key == "kubeletInsecureTLS" and decorated:
        text = sub(text, r"^          kubeletInsecureTLS: false ", f"          kubeletInsecureTLS: {value} ")
    elif key not in ("keycloakView", "kubeletInsecureTLS"):
        sys.exit(f"application.py: unknown --set {key}")
    return text


def main(argv):
    args, sets, is_plain, creds = [], [], False, True
    it = iter(argv)
    for a in it:
        if a == "--plain":
            is_plain = True
        elif a == "--no-credentials":
            creds = False
        elif a == "--set":
            k, _, v = next(it).partition("=")
            sets.append((k, v))
        elif a in ("-h", "--help"):
            print(__doc__)
            return
        else:
            args.append(a)
    if len(args) != 2:
        sys.exit(__doc__)
    text = open(args[0]).read()
    if is_plain:
        text = plain(text)
    if not creds:
        text = no_credentials(text)
    for k, v in sets:
        text = fill(text, k, v, not is_plain)
    if sets:  # filled in: the CHANGE-ME notes (and the example values they name) no longer apply
        text = re.sub(r" +# CHANGE-ME.*$", "", text, flags=re.M)
    open(args[1], "w").write(text)


if __name__ == "__main__":
    main(sys.argv[1:])
