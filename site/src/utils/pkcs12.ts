/**
 * PKCS#12 (.p12 / .pfx) inspection in the browser, with WebCrypto only:
 *
 *   inspectPkcs12(bytes)          is it a PKCS#12 file, how is it protected,
 *                                 does it hold a private key?
 *   checkPkcs12Password(bytes, pw)  verifies the password against the file's
 *                                 integrity MAC (RFC 7292, Appendix B)
 *   pkcs12Certificates(bytes, pw) subject, issuer and validity of the
 *                                 certificates, when they are PBES2 (AES)
 *                                 encrypted or not encrypted; legacy RC2 / 3DES
 *                                 files are reported as such (WebCrypto has
 *                                 no RC2)
 *
 * Nothing leaves the page; the password is only used in its memory.
 */

type Bytes = Uint8Array<ArrayBuffer>;

const OID = {
	data: "1.2.840.113549.1.7.1",
	signedData: "1.2.840.113549.1.7.2",
	encryptedData: "1.2.840.113549.1.7.6",
	pbes2: "1.2.840.113549.1.5.13",
	pbkdf2: "1.2.840.113549.1.5.12",
	pbmac1: "1.2.840.113549.1.5.14",
	keyBag: "1.2.840.113549.1.12.10.1.1",
	shroudedKeyBag: "1.2.840.113549.1.12.10.1.2",
	certBag: "1.2.840.113549.1.12.10.1.3",
	x509Certificate: "1.2.840.113549.1.9.22.1",
	commonName: "2.5.4.3",
	organization: "2.5.4.10",
};

/** Digest / HMAC OID: WebCrypto name, block size and output size in bytes. */
const HASHES: Record<string, [string, number, number]> = {
	"1.3.14.3.2.26": ["SHA-1", 64, 20],
	"2.16.840.1.101.3.4.2.1": ["SHA-256", 64, 32],
	"2.16.840.1.101.3.4.2.2": ["SHA-384", 128, 48],
	"2.16.840.1.101.3.4.2.3": ["SHA-512", 128, 64],
	"1.2.840.113549.2.7": ["SHA-1", 64, 20],
	"1.2.840.113549.2.9": ["SHA-256", 64, 32],
	"1.2.840.113549.2.10": ["SHA-384", 128, 48],
	"1.2.840.113549.2.11": ["SHA-512", 128, 64],
};
const AES_BITS: Record<string, number> = {
	"2.16.840.1.101.3.4.1.2": 128,
	"2.16.840.1.101.3.4.1.22": 192,
	"2.16.840.1.101.3.4.1.42": 256,
};
const LEGACY_CIPHERS: Record<string, string> = {
	"1.2.840.113549.1.12.1.3": "3DES (legacy)",
	"1.2.840.113549.1.12.1.6": "RC2-40 (legacy, weak)",
	"1.2.840.113549.1.12.1.5": "RC2-128 (legacy)",
	"1.2.840.113549.1.12.1.1": "RC4-128 (legacy, weak)",
};

/** The file is not a PKCS#12 file this page can read; the message says why. */
export class Pkcs12Error extends Error {}

// ---------------------------------------------------------------- DER

type DerNode = {
	tag: number;
	start: number;
	end: number;
	total: number;
	buf: Bytes;
};

const node = (buf: Bytes, pos: number): DerNode => {
	if (pos + 2 > buf.length) {
		throw new Pkcs12Error("truncated");
	}
	const tag = buf[pos];
	let length = buf[pos + 1];
	let header = 2;
	if (length & 0x80) {
		const n = length & 0x7f;
		if (n === 0 || n > 4 || pos + 2 + n > buf.length) {
			throw new Pkcs12Error("unsupported length");
		}
		length = 0;
		for (let i = 0; i < n; i++) {
			length = length * 256 + buf[pos + 2 + i];
		}
		header += n;
	}
	const start = pos + header;
	const end = start + length;
	if (end > buf.length) {
		throw new Pkcs12Error("truncated");
	}
	return { tag, start, end, total: end - pos, buf };
};

const contentOf = (n: DerNode): Bytes => n.buf.subarray(n.start, n.end);

const children = (n: DerNode): DerNode[] => {
	const out: DerNode[] = [];
	let p = n.start;
	while (p < n.end) {
		const child = node(n.buf, p);
		out.push(child);
		p = child.end;
	}
	return out;
};

const expectTag = (
	n: DerNode | undefined,
	tag: number,
	what: string,
): DerNode => {
	if (!n || n.tag !== tag) {
		throw new Pkcs12Error(`${what}: unexpected structure`);
	}
	return n;
};

