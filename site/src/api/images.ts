/**
 * @file The Images view's API (Templates > Images): workspace images that
 * admins build in the cluster with the platform service's image builder
 * (imagebuilder.py), for workspace templates to use.
 */
import { platformRequest } from "./platform";

const { get, post, upload, base } = platformRequest;
const IMAGES = `${base}/api/images`;
const enc = encodeURIComponent;

export type ImageBase = { kind: "workspace" } | { kind: "image"; id: string };
export type ImageDesktop = "keep" | "xfce" | "gnome" | "none";

export type ImageFile = { name: string; size: number };

export type ImageInstallation = {
	id: string;
	name: string;
	script: string;
	files: ImageFile[];
};

export type ImageDotfile = { path: string; content: string };

export type ImageHardening = {
	purgeDocs?: boolean;
	noSudo?: boolean;
	lockRoot?: boolean;
	noSetuid?: boolean;
	noCompilers?: boolean;
	strictUmask?: boolean;
	noCoreDumps?: boolean;
	sshHardening?: boolean;
	script: string;
};

export type ImageSpec = {
	base: ImageBase;
	packages: string[];
	debs: ImageFile[];
	installations: ImageInstallation[];
	remove: string[];
	hardening: ImageHardening;
	desktop: ImageDesktop;
	fips: boolean;
	config: {
		aliases: string;
		functions: string;
		profile: string;
		dotfiles: ImageDotfile[];
	};
};

export type ImageStatus = "draft" | "building" | "ready" | "failed";
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export type ReportSummary = {
	grade: string | null;
	counts: Partial<Record<Severity, number>>;
	fixable: number;
	secrets: number;
	fips: "ready" | "partial" | "not-ready" | null;
	scannedAt: string | null;
	dbUpdatedAt: string | null;
	checks: { pass: number; warn: number; fail: number };
};

export type CheckStatus = "pass" | "warn" | "fail" | "info";

export type ImageReport = {
	ref: string;
	scannedAt: string;
	error?: string;
	os?: string | null;
	grade: string;
	dbUpdatedAt: string | null;
	vulnerabilities: {
		counts: Partial<Record<Severity, number>>;
		total: number;
		fixable: number;
		scanned?: boolean;
		note?: string;
		top: {
			id: string;
			pkg: string;
			installed: string;
			fixed: string;
			severity: Severity;
			title: string;
			target: string;
		}[];
	};
	secrets: {
		rule: string;
		title: string;
		severity: string;
		target: string;
		line: number;
	}[];
	checks: {
		id: string;
		title: string;
		status: CheckStatus;
		detail: string;
		items: string[];
	}[];
	fips: {
		status: "ready" | "partial" | "not-ready";
		note: string;
		checks: {
			id: string;
			title: string;
			status: CheckStatus;
			detail: string;
		}[];
	};
};

export type ImageS3 = {
	enabled?: boolean;
	status?: "uploading" | "done" | "failed";
	key?: string;
	bytes?: number;
	version?: number;
	bucket?: string;
	error?: string | null;
	startedAt?: string;
	finishedAt?: string;
};

export type ImageListItem = {
	id: string;
	name: string;
	description: string;
	createdBy: string | null;
	createdAt: string;
	updatedBy: string | null;
	updatedAt: string;
	version: number;
	status: ImageStatus;
	ref: string | null;
	digest: string | null;
	size: number | null;
	builtAt: string | null;
	builtBy: string | null;
	pullRef: string | null;
	s3: ImageS3;
	base: ImageBase;
	counts: {
		packages: number;
		debs: number;
		installations: number;
		remove: number;
	};
	desktop: ImageDesktop;
	summary: ReportSummary | null;
};

export type BuildSummary = {
	id: number;
	version: number;
	status:
		| "queued"
		| "building"
		| "pushing"
		| "scanning"
		| "ready"
		| "failed"
		| "cancelled";
	stage: string | null;
	progress: number;
	message: string | null;
	startedAt: string;
	finishedAt: string | null;
	by: string | null;
	error: string | null;
};

export type ImageDetail = ImageListItem & {
	spec: ImageSpec;
	report: ImageReport | null;
	builds: BuildSummary[];
	activeBuild: number | null;
	canEdit: boolean;
};

export type BuildStep = {
	key: string;
	label: string;
	state: "done" | "active" | "pending";
};

export type BuildDetail = BuildSummary & { steps: BuildStep[]; log: string[] };

export type AptResult = {
	available: boolean;
	invalid?: boolean;
	virtual?: boolean;
	providedBy?: string;
	version?: string;
	description?: string;
	section?: string;
};

