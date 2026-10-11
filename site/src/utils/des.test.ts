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

	it("fails on the wrong key (bad padding)", () => {
		const key = randomBytes(24);
		const iv = randomBytes(8);
		const cipher = createCipheriv("des-ede3-cbc", key, iv);
		const encrypted = Buffer.concat([
			cipher.update(randomBytes(64)),
			cipher.final(),
		]);
		const wrong = bytes(randomBytes(24));
		let failures = 0;
		for (let i = 0; i < 5; i++) {
			try {
				tripleDesCbcDecrypt(wrong, bytes(iv), bytes(encrypted));
			} catch {
				failures++;
			}
			wrong[0] ^= 0xff;
		}
		expect(failures).toBeGreaterThanOrEqual(3);
	});
});
