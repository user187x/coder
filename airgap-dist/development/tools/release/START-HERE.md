# Install Coder fork 1.1.3

This guide uses the small source build kit. To install the supplied images without building,
use OFFLINE-INSTALL.md instead.
You build the fork images, put them in your registry, then install one Helm chart.
The build kit contains the source and the custom FileBrowser binary needed by DEFAULT.
It does not contain saved base images. The built server includes matching agent downloads.

## Before you start

Use a Linux x86_64 machine for the build. It needs Docker with BuildKit, Go 1.26.10 or newer,
Node.js 22 or 24, pnpm 10, Helm 3, Python 3, curl, Git, gzip and zstd.
Docker must be running. Allow plenty of disk space for build caches and workspace images.

Run these checks:

```bash
docker info >/dev/null
go version
node --version
pnpm --version
helm version
python3 --version
zstd --version
```

If a command says it is missing, install that program before continuing.

**Do the build while connected to the internet.** Having the base images alone is not enough
for a source build: it also downloads Go modules, npm packages, Linux packages and other
checked build inputs. The installed cluster does not need these build downloads.

Your build machine must be able to push to the registry your cluster can pull from.
For a disconnected registry, use your approved registry replication or image import process.
If neither machine can reach both sides, the built images must cross that boundary somehow.
This kit reduces the release download; it cannot eliminate the images needed at runtime.

## 1. Download the release

Download all the small release files from the GitHub release page into one folder.
Do not download old image `.tar.gz` files from an earlier release.

Open a terminal in that folder. Run:

```bash
sha256sum -c SOURCE-SHA256SUMS
tar -xzf coder-build-kit-1.1.3.tar.gz
cd coder-build-kit-1.1.3
```

Every checksum must say `OK`. Stop if one fails and download that file again.

## 2. Pick your registry

In the commands below, replace `registry.example.com/coder` with your registry and optional
folder. Do not put `https://` in it.

Log in if your registry requires it:

```bash
docker login registry.example.com
```

Keep your registry password private. Do not put it in this guide or a Git commit.

## 3. Build and push the required images

Run this from inside the extracted build kit:

```bash
./airgap-dist/development/tools/build-source-release.sh registry.example.com/coder --push
```

The first build can take a long time. Let it finish. A failed step stops the script.
After fixing the reported problem, run the same command again; Docker reuses cached work.
Existing matching local workspace, registry, MinIO and image-tools images are reused.
The script does not export large image archives.

When it prints `Build finished`, your output folder is:

```text
build/release-1.1.3/
```

That folder contains:

- `coder-airgapped-1.47.2.tgz`: the single Helm chart to install.
- `values.yaml`: the settings file you will edit next.
- `BUILT-IMAGES.txt`: every fork image pushed to your registry.
- `PUBLIC-IMAGES.txt`: common public images the cluster also needs.
- `FORK-IMAGES.txt`: original names of the fork images you built.

Use the chart from this output folder. The build updates its UI image tag to match the code.

### Optional: add DATAFLOW

DEFAULT works without DATAFLOW. Do not build DATAFLOW unless you need NiFi and Airflow.
To include it, use this command instead:

```bash
./airgap-dist/development/tools/build-source-release.sh registry.example.com/coder --dataflow --push
```

It makes much larger images and enables the DATAFLOW template in the generated settings.
You can add it later by running this command and upgrading the Helm release.

## 4. Make the common images available

If the cluster can pull the public images in `PUBLIC-IMAGES.txt`, leave them alone.
PostgreSQL, the database operator and gateway images are public dependencies, not fork builds.
Keycloak is your existing external service; this chart does not install Keycloak.

For a fully disconnected cluster, mirror the images in `PUBLIC-IMAGES.txt` into your registry,
keeping the path after the original registry host. Then set `global.registry` in `values.yaml`
to that mirror prefix. `global.registry` rewrites both public and fork image references.

For example, with `global.registry: registry.example.com/coder`,
`ghcr.io/cloudnative-pg/postgresql:TAG` must exist as
`registry.example.com/coder/cloudnative-pg/postgresql:TAG`.
Docker Hub library images keep `library/` in the mirrored path.

## 5. Check your target cluster

Copy the generated output folder to the machine that can reach your target cluster.
Install kubectl and Helm there. Select the correct kubeconfig context:

```bash
kubectl config get-contexts
kubectl config use-context YOUR-TARGET-CONTEXT
kubectl get nodes
kubectl get storageclass
```

Replace `YOUR-TARGET-CONTEXT` with the actual target name. All nodes should be `Ready`.
Your cluster needs a working default storage class with dynamic persistent volumes.
On EKS, configure the EBS CSI driver and its IAM permissions before proceeding.
Cloud Drive's CSI components also need the privileged/FUSE access described by the chart.
Do not install a second database operator or gateway if the cluster already has one.

## 6. Edit values.yaml

Open the generated `values.yaml` in a text editor.

Change these entries:

