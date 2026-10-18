import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { P12 } from "#/utils/pkcs12.test.fixtures";
import { CloudDriveEncryption } from "./CloudDriveEncryption";

const off = {
	state: "off",
	available: true,
	source: null,
	running: [],
	passwordMin: 12,
} as never;

const renderEncryption = () =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<CloudDriveEncryption />
		</QueryClientProvider>,
	);

const secret = {
	id: "5b3f1f86-2bb4-4d8a-bf11-6f7c00000001",
	name: "certificate-alice",
	description: "",
	env_name: "",
	file_path: "~/.cert/.alice.p12.b64",
	enabled: true,
	created_at: "2026-10-01T00:00:00Z",
	updated_at: "2026-10-01T00:00:00Z",
};

describe("CloudDriveEncryption: how the key is wrapped", () => {
	afterEach(() => vi.restoreAllMocks());

	it("offers Password, PEM and PFX", async () => {
		vi.spyOn(PlatformAPI, "getCloudDriveEncryption").mockResolvedValue(off);
		renderEncryption();
		expect(
			await screen.findByRole("radio", { name: "Password" }),
		).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "PEM" })).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: "PFX" })).toBeInTheDocument();
		expect(screen.queryByText("A password")).toBeNull();
		expect(screen.queryByText("My certificate (PKI)")).toBeNull();
	});

	it("PFX: says the password stays in the browser, opens the Account's certificate with it, and fills in its PEM", async () => {
		vi.spyOn(PlatformAPI, "getCloudDriveEncryption").mockResolvedValue(off);
		vi.spyOn(API, "getUserSecrets").mockResolvedValue([secret]);
		const file = vi
			.spyOn(API, "getUserCertificateFile")
			.mockResolvedValue({ name: secret.name, base64: P12["rsa-3des"] });
		const prepare = vi
			.spyOn(PlatformAPI, "prepareCloudDriveEncryption")
			.mockResolvedValue({
				keyId: "k1",
				kit: {} as never,
				fileName: "kit.json",
			});
		const post = vi.spyOn(API.getAxiosInstance(), "post");
		renderEncryption();
		fireEvent.click(await screen.findByLabelText("PFX"));
		const assurance = await screen.findByTestId("cloud-drive-pfx-assurance");
		expect(assurance.textContent).toContain(
			"never sent to the server, never saved, and never written to any log",
		);
		expect(assurance.textContent).toContain("not an administrator");
		fireEvent.click(screen.getByTestId("cloud-drive-pfx-continue"));
		expect(await screen.findByTestId("cloud-drive-pfx-account")).toBeVisible();
		fireEvent.change(screen.getByTestId("cloud-drive-pfx-password"), {
			target: { value: "s3cret" },
		});
		fireEvent.click(screen.getByTestId("cloud-drive-pfx-read"));
		const pem = await screen.findByTestId("cd-enc-pfx-pem");
		await waitFor(() =>
			expect((pem as HTMLTextAreaElement).value).toContain(
				"-----BEGIN CERTIFICATE-----",
			),
		);
		expect(file).toHaveBeenCalledWith("me", "certificate-alice");
		expect(screen.queryByTestId("cloud-drive-pfx")).toBeNull();
		// The password went nowhere: no request carried it.
		for (const call of post.mock.calls) {
			expect(JSON.stringify(call)).not.toContain("s3cret");
		}
		fireEvent.click(
			screen.getByRole("button", {
				name: /Make the key and download its recovery kit/,
			}),
		);
		await waitFor(() => expect(prepare).toHaveBeenCalled());
		const req = prepare.mock.calls[0][0] as {
			method: string;
			certificate: string;
		};
		expect(req.method).toBe("pki");
		expect(req.certificate).toContain("-----BEGIN CERTIFICATE-----");
		expect(JSON.stringify(req)).not.toContain("s3cret");
	});

	it("PFX without a certificate in the Account: asks for the file", async () => {
		vi.spyOn(PlatformAPI, "getCloudDriveEncryption").mockResolvedValue(off);
		vi.spyOn(API, "getUserSecrets").mockResolvedValue([]);
		renderEncryption();
		fireEvent.click(await screen.findByLabelText("PFX"));
		fireEvent.click(await screen.findByTestId("cloud-drive-pfx-continue"));
		expect(
			await screen.findByText("Choose your .pfx / .p12 file or drop it here"),
		).toBeInTheDocument();
	});

	it("PFX cancelled at the assurance: back to the method before", async () => {
		vi.spyOn(PlatformAPI, "getCloudDriveEncryption").mockResolvedValue(off);
		renderEncryption();
		fireEvent.click(await screen.findByLabelText("PEM"));
		fireEvent.click(screen.getByLabelText("PFX"));
		await screen.findByTestId("cloud-drive-pfx-assurance");
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() =>
			expect(screen.getByLabelText("PEM")).toHaveAttribute(
				"data-state",
				"checked",
			),
		);
	});
});
