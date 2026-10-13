import { createHash } from "node:crypto";
import { md5Hex } from "./md5";

const text = (s: string) => new TextEncoder().encode(s);

describe("md5Hex", () => {
	// RFC 1321, appendix A.5.
	it.each([
		["", "d41d8cd98f00b204e9800998ecf8427e"],
		["a", "0cc175b9c0f1b6a831c399e269772661"],
		["abc", "900150983cd24fb0d6963f7d28e17f72"],
		["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
		["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
		[
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
			"d174ab98d277d9f5a5611c2c9f419d9f",
		],
		[
			"12345678901234567890123456789012345678901234567890123456789012345678901234567890",
			"57edf4a22be3c955ac49da2e2107b67a",
		],
	])("hashes %j as RFC 1321 says", (input, digest) => {
		expect(md5Hex(text(input))).toBe(digest);
	});

	it("agrees with Node's MD5 at every padding boundary", () => {
		for (const n of [55, 56, 57, 63, 64, 65, 119, 120, 1000, 4099]) {
			const bytes = Uint8Array.from(
				{ length: n },
				(_, i) => (i * 31 + 7) & 255,
			);
			expect(md5Hex(bytes)).toBe(createHash("md5").update(bytes).digest("hex"));
		}
	});
});
