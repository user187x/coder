import {
	certificatePath,
	describeCertificate,
	parseCertificateDescription,
	parseCertificatePath,
} from "./certificateSecrets";

describe("certificate secrets", () => {
	it("finds the certificate name in a secret's file path", () => {
		expect(parseCertificatePath(certificatePath("jane.doe"))).toBe("jane.doe");
		expect(parseCertificatePath("~/.ssh/id_rsa")).toBeNull();
		expect(parseCertificatePath("~/.cert/../.x.p12.b64")).toBeNull();
	});

	it("keeps subject, expiry and fingerprint in the description", () => {
		const description = describeCertificate("jane", {
			sha: "0123456789abcdef0123",
			subject: "Jane Doe",
			notAfter: new Date("2030-01-02T03:04:05Z"),
		});
		expect(parseCertificateDescription(description)).toEqual({
			subject: "Jane Doe",
			expires: "2030-01-02",
			sha: "0123456789abcdef",
		});
	});
});
