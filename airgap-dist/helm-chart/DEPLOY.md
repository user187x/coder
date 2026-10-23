# How to deploy Coder (air-gapped)

**From a GitHub release** (one folder: our images, `push-images.sh` and the one chart; the public images already in
your registry): `./push-images.sh $REGISTRY`, then [a single `helm install`](#a-single-helm-install) - its
`INSTALL.md` has the steps. The rest of this page installs from the bundle built from this repository
(`development/tools/build-bundle.sh`), which carries every image and the installers.

## The quick way: `./make --deploy`

```bash
tar -xzf coder-airgapped-<version>.tar.gz && cd coder-airgapped-<version>     # the bundle (development/tools/build-bundle.sh)
./make --deploy
```

It asks only what it cannot work out, and offers a default you accept with Enter:

1. **Minikube** (this machine, for development) or **EKS** (or any cluster `kubectl` points at)
2. **Your domain** – Coder becomes `https://coder.<domain>`, workspace apps `*.<domain>` (worked out for you)
3. **Certificates** – create new self-signed ones (a private CA you trust once), or point it at your own
   certificate, key and CA bundle (PEM or DER; an encrypted key is decrypted after asking for its passphrase).
   They are checked before anything is installed.
4. Minikube: whether to deploy a development Keycloak (default) · EKS: registry, image push, storage class, your
   Keycloak's issuer / client secret / CA, Helm or Argo CD

Then it does the rest: Gateway API CRDs, Traefik, CloudNativePG, Secrets, the chart, and on Minikube the
`local-path` storage and a Keycloak. At the end it prints the URL and the sign-in (`admin@admin.com` / `admin`).
Re-running it is safe; it remembers your answers.

**Minikube and sudo:** reaching the cluster from your machine needs root for up to three things – the
`minikube tunnel`, `/etc/hosts` entries, and trusting the CA. Right after you name the profile, the script lists the
ones still needed (it skips a running tunnel, names your DNS already resolves, and a CA you already trust) and asks
once. Say yes and sudo asks for your password then; the steps run at the end of the install with no further
questions. Say no and it prints the exact commands instead.

Progress shows in the terminal and in `.deploy/deploy.log` (from a second terminal: `tail -F .deploy/deploy.log`).

## Updating with the layer bundle

A cluster installed from a full bundle can take the next release as its **layer bundle**,
`coder-airgapped-<version>-layer.tar.gz`, which carries only the customization layer: this chart, the installers,
and the images changed since the previous release (the base, named in its `LAYER.json`). Images of ours come thin,
just the layers their previous version lacks; Traefik, CloudNativePG, the Gateway API CRDs, Keycloak and the public
images are not in it at all.

```bash
sha256sum -c coder-airgapped-<version>-layer.tar.gz.sha256
tar -xzf coder-airgapped-<version>-layer.tar.gz && cd coder-airgapped-<version>
./layer-support info                                   # what it carries, and what the cluster must have
./make --deploy                                        # asks for the folder you installed from
```

`./make --deploy` then:

1. takes your settings (certificates, answers, the client secret) from the previous install's `.deploy` folder: it
   asks for that folder once (`PREVIOUS=<folder>` with `--yes`);
2. checks, before changing anything, that the cluster has what the layer does not carry: Coder installed (Helm
   release `coder`), the Traefik and CloudNativePG charts at this release's versions (or your own Traefik /
   CloudNativePG, left as they are), the Gateway API CRDs, Minikube's Keycloak at this release's version, and every
   image not carried, on every Minikube node or in your registry (`docker login` it first). Anything missing is
   listed and the deploy stops: use the full bundle then;
3. makes each thin image whole again in this machine's docker from its base image (from the local docker, a
   Minikube node, or your registry), checking every layer by its digest, and loads or pushes only the images the
   layer carries;
4. installs the chart as usual; Traefik's and CloudNativePG's charts are left as they are (unless the layer carries
   a newer one).

A layer is made for clusters at its base release. Installed on another release, the same checks decide: it works
when everything it needs is there, and otherwise says what is missing.

`./make --deploy --yes` takes every remembered answer without asking. Helpers it uses, which also work on their own:
`./x509-support` (certificates), `./minikube-support` (e.g. `./minikube-support expose coder <domain>` after a
reboot), `./install.sh`, `./mirror-images.sh`.

### Your Harbor first: `./make --push-images`

```bash
./make --push-images harbor.example.com/coder      # <harbor host>[/<project>]
```

Takes every image the solution needs (from the bundle) and its Helm charts into your Harbor, helping along the way:

1. it reaches Harbor's API; a private CA: give the CA file, and it sets up helm (`--ca-file`) and docker
   (`/etc/docker/certs.d/<host>/ca.crt`, with sudo, asked first) to trust it;
2. it logs your **docker and helm** in to Harbor (a user, or a robot account with push rights, `robot$<name>`), and
   on request to **Docker Hub** too (the public images the bundle does not carry are pulled from there, and Docker
   Hub limits anonymous pulls). Passwords and tokens go to docker and helm on stdin, never on a command line, and the
   script never writes them anywhere;
3. it checks the project, and offers to create it (public: nothing in the cluster needs a pull secret; private: the
   cluster needs one, and the nodes credentials for the workspace pods);
4. it pushes the images (as `<harbor>/<project>/<path>`, what `global.registry: <harbor>/<project>` expects) and the
   charts (`coder-airgapped`, CloudNativePG's and Traefik's) to `oci://<harbor>/<project>/charts`;
5. it checks every image and chart is there, and remembers `<harbor>/<project>` as the registry for
   `./make --deploy` (EKS).

Non-interactive: `HARBOR_USER=robot\$coder HARBOR_PASSWORD=... DOCKERHUB_LOGIN=n ./make --push-images
harbor.example.com/coder --yes` (`PUSH_GROUPS=all` adds the reference Argo CD and Keycloak images, `PUSH_GROUPS=ours`
pushes only ours). Any other registry works too: without Harbor's API, the project steps are skipped.

## Argo CD: Coder decorated by the customization layer

The bundle also installs as **two charts in one Argo CD Application**, the customization layer decorating a plain
Coder that it can be taken off again:

