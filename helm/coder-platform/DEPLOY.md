# Deploying coder-platform

This repository's Coder, with all its dashboard and server changes, deploys to
any Kubernetes cluster from one Argo CD Application:
[argocd/application.yaml](argocd/application.yaml). It needs nothing else: the
chart comes from this public repository, and the images come from `ghcr.io` and
Docker Hub, for linux/amd64 and linux/arm64.

## What gets deployed

Everything lands in namespace `coder-platform`:

| Component               | Kubernetes objects                                                     | Purpose                                                                                                                         |
|-------------------------|------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| Coder                   | Deployment `coder`, Service `coder`, ConfigMap `coder-platform-config` | This repository's Coder, image `ghcr.io/user187x/coder-platform`                                                                |
| PostgreSQL              | StatefulSet `coder-db`, Service, 10Gi volume                           | Coder's database, including uploaded logos, avatars, template icons and admin quick links                                       |
| Platform service        | Deployment `coder-ui-updates`, Service, 1Gi volume                     | Logo, avatars, template icons, classification, announcements, chat, and the Keycloak, Network, Monitoring and Persistence pages |
| Monitoring log database | Deployment `coder-ui-logs-db`                                          | Buffers workspace logs for the Monitoring page                                                                                  |
| Banner service          | Deployment `coder-banner`, Service                                     | The announcement banner and its live updates                                                                                    |
| Setup Jobs              | PreSync and PostSync hook Jobs                                         | Generate passwords, then create the first admin                                                                                 |

Browsers only ever talk to Coder. Coder forwards `/__coder-ui` and `/__banner`
to the platform and banner services itself, so any way of reaching Coder
works: `kubectl port-forward`, a LoadBalancer or NodePort Service, an Ingress,
or a Gateway API route.

## Requirements

- Argo CD 2.10 or newer, deploying to its own cluster
  (`https://kubernetes.default.svc`). The file also creates the Argo CD project
  `coder-platform` the Application uses, limited to this repository, namespace
  `coder-platform`, and the cluster-scoped objects the chart creates.
- A default StorageClass, or set `postgres.storage.storageClass` and
  `platform.storage.storageClass`.
- Internet access from the cluster to `github.com`, `ghcr.io` and `docker.io`.
  Workspace builds also download Terraform providers from
  `registry.terraform.io`.

## Deploy

```sh
kubectl apply -n argocd -f application.yaml
```

Argo CD then:

1. **PreSync:** Job `coder-platform-secrets` creates Secret `coder-db`
   (database password and connection URL) and Secret `coder-first-user`
   (admin password). Neither Secret is part of the release, so later syncs
   never change them.
2. **Sync:** creates PostgreSQL, Coder, the platform and banner services, and
   any route you configured. Coder migrates its schema on first start.
3. **PostSync:** Job `coder-platform-first-user` waits for Coder and creates the
   first admin, unless one exists.

It's done when the Application shows **Synced** and **Healthy**. The first
sync takes 5 to 10 minutes, most of it Argo CD cloning this repository:

```sh
kubectl -n argocd get application coder-platform
kubectl -n coder-platform get pods     # all Running, plus two Completed setup Jobs
```

## Sign in

```sh
kubectl -n coder-platform get secret coder-first-user -o jsonpath='{.data.password}' | base64 -d; echo
kubectl -n coder-platform port-forward svc/coder 8080:80
```

Browse to <http://localhost:8080> and sign in as `admin@example.com` with that
password. You can change it under **Account > Security**; the Secret is only
used to create the admin.

Without `accessURL`, Coder's address is `http://coder.coder-platform.svc.cluster.local`.
Workspaces in the cluster connect to that address, and you reach the dashboard
through the port-forward.

## Publish Coder at a real address

Set `accessURL` in the Application, for example `https://coder.example.com`,
point DNS for that host at the cluster, and uncomment one of the **Publish**
blocks:

| Block                              | Use when                                                                                                              |
|------------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| `coder.service.type: LoadBalancer` | The cluster hands out load balancer addresses (clouds, MetalLB, k3s ServiceLB). Put TLS in front, or use the Ingress  |
| `ingress`                          | An ingress controller runs (nginx, Traefik, ...). `tlsSecretName` names a TLS Secret in `coder-platform` for the host |
| `httpRoute`                        | A Gateway API Gateway runs. `parentRefs` names it and its HTTPS listener                                              |

Serve Coder over HTTPS. The dashboard resizes uploaded logos, avatars and
icons, animated ones included, with the browser's WebCodecs API, which
browsers only offer on secure addresses. Over plain HTTP, JPEGs and oversized
pictures are resized as still images and other pictures are stored as
uploaded.

