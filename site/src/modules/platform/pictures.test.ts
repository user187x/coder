import fs from "node:fs";
import path from "node:path";
import {
	BANNER_PRESET_PICTURES,
	PREBAKED_BACKGROUNDS,
	PREBAKED_GALLERY,
} from "./pictures";

// site/static is copied into the dashboard Coder serves: a picture listed here but missing there would be a broken
// choice on every installation.
const STATIC = path.resolve(__dirname, "../../../static");

describe("the dashboard's own pictures", () => {
	it("are all in site/static, as listed", () => {
		for (const p of [
			...PREBAKED_BACKGROUNDS,
			...PREBAKED_GALLERY,
			...BANNER_PRESET_PICTURES,
		]) {
			const file = path.join(STATIC, p.url);
			expect(fs.existsSync(file), p.url).toBe(true);
			const head = fs.readFileSync(file).subarray(0, 4).toString("latin1");
			expect(
				p.type === "image/gif" ? head.startsWith("GIF8") : true,
				p.url,
			).toBe(true);
			expect(p.type === "image/png" ? head.endsWith("PNG") : true, p.url).toBe(
				true,
			);
		}
	});
});
