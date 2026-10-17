/** A folder's path and a name in it: "docs" + "a.txt" = "docs/a.txt" ("" is the top). */
export const joinPath = (folder: string, name: string): string =>
	folder ? `${folder}/${name}` : name;

/** The breadcrumbs of a folder: [{name: "Cloud Drive", path: ""}, {name: "docs", path: "docs"}, ...]. */
export const breadcrumbs = (path: string): { name: string; path: string }[] => {
	const parts = path ? path.split("/") : [];
	return [
		{ name: "Cloud Drive", path: "" },
		...parts.map((name, i) => ({
			name,
			path: parts.slice(0, i + 1).join("/"),
		})),
	];
};

/** A name the Cloud Drive takes: no slashes, not "." or "..", no control characters, at most 255 bytes. */
export const validName = (name: string): string | null => {
	const trimmed = name.trim();
	if (!trimmed) {
		return "Give it a name.";
	}
	if (trimmed === "." || trimmed === "..") {
		return "That name is reserved.";
	}
	// A slash, or a control character (what the service refuses in a name).
	if (
		/[/\\]/.test(trimmed) ||
		[...trimmed].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
	) {
		return "No slashes or control characters.";
	}
	if (new TextEncoder().encode(trimmed).length > 255) {
		return "That name is too long.";
	}
	return null;
};

/** Bytes, as people read them: 0 B, 512 B, 1.5 KB, 12 MB, 3.2 GB (powers of 1024, as the quota is). */
export const formatBytes = (bytes: number): string => {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = Math.max(0, bytes);
	let i = 0;
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i++;
	}
	return i === 0
		? `${Math.round(value)} B`
		: `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")} ${units[i]}`;
};

/** The share of the quota in use, 0-100. */
export const usedPercent = (used: number, quota: number): number =>
	quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
