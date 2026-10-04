import type {
	PersistenceFix,
	PersistenceReport,
	PersistenceSettings,
} from "#/api/platform";

export const FIX_LABELS: Record<PersistenceFix, string> = {
	"cnpg.cluster": "Create a CloudNativePG cluster for Coder",
	"cnpg.instances": "Change the number of instances (replicas)",
	"cnpg.storage": "Grow the database volumes",
	"cnpg.backup": "Schedule volume-snapshot backups",
};

/** The suggested fixes; "cnpg.operator" is not applied from here but installed by an administrator. */
export const fixesNeeded = (report: PersistenceReport): PersistenceFix[] => [
	...new Set(
		report.checks.flatMap((c) =>
			c.fix && c.fix !== "cnpg.operator" ? [c.fix] : [],
		),
	),
];

/**
 * The fixes that turn the cluster as it is into the settings form's values:
 * a new cluster when there is none, else whatever was changed (instances,
 * a bigger volume) and backups once a snapshot class is chosen.
 */
export const fixesForSettings = (
	report: PersistenceReport,
	settings: PersistenceSettings,
): PersistenceFix[] => {
	const { cluster, backups } = report.facts;
	if (!cluster) {
		return [
			"cnpg.cluster",
			...(settings.snapshotClass ? (["cnpg.backup"] as const) : []),
		];
	}
	const fixes: PersistenceFix[] = [];
	if (settings.instances !== cluster.instances) {
		fixes.push("cnpg.instances");
	}
	if (
		cluster.storageSize !== null &&
		(parseQuantity(settings.storageSize) ?? 0) >
			(parseQuantity(cluster.storageSize) ?? 0)
	) {
		fixes.push("cnpg.storage");
	}
	if (!backups?.configured && settings.snapshotClass) {
		fixes.push("cnpg.backup");
	}
	return fixes;
};

const QUANTITY_UNITS: Record<string, number> = {
	"": 1,
	k: 1e3,
	M: 1e6,
	G: 1e9,
	T: 1e12,
	Ki: 2 ** 10,
	Mi: 2 ** 20,
	Gi: 2 ** 30,
	Ti: 2 ** 40,
};

/** A Kubernetes storage quantity ("20Gi", "500M") in bytes; null if it is not one. */
export const parseQuantity = (text: string): number | null => {
	const match = /^([0-9]+(?:\.[0-9]+)?)([a-zA-Z]{0,2})$/.exec(text.trim());
	const unit = match ? QUANTITY_UNITS[match[2]] : undefined;
	if (!match || unit === undefined) {
		return null;
	}
	const value = Number(match[1]) * unit;
	return Number.isFinite(value) ? value : null;
};
