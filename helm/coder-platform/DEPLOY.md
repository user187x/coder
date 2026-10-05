# Deploying coder-platform

This guide covers everything needed to run this repository's Coder, with all
its dashboard and server changes, on a Kubernetes cluster with Argo CD. The
examples use the devbox cluster: domain `xxx.com`, Traefik's Gateway
`traefik/traefik-gateway`, and Keycloak at `https://keycloak.xxx.com/realms/master`.

## What gets deployed

One Argo CD Application ([argocd/application.yaml](argocd/application.yaml))
installs the chart in this directory into namespace `coder-platform`:

| Component | Kubernetes objects | Purpose |
|-----------|--------------------|---------|
| Coder | Deployment `coder`, Service, ConfigMap `coder-platform-config` | This repository's Coder, from image `ghcr.io/user187x/coder-platform` |
| PostgreSQL | StatefulSet `coder-db`, Service, 10Gi volume | Coder's database, including uploaded logos, avatars and template icons |
| Platform service | Deployment `coder-ui-updates`, Service, 1Gi volume | `/__coder-ui/`: logo, avatars, template icons, classification, announcements, chat, and the Keycloak, Network, Monitoring and Persistence pages |
| Monitoring log database | Deployment `coder-ui-logs-db` | Buffers workspace logs for the Monitoring page |
| Banner service | Deployment `coder-banner`, Service | `/__banner/`: the announcement banner and its live updates |
| Setup Jobs | PreSync and PostSync hook Jobs | Generate passwords, then create the first admin |
| Route | HTTPRoute `coder` | `https://coder-platform.xxx.com` through `traefik-gateway` |

Everything runs from public images: the Coder image, `python:3.13-alpine` and
`postgres:17`. The platform and banner services are Python files in this
chart, mounted from ConfigMaps. Nothing needs Traefik's rewrite-body plugin.