`wildcardAccessURL` (for example `*.coder.example.com`) puts workspace apps on
their own subdomains. It needs wildcard DNS and a certificate. Without it,
apps use path URLs.

Argo CD reports an Ingress or a LoadBalancer Service as healthy once it has an
address. Until then the Application stays **Progressing**, and the PostSync
admin Job waits.

## Keycloak (OpenID Connect) sign-in

Sign-in supports Keycloak, or any OpenID Connect provider, and username and
password. Keycloak needs `accessURL`, because the browser returns to it.

1. In Keycloak, create a confidential client (for example `coder`) with this
   **Valid redirect URI**: `<accessURL>/api/v2/users/oidc/callback`.
2. Put its client secret in the cluster:

   ```sh
   kubectl -n coder-platform create secret generic keycloaking-coder-oidc --from-literal=client-secret=<secret>
   ```

3. Uncomment the `oidc` block in the Application and set `issuerURL`, for
   example `https://keycloak.example.com/realms/master`.
4. If Keycloak runs on the same cluster through the Keycloak operator, also set
   `platform.keycloakNamespace`, so the **Admin > Settings > Authentication**
   page can compare and repair the client.

To make a Keycloak user an admin, sign in as `admin`, open **Admin >
Accounts**, and give them the Owner role. Add `oidc.disablePasswordAuth: true`
to allow Keycloak sign-in only.

## Private certificate authorities

If a private CA signed Keycloak's certificate or `accessURL`'s certificate,
put its PEM in `tls.caPem` (the Application has a commented block). Coder and
the platform service then trust it. Instead of the value, you can create
Secret `tls-ca` (key `ca.crt`) in `coder-platform` yourself.

Workspace pods need the CA too when `accessURL` is HTTPS with a private
certificate, because the agent downloads itself from `accessURL`. Use a
workspace image with the CA installed, or leave `accessURL` empty so
workspaces use Coder's in-cluster HTTP address.

## Create a workspace

1. Open **Templates > New template** and choose the **Kubernetes** starter.
2. Set `namespace` to `coder-platform` and leave `use_kubeconfig` set to `false`.
   Coder's service account may create pods and volumes in its own namespace.
3. Create a workspace from the template.

To run workspaces in other namespaces, add them to `workspaces.namespaces`.

## Template and workspace icons

Open **Templates > Icons** to upload pictures. Each one gets a stable path,
such as `/__coder-ui/icons/my-tool`, for a template's icon, a workspace app's
icon, or any Terraform resource's `icon`. Uploaded icons also appear under
**Uploaded** in every icon picker.

## Replace an existing Coder

To move an existing Coder's users, templates and workspaces to this version,
point the chart at its database. Back the database up first: Coder's
migrations only go forward.

1. Stop the old Coder, keeping its database running. With Argo CD, remove the
   old Application's finalizers before deleting it, so it leaves its resources
   in place.
2. Delete the old Coder Deployment and Service (and any routes, or Traefik
   middlewares from earlier dashboard add-ons) if they're in the namespace you
   deploy to, because they share this chart's names.
3. In the Application, set:

   ```yaml
   postgres:
     enabled: false
     external:
       secretName: <Secret with the connection URL>   # in the destination namespace
       secretKey: uri
   firstUser:
     enabled: false        # the database already has admins
   ```

   and `accessURL`, routing and `oidc` as the old Coder had them.

## Update to a new version

Applications that track `targetRevision: main` pick up new versions by
themselves. To release one from this repository:

1. Bump `appVersion` in [Chart.yaml](Chart.yaml), for example to
   `2.0.0-platform.3`. Bump `version` when the chart changes.
2. Build and push the image from the repository root. It's tagged with
   `appVersion` for linux/amd64 and linux/arm64:

   ```sh
   docker login ghcr.io -u user187x --password-stdin < /path/to/token-file
   ./scripts/build_platform_image.sh --push
   ```

   The build compiles Coder for every platform the agent supports and needs
   about 10 GB of free disk space.

3. Commit and push. Argo CD syncs the new version, and Coder migrates its
   database on start.

To stay on a version instead of following `main`, set the Application's
`targetRevision` to a commit or tag.

## Day-to-day reference

