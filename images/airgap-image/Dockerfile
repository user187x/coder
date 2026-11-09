# The fork's Coder for air-gapped clusters: docker.io/mrshll187/coder-platform plus a Terraform provider mirror, so
# template pushes and workspace builds never reach registry.terraform.io (without it `terraform init` fails offline).
# The mirror holds the providers the bundled workspace template needs (template/*.tf, copied in by
# ../tools/build-airgap-image.sh) plus any in extra-providers/*.tf (for your other templates).
# Terraform itself is built here from its source with a current Go (the release binary's Go has fixed CVEs since),
# and the base's Alpine packages are upgraded: the image ships with no fixable CVE.
ARG BASE=docker.io/mrshll187/coder-platform:2.0.0-platform.4
ARG TERRAFORM_VERSION=1.16.6
ARG GO_IMAGE=docker.io/library/golang:1.26.10-alpine

FROM hashicorp/terraform:${TERRAFORM_VERSION} AS providers
COPY template/ /template/
COPY provider-cache/ /cache/
# The previous release's mirror (provider-cache, from build-airgap-image.sh) when the template initializes from it
# alone; otherwise providers download from GitHub's release CDN, which answers 504 for minutes at a time: try a few
# times (mirroring again into the same directory is safe; the checksum below still checks the result).
RUN if [ -d /cache/registry.terraform.io ]; then \
        printf 'provider_installation {\n  filesystem_mirror {\n    path = "/cache"\n  }\n}\n' > /tmp/cache.tfrc; \
        if TF_CLI_CONFIG_FILE=/tmp/cache.tfrc terraform -chdir=/template init -backend=false -input=false; then \
            rm -rf /template/.terraform; cp -a /cache /mirror; echo "providers from the previous release's mirror"; exit 0; \
        fi; \
    fi; \
    for try in 1 2 3 4 5; do \
        terraform -chdir=/template providers mirror -platform=linux_amd64 /mirror && exit 0; \
        echo "provider mirror failed (try $try), retrying in 20s"; sleep 20; \
    done; exit 1
COPY extra-providers/ /extra/
RUN if ls /extra/*.tf >/dev/null 2>&1; then \
        for try in 1 2 3 4 5; do \
            terraform -chdir=/extra providers mirror -platform=linux_amd64 /mirror && exit 0; \
            echo "provider mirror failed (try $try), retrying in 20s"; sleep 20; \
        done; exit 1; \
    fi
# Verify the approved third-party artifact independently of registry signatures.
RUN printf '%s  %s\n' \
    'a347aebd398769c35ed2d3169025a7a11c1937d94efead7a7bee212aabba1c73' \
    '/mirror/registry.terraform.io/alekc/kubectl/terraform-provider-kubectl_2.4.1_linux_amd64.zip' \
    | sha256sum -c -

FROM ${GO_IMAGE} AS terraform
ARG TERRAFORM_VERSION
RUN apk add --no-cache git \
	&& git clone --depth 1 --branch "v${TERRAFORM_VERSION}" https://github.com/hashicorp/terraform /src
WORKDIR /src
# dev=no: a release build ("Terraform v1.16.6", no -dev), as HashiCorp's own
RUN CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath \
		-ldflags "-s -w -X github.com/hashicorp/terraform/version.dev=no" -o /terraform . \
	&& /terraform version | grep -qx "Terraform v${TERRAFORM_VERSION}"

FROM ${BASE}
USER root
RUN apk upgrade --no-cache
COPY --from=terraform /terraform /usr/local/bin/terraform
COPY --from=providers --chown=1000:1000 /mirror /opt/terraform/plugins
COPY terraformrc /opt/terraform/terraformrc
# Coder's provisioner runs terraform with this environment: providers come only from the mirror above.
ENV TF_CLI_CONFIG_FILE=/opt/terraform/terraformrc
USER 1000:1000
