import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { prepareBackground } from "./prepareBackground";

it("keeps a GIF above four MiB byte-for-byte, including its original frame delays", async () => {
	const bytes = Uint8Array.from(
		readFileSync("static/pictures/login-orbit.gif"),
	);
	const file = new File([bytes], "motion.gif");
	// jsdom does not implement Blob.arrayBuffer() on slices.
	const slice = file.slice.bind(file);
	file.slice = (start, end, type) =>
		Object.assign(slice(start, end, type), {
			arrayBuffer: async () => bytes.slice(start, end).buffer,
		});
	const image = await prepareBackground(file, bytes.length);
	expect(image.bytes).toBe(bytes.length);
	expect(image.dataURL).toBe(
		`data:image/gif;base64,${Buffer.from(bytes).toString("base64")}`,
	);
	await expect(prepareBackground(file, bytes.length - 1)).rejects.toThrow(
		"MiB or smaller",
	);
});
