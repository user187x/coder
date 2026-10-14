import JSZip from "jszip";

/**
 * The icons a template uses: its own (Settings > Icon) and every `icon = "..."`
 * in its Terraform (apps, metadata, parameters and their options), served by
 * this deployment (paths such as /icon/ubuntu.svg, /emojis/1f4be.png,
 * /__icons/marimo.svg). Icons on other sites are left out: the export has to
 * work in an air-gapped network too.
 */
export const templateIconPaths = (
	templateIcon: string,
	files: Readonly<Record<string, string>>,
): string[] => {
	const found = new Set<string>();
	const add = (url: string) => {
		const path = url.trim();
		if (path.startsWith("/") && !path.startsWith("//")) {
			found.add(path.split(/[?#]/)[0]);
		}
	};
	add(templateIcon);
	for (const [name, text] of Object.entries(files)) {
		if (!name.endsWith(".tf")) {
			continue;
		}
		for (const m of text.matchAll(/\bicon\s*=\s*"([^"$]+)"/g)) {
			add(m[1]);
		}
	}
	return [...found].sort();
};

/** Where an icon goes in the export: icons/ and its path on the deployment ("/icon/ubuntu.svg" → "icons/icon/ubuntu.svg"). */
export const iconFileName = (path: string) =>
	`icons/${path
		.replace(/^\/+/, "")
		.split("/")
		.map((p) => decodeURIComponent(p).replace(/[^\w.@-]/g, "_"))
		.join("/")}`;

/**
 * Everything that makes up a template version, in one ZIP: its source as Coder
 * keeps it (the Terraform, the scripts and other files next to it) and the
 * icons it uses (templateIconPaths), with icons/index.json saying where each
 * one is served. `source` is Coder's own ZIP of the version's files.
 */
export const buildTemplateExport = async (
	source: Blob,
	templateIcon: string,
	fetchIcon: (path: string) => Promise<Blob | null>,
): Promise<{ zip: Blob; icons: string[]; missing: string[] }> => {
	// bytes, not the Blob itself: JSZip reads a Blob with a FileReader, which not every runtime has
	const zip = await JSZip.loadAsync(new Uint8Array(await source.arrayBuffer()));
	const texts: Record<string, string> = {};
	for (const file of Object.values(zip.files)) {
		if (!file.dir && file.name.endsWith(".tf")) {
			texts[file.name] = await file.async("string");
		}
	}
	const icons: string[] = [];
	const missing: string[] = [];
	const index: { url: string; file: string }[] = [];
	for (const path of templateIconPaths(templateIcon, texts)) {
		const blob = await fetchIcon(path).catch(() => null);
		if (!blob) {
			missing.push(path);
			continue;
		}
		const file = iconFileName(path);
		zip.file(file, new Uint8Array(await blob.arrayBuffer()));
		icons.push(file);
		index.push({ url: path, file });
	}
	if (index.length > 0) {
		zip.file("icons/index.json", `${JSON.stringify(index, null, 2)}\n`);
	}
	return {
		zip: new Blob(
			[
				new Uint8Array(
					await zip.generateAsync({
						type: "uint8array",
						compression: "DEFLATE",
					}),
				),
			],
			{ type: "application/zip" },
		),
		icons,
		missing,
	};
};

/** An icon from this deployment, or null when it is not there (or is not an image). */
export const fetchDeploymentIcon = async (path: string) => {
	const res = await fetch(path, { credentials: "same-origin" });
	const type = res.headers.get("content-type") ?? "";
	if (!res.ok || type.startsWith("text/html")) {
		return null; // the dashboard answers unknown paths with its own page
	}
	return res.blob();
};
