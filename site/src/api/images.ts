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
	/** Findings of each severity Fix image can fix (OS and Python packages with a fixed version). */
	fixableCounts?: Partial<Record<Severity, number>>;
	/** How many findings Fix image can fix (fixable: every one with a fixed version). */
	fixableHere?: number;
	/** The grade with every finding Fix image can fix fixed (null: not scanned). */
	projectedGrade?: string | null;
	/** Graded D or F, and fixing what has a fix would raise it: the list's Needs fixing and Fix CVEs. */
	needsFixing?: boolean;
};

/**
 * What an image adds over its base (/usr/share/coder-workspace/addons.json,
 * written by the workspace image's build): each program with the version it
 * reports, the apt packages asked for, and the packages of a Python environment it ships, if any.
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
	/** How it was found (scans since 2.0.0-platform.83): "os-pkgs" or "lang-pkgs". */
	class?: string;
	/** The distribution (ubuntu) or the language's package type (python-pkg, node-pkg, gobinary, jar). */
	type?: string;
	/** Where a language's package is (scans since 2.0.0-platform.83): its environment. */
	path?: string;
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
	/** Set for an image scanned as it is (in a registry, or on a node that holds it): read-only, only its report. */
	scanned?: { image: string } | null;
	/** Its pit stop in progress (the list's "In the pit" badge), else null. */
	pit?: PitBadge | null;
};

/** An image in the pit now: its lap of the laps allowed, the step, and where the patched image goes. */
export type PitBadge = {
	build: number;
	lap: number;
	laps: number;
	stage: string | null;
	target: string;
	source: string;
};

/** Copa's library updates: how far a version may move (1.2.3 to 1.2.x, 1.x or anything newer). */
export type CopaLevel = "patch" | "minor" | "major";

/** A pit stop's lap: Copa's patch at its library level, then the rescan. */
export type PitLap = {
	lap: number;
	level: CopaLevel | null;
	status: "patching" | "done" | "failed";
	startedAt: string;
	finishedAt?: string;
	summary?: { total: number; patched: number; skipped: number } | null;
	vex?: { fixed: string[]; statements: number } | null;
	grade?: string;
	counts?: Partial<Record<Severity, number>>;
	/** Of the findings worked on, how many the rescan still has. */
	remaining?: number;
	error?: string;
};

/**
 * A pit stop (Fix image › Pit stop): Copa patches the image in place, rescans it, patches again while it can do
 * better (laps), and puts it back on the track as the next version of the image (or of its patched copy).
 */
export type PitStop = {
	build: number;
	source: string;
	sourceEntry: string;
	target: string;
	version: number;
	libraries: boolean;
	level: CopaLevel;
	maxLevel: CopaLevel;
	laps: number;
	lap: number;
	pairs: [string, string][];
	chosen: number;
	before: { grade?: string; counts?: Partial<Record<Severity, number>> };
	after?: { grade?: string; counts?: Partial<Record<Severity, number>> };
	history?: PitLap[];
	/** The patched image, where workspaces pull it. */
	ref?: string;
	fixed?: number;
	outcome: "running" | "on-track" | "failed" | "cancelled";
	by: string;
	status: BuildSummary["status"];
	stage: string | null;
	progress: number;
	message: string | null;
	error: string | null;
	startedAt: string;
	finishedAt: string | null;
	steps: BuildStep[];
	log: string;
};

export type PitStopOptions = {
	/** The findings chosen; none: every one with a fixed version. */
	keys?: { id: string; pkg: string }[];
	/** Python and Node.js packages too (Copa's experimental library patching). */
	libraries: boolean;
	level: CopaLevel;
	maxLevel: CopaLevel;
	laps: number;
};

/** Where an imported image came from, and its last import. */
export type ImportedImage = {
	/** copa: a patched copy of an image only scanned here (a pit stop's), entry the image it was patched from. */
	source: "registry" | "upload" | "copa";
	entry?: string;
	/** The registry reference, or the archive's file name. */
	from: string;
	at: string;
	by: string;
};