const sequence = (n: DerNode | undefined, what: string) =>
	children(expectTag(n, 0x30, what));

const oid = (n: DerNode | undefined): string => {
	const b = contentOf(expectTag(n, 0x06, "OID"));
	const parts = [Math.floor(b[0] / 40), b[0] % 40];
	let v = 0;
	for (let i = 1; i < b.length; i++) {
		v = v * 128 + (b[i] & 0x7f);
		if (!(b[i] & 0x80)) {
			parts.push(v);
			v = 0;
		}
	}
	return parts.join(".");
};

const integer = (n: DerNode | undefined): number => {
	let v = 0;
	for (const x of contentOf(expectTag(n, 0x02, "INTEGER"))) {
		v = v * 256 + x;
	}
	return v;
};

const concat = (parts: Bytes[]): Bytes => {
	const out = new Uint8Array(parts.reduce((total, p) => total + p.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
};

// An OCTET STRING, or a constructed one (BER from some tools): its content.
const octets = (n: DerNode | undefined): Bytes => {
	if (n?.tag === 0x04) {
		return contentOf(n);
	}
	if (n?.tag === 0x24) {
		return concat(children(n).map(octets));
	}
	throw new Pkcs12Error("OCTET STRING expected");
};

const firstChild = (n: DerNode | undefined, tag: number, what: string) =>
	children(expectTag(n, tag, what))[0];

// ---------------------------------------------------------------- structure

const parse = (buf: Bytes) => {
	let top: DerNode;
	try {
		top = node(buf, 0);
	} catch {
		throw new Pkcs12Error("This is not a PKCS#12 file.");
	}
	if (top.tag !== 0x30 || top.total !== buf.length) {
		throw new Pkcs12Error(
			"This is not a PKCS#12 file (DER-encoded .p12 / .pfx expected; PEM text is not supported).",
		);
	}
	const [version, authSafe, macData] = sequence(top, "PFX");
	if (!version || integer(version) !== 3 || !authSafe) {
		throw new Pkcs12Error("This is not a PKCS#12 (version 3) file.");
	}
	const [contentType, content] = sequence(authSafe, "authSafe");
	const type = oid(contentType);
	if (type !== OID.data) {
		throw new Pkcs12Error(
			type === OID.signedData
				? "Public-key signed PKCS#12 files are not supported."
				: "Unsupported PKCS#12 content.",
		);
	}
	const authData = octets(firstChild(content, 0xa0, "authSafe content"));
	return { authData, macData };
};

const safeContents = (authData: Bytes) =>
	children(node(authData, 0)).map((contentInfo) => {
		const [type, content] = sequence(contentInfo, "ContentInfo");
		return { type: oid(type), content };
	});

const encryptedContentInfo = (content: DerNode | undefined) =>
	sequence(
		sequence(firstChild(content, 0xa0, "encryptedData"), "EncryptedData")[1],
		"EncryptedContentInfo",
	);

export type Pkcs12Info = {
	size: number;
	/** The integrity MAC's digest, or null when the file has none. */
	mac: string | null;
	encryption: string[];
	hasKey: boolean;
	certBags: number;
};

export const inspectPkcs12 = (bytes: Bytes): Pkcs12Info => {
	const { authData, macData } = parse(bytes);
	const info: Pkcs12Info = {
		size: bytes.length,
		mac: null,
		encryption: [],
		hasKey: false,
		certBags: 0,
	};
	if (macData) {
		const [digestInfo] = sequence(macData, "MacData");
		const algorithm = oid(
			sequence(sequence(digestInfo, "DigestInfo")[0], "AlgorithmIdentifier")[0],
		);
		info.mac =
			algorithm === OID.pbmac1
				? "PBMAC1"
				: (HASHES[algorithm]?.[0] ?? "unknown");
	}
	for (const contentInfo of safeContents(authData)) {
		if (contentInfo.type === OID.encryptedData) {
			const eci = encryptedContentInfo(contentInfo.content);
			const algorithm = oid(sequence(eci[1], "AlgorithmIdentifier")[0]);
			info.encryption.push(
				algorithm === OID.pbes2
					? "PBES2 (AES)"
					: (LEGACY_CIPHERS[algorithm] ?? "unknown"),
			);
		} else if (contentInfo.type === OID.data) {
			const bags = node(
				octets(firstChild(contentInfo.content, 0xa0, "data")),
				0,
			);
			for (const bag of children(bags)) {
				const id = oid(sequence(bag, "SafeBag")[0]);
				if (id === OID.shroudedKeyBag || id === OID.keyBag) {
					info.hasKey = true;
				}
				if (id === OID.certBag) {
					info.certBags += 1;
				}
			}
		}
	}
	return info;
};

// ---------------------------------------------------------------- password

const bmpPassword = (password: string): Bytes => {
	const out = new Uint8Array(password.length * 2 + 2);
	for (let i = 0; i < password.length; i++) {
		const c = password.charCodeAt(i);
		out[i * 2] = c >> 8;
		out[i * 2 + 1] = c & 0xff;
	}
	return out;
};

const digest = async (hash: string, data: Bytes): Promise<Bytes> =>
	new Uint8Array(await crypto.subtle.digest(hash, data));

/** RFC 7292 B.2: the PKCS#12 key-derivation function (ID 3 = MAC key). */
const pkcs12Kdf = async (
	hash: string,
	v: number,
	u: number,
	password: Bytes,
	salt: Bytes,
	iterations: number,
	id: number,
	n: number,
): Promise<Bytes> => {
	const fill = (src: Bytes, length: number): Bytes => {
		const out = new Uint8Array(length);
		for (let i = 0; i < length; i++) {
			out[i] = src[i % src.length];
		}
		return out;
	};
	const D = new Uint8Array(v).fill(id);
	const S = salt.length
		? fill(salt, v * Math.ceil(salt.length / v))
		: new Uint8Array(0);
	const P = password.length
		? fill(password, v * Math.ceil(password.length / v))
		: new Uint8Array(0);
	let I = concat([S, P]);
	const out: Bytes[] = [];
	for (let i = 0; i < Math.ceil(n / u); i++) {
		let A = await digest(hash, concat([D, I]));
		for (let r = 1; r < iterations; r++) {
			A = await digest(hash, A);
		}
		out.push(A);
		const B = fill(A, v);
		const next = new Uint8Array(I.length);
		for (let j = 0; j < I.length; j += v) {
			let carry = 1;
			for (let k = v - 1; k >= 0; k--) {
				const sum = I[j + k] + B[k] + carry;
				next[j + k] = sum & 0xff;
				carry = sum >> 8;
			}
		}
		I = next;
	}
	return concat(out).subarray(0, n);
};

/**
 * Whether `password` opens the file: true / false, or null when the file has
 * no integrity MAC or uses a scheme this page cannot check (PBMAC1).
 */
export const checkPkcs12Password = async (
	bytes: Bytes,
	password: string,
): Promise<boolean | null> => {
	const { authData, macData } = parse(bytes);
	if (!macData) {
		return null;
	}
	const [digestInfo, saltNode, iterationsNode] = sequence(macData, "MacData");
	const [algorithmId, digestNode] = sequence(digestInfo, "DigestInfo");
	const hash = HASHES[oid(sequence(algorithmId, "AlgorithmIdentifier")[0])];
	if (!hash) {
		return null;
	}
	const [hashName, v, u] = hash;
	const salt = octets(saltNode);
	const iterations = iterationsNode ? integer(iterationsNode) : 1;
	const expected = octets(digestNode);
	// "" can mean an empty BMPString (two zero bytes) or no password at all,
	// depending on the tool that made the file.
	const candidates = password
		? [bmpPassword(password)]
		: [bmpPassword(""), new Uint8Array(0)];
	for (const candidate of candidates) {
		const keyBytes = await pkcs12Kdf(
			hashName,
			v,
			u,
			candidate,
			salt,
			iterations,
			3,
			u,
		);
		const key = await crypto.subtle.importKey(
			"raw",
			keyBytes,
			{ name: "HMAC", hash: hashName },
			false,
			["sign"],
		);
		const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, authData));
		if (
			mac.length === expected.length &&
			mac.every((b, i) => b === expected[i])
		) {
			return true;
		}
	}
	return false;
};

