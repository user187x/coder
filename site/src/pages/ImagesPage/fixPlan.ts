import type { ImageDetail, ImageVulnerability, Severity } from "#/api/images";

/**
 * The Fix image page's logic: how each finding gets fixed, the grade the selected fixes would leave, and the script
 * that applies them (one installation step of the image's spec, or of a fixed copy of it).
 */

export type FixGroup = "upgrade" | "rebase" | "addon" | "none";

export type Finding = ImageVulnerability & {
	/** A key of its own: a CVE can hit several packages. */
	key: string;
	group: FixGroup;
	/** apt, pip, base image, npm, go, jar, add-on */
	source: string;
	/** A fix this page can apply (upgrade, rebase). */
	applicable: boolean;
	/** The fixed version to ask for. */
	to: string;
	/** pip: the environment it is in (its pip), for the script. */
	pip?: string;
};

const PY_PATH = /^(.*?)\/?lib\/python[0-9.]+\/(site|dist)-packages\//;

/** The pip that owns a Python package found at this path (its environment's), or the system's. */
export const pipFor = (target: string): string => {
	const m = PY_PATH.exec(target.replace(/^\//, ""));
	const prefix = m?.[1] ?? "";
	return prefix && prefix !== "usr" && prefix !== "usr/local"
		? `/${prefix}/bin/pip`
		: "pip3";
};

const isOsPackage = (v: ImageVulnerability) =>
	v.class ? v.class === "os-pkgs" : / \([^)]+\)$/.test(v.target);

/** Where a language's package is: its own path (newer scans), else the finding's target. */
const where = (v: ImageVulnerability) =>
	(v.path || v.target).replace(/^\//, "");

// trivy groups an image's language packages under one target per language ("Python", "Node.js")
const isPython = (v: ImageVulnerability) =>
	v.type === "python-pkg" ||
	v.type === "pip" ||
	v.target === "Python" ||
	(!v.type && PY_PATH.test(where(v)));

/** Where a finding's package came from, when it is not an OS or Python package. */
const langSource = (v: ImageVulnerability) =>
	LANG_SOURCE[v.type ?? ""] ??
	(v.target === "Node.js"
		? "npm"
		: v.pkg === "stdlib" || /^v\d/.test(v.installed)
			? "go"
			: "add-on");

const LANG_SOURCE: Record<string, string> = {
	"node-pkg": "npm",
	npm: "npm",
	yarn: "npm",
	gobinary: "go",
	jar: "jar",
	pom: "jar",
	"rust-binary": "cargo",
	cargo: "cargo",
};

/** The fixed version to ask for: of several (one per branch), the one on the installed version's branch. */
export const pickFixed = (installed: string, fixed: string): string => {
	const all = fixed
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);
	const branch = installed.split(".").slice(0, 2).join(".");
	return all.find((v) => v.startsWith(`${branch}.`)) ?? all[0] ?? "";
};

/**
 * How each finding gets fixed. OS packages the image installs itself are upgraded (apt); the ones its base brought
 * are the base's (a newer base fixes them for good; an upgrade in this image fixes them now). Python packages are
 * upgraded in their own environment (pip). Other languages' packages are inside a program the image ships (an
 * add-on): a newer release of it fixes them, not a package upgrade. No fixed version: no fix yet.
 */
export const classify = (image: ImageDetail): Finding[] => {
	const report = image.report;
	if (!report) {
		return [];
	}
	const builtHere = !image.imported && !image.scanned && !image.tracked;
	const own = new Set<string>([
		...(builtHere ? image.spec.packages : []),
		...(report.addons?.packages?.added ?? []).map((p) => p.name),
	]);
	const knowsBase = builtHere || Boolean(report.addons?.packages);
	return report.vulnerabilities.top.map((v, i) => {
		const key = `${v.id}:${v.pkg}:${i}`;
		const to = pickFixed(v.installed, v.fixed);
		if (!to) {
			return {
				...v,
				key,
				group: "none" as const,
				source: isOsPackage(v) ? "apt" : isPython(v) ? "pip" : langSource(v),
				applicable: false,
				to,
			};
		}
		if (isOsPackage(v)) {
			const fromBase = knowsBase && !own.has(v.pkg);
			return {
				...v,
				key,
				group: fromBase ? ("rebase" as const) : ("upgrade" as const),
				source: fromBase ? "base image" : "apt",
				applicable: true,
				to,
			};
		}
		if (isPython(v)) {
			return {
				...v,
				key,
				group: "upgrade" as const,
				source: "pip",
				applicable: true,
				to,
				pip: pipFor(where(v)),
			};
		}
		return {
			...v,
			key,
			group: "addon" as const,
			source: langSource(v),
			applicable: false,
			to,
		};
	});
};

const SEVERITIES: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

/**
 * The grade after the selected fixes: imagebuilder.py's grade() on the counts with the selected findings gone (its
 * secrets and checks as they are).
 */
export const gradeAfter = (
	image: ImageDetail,
	fixed: readonly Finding[],
): { grade: string; counts: Record<Severity, number> } => {
	const report = image.report;
	const counts = Object.fromEntries(
		SEVERITIES.map((s) => [
			s,
			Math.max(
				0,
				(report?.vulnerabilities.counts[s] ?? 0) -
					fixed.filter((f) => f.severity === s).length,
			),
		]),
	) as Record<Severity, number>;
	if (!report || report.error) {
		return { grade: "?", counts };
	}
	const fails = report.checks.filter((c) => c.status === "fail").length;
	const warns = report.checks.filter((c) => c.status === "warn").length;
	const secrets = report.secrets.length;
	let grade = "A";
	if (counts.CRITICAL > 0 || secrets || fails) {
		grade = counts.CRITICAL > 5 || secrets || fails > 1 ? "F" : "D";
	} else if (counts.HIGH > 20) {
		grade = "D";
	} else if (counts.HIGH > 0) {
		grade = "C";
	} else if (counts.MEDIUM > 20 || warns > 2) {
		grade = "B";
	}
	return { grade, counts };
};

const shQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

/**
 * The script that applies the selected fixes, as an installation step (run as root, bash -euo pipefail): the apt
 * packages upgraded (to the newest the image's sources have: at least the fixed version), each Python environment's
 * packages raised to at least the fixed version. Its lines are what the Dockerfile diff shows.
 */
export const fixScript = (selected: readonly Finding[]): string[] => {
	const apt = new Map<string, string>();
	const pip = new Map<string, Map<string, string>>();
	for (const f of selected) {
		if (!f.applicable) {
			continue;
		}
		if (f.source === "pip" && f.pip) {
			const env = pip.get(f.pip) ?? new Map<string, string>();
			env.set(f.pkg, f.to);
			pip.set(f.pip, env);
		} else if (f.group === "upgrade" || f.group === "rebase") {
			apt.set(f.pkg, f.to);
		}
	}
	const ids = [
		...new Set(selected.filter((f) => f.applicable).map((f) => f.id)),
	];
	const lines = [
		`# Security fixes for ${ids.length} advisor${ids.length === 1 ? "y" : "ies"} (${ids.slice(0, 6).join(", ")}${ids.length > 6 ? ", …" : ""})`,
	];
	if (apt.size > 0) {
		lines.push(
			`# apt: ${[...apt].map(([p, v]) => `${p} >= ${v}`).join(", ")}`,
			"apt-get update",
			`apt-get install -y --only-upgrade ${[...apt.keys()].map(shQuote).join(" ")}`,
			"rm -rf /var/lib/apt/lists/*",
		);
	}
	for (const [cmd, pkgs] of pip) {
		const args = [...pkgs].map(([p, v]) => shQuote(`${p}>=${v}`)).join(" ");
		lines.push(
			cmd === "pip3"
				? `pip3 install --no-cache-dir --break-system-packages ${args}`
				: `${cmd} install --no-cache-dir ${args}`,
		);
	}
	return lines;
};

/** The blocks of the diff (apt, each Python environment): what the Dockerfile header counts as hunks. */
export const hunks = (lines: readonly string[]) =>
	lines.filter(
		(l) =>
			l.startsWith("apt-get install") || / install --no-cache-dir /.test(l),
	).length;
