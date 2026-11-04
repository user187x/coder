import { createCipheriv, randomBytes } from "node:crypto";
import { tripleDesCbcDecrypt } from "./des";

const bytes = (b: Buffer) => new Uint8Array(b);

describe("tripleDesCbcDecrypt", () => {
	it("undoes OpenSSL's des-ede3-cbc", () => {
		for (const size of [0, 1, 7, 8, 9, 100]) {
			const key = randomBytes(24);
			const iv = randomBytes(8);
			const plain = randomBytes(size);
			const cipher = createCipheriv("des-ede3-cbc", key, iv);
			const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
			expect(
				Buffer.from(
					tripleDesCbcDecrypt(bytes(key), bytes(iv), bytes(encrypted)),
				),
			).toEqual(plain);
		}
	});

	it("undoes two-key des-ede-cbc", () => {
		const key = randomBytes(16);
		const iv = randomBytes(8);
		const plain = randomBytes(40);
		const cipher = createCipheriv("des-ede-cbc", key, iv);
		const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
		expect(
			Buffer.from(tripleDesCbcDecrypt(bytes(key), bytes(iv), bytes(encrypted))),
		).toEqual(plain);
	});

	it("rejects invalid padding produced by a wrong key", () => {
		const key = Buffer.from(
			"0123456789abcdef23456789abcdef01456789abcdef0123",
			"hex",
		);
		const iv = Buffer.alloc(8);
		const cipher = createCipheriv("des-ede3-cbc", key, iv);
		const encrypted = Buffer.concat([
			cipher.update("workspace"),
			cipher.final(),
		]);
		const wrong = bytes(key);
		wrong[0] ^= 0x80;
		expect(() =>
			tripleDesCbcDecrypt(wrong, bytes(iv), bytes(encrypted)),
		).toThrow("bad padding");
	});
});