/** An image a node of the cluster holds (preloaded, loaded or pulled): its names there, size, nodes, entry here. */
export type ImageOnNode = {
	image: string;
	/** Its other names on the nodes (digests). */
	names: string[];
	sizeBytes: number;
	nodes: string[];
	/** A workspace runs it now. */
	running: boolean;
	entry: string | null;
};

/**
 * What an image of ours (the Coder fork's: ghcr.io/user187x/) holds, as built: recorded by
 * development/tools/image-contents.py from the image itself, shipped with the platform service.
 */
export type ImageContents = {
	ref: string;
	repository: string;
	/** What images.txt pins. */
	digest: string;
	imageId: string;
	/** images.txt's section, and its description. */
	section: string;
	description: string;
	/** Where it is made in the repository. */
	source: { folder: string; build: string };
	created: string | null;
	size: number | null;
	platform: string;
	config: {
		user: string;
		entrypoint: string[] | null;
		cmd: string[] | null;
		workdir: string;
		ports: string[];
		env: string[];
		labels: Record<string, string>;
	};
	layers: number;
	/** Every build step, oldest first, with what it added. */
	steps: { step: string; size: string; comment: string }[];
	/** The programs we put in it, each with the version it reports itself. */
	programs: { name: string; what: string; version: string | null }[];
	/** The workspace images' add-ons (addons.json): any part may be missing (an image without a Python environment). */
	addons: {
		base?: string | null;
		builtAt?: string | null;
		software?: ImageAddons["software"];
		packages?: Partial<ImageAddons["packages"]>;
		python?: Partial<ImageAddons["python"]>;
	} | null;
	packages?: {
		os: {
			manager: "dpkg" | "apk";
			count: number;
			items: [name: string, version: string][];
		} | null;
		python: {
			env: string;
			count: number;
			items: [name: string, version: string][];
		}[];
	};
};

export type ImageContentsCatalog = { images: Record<string, ImageContents> };

/** An image workspaces run now, or a template runs: which, and its entry here if it has one. */
export type ImageInUse = {
	image: string;
	workspaces: string[];
	templates: string[];
	entry: string | null;
};

/**
 * The shared libraries: files every workspace (or every AI workspace) has read-only - the ISO library's disk images
 * at ~/isos, the model library's GGUF language models at ~/models.
 */
export type LibraryKind = "isos" | "models";

/** A file of a library (a model's: its security scan too). */
export type LibraryFile = {
	name: string;
	size: number;
	modified: string;
	scan?: ModelScan;
};

/** A file the service downloads into a library. */
export type LibraryImport = {
	name: string;
	url: string;
	bytes: number;
	total: number | null;
	error: string | null;
	done: boolean;
	by: string;
	startedAt: number;
};

export type Library = {
	enabled: boolean;
	canEdit: boolean;
	mountPath: string;
	maxBytes: number;
	files: LibraryFile[];
	usedBytes: number;
	imports: LibraryImport[];
	/** The model library: the models waiting for their security scan (or an admin) before workspaces have them. */
	held?: HeldModel[];
	/** The model scanner (a plug-in): hooked up, or not (and then whether admins hid its section). */
	scanner?: {
		enabled: boolean;
		releaseGrade?: string;
		garak?: string | null;
		hidden?: boolean;
	};
};

const LIBRARY = (kind: LibraryKind) => `${base}/api/${kind}`;
/** A library's react-query key (the Images view's libraries and the model scanner refresh it). */
export const libraryKey = (kind: LibraryKind) =>
	["platform", "library", kind] as const;
const MODELS = `${base}/api/models`;

/**
 * The model library's security gate (modelscan.py): every model added is scanned with garak, NVIDIA's LLM
 * vulnerability scanner, before it is released into the library; its report is graded like an image's.
 */
export type ModelScanStatus =
	| "queued"
	| "starting"
	| "fetching"
	| "running"
	| "done"
	| "failed"
	| "cancelled"
	| "none";

