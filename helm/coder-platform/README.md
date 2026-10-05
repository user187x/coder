# coder-platform

A self-contained Helm chart that deploys this repository's Coder, with its
dashboard and server changes built in, and the services its dashboard uses. It
needs no other chart, no Traefik plugin and no values: with the defaults it
runs on any cluster, and you open it with `kubectl port-forward`.

Deploy it with the Argo CD Application in
[argocd/application.yaml](argocd/application.yaml). [DEPLOY.md](DEPLOY.md)
covers publishing Coder at a real address, Keycloak, private CAs, workspaces,
upgrades, replacing an existing Coder, and troubleshooting.

## What it deploys

| Component                       | Objects                                                        | Purpose                                                                                                                         |
|---------------------------------|----------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| Coder (this repository's image) | Deployment `coder`, Service, ConfigMap `coder-platform-config` | Coder; it also forwards `/__coder-ui` and `/__banner` to the services below                                                     |
| PostgreSQL (optional)           | StatefulSet `coder-db`, Service                                | Coder's database, including uploaded logos, avatars and template icons                                                          |
| Platform service                | Deployment `coder-ui-updates`, Service, PVC                    | Logo, avatars, template icons, classification, announcements, chat, and the Keycloak, Network, Monitoring and Persistence pages |
| Banner service                  | Deployment `coder-banner`, Service                             | The announcement banner and its live updates                                                                                    |
| Setup Jobs                      | Hook Jobs                                                      | Generate the database and first-admin passwords, then create the first admin                                                    |
| Routing (optional)              | Ingress, Gateway API HTTPRoute                                 | `accessURL` and `wildcardAccessURL`                                                                                             |

The platform and banner services are standard-library Python
(`files/platform`, `files/banner`), mounted from ConfigMaps into a stock
`python` image. Coder forwards their paths
(`CODER_PLATFORM_SERVICE_ROUTES`), so browsers only ever talk to Coder.

## Build the image

The chart deploys `image.repository:image.tag`, and an empty tag means the
chart's `appVersion`. Build and push from the repository root:

```sh
./scripts/build_platform_image.sh --push
# or choose the repository, tag and architectures:
./scripts/build_platform_image.sh --image registry.example.com/coder-platform --tag 2.0.0-platform.2 --arch amd64 --push
```

The script builds Coder's Linux binaries with the dashboard and agent binaries
embedded, puts each on Coder's base image (Alpine with Terraform), and pushes
linux/amd64 and linux/arm64 under one tag. Coder reports the tag as its
version. When the code changes, bump `appVersion` in `Chart.yaml` and build
again.

## Deploy with Helm

```sh
helm upgrade --install coder-platform ./helm/coder-platform -n coder-platform --create-namespace
kubectl -n coder-platform port-forward svc/coder 8080:80
```

## Common settings

| Value                                                           | Default                                         | Purpose                                                             |
|-----------------------------------------------------------------|-------------------------------------------------|---------------------------------------------------------------------|
| `accessURL`                                                     | `""` (in-cluster address)                       | The URL users open, for example `https://coder.example.com`         |
| `wildcardAccessURL`                                             | `""`                                            | Wildcard host for workspace apps, for example `*.coder.example.com` |
| `image.repository`, `image.tag`                                 | `ghcr.io/user187x/coder-platform`, `appVersion` | The Coder image                                                     |
| `coder.service.type`                                            | `ClusterIP`                                     | `LoadBalancer` or `NodePort` to publish Coder directly              |
| `ingress.enabled`, `ingress.className`, `ingress.tlsSecretName` | `false`                                         | An Ingress to Coder                                                 |
| `httpRoute.enabled`, `httpRoute.parentRefs`                     | `false`                                         | A Gateway API route to Coder                                        |
| `oidc.*`                                                        | disabled                                        | Keycloak or another OpenID Connect provider                         |
| `firstUser.*`                                                   | `admin`                                         | The first admin; `existingSecret` supplies the password             |
| `postgres.enabled`                                              | `true`                                          | `false` uses `postgres.external.secretName` (a connection URL)      |
| `tls.caPem`                                                     | `""`                                            | A private CA that Coder and the platform service trust              |
| `platform.keycloakNamespace`                                    | `""`                                            | Lets the Keycloak page read the Keycloak operator's resources       |
| `platform.clusterRead`                                          | `true`                                          | Cluster-wide read access for the Network and Persistence pages      |

See [values.yaml](values.yaml) for everything else.

## Notes

- Install one release per namespace: object names are fixed because the
  platform service looks them up by name.
- Serve Coder over HTTPS. The dashboard resizes uploaded logos, avatars and
  icons, animated ones included, with the browser's WebCodecs API, which
  browsers offer only on secure origins.
- The bundled PostgreSQL is a single instance. Back up its volume, or use
  `postgres.enabled: false` with a managed or CloudNativePG database.
- Generated Secrets (`coder-db`, `coder-first-user`, `coder-ui-logs-db`) are not
  part of the release, so uninstalling keeps them, and reinstalling reuses
  them.
- `files/platform/ui-service.py` and `files/platform/pgwire.py` come from the
  platform service's source; copy updated versions into this chart.