export type AptIndexStatus = {
	sources: number;
	packages: number;
	loadedAt: string | null;
	errors: string[];
};

export type LintIssue = {
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
	level: "error" | "warning" | "info" | "style";
	code: string;
	message: string;
};

export type ImagesSettings = {
	aptSources: string;
	defaultAptSources: string;
	index: AptIndexStatus;
	s3: {
		endpoint?: string;
		region?: string;
		bucket?: string;
		prefix?: string;
		accessKey?: string;
		secretKey?: string;
		secretSet?: boolean;
		pathStyle?: boolean;
	};
	canChange: boolean;
	hardening: Record<string, string>;
};

export const ImagesAPI = {
	list: () =>
		get<{
			images: ImageListItem[];
			canEdit: boolean;
			pullPrefix: string;
			baseImage: string;
		}>(IMAGES),
	create: (name: string, description: string, base: ImageBase) =>
		post<{ image: ImageDetail }>(IMAGES, { name, description, base }),
	get: (id: string) => get<{ image: ImageDetail }>(`${IMAGES}/${enc(id)}`),
	save: (id: string, change: { spec?: ImageSpec; description?: string }) =>
		post<{ image: ImageDetail }>(`${IMAGES}/${enc(id)}`, change),
	remove: (id: string) => post<{ ok: true }>(`${IMAGES}/${enc(id)}/delete`, {}),
	build: (id: string) =>
		post<{ build: number }>(`${IMAGES}/${enc(id)}/build`, {}),
	buildStatus: (id: string, build: number, logLines = 400) =>
		get<{
			build: BuildDetail;
			image: {
				id: string;
				pullRef: string | null;
				summary: ReportSummary | null;
			};
		}>(`${IMAGES}/${enc(id)}/builds/${build}?log=${logLines}`),
	cancelBuild: (id: string, build: number) =>
		post<{ ok: true }>(`${IMAGES}/${enc(id)}/builds/${build}/cancel`, {}),
	uploadFile: (
		id: string,
		kind: "deb" | "install" | "dotfile",
		file: File,
		install?: string,
		onProgress?: (fraction: number) => void,
	) =>
		upload<{ file: ImageFile & { sha256: string } }>(
			`${IMAGES}/${enc(id)}/files/${kind}/${enc(file.name)}${install ? `?install=${enc(install)}` : ""}`,
			file,
			onProgress,
		),
	deleteFile: (
		id: string,
		kind: "deb" | "install" | "dotfile",
		name: string,
		install?: string,
	) =>
		post<{ ok: true }>(`${IMAGES}/${enc(id)}/files/delete`, {
			kind,
			name,
			install,
		}),
	downloadUrl: (id: string) => `${IMAGES}/${enc(id)}/download`,
	setS3: (id: string, enabled: boolean) =>
		post<{ s3: ImageS3 }>(`${IMAGES}/${enc(id)}/s3`, { enabled }),
	backupNow: (id: string) =>
		post<{ ok: true }>(`${IMAGES}/${enc(id)}/s3/backup`, {}),
	aptCheck: (packages: string[]) =>
		post<{ results: Record<string, AptResult>; index: AptIndexStatus }>(
			`${IMAGES}/apt-check`,
			{ packages },
		),
	aptSearch: (q: string) =>
		get<{
			packages: { name: string; version: string; description: string }[];
			index: AptIndexStatus;
		}>(`${IMAGES}/apt-search?q=${enc(q)}`),
	aptRefresh: () =>
		post<{ index: AptIndexStatus }>(`${IMAGES}/apt-refresh`, {}),
	lint: (script: string) =>
		post<{ available: boolean; issues: LintIssue[]; error?: string }>(
			`${IMAGES}/lint`,
			{ script },
		),
	format: (script: string) =>
		post<{ available: boolean; script?: string; error?: string }>(
			`${IMAGES}/format`,
			{ script },
		),
	dockerfile: (id: string, spec: ImageSpec) =>
		post<{ dockerfile: string; steps: { key: string; label: string }[] }>(
			`${IMAGES}/dockerfile`,
			{ id, spec },
		),
	settings: () => get<ImagesSettings>(`${IMAGES}/settings`),
	saveSettings: (change: { aptSources?: string; s3?: ImagesSettings["s3"] }) =>
		post<{ ok: true; s3: ImagesSettings["s3"] }>(`${IMAGES}/settings`, change),
};

/** The Terraform a workspace template uses to run on the image. */
export const terraformSnippet = (pullRef: string) =>
	`resource "kubernetes_deployment_v1" "main" {
  # ...
  spec {
    template {
      spec {
        container {
          name  = "dev"
          image = "${pullRef}"
          # ...
        }
      }
    }
  }
}`;