export type ModelSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "PASS";

export type ModelScanSummary = {
	scanId: string;
	grade: string;
	counts: Record<ModelSeverity, number>;
	/** garak's own tier-based security aggregate, 1.0 (worst) to 5.0. */
	tbsa: number | null;
	checks: { pass: number; warn: number; fail: number };
	profile: string | null;
	garak: string | null;
	scannedAt: number;
	error: string | null;
	probes: number | null;
};

export type ModelScanProgress = {
	phase: "starting" | "fetching" | "checking" | "loading" | "probing";
	bytes?: number;
	total?: number;
	probesTotal?: number;
	probesDone?: number;
	probe?: string | null;
	prompts?: number;
};

export type ModelScan = {
	status: ModelScanStatus;
	profile?: string | null;
	progress?: ModelScanProgress | null;
	startedAt?: number | null;
	error?: string | null;
	last: ModelScanSummary | null;
	position?: number | null;
	releasedBy?: { by: string; at: number; override: boolean } | null;
	heldBy?: { by: string; at: number } | null;
	/** Why a held model stays held. */
	reason?: string | null;
	/** A released model with a newer version held: this is its earlier report. */
	newerHeld?: boolean;
};

export type HeldModel = LibraryFile & {
	scan: ModelScan;
	alsoReleased: boolean;
};

export type ModelScannerProfile = {
	id: string;
	title: string;
	spec?: string;
	cap?: number;
	generations?: number;
	hours: number;
	description?: string;
	probes?: number;
};

export type ModelScanner = {
	/** A scanner is hooked up (a plug-in: none ships with the platform). */
	enabled: boolean;
	canEdit: boolean;
	/** Admins hid the section while no scanner is hooked up. */
	hidden: boolean;
	image: string;
	defaultImage: string;
	custom: boolean;
	candidate: string | null;
	candidateError: string | null;
	checking: boolean;
	error: string | null;
	garak: string | null;
	llamaCpp: { version?: string; build?: string; commit?: string };
	python: string | null;
	builtAt: string | null;
	calibration: { date: string; models: number } | null;
	detectorModels: string[];
	datasets: string[];
	probes: { active: number; total: number };
	profiles: ModelScannerProfile[];
	profile: string;
	releaseGrade: string;
	latest: {
		version?: string | null;
		checkedAt?: number;
		error?: string | null;
	};
	queue: string[];
	running: {
		name: string;
		status: ModelScanStatus;
		progress: ModelScanProgress | null;
		profile: string;
		startedAt: number;
	}[];
};

export type ModelFinding = {
	probe: string;
	group: string;
	detector: string;
	defcon: number | null;
	severity: ModelSeverity;
	passRate: number;
	passed: number;
	failed: number;
	total: number;
	relative: number | null;
	relativeComment: string | null;
	absoluteComment: string | null;
	tier: number | null;
	owasp: string[];
	description: string;
	goal: string;
	detectorDescription: string;
	examples: {
		prompt: string;
		output: string;
		score: number | null;
		triggers: string[] | null;
	}[];
};

export type ModelCheck = {
	id: string;
	title: string;
	status: "pass" | "warn" | "fail" | "info";
	detail: string;
};

export type ModelFileInfo = {
	sha256?: string;
	size?: number;
	ggufVersion?: number;
	tensors?: number;
	parameters?: number;
	architecture?: string;
	name?: string;
	sizeLabel?: string;
	license?: string;
	quantizedBy?: string;
	fileType?: string;
	contextLength?: number | null;
	layers?: number | null;
	tokenizer?: string;
	chatTemplates?: Record<string, { chars: number; sha256: string }>;
};