| Task                  | Command                                                                                             |
|-----------------------|-----------------------------------------------------------------------------------------------------|
| Admin password        | `kubectl -n coder-platform get secret coder-first-user -o jsonpath='{.data.password}' \| base64 -d` |
| Open Coder locally    | `kubectl -n coder-platform port-forward svc/coder 8080:80`                                          |
| Coder logs            | `kubectl -n coder-platform logs deploy/coder`                                                       |
| Platform service logs | `kubectl -n coder-platform logs deploy/coder-ui-updates`                                            |
| Banner service logs   | `kubectl -n coder-platform logs deploy/coder-banner`                                                |
| Setup Job logs        | `kubectl -n coder-platform logs job/coder-platform-first-user`                                      |
| Database shell        | `kubectl -n coder-platform exec -it coder-db-0 -- psql -U coder coder`                              |
| Database backup       | `kubectl -n coder-platform exec coder-db-0 -- pg_dump -U coder -Fc coder > coder.dump`              |
| Restart Coder         | `kubectl -n coder-platform rollout restart deploy/coder`                                            |

### Where data lives

| Data                                                                           | Location                                                   | Survives                                     |
|--------------------------------------------------------------------------------|------------------------------------------------------------|----------------------------------------------|
| Users, templates, workspaces, logo, avatars, template icons, admin quick links | PostgreSQL volume `data-coder-db-0`                        | Restarts, upgrades, deleting the Application |
| Announcement receipts, chat                                                    | Volume `coder-ui-updates-data`                             | Restarts, upgrades, deleting the Application |
| Published banner                                                               | ConfigMap `coder-banner-state`                             | Restarts and upgrades                        |
| Passwords                                                                      | Secrets `coder-db`, `coder-first-user`, `coder-ui-logs-db` | Everything; delete them yourself             |

Deleting the Application removes the workloads but keeps the volumes and the
generated Secrets; applying it again picks them up. To remove everything,
delete the Application, then `kubectl delete namespace coder-platform`.

## Troubleshooting

| Symptom                                                         | Cause and fix                                                                                                                                                 |
|-----------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| PVCs stay `Pending`                                             | No default StorageClass. Set `postgres.storage.storageClass` and `platform.storage.storageClass`                                                              |
| Pods in `ImagePullBackOff`                                      | The cluster can't reach `ghcr.io` or `docker.io`, or Docker Hub's anonymous pull limit was hit. Check `kubectl -n coder-platform describe pod <pod>`          |
| `coder` restarts a few times on the first sync                  | It started before PostgreSQL accepted connections, and settles once it does                                                                                   |
| Application stays `Progressing`; the admin Job never runs       | Something isn't healthy yet: a pod that isn't ready, or an Ingress or LoadBalancer without an address. Check `kubectl -n coder-platform get pods,ingress,svc` |
| Dashboard pages show "platform service is not reachable"        | `coder-ui-updates` or `coder-banner` isn't running: check their pods and logs                                                                                 |
| Keycloak sign-in fails with a certificate error                 | Keycloak's certificate is signed by a CA Coder doesn't trust: set `tls.caPem`                                                                                 |
| Keycloak says "Invalid redirect URI"                            | Add `<accessURL>/api/v2/users/oidc/callback` to the client                                                                                                    |
| `coder` pod in `CreateContainerConfigError` after enabling OIDC | Secret `keycloaking-coder-oidc` is missing in `coder-platform`                                                                                                |
| Uploaded animated pictures aren't resized                       | Use an `https://` address                                                                                                                                     |
| Monitoring shows no logs at first                               | `coder-ui-logs-db` starts once the platform service has created its password Secret, about a minute after the first sync                                      |

## Values reference

The most-used values, with the full list in [values.yaml](values.yaml):

| Value                                     | Purpose                                                         |
|-------------------------------------------|-----------------------------------------------------------------|
| `accessURL`                               | The address users open; empty = Coder's in-cluster address      |
| `wildcardAccessURL`                       | Wildcard host for workspace apps                                |
| `image.repository`, `image.tag`           | The Coder image; an empty tag means the chart's `appVersion`    |
| `coder.service.type`                      | `ClusterIP`, `LoadBalancer` or `NodePort`                       |
| `ingress.*`, `httpRoute.*`                | Optional routing to Coder                                       |
| `oidc.*`                                  | Keycloak or another OpenID Connect provider                     |
| `firstUser.*`                             | The first admin; `existingSecret` supplies your own password    |
| `postgres.enabled`, `postgres.external.*` | The bundled database, or an existing one                        |
| `tls.caPem`                               | A private CA to trust                                           |
| `platform.keycloakNamespace`              | Where the dashboard's Keycloak page finds the Keycloak operator |
| `platform.clusterRead`                    | Cluster-wide read access for the Network and Persistence pages  |
| `workspaces.namespaces`                   | Extra namespaces Coder may create workspaces in                 |
