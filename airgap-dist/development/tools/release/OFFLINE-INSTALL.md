# Install without internet

Everything stays in ONE folder. Do not unpack the image files. Do not join the parts yourself.
You do not need to compile anything for this option.

The folder contains the modified Coder server with its embedded dashboard, the graphics service,
DEFAULT and optional DATAFLOW workspace images, PostgreSQL, the database operator, gateway,
Cloud Drive, registry, BuildKit, metrics and CSI images. A Keycloak image is included as a spare
for your separate Keycloak installation. The Coder chart does not install Keycloak.

## 1. Take the files into the enclave

Download the release files into one folder named `coder-offline`.
Keep every image file, including both DATAFLOW `.part-00` and `.part-01` files.
You may skip `coder-build-kit-1.1.3.tar.gz`; that is the source-build alternative.

Copy the WHOLE folder into the enclave. Do not rearrange it.
Open a terminal in that folder.

Your enclave machine needs Docker, Bash, gzip and the usual Linux coreutils.
The deployment machine also needs kubectl and Helm, with access to your Kubernetes cluster.

## 2. Put the images in your enclave registry

Replace `registry.example.com` with your registry's host.
Replace `registry.example.com/coder` with the host and folder you want to use.
Do not include `https://`.

```bash
chmod +x load-and-push.sh
docker login registry.example.com
./load-and-push.sh registry.example.com/coder
```

This ONE script checks the files, joins any split files automatically, loads the images,
and pushes all of them into your registry. It does not contact a public image registry.
Wait until it says all images were pushed. If it fails, fix the error and run it again.

For AWS ECR, log in using your normal AWS/ECR credentials, then use
`ECR=1 ./load-and-push.sh YOUR-ECR-REGISTRY/coder`.
This also creates missing repositories. The ECR API and registry must be reachable from
inside the enclave, through your approved network or VPC endpoints.

You can first check the files without loading/pushing anything:

```bash
./load-and-push.sh registry.example.com/coder --dry-run
```

## 3. Edit ONE settings file

```bash
cp offline-values.example.yaml values.yaml
```

Open `values.yaml` in a text editor. Change:

1. `global.domain`: your domain, such as `example.com`.
2. `global.registry`: exactly the registry prefix used in step 2.

Leave `global.forkRegistry` blank. With `global.registry` set, ALL images come from your
registry, including PostgreSQL and the other common dependencies.
Leave DATAFLOW disabled unless you want it. Its files are included just in case.
To enable it, set `coder-workspace.dataflowTemplate.enabled: true`.

For a blank cluster, leave the bundled gateway and database operator enabled.
If those already exist, use the existing ones instead of installing duplicates.
Your cluster needs ready Linux/amd64 nodes, working persistent storage and a default storage
class. On EKS, configure the EBS CSI driver and IAM permissions first.

If the registry is private, create a pull secret in the install namespace and add it to
`global.imagePullSecrets`. START-HERE.md step 6 shows the exact commands.

## 4. Install ONE chart

Check the target cluster before installing:

```bash
kubectl config current-context
kubectl get nodes
kubectl get storageclass
```

Then run:

```bash
helm upgrade --install coder-fork ./coder-airgapped-1.47.2.tgz \
  --namespace coder-fork --create-namespace \
  --values values.yaml --timeout 20m
```

Wait for startup, then check:

```bash
kubectl -n coder-fork get pods
kubectl -n coder-fork get pvc
kubectl -n coder-fork get svc
```

Long-running pods should be ready. Storage claims should say `Bound`.
Completed setup Jobs are normal.

## 5. Open Coder

Point `coder.YOUR-DOMAIN` and the workspace wildcard `*.YOUR-DOMAIN` at the gateway service's
external address. Use matching TLS certificates. With generated test TLS, trust its CA in
your browser/operating system. START-HERE.md step 8 shows how to export the CA.
Do not bypass certificate warnings.

Open `https://coder.YOUR-DOMAIN`.
The first username is `admin`. If you left the password blank, read the generated password:

```bash
kubectl -n coder-fork get secret coder-init-auth \
  -o jsonpath='{.data.password}' | base64 -d
printf '\n'
```

Sign in, change the password, create a DEFAULT workspace and open its Terminal.
You are deployed. Configure your existing Keycloak afterward using START-HERE.md step 10.
The included Keycloak image is at `YOUR-REGISTRY/keycloak/keycloak:26.7.3` after step 2;
its realm, database, secrets and deployment still belong to your separate Keycloak setup.

## If it does not start

```bash
kubectl -n coder-fork get events --sort-by=.lastTimestamp
kubectl -n coder-fork describe pod POD-NAME
kubectl -n coder-fork logs POD-NAME --all-containers --tail=100
```

Replace `POD-NAME` with the failing pod's name.
`ImagePullBackOff` means check the registry path, tag and pull secret.
An unbound volume means fix storage.
Fix the cause and run the same Helm command again. Do not delete the database or volumes.