1. `global.domain`: your domain, such as `example.com`.
2. `global.forkRegistry`: the same registry prefix used in step 3.
3. `global.bundled.traefik`: leave `true` for a blank cluster, or use your existing gateway.
4. `global.bundled.cloudnativePG`: leave `true` for a blank cluster, or use your existing operator.
5. TLS: `secrets.generateTls: true` makes a test CA and certificate. For production, set it to
   `false` and provide your certificate, private key and CA in the adjacent TLS settings.

Keep `global.registry: ""` if the common images pull from their public repositories.
Leave DATAFLOW disabled unless you built its image.
The default setup installs PostgreSQL through CloudNativePG. It does not require a custom
PostgreSQL image from this project.

### Private registry login for Kubernetes

Create the namespace before adding its pull secret:

```bash
kubectl create namespace coder-fork
kubectl -n coder-fork create secret generic registry-pull \
  --from-file=.dockerconfigjson="$HOME/.docker/config.json" \
  --type=kubernetes.io/dockerconfigjson
```

This uses the Docker login file from step 2. If your login uses an external credential helper,
create a Kubernetes registry secret through your normal secret manager instead.
Then set:

```yaml
global:
  imagePullSecrets:
    - name: registry-pull
```

Edit the existing `global` section. Do not add a second `global` section.
The release namespace must be able to pull every image; verify any separate workspace
namespace also has the pull credentials required by your registry.

## 7. Install

Run from the generated output folder:

```bash
helm upgrade --install coder-fork ./coder-airgapped-1.47.2.tgz \
  --namespace coder-fork --create-namespace \
  --values values.yaml --timeout 20m
```

This is the one Helm install for the platform. The first startup can take several minutes.

Check it:

```bash
kubectl -n coder-fork get pods
kubectl -n coder-fork get jobs
kubectl -n coder-fork get pvc
kubectl -n coder-fork get svc
```

Wait for long-running pods to become `Running` and ready. Completed setup Jobs are normal.
Persistent volume claims should be `Bound`.

## 8. Point your domain at the gateway

Find the external address of the gateway service in `kubectl get svc`.
Create DNS records for `coder.YOUR-DOMAIN` and the workspace wildcard `*.YOUR-DOMAIN`
pointing to that gateway. Your DNS administrator can create the appropriate A or CNAME records.

If the gateway has no external address, resolve that before opening Coder.
For EKS, check your load balancer controller, subnet tags and security groups.

If you used generated test TLS, export its CA:

```bash
kubectl -n coder-fork get secret tls-ca \
  -o jsonpath='{.data.ca\.crt}' | base64 -d > coder-ca.crt
```

Trust this CA through your operating system/browser certificate settings.
Do not bypass a certificate warning. Production certificates must match your chosen domain.

## 9. Sign in

Open `https://coder.YOUR-DOMAIN`.
The default first username is `admin`. If you left its password blank, read the generated one:

```bash
kubectl -n coder-fork get secret coder-init-auth \
  -o jsonpath='{.data.password}' | base64 -d
printf '\n'
```

Sign in and change the initial password.
Create one workspace with the DEFAULT template. Wait for it to start, then open Terminal.
This proves the server, provisioning, workspace image and agent are working together.

## 10. Connect Keycloak when ready

Start with password sign-in working so an OIDC mistake does not lock you out.
In your existing Keycloak, create a confidential OIDC client named `coder`.
Its redirect URI is `https://coder.YOUR-DOMAIN/api/v2/users/oidc/callback`.

In the existing sections of `values.yaml`, set:

```yaml
global:
  oidc:
    issuerUrl: https://keycloak.YOUR-DOMAIN/realms/YOUR-REALM
    clientId: coder
  disablePasswordAuth: "false"
secrets:
  oidcClient:
    create: true
    clientSecret: YOUR-CLIENT-SECRET
```

If Keycloak uses a private CA, fill in `secrets.oidcCa` too.
Protect this values file because it now contains a secret. Use your secret manager for production.
Run the Helm command from step 7 again. Test OIDC in another browser session before disabling
password sign-in. If Argo CD manages the installation, make these settings in its Git source
instead of applying a conflicting manual Helm release. Keep Crossplane responsible for its
infrastructure resources and Argo CD responsible for this application's desired settings.

## If something fails

Run:

```bash
kubectl -n coder-fork get pods
kubectl -n coder-fork get events --sort-by=.lastTimestamp
kubectl -n coder-fork describe pod POD-NAME
kubectl -n coder-fork logs POD-NAME --all-containers --tail=100
```

Replace `POD-NAME` with the failing pod's name.

- `ImagePullBackOff`: check the image exists, its tag, registry access and pull secret.
- `Pending` with unbound volumes: fix storage before retrying.
- A failed setup Job: read that Job's pod logs.
- TLS error: check DNS, hostname, certificate and CA trust.
- DEFAULT starts but DATAFLOW does not: keep DATAFLOW disabled until its image is present.

After fixing the cause, run the same Helm command again. Do not delete the database or PVCs
as a troubleshooting step.