// ---------------------------------------------------------------- certificates

export type Pkcs12Certificate = {
	subject: string;
	issuer: string;
	notBefore: Date | null;
	notAfter: Date | null;
};

const distinguishedName = (n: DerNode | undefined): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const rdn of children(expectTag(n, 0x30, "Name"))) {
		for (const attribute of children(rdn)) {
			const [type, value] = sequence(attribute, "AttributeTypeAndValue");
			if (value) {
				out[oid(type)] = new TextDecoder().decode(contentOf(value));
			}
		}
	}
	return out;
};

const time = (n: DerNode | undefined): Date | null => {
	if (!n) {
		return null;
	}
	const s = new TextDecoder().decode(contentOf(n));
	const utc = n.tag === 0x17;
	const m = utc
		? /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/.exec(s)
		: /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?/.exec(s);
	if (!m) {
		return null;
	}
	const year = utc
		? (Number(m[1]) < 50 ? 2000 : 1900) + Number(m[1])
		: Number(m[1]);
	return new Date(
		Date.UTC(
			year,
			Number(m[2]) - 1,
			Number(m[3]),
			Number(m[4]),
			Number(m[5]),
			Number(m[6] || 0),
		),
	);
};

const certificate = (der: Bytes): Pkcs12Certificate => {
	const [tbs] = sequence(node(der, 0), "Certificate");
	let fields = sequence(tbs, "TBSCertificate");
	if (fields[0]?.tag === 0xa0) {
		fields = fields.slice(1);
	}
	const [, , issuer, validity, subject] = fields;
	const [notBefore, notAfter] = children(expectTag(validity, 0x30, "Validity"));
	const sub = distinguishedName(subject);
	const iss = distinguishedName(issuer);
	return {
		subject: sub[OID.commonName] || sub[OID.organization] || "(no common name)",
		issuer: iss[OID.commonName] || iss[OID.organization] || "(no common name)",
		notBefore: time(notBefore),
		notAfter: time(notAfter),
	};
};

