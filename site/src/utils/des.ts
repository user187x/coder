/**
 * Triple DES (DES-EDE) in CBC mode, decryption only: what PKCS#12 files made
 * with legacy settings (pbeWithSHAAnd3-KeyTripleDES-CBC, still the default of
 * many tools and CAs) encrypt their private key with. WebCrypto has no DES.
 * FIPS 46-3; tested against OpenSSL's des-ede3-cbc.
 */

type Bytes = Uint8Array<ArrayBuffer>;

// biome-ignore format: the standard's tables
const IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
// biome-ignore format: the standard's tables
const FP = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
// biome-ignore format: the standard's tables
const E = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
// biome-ignore format: the standard's tables
const P = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
// biome-ignore format: the standard's tables
const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
// biome-ignore format: the standard's tables
const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
// biome-ignore format: the standard's tables
const S = [
	[14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
	[15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
	[10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
	[7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
	[2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
	[12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
	[4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
	[13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
];

type Bits = number[];

const toBits = (bytes: ArrayLike<number>): Bits => {
	const out: Bits = [];
	for (let i = 0; i < bytes.length; i++) {
		for (let b = 7; b >= 0; b--) {
			out.push((bytes[i] >> b) & 1);
		}
	}
	return out;
};

const toBytes = (bits: Bits): number[] => {
	const out: number[] = [];
	for (let i = 0; i < bits.length; i += 8) {
		let v = 0;
		for (let b = 0; b < 8; b++) {
			v = (v << 1) | bits[i + b];
		}
		out.push(v);
	}
	return out;
};

const permute = (bits: Bits, table: readonly number[]): Bits =>
	table.map((position) => bits[position - 1]);

/** The 16 round keys (48 bits each) of one 8-byte DES key. */
const subkeys = (key: ArrayLike<number>): Bits[] => {
	const k = permute(toBits(key), PC1);
	let c = k.slice(0, 28);
	let d = k.slice(28);
	return SHIFTS.map((shift) => {
		c = [...c.slice(shift), ...c.slice(0, shift)];
		d = [...d.slice(shift), ...d.slice(0, shift)];
		return permute([...c, ...d], PC2);
	});
};

const feistel = (right: Bits, key: Bits): Bits => {
	const x = permute(right, E).map((bit, i) => bit ^ key[i]);
	const out: Bits = [];
	for (let s = 0; s < 8; s++) {
		const b = x.slice(s * 6, s * 6 + 6);
		const v =
			S[s][(b[0] * 2 + b[5]) * 16 + b[1] * 8 + b[2] * 4 + b[3] * 2 + b[4]];
		out.push((v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1);
	}
	return permute(out, P);
};

/** One DES block with the given round keys (reversed for decryption). */
const block = (input: Bits, keys: readonly Bits[]): Bits => {
	const bits = permute(input, IP);
	let left = bits.slice(0, 32);
	let right = bits.slice(32);
	for (const key of keys) {
		const f = feistel(right, key);
		[left, right] = [right, left.map((bit, i) => bit ^ f[i])];
	}
	return permute([...right, ...left], FP);
};

/**
 * Decrypts DES-EDE3-CBC (a 24-byte key; a 16-byte key is two-key 3DES) and
 * removes the PKCS#7 padding. Throws when the padding is wrong, which is what
 * a wrong password looks like.
 */
export const tripleDesCbcDecrypt = (
	key: Bytes,
	iv: Bytes,
	data: Bytes,
): Bytes => {
	if (key.length !== 24 && key.length !== 16) {
		throw new Error("3DES needs a 16- or 24-byte key");
	}
	if (iv.length !== 8 || data.length % 8 !== 0 || data.length === 0) {
		throw new Error("3DES-CBC needs an 8-byte IV and whole 8-byte blocks");
	}
	const k1 = subkeys(key.subarray(0, 8));
	const k2 = subkeys(key.subarray(8, 16));
	const k3 = key.length === 24 ? subkeys(key.subarray(16, 24)) : k1;
	// EDE encryption is E(k3, D(k2, E(k1, x))); decryption undoes it.
	const steps = [[...k3].reverse(), k2, [...k1].reverse()];
	const out = new Uint8Array(data.length);
	let previous = toBits(iv);
	for (let i = 0; i < data.length; i += 8) {
		const cipherBits = toBits(data.subarray(i, i + 8));
		let bits = cipherBits;
		for (const keys of steps) {
			bits = block(bits, keys);
		}
		out.set(toBytes(bits.map((bit, j) => bit ^ previous[j])), i);
		previous = cipherBits;
	}
	const pad = out[out.length - 1];
	if (
		pad < 1 ||
		pad > 8 ||
		out.subarray(out.length - pad).some((b) => b !== pad)
	) {
		throw new Error("bad padding");
	}
	return out.slice(0, out.length - pad);
};
