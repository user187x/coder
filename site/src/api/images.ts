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
	/** Programs the image adds over its base, and apt packages asked for (addons.json; 0 without one). */
	addons?: number;
	addonPackages?: number;
};

/**
 * What an image adds over its base (/usr/share/coder-workspace/addons.json,
 * written by the workspace image's build): each program with the version it
 * reports, the apt packages asked for, and marimo's Python packages.
 */
export type ImageAddons = {
	base: string | null;
	builtAt: string | null;
	software: {
		name: string;
		what: string | null;
		group: string | null;
		version: string | null;
	}[];
	packages: {
		added: { name: string; version: string }[];
		dependencies: number;
		upgraded: number;
		installed: number;
	};
	python: {
		environment: string | null;
		packages: { name: string; version: string }[];
	};
};

/** The workspace template's own image, listed (read-only) for its report and add-ons. */
export type TrackedImage = {
	/** As the template names it (what workspaces run). */
	image: string;
	/** The builder's copy, which is scanned. */
	ref: string;
	/** The template's name. */
	template: string;
};

export type CheckStatus = "pass" | "warn" | "fail" | "info";

/** What a report records about the security data that graded it. */
export type ReportData = {
	source: "bundled" | "uploaded";
	trivyVersion: string | null;
	vulnerabilityDbUpdatedAt: string | null;
	javaDbUpdatedAt: string | null;
	fipsRules: { version: string | null; published: string | null };
};

export type DataLevel = "current" | "aging" | "stale" | "unknown";

type DatedDb = {
	updatedAt: string | null;
	nextUpdate: string | null;
	downloadedAt: string | null;
	ageDays: number | null;
	level: DataLevel;
};

/** Images > Settings > Security data: what grades images now, how old it is. */
export type SecurityDataStatus = {
	source: {
		kind: "bundled" | "uploaded";
		id?: string;
		installedAt?: string;
		installedBy?: string;
		createdAt?: string;
		file?: string;
		sha256?: string;
		size?: number;
	};
	trivyVersion: string | null;
	vulnerabilityDb: DatedDb | null;
	javaDb: DatedDb | null;
	fipsRules: {
		version: string | null;
		published: string | null;
		standard: string | null;
		summary: string | null;
		sources: string[];
		ageDays: number | null;
		level: DataLevel;
	};
	level: DataLevel;
	history: {
		id: string;
		installedAt: string;
		installedBy: string;
		dbUpdatedAt: string | null;
		active: boolean;
	}[];
	thresholds: { agingDays: number; staleDays: number };
	canChange?: boolean;
	rescan?: {
		running: boolean;
		queued: string[];
		done: string[];
		failed: string[];
		startedAt: string | null;
	};
};

export type ImageVulnerability = {
	id: string;
	pkg: string;
	installed: string;
	fixed: string;
	severity: Severity;
	title: string;
	target: string;
};

