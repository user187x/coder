# coder-platform

A self-contained Helm chart that deploys this repository's Coder, with its
dashboard and server changes built in, and the services its dashboard uses. It
needs no other chart and no Traefik plugin, and it deploys with Argo CD or
Helm.

## What it deploys

| Component | Objects | Serves |
|-----------|---------|--------|
| Coder (this repository's image) | Deployment `coder`, Service, ConfigMap `coder-platform-config` | Everything not listed below |
| PostgreSQL (optional) | StatefulSet `coder-db`, Service | Coder's database, including uploaded logos, avatars and template icons |
| Platform service | Deployment `coder-ui-updates`, Service, PVC | `/__coder-ui/`: logo, avatars, template icons, classification, announcements, chat, and the Keycloak, Network, Monitoring and Persistence pages |
| Banner service | Deployment `coder-banner`, Service | `/__banner/`: the announcement banner and its live updates |
| Setup Jobs | Hook Jobs | Generate the database and first-admin passwords, then create the first admin |
| Routing | Ingress, or Gateway API HTTPRoutes | `accessURL` and `wildcardAccessURL` |

The platform and banner services are standard-library Python
(`files/platform`, `files/banner`), mounted from ConfigMaps into a stock
`python` image.

## Build the image

The chart deploys `image.repository:image.tag`, and an empty tag means the
chart's `appVersion`. Build and push the image from the repository root:

```sh
./scripts/build_platform_image.sh --push
# or choose the repository and tag:
./scripts/build_platform_image.sh --image registry.example.com/coder-platform --tag 2.0.0-platform.1 --push
```

The script builds Coder's Linux binary with the dashboard and agent binaries
embedded (`make build/coder_<version>_linux_amd64`), and puts it on Coder's base
image (Alpine with Terraform). When the code changes, bump `appVersion` in
`Chart.yaml` and build again.

## Deploy with Argo CD

1. Push the image (see above). If the registry is private, create a
   docker-registry Secret in the destination namespace and list it in
   `imagePullSecrets`.
2. For Keycloak sign-in, create the client secret before the first sync:

   ```sh
   kubectl create namespace coder
   kubectl -n coder create secret generic keycloaking-coder-oidc --from-literal=client-secret=<secret>
   ```

3. Edit the values in [argocd/application.yaml](argocd/application.yaml) and
   apply it:

   ```sh
   kubectl apply -n argocd -f helm/coder-platform/argocd/application.yaml
   ```

The first sync generates Secret `coder-db` (PreSync), deploys everything, and
creates the first admin once Coder answers (PostSync). Read the admin's
password with:

```sh
kubectl -n coder get secret coder-first-user -o jsonpath='{.data.password}' | base64 -d; echo
```

Argo CD runs PostSync hooks only after every resource is healthy. Argo CD
reports an Ingress as healthy once the ingress controller publishes its
address in the Ingress status, which Traefik and ingress-nginx do by default.
If your controller doesn't, use `httpRoute` or create the first admin in the
browser.

## Deploy with Helm

```sh
helm upgrade --install coder-platform ./helm/coder-platform -n coder --create-namespace \
  --set accessURL=https://coder.example.com \
  --set ingress.tlsSecretName=coder-tls
```

## Common settings

| Value | Default | Purpose |
|-------|---------|---------|
| `accessURL` | (required) | The URL users open, for example `https://coder.example.com` |
| `wildcardAccessURL` | `""` | Wildcard host for workspace apps, for example `*.coder.example.com` |
| `image.repository`, `image.tag` | `ghcr.io/user187x/coder-platform`, `appVersion` | The Coder image |
| `ingress.className`, `ingress.tlsSecretName` | `""` | Ingress controller and TLS certificate |
| `httpRoute.enabled`, `httpRoute.parentRefs` | `false` | Gateway API routing instead of, or as well as, the Ingress |
| `oidc.*` | disabled | Keycloak or another OpenID Connect provider |
| `firstUser.*` | `admin` | The first admin; `existingSecret` supplies the password |
| `postgres.enabled` | `true` | `false` uses `postgres.external.secretName` (a connection URL) |
| `tls.caPem` | `""` | A private CA that Coder and the platform service trust |
| `platform.keycloakNamespace` | `""` | Lets the Keycloak page read the Keycloak operator's resources |
| `platform.clusterRead` | `true` | Cluster-wide read access for the Network and Persistence pages |

See [values.yaml](values.yaml) for everything else.

## Notes

- Install one release per namespace: object names are fixed because the
  platform service looks them up by name.
- Serve Coder over HTTPS. The dashboard resizes uploaded logos, avatars and
  icons, animated ones included, with the browser's WebCodecs API, which
  browsers offer only on secure origins. Over plain HTTP, JPEGs and oversized
  pictures are resized as still images and other pictures are stored as
  uploaded.
- The bundled PostgreSQL is a single instance. Back up its volume, or use
  `postgres.enabled: false` with a managed or CloudNativePG database.
- Generated Secrets (`coder-db`, `coder-first-user`, `coder-ui-logs-db`) are not
  part of the release, so uninstalling keeps them, and reinstalling reuses
  them.
- `files/platform/ui-service.py` and `files/platform/pgwire.py` come from the
  platform service's source; copy updated versions into this chart.
