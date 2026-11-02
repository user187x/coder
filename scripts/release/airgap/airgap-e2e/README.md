# Air-gapped end-to-end test of DEPLOY.md

`e2e.sh` resets everything and runs DEPLOY.md steps 1–7 from a tarball (step 3 in a docker-in-docker with no images,
so every image must come from the bundle's `images/`); `step8.py` (run as a pod) is step 8, as a
browser inside the network. Run for every release (results: ../../../helm-chart/README.md › End-to-end air-gap test).

One-time setup (online), in this directory (it becomes the work dir: kubeconfig, pki/, logs):

```bash
kind create cluster --config kind.yaml --kubeconfig ./kubeconfig
docker run -d --name airgap-registry -p 127.0.0.1:5001:5000 registry:2 && docker network connect kind airgap-registry
docker exec airgap-test-control-plane sh -c 'for h in localhost:5001 airgap-registry:5000; do mkdir -p /etc/containerd/certs.d/$h; printf "[host.\"http://airgap-registry:5000\"]\n" > /etc/containerd/certs.d/$h/hosts.toml; done'
export KUBECONFIG=$PWD/kubeconfig
# test CA (with keyUsage!) + *.airgap.test cert in pki/; Secret traefik/airgap-tls from it
kubectl apply --server-side -f ../../../helm-chart/prereqs/gateway-api-v1.6.0-standard-install.yaml
helm install traefik ../../../helm-chart/prereqs/traefik-41.4.0.tgz -n traefik --create-namespace \
  -f <(sed 's/grey-marshall-tls/airgap-tls/' ../../../helm-chart/prereqs/traefik-41.4.0.reference-values.yaml) --set service.type=ClusterIP
helm install argocd argo-cd --repo https://argoproj.github.io/argo-helm --version 10.8.1 -n argocd --create-namespace --set dex.enabled=false
kubectl apply -f keycloak.yaml   # client "coder" + user tester: ./keycloak-setup.sh (e2e.sh re-runs it)
# CoreDNS: rewrite name regex ^(.+)\.airgap\.test\.?$ traefik.traefik.svc.cluster.local answer auto
# Service default/airgap-registry (+ EndpointSlice to the registry container's IP) so Argo CD can reach the charts
# Air gap: ./airgap-on.sh (iptables REJECT of all egress except 127/8, 10/8, 172.16/12, 192.168/16; e2e.sh re-applies it)
```

Then: `./e2e.sh /path/to/coder-airgapped-<version>.tar.gz`, and run `step8.py` in a pod (image
`localhost:5001/library/python:3.13-alpine`, ConfigMap with step8.py at /t, the test CA at /ca/ca.crt).
Clean up: `kind delete cluster --name airgap-test; docker rm -f airgap-registry`.

## A real Harbor with a private CA: `harbor-setup.sh`

After `./setup.sh`: `./harbor-setup.sh` adds Harbor 2.15 (the official chart) at `https://harbor.airgap.test`, behind the
Gateway with the test CA's certificate (Traefik on hostPort 443, so the same address works from the node, the pods
and outside), makes the node trust the CA (containerd `certs.d`), creates the system robot `robot$argocd` (pull
rights; `harbor/argocd.env`), and starts the installing machine `harbor-installer`: a docker-in-docker with no images
and logins of its own, a copy of the bundle at `/bundle` (without its `.deploy`), `pki/` at `/pki`. Then run the
installers in it as a customer would, e.g.:

```bash
docker exec --env-file harbor/push.env -e HARBOR_USER=admin -e HARBOR_CA=/pki/ca.crt -e DOCKERHUB_LOGIN=n \
  -w /bundle harbor-installer ./make --push-images https://harbor.airgap.test/coder-test --yes
docker exec --env-file harbor/push.env --env-file harbor/argocd.env -e HARBOR_USER=admin -e HARBOR_CA=/pki/ca.crt \
  -e DOCKERHUB_LOGIN=n -e DOMAIN=airgap.test -e CERTS=existing -e TLS_CRT=/pki/wildcard.crt -e TLS_KEY=/pki/wildcard.key \
  -e CA_BUNDLE=/pki/ca.crt -e OIDC_ISSUER=https://keycloak.airgap.test/realms/master \
  -e OIDC_SECRET_FILE=/pki/oidc-client-secret.txt -e OIDC_CA=/pki/ca.crt -e STORAGE_CLASS=standard \
  -w /bundle harbor-installer ./make --argocd https://harbor.airgap.test/coder-test --yes
```

(`--env-file` keeps `robot$argocd` as it is; a shell would expand `$argocd`.) Clean up: `docker rm -f -v harbor-installer`,
then the cluster as above.