const certificatesIn = (contents: Bytes): Pkcs12Certificate[] => {
	const out: Pkcs12Certificate[] = [];
	for (const bag of children(node(contents, 0))) {
		const [id, value] = sequence(bag, "SafeBag");
		if (oid(id) !== OID.certBag) {
			continue;
		}
		const [certId, certValue] = sequence(
			firstChild(value, 0xa0, "certBag"),
			"CertBag",
		);
		if (oid(certId) !== OID.x509Certificate) {
			continue;
		}
		out.push(certificate(octets(firstChild(certValue, 0xa0, "certValue"))));
	}
	return out;
};

const pbes2Decrypt = async (
	params: DerNode | undefined,
	encrypted: Bytes,
	password: string,
): Promise<Bytes> => {
	const [kdf, scheme] = sequence(params, "PBES2-params");
	const [kdfOid, kdfParams] = sequence(kdf, "KDF");
	if (oid(kdfOid) !== OID.pbkdf2) {
		throw new Pkcs12Error("unsupported key derivation");
	}
	const pbkdf2 = sequence(kdfParams, "PBKDF2-params");
	const salt = octets(pbkdf2[0]);
	const iterations = integer(pbkdf2[1]);
	const prfNode = pbkdf2.find((c) => c.tag === 0x30);
	const prf = prfNode
		? HASHES[oid(sequence(prfNode, "prf")[0])]
		: HASHES["1.2.840.113549.2.7"];
	const [cipherOid, iv] = sequence(scheme, "encryptionScheme");
	const bits = AES_BITS[oid(cipherOid)];
	if (!bits || !prf) {
		throw new Pkcs12Error("unsupported cipher");
	}
	const base = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveKey"],
	);
	const key = await crypto.subtle.deriveKey(
		{ name: "PBKDF2", salt, iterations, hash: prf[0] },
		base,
		{ name: "AES-CBC", length: bits },
		false,
		["decrypt"],
	);
	return new Uint8Array(
		await crypto.subtle.decrypt(
			{ name: "AES-CBC", iv: octets(iv) },
			key,
			encrypted,
		),
	);
};

/**
 * The certificates in the file, or `{ legacy: "<cipher>" }` when they are
 * encrypted with a cipher WebCrypto lacks.
 */
export const pkcs12Certificates = async (
	bytes: Bytes,
	password: string,
): Promise<Pkcs12Certificate[] | { legacy: string }> => {
	const { authData } = parse(bytes);
	const out: Pkcs12Certificate[] = [];
	let legacy: string | null = null;
	for (const contentInfo of safeContents(authData)) {
		if (contentInfo.type === OID.data) {
			out.push(
				...certificatesIn(
					octets(firstChild(contentInfo.content, 0xa0, "data")),
				),
			);
		} else if (contentInfo.type === OID.encryptedData) {
			const eci = encryptedContentInfo(contentInfo.content);
			const [algorithmOid, params] = sequence(eci[1], "AlgorithmIdentifier");
			const algorithm = oid(algorithmOid);
			const content = eci[2];
			if (!content) {
				continue;
			}
			const encrypted =
				content.tag === 0x80
					? contentOf(content)
					: concat(children(content).map(contentOf));
			if (algorithm !== OID.pbes2) {
				legacy = LEGACY_CIPHERS[algorithm] ?? "unknown cipher";
				continue;
			}
			out.push(
				...certificatesIn(await pbes2Decrypt(params, encrypted, password)),
			);
		}
	}
	return legacy && !out.length ? { legacy } : out;
};

export const sha256Hex = async (bytes: Bytes): Promise<string> =>
	[...(await digest("SHA-256", bytes))]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
