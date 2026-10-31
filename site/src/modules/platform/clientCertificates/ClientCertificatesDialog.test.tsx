import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClientCertificatesAPI } from "#/api/clientCertificates";
import {
	MockCertificateDownload,
	MockClientCertificate,
} from "#/testHelpers/clientCertificates";
import { MockUserOwner, mockApiError } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import * as download from "./ClientCertificateDownload";
import { ClientCertificatesDialog } from "./ClientCertificatesDialog";

beforeEach(() => {
	vi.spyOn(ClientCertificatesAPI, "capabilities").mockResolvedValue({
		enabled: true,
	});
	vi.spyOn(ClientCertificatesAPI, "list").mockResolvedValue({
		certificates: [MockClientCertificate],
	});
	vi.stubGlobal(
		"URL",
		class extends URL {
			static createObjectURL = vi.fn(() => "blob:certificate");
			static revokeObjectURL = vi.fn();
		},
	);
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
	vi.spyOn(download, "saveClientCertificate");
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
const account = { ...MockUserOwner, login_type: "oidc" as const };

const fill = async () => {
	await userEvent.type(screen.getByLabelText("Device name"), "My phone");
	await userEvent.type(
		screen.getByLabelText("Download password"),
		"my-device-password",
	);
};

it("issues in the selected account, saves the encrypted response and preserves it on Escape", async () => {
	const issue = vi
		.spyOn(ClientCertificatesAPI, "issue")
		.mockResolvedValue(MockCertificateDownload);
	const close = vi.fn();
	render(<ClientCertificatesDialog user={account} onClose={close} />);
	await fill();
	await userEvent.click(
		screen.getByRole("button", { name: "Issue and download" }),
	);
	await waitFor(() =>
		expect(download.saveClientCertificate).toHaveBeenCalledWith(
			MockCertificateDownload,
		),
	);
	expect(issue).toHaveBeenCalledWith(account.organization_ids[0], account.id, {
		label: "My phone",
		password: "my-device-password",
		days: 90,
	});
	await userEvent.keyboard("{Escape}");
	expect(close).not.toHaveBeenCalled();
	await userEvent.click(
		screen.getByRole("button", { name: "Download certificate" }),
	);
	expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
	expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(2);
	await userEvent.click(screen.getByRole("button", { name: "Done" }));
	expect(close).toHaveBeenCalledOnce();
});

it("retains a pending issuance and refreshes public inventory after partial failure", async () => {
	let rejectIssue: (error: Error) => void = () => {};
	const issue = vi.spyOn(ClientCertificatesAPI, "issue").mockReturnValue(
		new Promise((_resolve, reject) => {
			rejectIssue = reject;
		}),
	);
	const close = vi.fn();
	render(<ClientCertificatesDialog user={account} onClose={close} />);
	await fill();
	await userEvent.click(
		screen.getByRole("button", { name: "Issue and download" }),
	);
	await waitFor(() => expect(issue).toHaveBeenCalledOnce());
	await userEvent.keyboard("{Escape}");
	expect(close).not.toHaveBeenCalled();
	vi.mocked(ClientCertificatesAPI.list).mockClear();
	await act(async () => rejectIssue(new Error("Provider unavailable")));
	await waitFor(() =>
		expect(ClientCertificatesAPI.list).toHaveBeenCalledWith(
			account.organization_ids[0],
			account.id,
		),
	);
	expect(download.saveClientCertificate).not.toHaveBeenCalled();
});

it("revokes only the selected device and refreshes the inventory", async () => {
	const revoke = vi
		.spyOn(ClientCertificatesAPI, "revoke")
		.mockResolvedValue({ revoked: true });
	render(<ClientCertificatesDialog user={account} onClose={vi.fn()} />);
	await userEvent.click(
		await screen.findByRole("button", { name: "Revoke Android phone" }),
	);
	await waitFor(() =>
		expect(revoke).toHaveBeenCalledWith(
			account.organization_ids[0],
			account.id,
			MockClientCertificate.id,
		),
	);
	await waitFor(() =>
		expect(ClientCertificatesAPI.list).toHaveBeenCalledTimes(2),
	);
});

it("does not issue when capability verification fails", async () => {
	vi.mocked(ClientCertificatesAPI.capabilities).mockRejectedValue(
		mockApiError({ message: "Not configured" }),
	);
	const issue = vi.spyOn(ClientCertificatesAPI, "issue");
	render(<ClientCertificatesDialog user={account} onClose={vi.fn()} />);
	await fill();
	await userEvent.click(
		screen.getByRole("button", { name: "Issue and download" }),
	);
	expect(issue).not.toHaveBeenCalled();
});