The Application installs alongside the existing `coder` Application (namespace
`coder`, `coder.xxx.com`) and leaves it alone. To replace that Coder instead
and keep its data, see [Replace the existing Coder](#replace-the-existing-coder).

## Current state

| Item | State |
|------|-------|
| Image `ghcr.io/user187x/coder-platform:2.0.0-platform.1` | Pushed, but **private**. Make it public (step 1 below) |
| Chart `helm/coder-platform` on `github.com/user187x/coder`, branch `main` | Pushed. The repository is public, so Argo CD needs no credentials |
| Argo CD Application | [argocd/application.yaml](argocd/application.yaml), ready to apply |

## Deploy

### 1. Make the image public

GHCR creates packages as private, and GitHub has no API for changing that:

1. Open <https://github.com/users/user187x/packages/container/package/coder-platform>.
2. Click **Package settings**.
3. Under **Danger Zone**, click **Change visibility**, choose **Public**, and
   type `coder-platform` to confirm.

To check, pull it while logged out of GHCR:

```sh
docker logout ghcr.io
docker pull ghcr.io/user187x/coder-platform:2.0.0-platform.1
```

To keep the image private instead, create a pull Secret in namespace
`coder-platform` and add `imagePullSecrets: [<secret name>]` to the
Application's values.

### 2. Point DNS at Traefik

`coder-platform.xxx.com` must resolve to Traefik for browsers and from inside
the cluster, like the other `xxx.com` hosts. The Gateway's `wildcard-tls`
certificate (`*.xxx.com`) already covers it. If you use `/etc/hosts`, add the
same address the other hosts use.

### 3. Prepare the namespace

Create the namespace, and give Coder the xxx.com Root CA in Secret `tls-ca`
(key `ca.crt`). Coder needs it to trust Keycloak and its own HTTPS address,
and the platform service needs it for the Keycloak page.

```sh
kubectl create namespace coder-platform

# Copy the CA Secret the existing Coder uses:
kubectl -n coder-platform create secret generic tls-ca \
  --from-literal=ca.crt="$(kubectl -n coder get secret tls-ca -o jsonpath='{.data.ca\.crt}' | base64 -d)"

# Or from a PEM file:
kubectl -n coder-platform create secret generic tls-ca --from-file=ca.crt=/path/to/xxx-root-ca.pem
```

Skip this only if every certificate involved comes from a public CA.

### 4. Apply the Application

```sh
kubectl apply -n argocd -f helm/coder-platform/argocd/application.yaml
```

Argo CD then works through these steps:

1. **PreSync:** Job `coder-platform-secrets` creates Secret `coder-db`
   (database password and connection URL) and Secret `coder-first-user` (the
   admin password). Neither Secret is part of the release, so later syncs
   never change them.
2. **Sync:** PostgreSQL, Coder, the platform service, the banner service and
   the route. Coder migrates its schema on first start, which takes a minute
   or two.
3. **PostSync:** Job `coder-platform-first-user` waits for Coder and creates the
   first admin, unless one already exists.

Watch it:

```sh
kubectl -n argocd get application coder-platform -w
kubectl -n coder-platform get pods
```

The Application is done when it shows `Synced` and `Healthy` and every pod is
`Running`, apart from the two `Completed` Jobs.

### 5. Sign in

```sh
kubectl -n coder-platform get secret coder-first-user -o jsonpath='{.data.password}' | base64 -d; echo
```

Open <https://coder-platform.xxx.com> and sign in as `admin@xxx.com` with that
password. You can change it from your user menu under **Account > Security**;
the Secret is only used to create the admin.

## Turn on Keycloak sign-in

Sign-in supports Keycloak (OpenID Connect) and username and password. To add
Keycloak:

1. In the Keycloak admin console, open realm **master**, then **Clients >
   coder**. Add this redirect URI under **Valid redirect URIs**:

   ```text
   https://coder-platform.xxx.com/api/v2/users/oidc/callback
   ```

2. Give the new namespace the client secret. It's the same one the existing
   Coder uses:

   ```sh
   kubectl -n coder-platform create secret generic keycloaking-coder-oidc \
     --from-literal=client-secret="$(kubectl -n coder get secret keycloaking-coder-oidc -o jsonpath='{.data.client-secret}' | base64 -d)"
   ```

   Or copy it from Keycloak, under **Clients > coder > Credentials**.

3. In [argocd/application.yaml](argocd/application.yaml), set `oidc.enabled: true`,
   then commit and push (or edit the Application's values in Argo CD).

Coder restarts with a **Sign in with Keycloak** button. Users who sign in with
Keycloak get Coder accounts automatically (`oidc.allowSignups`). To make a
Keycloak user an admin, sign in as `admin`, open **Admin > Accounts**, and give
them the Owner role.

To allow Keycloak sign-in only, add `oidc.disablePasswordAuth: true` once a
Keycloak user is an Owner. The **Admin > Settings > Authentication** page shows
what Coder and Keycloak each have configured, and can repair mismatches.

## Create a workspace

1. Open **Templates > New template** and choose the **Kubernetes** starter.
2. Set `namespace` to `coder-platform` and leave `use_kubeconfig` set to `false`.
   Coder's service account may create pods and volumes in its own namespace.
3. Create a workspace from the template.

Workspace builds download Terraform providers from `registry.terraform.io`,
so the cluster needs internet access for builds.

Workspace pods must also trust the xxx.com Root CA, because the agent
downloads itself from `https://coder-platform.xxx.com`. Either use a workspace
image with the CA installed, or mount Secret `tls-ca` into the workspace pod
in the template and add it to the image's trust store before the agent starts.

To create workspaces in other namespaces, add them to `workspaces.namespaces`
in the values. The chart grants Coder the same permissions there.

## Template and workspace icons

Open **Templates > Icons** to upload pictures. Each one gets a stable path such
as `/__coder-ui/icons/my-tool`. Use that path for a template's icon, a
workspace app's icon, or any Terraform resource's `icon`. Uploaded icons also
appear under **Uploaded** in every icon picker.

## Update to a new version

When the code changes:

1. Bump `appVersion` in [Chart.yaml](Chart.yaml), for example to
   `2.0.0-platform.2`. Bump `version` too if the chart itself changed.
2. Build and push the image from the repository root. The image is tagged with
   `appVersion`:

   ```sh
   docker login ghcr.io -u user187x --password-stdin < /path/to/token-file
   ./scripts/build_platform_image.sh --push
   ```

   The build compiles Coder for every platform the agent supports, and needs
   about 10 GB of free disk space.

3. Commit and push. Argo CD syncs the new version, and Coder migrates its
   database on start.

Database migrations only go forward. To roll back to an older image, restore a
database backup taken before the upgrade.

## Replace the existing Coder

To serve `coder.xxx.com` from this version and keep the existing users,
templates and workspaces, reuse the existing CloudNativePG database
(Secret `coder-db-app` in namespace `coder`):

1. **Back up the database first.** Find the primary instance, then dump it:

   ```sh
   kubectl -n coder get pods -l cnpg.io/cluster=coder-db,cnpg.io/instanceRole=primary
   kubectl -n coder exec coder-db-1 -c postgres -- pg_dump -U postgres -Fc app > coder-backup.dump
   ```

2. Remove the old Application without deleting what it created, so the
   database keeps running:

   ```sh
   kubectl -n argocd patch application coder --type json -p '[{"op":"remove","path":"/spec/syncPolicy/automated"}]'
   kubectl -n argocd patch application coder --type json -p '[{"op":"remove","path":"/metadata/finalizers"}]'
   kubectl -n argocd delete application coder
   ```

3. Delete the old Coder's workloads and routes. Their names match this
   chart's, and a Deployment's selector can't change. This includes anything
   left by the earlier Traefik-rewrite add-ons, whose routes would otherwise
   still rewrite the dashboard. Coder is down from here until the next step
   finishes:

   ```sh
   kubectl -n coder delete deployment coder coder-ui-updates coder-banner coder-ui-logs-db --ignore-not-found
   kubectl -n coder delete service coder coder-ui-updates coder-banner coder-ui-logs-db --ignore-not-found
   kubectl -n coder delete httproute coder coder-ui-updates coder-banner --ignore-not-found
   kubectl -n coder get middlewares.traefik.io -o name | grep -E 'coder-(ui-updates|banner)' | xargs -r kubectl -n coder delete
   ```

   `kubectl -n coder get httproute` should then list nothing that still points
   at `coder.xxx.com`.

4. Edit [argocd/application.yaml](argocd/application.yaml):

   ```yaml
   destination:
     namespace: coder
   # in valuesObject:
   accessURL: https://coder.xxx.com
   wildcardAccessURL: "*.xxx.com"
   postgres:
     enabled: false
     external:
       secretName: coder-db-app
       secretKey: uri
   firstUser:
     enabled: false        # the database already has admins
   oidc:
     enabled: true         # Secret keycloaking-coder-oidc already exists in coder
   ```

5. Apply it: `kubectl apply -n argocd -f helm/coder-platform/argocd/application.yaml`.

The CloudNativePG operator and cluster keep running, but no Argo CD
Application manages them any more.

## Day-to-day reference

| Task | Command |
|------|---------|
| Admin password | `kubectl -n coder-platform get secret coder-first-user -o jsonpath='{.data.password}' \| base64 -d` |
| Coder logs | `kubectl -n coder-platform logs deploy/coder` |
| Platform service logs | `kubectl -n coder-platform logs deploy/coder-ui-updates` |
| Banner service logs | `kubectl -n coder-platform logs deploy/coder-banner` |
| Setup Job logs | `kubectl -n coder-platform logs job/coder-platform-first-user` |
| Database shell | `kubectl -n coder-platform exec -it coder-db-0 -- psql -U coder coder` |
| Database backup | `kubectl -n coder-platform exec coder-db-0 -- pg_dump -U coder -Fc coder > coder.dump` |
| Restart Coder | `kubectl -n coder-platform rollout restart deploy/coder` |

### Where data lives

| Data | Location | Survives |
|------|----------|----------|
| Users, templates, workspaces, logo, avatars, template icons, admin quick links | PostgreSQL volume `data-coder-db-0` | Restarts, upgrades, deleting the Application |
| Announcement receipts, chat | Volume `coder-ui-updates-data` | Restarts, upgrades, deleting the Application |
| Published banner | ConfigMap `coder-banner-state` | Restarts and upgrades |
| Passwords | Secrets `coder-db`, `coder-first-user`, `coder-ui-logs-db` | Everything; delete them yourself |

Deleting the Application removes the workloads but keeps the volumes and the
generated Secrets. Reapplying it picks them up again. To remove everything,
delete the Application, then `kubectl delete namespace coder-platform`.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| Pods in `ImagePullBackOff` for `ghcr.io/user187x/coder-platform` | The image is still private. Make it public (step 1) or add `imagePullSecrets` |
| `coder` pod restarts a few times on the first sync | Coder starts before PostgreSQL is ready. It settles once the database accepts connections |
| Application stays `Progressing` and the admin Job never runs | Argo CD runs PostSync only when everything is healthy. Check `kubectl -n coder-platform get pods` for a pod that isn't ready |
| Browser can't reach `coder-platform.xxx.com` | DNS or `/etc/hosts` doesn't point the host at Traefik, or the route isn't accepted: `kubectl -n coder-platform describe httproute coder` |
| Keycloak button fails with a certificate error | Secret `tls-ca` is missing in `coder-platform`, or doesn't hold the CA that signed Keycloak's certificate. Create it, then restart Coder |
| Keycloak says "Invalid redirect URI" | Add `https://coder-platform.xxx.com/api/v2/users/oidc/callback` to the `coder` client |
| `coder` pod in `CreateContainerConfigError` after turning on OIDC | Secret `keycloaking-coder-oidc` is missing in `coder-platform` |
| Uploaded animated pictures aren't resized | The browser resizes them only on HTTPS addresses. Use the `https://` address |
| Monitoring page shows no logs | `coder-ui-logs-db` starts once the platform service has created its password Secret; give it a minute after the first sync |

## Values reference

The values that matter for most installations, with the full list in
[values.yaml](values.yaml):

| Value | Purpose |
|-------|---------|
| `accessURL` | The HTTPS address users open (required) |
| `wildcardAccessURL` | Wildcard host for workspace apps; needs DNS and a certificate for it |
| `image.repository`, `image.tag` | The Coder image; an empty tag means the chart's `appVersion` |
| `httpRoute.*` or `ingress.*` | How traffic reaches Coder |
| `oidc.*` | Keycloak sign-in |
| `firstUser.*` | The first admin; `existingSecret` supplies your own password |
| `postgres.enabled`, `postgres.external.*` | The bundled database, or an existing one |
| `tls.caPem` | A private CA, if you'd rather put the PEM in values than create Secret `tls-ca` |
| `platform.keycloakNamespace` | Where the Keycloak page finds the Keycloak operator |
| `platform.clusterRead` | Cluster-wide read access for the Network and Persistence pages |
| `workspaces.namespaces` | Extra namespaces Coder may create workspaces in |
