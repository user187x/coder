import { rc2CbcDecrypt, rc2DecryptBlock } from "./rc2";

const hex = (s: string) =>
	Uint8Array.from(s.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
const toHex = (b: Uint8Array) =>
	[...b].map((x) => x.toString(16).padStart(2, "0")).join("");

describe("RC2 (RFC 2268)", () => {
	// The RFC's test vectors: key, effective bits, plaintext, ciphertext.
	it.each([
		["0000000000000000", 63, "0000000000000000", "ebb773f993278eff"],
		["ffffffffffffffff", 64, "ffffffffffffffff", "278b27e42e2f0d49"],
		["3000000000000000", 64, "1000000000000001", "30649edf9be7d2c2"],
		["88", 64, "0000000000000000", "61a8a244adacccf0"],
		["88bca90e90875a", 64, "0000000000000000", "6ccf4308974c267f"],
		[
			"88bca90e90875a7f0f79c384627bafb2",
			64,
			"0000000000000000",
			"1a807d272bbe5db1",
		],
		[
			"88bca90e90875a7f0f79c384627bafb2",
			128,
			"0000000000000000",
			"2269552ab0f85ca6",
		],
	])("key %s, %i bits", (key, bits, plain, cipher) => {
		expect(toHex(rc2DecryptBlock(hex(key), bits, hex(cipher)))).toBe(plain);
	});

	it("refuses a bad padding (what a wrong key gives)", () => {
		// The block decrypts to eight zero bytes: no valid PKCS#7 padding.
		expect(() =>
			rc2CbcDecrypt(
				hex("0000000000000000"),
				63,
				hex("0000000000000000"),
				hex("ebb773f993278eff"),
			),
		).toThrow();
	});
});