export type ImageReport = {
	ref: string;
	scannedAt: string;
	error?: string;
	os?: string | null;
	grade: string;
	dbUpdatedAt: string | null;
	/** The security data that graded it (reports from before 1.27 have only dbUpdatedAt). */
	data?: ReportData;
	vulnerabilities: {
		counts: Partial<Record<Severity, number>>;
		total: number;
		fixable: number;
		scanned?: boolean;
		javaScanned?: boolean;
		note?: string;
		top: ImageVulnerability[];
		/**
		 * Findings that cannot apply to a container image, set apart (not in the counts or the grade), each rule
		 * with its reason: kernel-headers (the kernel's header package; a container runs its node's kernel),
		 * mozilla-firefox (Ubuntu's snap-package advisories, at least two years old, on Mozilla's own Firefox).
		 */
		notApplicable?: {
			rule: string;
			reason: string;
			total: number;
			counts: Partial<Record<Severity, number>>;
			packages: string[];
			items: ImageVulnerability[];
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
		rules?: {
			version: string | null;
			published: string | null;
			standard: string | null;
		};
		checks: {
			id: string;
			title: string;
			status: CheckStatus;
			detail: string;
		}[];
	};
	/** What the image adds over its base, when it says (addons.json). */
	addons?: ImageAddons | null;
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
	/** Set for the workspace template's own image (read-only here). */
	tracked?: TrackedImage | null;
	/** Set for an image brought in (copied from a registry, or an uploaded archive) rather than built. */
	imported?: ImportedImage | null;
};

/** Where an imported image came from, and its last import. */
export type ImportedImage = {
	source: "registry" | "upload";
	/** The registry reference, or the archive's file name. */
	from: string;
	at: string;
	by: string;
};

/** An image workspaces run now, or a template runs: which, and its entry here if it has one. */
export type ImageInUse = {
	image: string;
	workspaces: string[];
	templates: string[];
	entry: string | null;
};

/** An ISO of the library: in every workspace at ~/isos, read-only. */
export type IsoFile = { name: string; size: number; modified: string };

/** An ISO the service downloads into the library. */
export type IsoImport = {
	name: string;
	url: string;
	bytes: number;
	total: number | null;
	error: string | null;
	done: boolean;
	by: string;
	startedAt: number;
};

export type IsoLibrary = {
	enabled: boolean;
	canEdit: boolean;
	mountPath: string;
	maxBytes: number;
	files: IsoFile[];
	usedBytes: number;
	imports: IsoImport[];
};

const ISOS = `${base}/api/isos`;

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
			/** The templates whose workspaces can run on an image here (their Workspace image parameter). */
			templates?: { name: string; displayName: string }[];
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
	securityData: () => get<SecurityDataStatus>(`${IMAGES}/security-data`),
	uploadSecurityData: (file: File, onProgress?: (fraction: number) => void) =>
		upload<SecurityDataStatus>(
			`${IMAGES}/security-data?name=${enc(file.name)}`,
			file,
			onProgress,
		),
	activateSecurityData: (id: string | null) =>
		post<SecurityDataStatus>(`${IMAGES}/security-data/activate`, { id }),
	rescanAll: () => post<{ images: string[] }>(`${IMAGES}/rescan-all`, {}),
	rescan: (id: string) =>
		post<{ build: number }>(`${IMAGES}/${enc(id)}/rescan`, {}),
	saveSettings: (change: { aptSources?: string; s3?: ImagesSettings["s3"] }) =>
		post<{ ok: true; s3: ImagesSettings["s3"] }>(`${IMAGES}/settings`, change),
	/** An image copied from a registry: a new image, or a new version of an imported one. */
	importFromRegistry: (body: {
		name: string;
		description: string;
		ref: string;
		username?: string;
		password?: string;
	}) => post<{ image: string; build: number }>(`${IMAGES}/import`, body),
	/** An image from a `docker save` or OCI archive (.tar, .tar.gz). */
	importArchive: (
		name: string,
		description: string,
		file: File,
		onProgress?: (fraction: number) => void,
	) =>
		upload<{ image: string; build: number }>(
			`${IMAGES}/import-upload?name=${enc(name)}&description=${enc(description)}&file=${enc(file.name)}`,
			file,
			onProgress,
		),
	inUse: () => get<{ images: ImageInUse[] }>(`${IMAGES}/in-use`),
	isos: () => get<IsoLibrary>(ISOS),
	uploadIso: (file: File, onProgress?: (fraction: number) => void) =>
		upload<{ ok: true; name: string; size: number }>(
			`${ISOS}/upload?name=${enc(file.name)}`,
			file,
			onProgress,
		),
	importIso: (url: string, name: string) =>
		post<{ ok: true; name: string }>(`${ISOS}/import`, { url, name }),
	deleteIso: (name: string) => post<{ ok: true }>(`${ISOS}/delete`, { name }),
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
