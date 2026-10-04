import {
	checkPkcs12Password,
	inspectPkcs12,
	Pkcs12Error,
	pkcs12Certificates,
	sha256Hex,
} from "./pkcs12";

// A self-signed EC certificate and key exported by OpenSSL 3 (PBES2 / AES-256,
// HMAC-SHA256 integrity) with the password "secret".
const FIXTURE =
	"MIIEPAIBAzCCA/IGCSqGSIb3DQEHAaCCA+MEggPfMIID2zCCAooGCSqGSIb3DQEHBqCCAnswggJ3AgEAMIICcAYJKoZIhvcNAQcBMF8GCSqGSIb3DQEFDTBSMDEGCSqGSIb3DQEFDDAkBBDs/3rzHonxEZ1D5j92pTiRAgIIADAMBggqhkiG9w0CCQUAMB0GCWCGSAFlAwQBKgQQ5u7CCY8lNhV9yVTVXrqzu4CCAgDu2+FTN7Dx4HeOSl3pikE7pERrnboux2oDGkQAo4vG+weJEPOAuBsm9xhUnY7QfJHprS/rmhXqLZQnrJVvUoqgswR3KGe/U/b0O0cr+g/VIkmunoMyjGbo3Hv9SoWWp2cq0hrKwlAk861usTxJKjQuukDyaC0AyzXItTUajK/k7PeIgbaI2t9VYCaMVHXVXX9tEoymhqgELrstQ9LFC1alyg6dMQFcweKnQVRMOIKMupEjj368WOUEik7YXBmfEmyOyRLDN4KVNG25EPU1CVD3bJwkySr7iL91HAD5C5hP0WxBMx3PTmjfVDWgJqG1oAT+z3t72Bsj3es5odfuxCTHZFt/RbcVfQWIkAl9Id5Mbi3uPsu2x8X9n0yif7Z2ngukqQmzn7r+ZXLROV7YCeU8+9cO+rlqBjFRdlyo0Uk8ngzt4r2NjvfB1CnaH40LABLkBqjA0AQL9S5GCLY4ybpIj2jw1gD+0JAtnpqAe4//FeIEzBb7YRdZ5qatQRCGWxzAZsrN48xaoAr7NE/bNGCeBbkz6P+RcFvqxQmPNy2VDiOpfoQQMWi5p4d8kSK8OiTu19qMm6bQ9E8+iTDpy6NGxxhdjyNhfC/t9rKG0vu8ksBeTnX5QetiHlkAX/iQnN5T8D0b59xRLXOUY+PExpwfpqGdnWA4iOgE5w1Xh3BUVDCCAUkGCSqGSIb3DQEHAaCCAToEggE2MIIBMjCCAS4GCyqGSIb3DQEMCgECoIH3MIH0MF8GCSqGSIb3DQEFDTBSMDEGCSqGSIb3DQEFDDAkBBCCv/L5uYnUdPhnpIdrnlMsAgIIADAMBggqhkiG9w0CCQUAMB0GCWCGSAFlAwQBKgQQLq0reMsc68azumDdzyD19QSBkGfquoFO336Ah1pSAbgY46sDlK0yV0CmyLAS3Umt2/9zOHMGDchP+1TcSHKSucB/UKvf1+Whyi6Gyf24NAOJzOF58W1t4iHxH9foL10mvwI1205ds24QHM+yw8Bv3wymHpVtKJAdsqmEdWTh4lio5SpvHrOUaU1eFtcIFnUUMvxXHEsQKUi+0yXN1J9KGghyDzElMCMGCSqGSIb3DQEJFTEWBBSImdKDlb9svp96EP50SQWjwWV/bTBBMDEwDQYJYIZIAWUDBAIBBQAEIKKXBn+qZcy7nImrrkiydHfTMX/h6lONGzfsNaG7hjeQBAhP/vfJdcZnuwICCAA=";

const fixture = () => Uint8Array.from(atob(FIXTURE), (c) => c.charCodeAt(0));

describe("inspectPkcs12", () => {
	it("reports how the file is protected and what it holds", () => {
		const info = inspectPkcs12(fixture());
		expect(info.mac).toBe("SHA-256");
		expect(info.encryption).toEqual(["PBES2 (AES)"]);
		expect(info.hasKey).toBe(true);
	});

	it("rejects files that are not PKCS#12", () => {
		const pem = new TextEncoder().encode("-----BEGIN CERTIFICATE-----");
		expect(() => inspectPkcs12(pem)).toThrow(Pkcs12Error);
	});
});

describe("checkPkcs12Password", () => {
	it("accepts the right password and refuses a wrong one", async () => {
		await expect(checkPkcs12Password(fixture(), "secret")).resolves.toBe(true);
		await expect(checkPkcs12Password(fixture(), "wrong")).resolves.toBe(false);
	});
});

describe("pkcs12Certificates", () => {
	it("reads the certificate's subject, issuer and expiry", async () => {
		const certificates = await pkcs12Certificates(fixture(), "secret");
		expect(certificates).toEqual([
			{
				subject: "Fixture User",
				issuer: "Fixture User",
				notBefore: new Date("2026-10-03T16:22:24Z"),
				notAfter: new Date("2036-09-30T16:22:24Z"),
			},
		]);
	});
});

describe("sha256Hex", () => {
	it("is the hex digest of the bytes", async () => {
		await expect(sha256Hex(new TextEncoder().encode("abc"))).resolves.toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
});
