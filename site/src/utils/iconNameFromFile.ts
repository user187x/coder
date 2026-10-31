/** A name for an icon from its file name: lower case, safe characters, no extension. */
export const iconNameFromFile = (fileName: string): string =>
	fileName
		.replace(/\.[^.]+$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^[^a-z0-9]+|-+$/g, "")
		.slice(0, 64);