| | Chart (`charts/`) | What it installs |
|---|---|---|
| 1 | `coder-airgapped-base-<version>.tgz` | The Coder installation: the upstream Coder chart running **upstream Coder** (at the fork's base, with a Terraform provider mirror), its CloudNativePG database and its first owner |
| 2 | `coder-airgapped-layer-<version>.tgz` | The customization layer: the platform service, the announcement banner, the DEFAULT template and its icons, the image builder, metrics-server, admins' kubectl |
| 3 | `argocd/coder-decorated-application.yaml` | The Application with both (`argocd/coder-plain-application.yaml`: the base alone) |
| 4 | `./make --argocd` | Pushes everything to Harbor and deploys it with Argo CD (below) |

The layer's one hook into the base is `global.decorator.layer: true` in the Application's shared `global` block:
with it, the base runs the fork's Coder image with the platform's settings; without it, upstream Coder. Both charts
are packaged from `coder-airgapped/` (`./mirror-images.sh decorator-charts`), so together they are exactly that chart.

```bash
./make --argocd harbor.example.com/coder-airgapped      # <harbor host>[/<project>]; kubectl's context: the cluster with Argo CD
```

1. **Harbor:** as `./make --push-images` (above): logins, project, every image and chart (both of these, the
   prerequisites') to `oci://<harbor>/<project>/charts`, all checked;
2. **the cluster:** the Gateway API CRDs (v1.6.0, from `prereqs/`), a Gateway `traefik/traefik-gateway` (Traefik
   from `prereqs/`) and the CloudNativePG operator, each installed only when missing, after asking;
3. **the domain, certificates, OIDC provider and storage class**, then the Secrets the charts read
   (`install.sh --prepare-only`), and a pull secret if the Harbor project is private;
4. **Argo CD:** the chart repository's credentials (a Secret in `argocd`; a robot account with pull rights is
   enough; the password goes to kubectl on stdin, never into a file), Harbor's CA if it has a private one
   (`argocd-tls-certs-cm`), and the Application filled in with your values, in `.deploy/argocd-<domain>/`;
5. it applies the Application (asked first; or tells you how to add it in Argo CD's UI), waits until it is Synced
   and Healthy, and seeds the image builder.

Without the script: push with `./make --push-images`, install the prerequisites and Secrets as steps 3–5 of "By
hand" below, fill in the CHANGE-MEs of `argocd/coder-decorated-application.yaml` and `kubectl apply -f` it.

**Taking the layer off:** `./make --argocd harbor.example.com/coder-airgapped --plain` (or `kubectl apply -f
.deploy/argocd-<domain>/coder-plain-application.yaml`). Argo CD prunes everything the layer added and restarts Coder
as upstream Coder; the database, users, templates, workspaces and their homes stay. Running workspaces keep running
on their image. Without the layer, Coder has no platform service, banner or template push; the fork's own dashboard
features go with its image. The layer's own data is kept too: the platform service's volume and log database
password, and the image builder's two volumes (built images, uploads) may never be pruned (`Prune=false`), so
`--plain` takes them out of the Application (Argo CD then reports it Synced) and they wait, as they are, for the
layer. **Putting it back:** `./make --argocd …` again (or apply the decorated file): Argo CD adopts those again,
data intact.

**Updating:** carry the next release's layer bundle (or full bundle), run `./make --argocd …` from it: it pushes the
new images and charts and moves the Application to the new version.

Notes: the nodes pull the images straight from Harbor, so a private project also needs the nodes' container runtime
to have credentials (the workspace pods have no pull secret of their own), and a private CA must be trusted by the
nodes. `ARGOCD_REPO=<host>/<project>/charts` tells Argo CD another address for the charts (e.g. Harbor through an
internal name). Non-interactive: `HARBOR_USER=... HARBOR_PASSWORD=... ARGOCD_USER=... ARGOCD_PASSWORD=...
DOMAIN=... CERTS=existing TLS_CRT=... TLS_KEY=... CA_BUNDLE=... OIDC_ISSUER=... OIDC_SECRET_FILE=... OIDC_CA=...
STORAGE_CLASS=... ./make --argocd harbor.example.com/coder-airgapped --yes`.

The steps below are the same install done by hand.

### Updating an Argo CD install: the decorator update

A cluster that runs an earlier release this way needs only the fork's Coder image and the two charts to move on, not
the whole bundle: each release also ships `coder-airgapped-<version>-decorator-update.tar.gz` (about 300 MB; built
by `development/tools/build-decorator-update.sh`). It carries `images/` (the fork's Coder image), `charts/`
(`coder-airgapped-base` and `coder-airgapped-layer`), `update-application.sh` and a README listing the images that
changed since the previous release. The third-party charts and images and the workspace image are those already in
your registry; so is everything else, unless the README lists it.

```bash
sha256sum -c coder-airgapped-<version>-decorator-update.tar.gz.sha256
tar -xzf coder-airgapped-<version>-decorator-update.tar.gz && cd coder-airgapped-<version>-decorator-update
./update-application.sh --app /path/to/your-application.yaml --dry-run     # what would change
./update-application.sh --app /path/to/your-application.yaml --push --apply
```

`--push` loads the image and pushes it to `<registry>/user187x/coder-platform:<tag>` (`global.registry` in your
file, or `--registry <harbor>/<project>`) and pushes both charts to your Application's chart repository (docker and
helm logged in as for the install; `HELM_PUSH_ARGS="--ca-file ca.crt"` for a private CA helm does not trust).
`--apply` points both sources at the new version (keeping your file as `<file>.<time>.bak`, comments and all),
applies it and asks Argo CD to refresh; Coder restarts on the new image with no gap. The ubuntu-dataflow template
(Apache NiFi and Airflow) runs on its own image, which the update does not carry: the helper turns that template off
(`coder-workspace.dataflowTemplate.enabled: false`) unless you give it the image (`--dataflow keep` when it is in
your registry, `--dataflow <image>` for another). Back: restore the `.bak` file and apply it. The full bundle carries
the same helper (`argocd/update-application.sh`).

---

## By hand

Takes about 30 minutes. Steps 1–2 happen before you go in, steps 3–8 on a machine **inside** the air-gapped network.
No internet is needed – every image is in the bundle.


## Before you start

The air-gapped cluster needs these already running:

- [ ] **Kubernetes** 1.27 or newer (EKS is fine) with **amd64 (x86_64) nodes** – the images are amd64 only
- [ ] **Gateway API CRDs** v1.6.0 – `kubectl apply --server-side -f prereqs/gateway-api-v1.6.0-standard-install.yaml`
- [ ] **Traefik v3** with a **Gateway** that serves HTTPS for `coder.<your-domain>` and `*.<your-domain>`
      (stock Traefik: nothing rewrites a response – see `prereqs/traefik-41.4.0.reference-values.yaml`)
- [ ] **Keycloak** (or another OIDC login) with a client called `coder`
      and redirect URL `https://coder.<your-domain>/api/v2/users/oidc/callback` – your users sign in with it
- [ ] **DNS** for `coder.<your-domain>` and `*.<your-domain>`
- [ ] **Argo CD**
- [ ] **A container registry** (ECR, Harbor, ...)

Have these files ready:

| File | What it is |
|---|---|
| `ca.crt` | The CA that signed your HTTPS certificate |
| `wildcard.crt` / `wildcard.key` | The certificate for `*.<your-domain>` |
| `keycloak-ca.crt` | The CA of your Keycloak server |
| `oidc-client-secret.txt` | The Keycloak client secret, on one line |

Tools needed: `docker`, `helm`, `kubectl` (and `aws` if you use ECR).

---

## Step 1 – Check the bundle

```bash
tar -xzf coder-airgapped-<version>.tar.gz
cd coder-airgapped-<version>
./mirror-images.sh list
```

Every image should say `bundled` – they are all inside `images/`, one folder per part of the solution (`ui/` for the
user interface, `workspaces/`, `cloud-drive/`, ...: see `images/README.md`), so no internet is needed. The packaged
charts are in `charts/`.

Using the smaller **`-slim`** bundle (only our images)? Then only ours say `bundled`:
either run `./mirror-images.sh save` here on a machine with internet, or – if your registry already has the public
images, under the same paths (`docker.io/library/python:3.13-alpine` as `$REGISTRY/library/python:3.13-alpine`, ...;
`./mirror-images.sh list $REGISTRY` shows each target) – go on and use `ours` in Step 3.

Downloaded the release **in parts** (`-charts.tar.gz` and the `-images-<part>.tar.gz` you need)? Unpack them all into
one directory: they make the same `coder-airgapped-<version>` folder (`-ASSETS.txt` says which part holds what).

## Step 2 – Carry it across

Copy the whole `coder-airgapped-<version>` folder into the air-gapped network.

---

## Step 3 – Push the images to your registry

```bash
cd coder-airgapped-<version>
REGISTRY=123456789012.dkr.ecr.us-east-1.amazonaws.com      # <-- your registry

docker login $REGISTRY                                     # ECR: aws ecr get-login-password | docker login -u AWS --password-stdin $REGISTRY
ECR=1 ./mirror-images.sh push $REGISTRY                    # drop ECR=1 if not using ECR
```

Public images already in your registry? Push only ours: `./mirror-images.sh push $REGISTRY ours`. One part only:
`./mirror-images.sh push $REGISTRY ui` (a folder's section of `images.txt`).
Harbor: `./make --push-images <harbor>/<project>` does this step and the next, logins included.

## Step 4 – Push the chart to your registry

```bash
helm registry login $REGISTRY                              # ECR: aws ecr get-login-password | helm registry login -u AWS --password-stdin $REGISTRY
ECR=1 ./mirror-images.sh chart $REGISTRY/charts            # drop ECR=1 if not using ECR
```

## Step 5 – Create the secrets (and the database operator)

```bash
CNPG_IMAGE=$REGISTRY/cloudnative-pg/cloudnative-pg:1.30.0 \
./install.sh --prepare-only --cnpg \
  --ca ca.crt \
  --tls-crt wildcard.crt --tls-key wildcard.key \
  --oidc-ca keycloak-ca.crt \
  --oidc-secret-file oidc-client-secret.txt
```

Leave out `--cnpg` if CloudNativePG is already installed on the cluster.

**Keycloak not ready yet?** Leave out `--oidc-ca` and `--oidc-secret-file`. Coder starts without them, and the admin
signs in with the password from Step 8. A Keycloak issuer that does not answer yet does not stop Coder either: its
sign-in button works as soon as Keycloak does. When Keycloak is set up, create the two secrets (run this step again
with both options) and restart Coder (`kubectl -n coder rollout restart deploy/coder`). Keep
`global.disablePasswordAuth: "false"` until a Keycloak sign-in has worked: with `"true"` nobody can sign in while
Keycloak is down.

## Step 6 – Fill in the Argo CD file

Open `argocd/coder-airgapped-application.yaml` and change every line marked **`CHANGE-ME`**:

| Setting | Example |
|---|---|
| Registry address (3 places) | `123456789012.dkr.ecr.us-east-1.amazonaws.com` |
| Registry password | ECR: output of `aws ecr get-login-password` |
| `domain` | `example.com` |
| `oidc.issuerUrl` | `https://keycloak.example.com/realms/master` |
| `storageClass` (5 places) | `gp3` |

Everything else can stay as it is. The admin account is `admin` / `admin@admin.com` with password **`admin`**
(`firstUser`); you change the password in Step 8.

## Step 7 – Deploy

```bash
kubectl apply -f argocd/coder-airgapped-application.yaml
```

Argo CD now installs everything. Watch it:

```bash
kubectl -n argocd get application coder      # wait for: Synced   Healthy
kubectl -n coder get pods                    # everything Running (takes 5–10 minutes)
```

## Step 8 – Sign in

Open **`https://coder.<your-domain>`** and sign in with email **`admin@admin.com`** and password **`admin`**.
You are the Coder admin (owner).

**Change the password now:** your avatar › **Account** › **Security**. (Later syncs never reset it.)

Everyone else clicks the **Keycloak logo** on the sign-in page and logs in with Keycloak; they get a normal account.
The admin can make others admins in **Controls › Settings › Users**. The banner starts empty – publish one in
**Admin Settings › Announcement**.

Then give the image builder its base image (Templates › Images builds on the workspace image, from its own
registry in the cluster; `./make --deploy` does this itself):

```bash
./mirror-images.sh seed-builder coder          # uses kubectl port-forward; a few minutes
```

Done.

## Optional – kubectl and k9s for admins

Coder's admins (role Owner) can run `kubectl` and `k9s` on this cluster from their workspace terminals, each **signed
in as themselves**. There is no shared account, and the workspace holds no long-lived credential. The cluster sees the
person, e.g. `keycloak:alice` in group `keycloak:coder-cluster-admins` (an API server audit log, where one is turned
on, records that name). The group gets `cluster-admin`.

In the workspace, the first `kubectl` command prints a Keycloak link and code. The admin opens the link in their own
browser and signs in, as they do for Coder. The first time, they confirm the grant. Then kubectl continues. The sign-in lasts as long
as that Keycloak session (Minikube's development Keycloak: 30 minutes idle, 8 hours at most). It is forgotten when the
workspace restarts. k9s cannot show the link, so run a `kubectl` command (e.g. `kubectl auth whoami`) first.

Only Keycloak accounts can sign in. The built-in `admin@admin.com` has none: sign in to Coder with your own Keycloak
account and make it an Owner. The platform service keeps the Keycloak group equal to Coder's Owners who sign in with
Keycloak, checked every minute; anyone else added to the group in Keycloak is removed.

**Minikube:** `./make --deploy` sets it all up with its development Keycloak (the question *Let Coder's admins use
kubectl…*, default yes). The API server restarts once.

**EKS or another cluster:** three pieces, then `global.clusterAccess.enabled: true` in your values:

1. **Keycloak** (the realm of `global.oidc.issuerUrl`), as an admin with `kcadm.sh`:

   ```bash
   kcadm.sh create clients -r <realm> -f - <<'EOF'
   {"clientId": "kubernetes", "name": "Kubernetes (kubectl sign-in)", "publicClient": true, "consentRequired": true,
    "standardFlowEnabled": false, "directAccessGrantsEnabled": false,
    "attributes": {"oauth2.device.authorization.grant.enabled": "true", "access.token.lifespan": "600"},
    "protocolMappers": [{"name": "groups", "protocol": "openid-connect",
      "protocolMapper": "oidc-group-membership-mapper",
      "config": {"claim.name": "groups", "full.path": "false", "id.token.claim": "true", "access.token.claim": "true"}}]}
   EOF
   kcadm.sh create groups -r <realm> -s name=coder-cluster-admins
   ```

   If Coder's client signs in with certificates (its own browser flow), give this client the same flow:
   **Clients › kubernetes › Advanced › Authentication flow overrides › Browser flow**.
2. **The API server trusts Keycloak** for audience `kubernetes`: username claim `preferred_username`, groups claim
   `groups`, both with the prefix `keycloak:`. On EKS:

   ```bash
   aws eks associate-identity-provider-config --cluster-name <cluster> --oidc \
     identityProviderConfigName=keycloak,issuerUrl=<issuer URL>,clientId=kubernetes,usernameClaim=preferred_username,usernamePrefix=keycloak:,groupsClaim=groups,groupsPrefix=keycloak:
   ```

   EKS fetches the issuer's keys itself, so the issuer URL must be reachable from the EKS control plane, with a
   certificate it trusts. A Keycloak that only the private network can reach cannot be used this way. On a cluster
   you run yourself, use the API server's `--authentication-config` (see `minikube-support`, `signin_conf`).
3. **The workspace image has kubelogin** (`kubectl oidc-login`): `coder-workspace:1.7.0` and later.

The chart then adds the ClusterRoleBinding `coder-cluster-admins` and passes the issuer to the template. Admins'
workspaces get the kubeconfig at their next start. Settings: `global.clusterAccess` in `values.yaml` (client, group,
prefix, cluster role, which Coder roles count as admins, the group sync).

## Optional – the image builder (Templates › Images)

**Templates › Images** builds workspace images in the cluster for templates to run. Admins and template admins create
them; everyone can see them. Each image is a base image plus:

* apt packages, each checked in the apt sources as you type;
* uploaded `.deb` files;
* named installations, each with its own files and a bash script;
* removed packages and hardening;
* a desktop (XFCE, GNOME or none);
* shell configuration and dotfiles.

Each build is scanned: trivy for vulnerabilities and secrets, plus checks on users, sudo, setuid files and FIPS
readiness. A template uses the image as `localhost:5000/coder-images/<name>:<version>`. Images can be downloaded
(`docker load`) and backed up to S3.

It is on by default (`imageBuilder.enabled`). It adds:

* **`coder-image-registry`:** a registry for the built images, on a 50 Gi volume (`imageBuilder.registry.size`).
  The space of deleted images comes back the next time it starts (it garbage-collects first):
  `kubectl -n coder rollout restart deploy/coder-image-registry`.
* **A small DaemonSet, `coder-image-registry-proxy`**, on the host network of every node. It listens on
  `127.0.0.1:5000`, so each node's container runtime pulls the images from `localhost:5000`; runtimes treat localhost
  as a trusted registry without TLS. No node configuration is needed.
* **Build Jobs with BuildKit rootless** (`moby/buildkit:v0.33.0-rootless`). They run as uid 1000 with no privileges,
  but with **seccomp and AppArmor unconfined**: rootless BuildKit needs user namespaces. A cluster whose policy forbids
  unconfined pods (Pod Security `restricted`, or Kyverno/Gatekeeper rules) needs an exception for the `coder`
  namespace's `coder-image-*` pods. Each Job takes up to 4 CPUs and 8 Gi (`imageBuilder.build`).
* **Two volumes:** a 20 Gi one for uploads and build contexts (`imageBuilder.files`), and the platform service's
  limit raised to 512 Mi.

**In an air gap, set `imageBuilder.aptSources` to your apt mirror** (deb822, as in `values.yaml`), or set it later in
Images › Settings. The package check and the builds both use it. The vulnerability database is in the bundle (in
`coder-image-tools`, dated when the bundle was made); Java archives are not scanned, because their database is not
bundled. Set S3 backups (bucket, region, keys, or an S3-compatible endpoint such as MinIO) in Images › Settings.

**Importing instead of building.** **Import** brings in a container image as it is: copied from a registry the
cluster reaches (its reference, and a user and password if that registry asks; they go to `regctl` in a file of its
own, never on a command line), or uploaded as a `docker save` or OCI archive (`.tar` / `.tar.gz`, up to 20 GB,
`BUILDER_IMPORT_MAX_GIB`; the builder volume needs room for it). It is stored and scanned like a built image, and a
new version is imported the same way. **In use** lists the images workspaces run now and the templates' own, each
opened or imported from there.

**Running a workspace on an image.** The chart's templates offer the images here in their **Workspace image**
parameter (`coder-workspace.imagesRegistry`, `localhost:5000/coder-images` by default; `""` takes it away), a dropdown:
**The template's image** (the default; it follows the template, so a template update brings its new image), every
version built or imported here that the registry keeps (the platform service lists them in the ConfigMap
`coder-workspace-images`, which the templates read), and **Another image…**, which asks for any image the cluster can
pull, with an example and a plain-language check. A new workspace on one (the image's page has a button per template),
or an existing one switched to one in its settings, from its next start. A workspace whose image is gone (deleted
here) is offered the list again at its next update instead of an error; one created before the dropdown, whose value
is an earlier tag of the template's own image, runs the template's current image. An image built on the workspace
image has everything the templates run.

**Pictures:** the pictures offered as backgrounds (Appearance > Background image) and in the logo and avatar
editors are part of the Coder image (`site/static/pictures/`), whatever the install (`./make`, Argo CD, plain Helm); a
background chosen from them is stored as its path and drawn from Coder. `helm-chart/defaults/gallery/` adds more for
`install.sh` installs only.

**The ISO library** (with the Cloud Drive's storage, `global.userStorage`): disk images for every workspace, read-only at
`~/isos` in each. Admins and template admins upload ISOs (or `.img`) or have the platform service fetch one from an
address the cluster reaches; up to 20 GB each (`SAFE_ISO_MAX_GIB`). Personal ones go in each user's Cloud Drive.

Builds start from the workspace image in the builder's own registry in the cluster, so BuildKit needs no access
to your registry. `./make --deploy` puts it there (on any cluster); after an Argo CD or plain Helm install, run
`./mirror-images.sh seed-builder coder` once (Step 8). Until then, builds use the workspace image in your registry
(`global.registry`, with its pull secret if any).

## Keeping the security data current (air gap)

The image builder grades every image with trivy's vulnerability database and Java database, and with the FIPS rules.
In an air gap these age: trivy publishes a new vulnerability database every few hours, but the bundle carries the one
from the day it was made. Templates › Images shows their dates (the "Security data" badge, and Images › Settings). It
marks them ageing after 14 days and out of date after 30, and every report says which data graded it.

To update them:

1. On a machine with internet access and Docker, in this repository:
   `development/tools/build-security-data.sh`. It writes `dist/coder-security-data-<date>.tar.gz` (about 1.1 GB;
   `--no-java` leaves out the Java database: about 100 MB, but .jar / .war / .ear are then not scanned) and its
   `.sha256`. It uses the bundle's own trivy (`coder-image-tools`), so the database schema matches.
2. Carry the file across the air gap and check it: `sha256sum -c coder-security-data-<date>.tar.gz.sha256`.
3. In Coder, as an admin: Templates › Images › Settings › Security data › **Load security data…**. The service
   checks every file against the file's manifest and the database's schema before switching to it. The previous set
   is kept, and **Use the bundled data** goes back to the bundle's own.
4. **Rescan all built images**: each built image is scanned again with the new data, one after another. Nothing is
   rebuilt and versions stay; each image gets a new report.

The FIPS rules are `helm-chart/coder-airgapped/files/ui-updates/fips-rules.json`: versioned and dated, with the
standards they follow. Edit it (or pass `--fips-rules FILE`) when the rules change, and make a new file. FIPS-aligned
crypto in new builds uses the rules in force too. A scan needs up to 8 Gi of scratch space with the Java database.

## metrics-server (live CPU and memory)

The HUD, Health and quotas show live usage from the Kubernetes metrics API. The chart installs metrics-server
(`registry.k8s.io/metrics-server/metrics-server:v0.8.1`, in the bundle) only where the cluster has none
(`metricsServer.enabled: auto`). On EKS with the metrics-server add-on, nothing is installed. Set `false` to never
install it, `true` to always. Kubelets with self-signed serving certificates (Minikube, kind) need
`metricsServer.kubeletInsecureTLS: true`; `./make --deploy` sets it on Minikube. Keep it false on EKS.

## Workspace backups and disk growth

A workspace's ⋮ menu has **Back up home** and **Expand disk**, for its owner and admins. Both use the image builder's
volume (`imageBuilder.enabled`) and the platform service's permission to manage PVCs in the workspace namespace.

* **Backups** go to the S3 bucket set in Templates › Images › Settings, or become a download kept 24 hours on the
  builder volume (`imageBuilder.files.size` bounds how large).
* **Expand disk** grows the volume in place where the storage class has `allowVolumeExpansion: true` (EBS gp2 / gp3
  on EKS). Elsewhere it stops the workspace and copies its home onto a bigger volume.

> **Good to know – workspaces in a strict air gap:** everything a workspace runs is in the workspace image: the
> desktop, Firefox, code-server, File Browser (FileBrowser Quantum, from `coder-workspace:1.8.7`: the provided
> `filebrowser-quantum` release binary, under the app's path, no sign-in of its own, no update check), tmux,
> k9s/kubectl and the JetBrains Mono Nerd Font. Nothing is downloaded when a workspace starts (`coder-workspace:1.8.0`
> and later).

## The Cloud Drive (each account's own storage)

Every account has a **Cloud Drive**: its own files on S3, the same ones everywhere. On the Workspaces page it is one
button above the table (as tall as **+ Workspace**), flush with its right edge, with a cable from its socket to a plug
in each connected workspace row; it opens a window in the middle of the screen (folders, upload with progress or by
dropping files, download, delete) with its **Workspaces** (which are connected, a switch each), its **Encryption**, its
**Source** and its **Settings**: where the files are kept and whether that storage answers (checked every half minute;
the cables turn red and dashed when it does not). Every
connected workspace of the account has it at `~/cloud-drive`; the workspace page shows a cloud right of the latency,
with how full the drive is and its first files on hover. On by default (`global.userStorage.enabled`). Its API,
claims and volumes keep the earlier name, `safe` (`/api/safe`, `coder-safe-<user id>`).

* **Connecting and disconnecting a workspace:** every workspace is connected, a new one too. Its owner drags a plug
  away from a row to disconnect that workspace (the cable hangs, then reels into the Cloud Drive) and drags a cable
  out of the socket onto a row to connect it again - or uses the switches in the Cloud Drive's **Workspaces**. A
  running workspace follows within a second, no restart: the template mounts the volume at `/mnt/cloud-drive`, and
  a watcher in the workspace (the template's Cloud Drive script) links `~/cloud-drive` to it while the pod's
  annotation `platform.coder/cloud-drive` says `on`, which it reads through the downward API
  (`/etc/platform/cloud-drive`). The platform service keeps the disconnected workspaces in its volume
  (`/data/cloud-drive-links.json`) and every running workspace pod's annotation so (a restarted one gets its
  disconnection back within 5 seconds). A workspace on a template version from before this takes the change once it
  is updated. It is a convenience, not a wall: the volume stays mounted in the pod.
* **Only its owner:** the API serves the caller's own drive only, and a workspace shared with other users or groups
  (Coder's workspace sharing) never has its owner's: its link is cut at once, it cannot be connected while shared, and
  from its next start it mounts no Cloud Drive (the platform service lists shared workspaces in the ConfigMap
  `coder-cloud-drive`, which the template reads when a workspace starts; Coder's service account may read that one
  ConfigMap). One shared while it ran keeps the volume it started with until it restarts: the Cloud Drive's
  **Workspaces** says so.
* **Encryption (each owner's choice):** in **Encryption** the owner wraps a key of their own with a **Password** (12
  characters or more, never stored), a certificate pasted as **PEM** (an RSA certificate, PEM or DER - its public
  part), or one read out of their **PFX**: a note first says what happens to its password, then the PKCS#12 file kept
  in Account > Certificates (Coder gives it back to its owner only, still encrypted - never to an admin) or a .pfx /
  .p12 they choose is opened in the browser with its password (AES, 3DES or the legacy RC2 of older exports), and its
  public certificate goes into the form. The password stays in that page's memory only - never sent to the server,
  stored or logged - and is cleared once the certificate is out. The recovery kit downloads first - where the files are (endpoint,
  bucket, prefix), how many and how much, the scheme, the key wrapped for `openssl enc` (password) or `openssl
  pkeyutl` (certificate), and the steps to get every file back with the AWS CLI or GeeseFS - and encryption turns on
  only once the owner says it is kept and none of their workspaces has the drive (stop them first). Every object is
  then re-encrypted in place with S3's customer-key encryption (SSE-C, AES-256: the storage keeps no copy of the key),
  in the background; a run that stops is taken up again where it was. The key is kept for the mounts in Secret
  `coder-cloud-drive-keys` (admins can reach it); the connected workspaces read and write as before and show a lock
  on their icon. Turning it off needs the password (or the data key from the kit). SSE-C needs TLS: the chart's MinIO
  serves TLS on 9443 (its certificate made once, Secret `coder-user-storage-minio-tls`; Argo CD: ignoreDifferences on
  its `/data`), and its old port 9000 is a plain bridge to it in the same pod for unencrypted mounts and the
  libraries. The nodes' encrypted mounts reach MinIO by its ClusterIP, which no certificate can name, so they do not
  check its certificate (GeeseFS takes no CA); the platform service checks it. An S3 service of your own needs an
  https endpoint for it.
* **Sharing between users (admins turn it on: Cloud Drive > Sharing):** one user asks another for their Cloud Drive
  in chat (a conversation's menu: **Ask for their Cloud Drive**, read only or read and write); the request is a card
  in their conversation, where its owner shares it **read only**, **read and write** (when asked for) or declines.
  While **Admins approve each share** is on (the default), an admin approves it in Sharing before it is mounted. An
  active share mounts the owner's volume in the requester's workspaces (read only unless shared read and write) at
  `~/cloud-drive-shared/<owner>`, from their next start (the ConfigMap `coder-cloud-drive`'s `peers`; the Cloud
  Drive's **Workspaces** says which running ones a restart brings it to); none in a workspace shared with others. The
  share also opens at once in the requester's Cloud Drive window (its drive switcher: Mine, or each drive shared with
  them; the file routes take `?drive=<owner id>`, read with any active share, written only with a read and write one -
  the service checks, the window hides Upload, New folder and Delete). The Accounts table draws every active share
  (admins; others their own) as a Cloud Drive cable from the owner's row (a socket) to the requester's (a plug; green
  prongs read and write, blue read only). The owner, the requester or an admin ends a share at any time (from the
  requester's next restart; at once in the window). Turned off, no request can be made and no share is mounted (they
  are kept for when it is back on). Kept in the platform service's volume (`/data/cloud-drive-peers.json`).
* **A workspace folder as the Cloud Drive (Source):** the owner picks one of their workspaces and a folder of its home
  (not the home itself, not a hidden folder). The platform service starts a small S3 server in that workspace
  (`drivesource.py`, through the exec API, as the workspace's user; every request signed with a key of its own),
  and their other workspaces mount it (volume `coder-drive-src-<user id>`, through Service `coder-drive-src-<user
  id>`) from their next start while it runs - one that starts while it is stopped has no Cloud Drive until its next
  start. The source workspace links `~/cloud-drive` to the folder itself. The files on the S3 storage stay, unused,
  until the owner goes back to it (**Back to the S3 storage**). Deleting the source workspace is guarded: the delete
  dialog lists the workspaces connected to it, each needs **Confirm: OK to disconnect**, and `delete` must be typed
  and Enter pressed; it is never deleted in a batch. Deleted past the dashboard (CLI, API), the drive goes back to
  S3 within half a minute. Encryption is for the S3 storage: off while a folder is the source.

* **Where the files are:** one bucket (`userStorage.bucket`), a prefix `users/<user id>/` per account. By default on
  the chart's MinIO (one instance, a `userStorage.minio.size` volume; its keys in Secret `coder-user-storage-s3`,
  generated). For high availability or more room, use your own S3 instead: `userStorage.minio.enabled: false`,
  `userStorage.s3.endpoint`, `.region`, and `.existingSecret` (a Secret with `accessKeyID` and `secretAccessKey`).
* **Another S3 service without a deploy:** admins set one in the Cloud Drive's **Settings** (endpoint, region, bucket,
  keys; **Test connection** first). It is saved only once it answers, the bucket is made if missing, and it is kept in
  the platform service's volume (`/data/cloud-drive.json`, mode 0600; the secret key is never shown again). **Use the
  chart's storage again** goes back to the values above. Files are not copied: what is in the old storage stays there.
  Each account's volume moves to the new storage when none of its workspaces runs (a running one keeps the old one
  until it stops). The nodes mount it from the endpoint as written, outside the cluster's DNS.
* **How workspaces get it:** the CSI driver `ru.yandex.s3.csi` (k8s-csi-s3 with GeeseFS; `userStorage.csi`) runs on
  every node as a **privileged DaemonSet**: it needs `/dev/fuse` and systemd on the nodes (EKS's Amazon Linux nodes
  have both). If your cluster already runs that driver, set `userStorage.csi.enabled: false`. Clusters that enforce
  Pod Security "baseline" or "restricted" on the namespace must allow it.
* **Each account's volume:** the platform service makes a PersistentVolume and claim `coder-safe-<user id>` for every
  account within a minute of its creation (Retain: removing them never removes files). A workspace started before
  that waits for it.
* **Mount options** (`userStorage.csi.mountOptions`) are written into each account's volume when it is made. When they
  change (or the account's encryption, or the storage), the platform service makes the volume again once none of the
  account's workspaces has it; the files stay.
* **Limits:** `userStorage.quotaGiB` (10) per account for uploads on the page, `userStorage.maxUploadGiB` (5) a file.
  Admins change every account's capacity in the Cloud Drive's **Settings** (a slider, or a number of 1 to 10240 GiB;
  kept in the platform service's volume, `/data/cloud-drive-quota.json`); **Use the chart's** goes back to
  `quotaGiB`. Lowering it below what an account holds stops its uploads only.
* **Mounted into a folder** (the window's **Mount**, or `cloud-drive mount PATH` in a workspace's terminal): the
  Cloud Drive in any folder of a running workspace (absolute, or relative to the home; one with files of its own, or
  a new one), its entries linked in beside the folder's own, folders of the same name merged. A file of the same name
  there halts it until the owner chooses: **Keep both** (the Cloud Drive's is linked as `data-(cloud_drive).csv`) or
  **Overwrite** - then **Overwrite all**, or **Prompt for each occurrence** (yes / no each; `[Y/n]` in the terminal).
  An overwritten file moves to `~/.local/share/cloud-drive/overwritten/` and comes back when the folder is unmounted.
  The workspace keeps its mounts up to date as the Cloud Drive changes (a new collision then: as the mount was made,
  "prompt" keeping both). `cloud-drive unmount PATH`, `cloud-drive list`.
* **Transfers:** uploads and downloads in the window show a moving bar, how much has gone, how fast and how long is
  left. A download is written to disk as it comes where the browser can (Chromium's save dialog); elsewhere it is held
  in memory, and a file over 1 GiB goes to the browser's own download.
  Files written inside a workspace are not stopped at the quota (S3 has none per prefix); the page shows what is used.
* **Images:** `ghcr.io/user187x/coder-minio` (Chainguard's MinIO build; the MinIO project publishes no images since
  2025: `development/tools/build-minio-image.sh`) and the driver's two images, all in `images.txt` and the bundle.

## Disaster recovery for Coder's database (General > Persistence)

Besides CloudNativePG's backups (in the cluster), the Persistence view's **Disaster recovery** card copies Coder's
database out of it:

* **Download a dump** - `pg_dump` (custom format) streamed to the admin's browser. Restore it with
  `pg_restore --clean --if-exists --no-owner -d <database> coder-db-<time>.dump`.
* **An S3 bucket** - a dump every N hours (or **Run now**) to `<prefix>coder-db-<UTC time>.dump`, the newest N kept;
  a private CA can be given. The dump streams through the platform service one part at a time, never whole.
* **An external PostgreSQL** - Coder's database copied into it every N hours (`pg_dump | pg_restore --clean`): it
  holds what Coder's held then, and is never written back. The copy runs in the database's primary pod, so that pod
  must reach the external database (an egress rule where NetworkPolicies limit it); its address is passed on stdin,
  never in a command line.

The dumps run in the CloudNativePG primary (it has `pg_dump`, `pg_restore` and `psql`; the platform service has none)
through the exec API. Targets and their keys are kept in the platform service's volume (`/data/dr.json`, 0600), with
the last 50 runs. A database outside the cluster (no CloudNativePG primary) is left to its provider's backups.

## Templates: the base template and the decorator

The DEFAULT template (`charts/coder-workspace/files/main.tf`, one file: the certificate's install, Lock Down's start
mode in `lockdown.sh`) is the platform's base template, the prototype of every new one. Its platform parts are marked
sections - `# platform:begin certificates`, `lockdown`, `cloud-drive`, `metrics`, `code-server-ha` ... `# platform:end` -
and Coder's **template decorator** (the fork's `coderd/templatedecorator`) injects each into every template that lacks
it when a provisioner takes its job (an import, a dry run, a workspace build): at the same place (top level, the
agent, the pod, the agent's container), with what the sections use and the template does not declare, and their
scripts as `.platform/<file>`. A template's own declarations win (it is skipped where they clash); one with
`# platform:no-decorator` in its files is left as it is.

* **Create new template** starts every template from the base without a choice shown; its step is the workspace's
  apps - **Desktop**, **File Browser** and **Terminal**, each included or excluded (the template's `desktop`,
  `file_browser` and `terminal` variables). The new template's code is the base's own logic only: its platform
  sections come in when it is built.
* **Source Code** shows a template's own code (**Code**) and, beside it, **Materialized**: its main.tf exactly as it
  is provisioned, the injected sections in. The editor has a Materialized tab too (its files as they are now).
  **Global files**, under Upload, are the files every template gets (`.platform/`): hovered, each says it is provided
  and how a template reads it; clicked, its code, read-only.

## code-server high availability

A template can make its workspaces' code-server a **global singleton** (its `code_server_ha` variable, off by
default; `codeServerHA` in the values): code-server no longer runs inside the workspace but as one instance per
workspace across every cluster that shares Coder's database, kept by the **code-server-replicator** (one per cluster,
two replicas: one works, one waits). The instance runs on the workspace's node with its home volume; when it fails a
new one replaces it (a new generation), and when the workspace's own cluster stops answering, another connected,
healthy cluster (`codeServerHA.endpointExternal` set: how its instances are reached) takes it over after its lease
lapses, with the user's code-server state (settings, keybindings, snippets, extensions list) from the database; once
the workspace's own cluster has answered again for a minute, the workspace goes back to it (and its home volume). Older
generations are fenced off: deleted, and refused by the relays. A **relay** in the workspace's pod answers where
code-server would (its app is unchanged) and takes each connection to the active instance, in this cluster or another;
a relay beside each instance takes only its instance's connections and passes those of an older one on.

Every bit of its state is in Coder's database (schema `code_server_ha`): the operators write it as the database's
owner, the relays log in as the role `code_server_relay` (CloudNativePG makes it from the Secret
`coder-code-server-ha-relay`), which may only call the schema's functions - a workspace's relay proves itself with its
agent's token (Coder's own registry of agents), an instance's relay with its instance's token.
`development/tools/verify/csha_db_test.py` checks it all against a real PostgreSQL (two clusters, a failover).

## High availability

**Platform HA** ([ADR-0001](../docs/adr/0001-platform-ha.md), accepted) is the platform's own high availability for
Coder's control plane, without the Enterprise license. It ships in phases:

- the infrastructure (synchronous replication, the pooler, the PodDisruptionBudgets);
- the replica registry (`global.platformHA.mode: registry`): each Coder replica's lease in PostgreSQL (schema
  `platform_ha`), fenced when it cannot renew (`coderd_platform_ha_*` metrics);
- **active/standby** (`global.platformHA.mode: activeStandby`), which `values-ha.example.yaml` turns on;
- active/active replicas with a mesh coordinator and DERP cells, in a later phase.

In active/standby, one Coder replica serves and the others wait warm:

- **Who serves.** The replica holding the lease `coder-active` runs Coder. Its pod is labeled
  `coder-airgapped/ha-role=active`, and the coder Service selects only that label.
- **What a standby does.** It joins the registry, answers its probes on port 2113 and watches the lease. It does not
  start Coder until its turn, so an unlicensed deployment never runs two Coder replicas (Coder's Enterprise code
  would report that as an error).
- **When the active one fails.** A standby takes the lease once it lapses: back through Traefik after about 12 s.
- **During a rolling update.** The leaving pod's preStop hands the lease over: its successor starts Coder and takes
  traffic before the leader lets go. Users see about 2 s without Coder, because the old pod leaves the endpoints the
  moment it is deleted.

`values-ha.example.yaml` goes on top of your values:

```bash
./install.sh -f my-values.yaml -f values-ha.example.yaml ...    # Argo CD: the same keys in the valuesObject
```

| | Default | `values-ha.example.yaml` |
|---|---|---|
| Coder | 1 replica, 2 vCPU and 4 GiB | 2 replicas in active/standby (`global.platformHA.mode: activeStandby`), 2 vCPU and 8 GiB each (Coder's reference for up to 1,000 users), one per node, spread over the zones; a PodDisruptionBudget lets node drains take only one down at a time (its preStop hands over) |
| Database (CloudNativePG) | 2 instances | 3 instances, one per zone. The operator promotes a replica when the primary fails, and Coder follows, because it connects through the `-rw` Service. The operator makes the database's own PodDisruptionBudgets. **Synchronous replication** (`database.synchronous`): a commit waits for one standby, so a failover loses no committed transaction |
| Database pooler | none | PgBouncer (`database.pooler`, a CloudNativePG Pooler, 2 pods, transaction mode) for code-server HA's relays, whose connections then stop counting against PostgreSQL's `max_connections`; Coder and the replicator keep connecting to `-rw`. Its image, `ghcr.io/cloudnative-pg/pgbouncer:1.25.1`, must be in your registry |
| metrics-server | 1 replica | 2 replicas on separate nodes, with a PodDisruptionBudget |
| code-server-replicator | 2 replicas (one works) | the same; a PodDisruptionBudget and zone spread are always on |

**What it needs:**

- [ ] **Nodes for Coder in 2 or more zones of one region**, in a static node group (one the autoscaler never scales
      down), with room for a 3rd replica during a rollout. Under 10 ms between them and to the database. Never
      across regions.
- [ ] **The kubelet reaches each Coder pod's health port, TCP 2113** (the probes and the preStop handover). With
      NetworkPolicies in `coder`, allow it.
- [ ] **Coder may read and label its own pods.** The chart adds the Role `coder-platform-ha` (pods: get, patch) for
      Coder's service account.
- [ ] **Traefik with 2 or more replicas**, so the Gateway isn't a single pod: pass
      `prereqs/traefik-41.4.0.ha-values.yaml` after the reference values (2 replicas on separate nodes, spread over the
      zones, a PodDisruptionBudget), behind a load balancer in all three zones.

**Switching on.** Switching a running install to active/standby costs one Coder start of downtime: the Service moves
to the `active` label before any pod carries it.

**Upgrades.** A rolling update replaces one replica at a time: the standbys first, then the active one, which hands
over to a new replica in its preStop. Connections through Coder drop for a moment and reconnect. A new Coder version
(`global.coderImages.upstream` changes, so the fork's upstream base changes) can bring database migrations, and old
replicas can hold the locks those migrations need. Before such an upgrade, scale Coder to one replica, then upgrade:

- **Plain Helm:** run `kubectl -n coder scale deploy/coder --replicas=1`, then `./install.sh ...` (Helm restores the
  2 replicas on the new version).
- **Argo CD:** set `coder.coder.replicaCount: 1` and sync, update, then set it back to 2. A `kubectl scale` would be
  undone by Argo CD's self-heal.

The fork adds no migrations of its own, so a new fork build on the same upstream base upgrades with a plain rolling
update. If a migration still waits on a lock, follow Coder's
[upgrade best practices](https://coder.com/docs/install/operate/upgrade/best-practices). On an existing install,
going from 2 database instances to 3 adds a replica online. A new `database.affinity` restarts the instances one
at a time, the primary last. Coder's database requests pause while the primary moves, and then Coder reconnects.

**What stays a single copy:**

- **The platform service** (`coder-ui-updates`: Health, Chat, Images, Monitoring and the other platform views). Its
  data is a SQLite file on a ReadWriteOnce volume. While it restarts, Coder keeps working: quota and schedule checks
  let requests through, and the dashboard starts with its defaults. On EKS its EBS volume is in one zone, so it
  stays down if that zone is lost.
- **The image builder's registry** (`coder-image-registry`, ReadWriteOnce). While it is down, nodes cannot pull
  images built in Templates › Images that they don't already have.
- **Workspaces.** Each is one pod (or VM) with its volume in one zone. Platform HA keeps the dashboard and
  connections up, but it does not protect a workspace whose node or zone is lost.

**Sizing and monitoring** (Coder's [scale guide](https://coder.com/docs/tutorials/best-practices/scale-coder)):

- Grow replicas vertically before adding more. Keep Coder under about 10 replicas, and don't autoscale it.
- Each replica runs 3 provisioners, so 3 replicas build 9 workspaces at a time. More builds at once need external
  provisioner daemons (with `CODER_PROVISIONER_DAEMONS=0` on Coder), which this chart doesn't have yet.
- With STUN off (the air-gap values), every CLI and IDE connection to a workspace is relayed through a Coder replica.
  Size the replicas for that traffic.
- Each replica opens up to 10 database connections (`CODER_PG_CONN_MAX_OPEN`). PostgreSQL's `max_connections`
  (100) must cover all replicas' connections plus about 20%.
- To expose metrics, add `CODER_PROMETHEUS_ENABLE=true`, `CODER_PROMETHEUS_COLLECT_DB_METRICS=true` and
  `CODER_PROMETHEUS_AGGREGATE_AGENT_STATS_BY=agent_name` to `coder.coder.extraEnv`. That is a list, so repeat your
  values' entries in it. Then scrape port 2112 of each Coder pod and alert on the tail latency of
  `coderd_api_request_latencies_seconds` and `coderd_db_query_latencies_seconds`.

---

## If something goes wrong

| Problem | Check |
|---|---|
| Pods stuck in `ImagePullBackOff` | Step 3 – are the images in your registry? Is `registry` in the Argo CD file right? |
| Argo CD says it can't find the chart | Step 4, and the registry address/password at the top of the Argo CD file (ECR passwords expire after 12 hours) |
| `coder` pod stuck in `ContainerCreating` | Step 5 – the secrets are missing: `kubectl -n coder get secrets` |
| Database not starting | `kubectl -n coder get cluster` – is CloudNativePG installed? Is the storage class right? |
| Login page doesn't load | DNS and the Gateway's HTTPS certificate for `coder.<your-domain>` |
| `admin` / `admin` is refused | The admin's password was changed, or the database was not fresh: `kubectl -n coder logs job/coder-bootstrap-first-user` |
| No workspace template in Coder | `kubectl -n coder logs job/coder-bootstrap-first-user` and `job/coder-workspace-push-template` |
| "You have multiple replicas but …" in Coder | More than one replica runs Coder: Coder's own high availability needs a license with `high_availability`. Without one, use Platform HA's `global.platformHA.mode: activeStandby` (one replica runs Coder; `values-ha.example.yaml`), or set `coder.coder.replicaCount: 1` |
| An upgrade hangs with a `coder` pod Pending | High availability: Coder's nodes have no room for the rollout's extra replica (`kubectl -n coder describe pod`) |
| A new workspace waits in `ContainerCreating` | The Cloud Drive: `kubectl -n coder get pvc coder-safe-<user id>` (made by the platform service), `kubectl -n coder get pods -l app.kubernetes.io/name=coder-user-storage-csi` (FUSE and systemd on the node) |
| Deleting the namespace hangs: workspace pods stay `Terminating`, PVCs too | The Cloud Drive's CSI driver went first (the namespace was deleted without `helm uninstall`, whose hook stops those workspaces before the driver goes): `kubectl -n coder delete pod <pod> --grace-period=0 --force`, then on its node `umount -l` the pod's leftover `fuse` mounts. Next time: `helm uninstall coder -n coder --wait` first (Argo CD: delete the Application, whose PreDelete hook does the same), then the namespace |
| The Cloud Drive says its storage cannot be reached (a red dot) | `kubectl -n coder get pods -l app.kubernetes.io/name=coder-user-storage-minio`, or your S3's endpoint and keys (`userStorage.s3`, or the one in its Settings) |

---

## Without Argo CD (plain Helm)

Do steps 1–3 and 5 as above (step 5 **without** `--prepare-only`), but first:

```bash
cp values-eks-airgap.example.yaml my-values.yaml    # change every CHANGE-ME
```

and add `-f my-values.yaml` to the step 5 command. That installs everything directly; skip steps 4, 6 and 7.

### A single `helm install`

The chart alone – the release asset `coder-airgapped-<version>.tgz`, also `charts/` in the bundle – installs the
whole platform in one release: Coder and its database, the platform service, the workspace
templates and their icon server, the Cloud Drive (MinIO and its CSI driver), the image builder (BuildKit and its
registry) and metrics-server. It needs what [Before you start](#before-you-start) lists (Gateway API CRDs, Traefik's
Gateway), CloudNativePG's operator, the images in your registry (Step 3), and `my-values.yaml` as above. The Secrets
come from values too, so `install.sh` is not needed:

```bash
helm install cnpg prereqs/cloudnative-pg-0.29.0.tgz -n cnpg-system --create-namespace --wait \
  --set image.repository=$REGISTRY/cloudnative-pg/cloudnative-pg --set image.tag=1.30.0   # unless it is there already

tr -d '\r\n' <oidc-client-secret.txt >client-secret.txt     # no newline in the secret
helm install coder coder-airgapped-<version>.tgz -n coder --create-namespace -f my-values.yaml \
  --set secrets.tlsCa.create=true --set-file secrets.tlsCa.caCrt=ca.crt \
  --set secrets.wildcardTls.create=true \
  --set-file secrets.wildcardTls.tlsCrt=wildcard.crt --set-file secrets.wildcardTls.tlsKey=wildcard.key \
  --set secrets.oidcCa.create=true --set-file secrets.oidcCa.caCrt=keycloak-ca.crt \
  --set secrets.oidcClient.create=true --set-file secrets.oidcClient.clientSecret=client-secret.txt \
  --wait --timeout 20m
```

The namespace must be `coder` (the workspace template accepts no other). Keycloak not ready yet? Leave out the two
`oidc` lines (Step 5 says what that means). Then Step 8: sign in as `admin@admin.com` / `admin`, and seed the image
builder. `helm upgrade` with the next release's chart and the same options updates it.

More detail: `README.md`.