export type ModelReport = {
	name: string;
	stage: "held" | "released";
	scanId: string;
	profile: string;
	profileTitle: string;
	image: string;
	garak: string;
	llamaCpp: { version?: string; build?: string };
	scannedAt: number;
	startedAt: number | null;
	error: string | null;
	grade: string;
	counts: Record<ModelSeverity, number>;
	tbsa: { score: number; hash?: string; pairs?: number } | null;
	calibration: { date: string; models: number } | null;
	runId: string | null;
	findings: ModelFinding[];
	groups: {
		group: string;
		score: number | null;
		defcon: number | null;
		link: string;
	}[];
	owasp: {
		id: string;
		title: string;
		pairs: number;
		counts: Record<string, number>;
	}[];
	checks: ModelCheck[];
	file: ModelFileInfo;
	server: {
		context?: number;
		parallel?: number;
		threads?: number;
		jinja?: boolean;
	};
	prompts: number | null;
	probes: number;
	releasedBy: { by: string; at: number; override: boolean } | null;
	heldBy: { by: string; at: number } | null;
	holdReason: string | null;
	releaseGrade: string;
};

export type ModelRawFile = "report.jsonl" | "hitlog.jsonl" | "report.html";

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
	/** Its latest pit stop (as the image patched, or as the patched copy), else null. */
	pit?: PitStop | null;
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
	/** A pit stop: Copa patches the image in place (the patched image goes to the target entry). */
	pitStop: (id: string, options: PitStopOptions) =>
		post<{ target: string; build: number; pit: PitStop }>(
			`${IMAGES}/${enc(id)}/pit`,
			options,
		),
	pit: (id: string) => get<{ pit: PitStop | null }>(`${IMAGES}/${enc(id)}/pit`),
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
	onNodes: () => get<{ images: ImageOnNode[] }>(`${IMAGES}/on-nodes`),
	/** What each image of ours holds (the Coder fork's images, as built). */
	contents: () => get<ImageContentsCatalog>(`${IMAGES}/contents`),
	/** Any image scanned as it is (from the cluster's registry, else from a node that holds it): its entry and the scan. */
	scan: (image: string) =>
		post<{ id: string; build: number }>(`${IMAGES}/scan`, { image }),
	library: (kind: LibraryKind) => get<Library>(LIBRARY(kind)),
	uploadToLibrary: (
		kind: LibraryKind,
		file: File,
		onProgress?: (fraction: number) => void,
	) =>
		upload<{ ok: true; name: string; size: number }>(
			`${LIBRARY(kind)}/upload?name=${enc(file.name)}`,
			file,
			onProgress,
		),
	importToLibrary: (kind: LibraryKind, url: string, name: string) =>
		post<{ ok: true; name: string }>(`${LIBRARY(kind)}/import`, { url, name }),
	/** held: the model waiting in the hold (not the library's file of the name). */
	deleteFromLibrary: (kind: LibraryKind, name: string, held = false) =>
		post<{ ok: true }>(`${LIBRARY(kind)}/delete`, { name, held }),
	modelScanner: () => get<ModelScanner>(`${MODELS}/scanner`),
	saveModelScanner: (body: {
		profile?: string;
		releaseGrade?: string;
		image?: string;
		hidden?: boolean;
	}) => post<ModelScanner>(`${MODELS}/scanner`, body),
	rescanAllModels: () =>
		post<{ ok: true; queued: number }>(`${MODELS}/scanner/rescan-all`, {}),
	scanModel: (name: string, profile?: string) =>
		post<{ ok: true }>(`${MODELS}/scan`, { name, profile }),
	cancelModelScan: (name: string) =>
		post<{ ok: true }>(`${MODELS}/cancel`, { name }),
	releaseModel: (name: string) =>
		post<{ ok: true }>(`${MODELS}/release`, { name }),
	holdModel: (name: string) => post<{ ok: true }>(`${MODELS}/hold`, { name }),
	modelReport: (name: string) =>
		get<ModelReport>(`${MODELS}/report?name=${enc(name)}`),
	modelReportFileUrl: (name: string, file: ModelRawFile) =>
		`${MODELS}/report/raw?name=${enc(name)}&file=${enc(file)}`,
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
