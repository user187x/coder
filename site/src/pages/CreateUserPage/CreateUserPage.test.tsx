import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { ClientCertificatesAPI } from "#/api/clientCertificates";
import * as download from "#/modules/platform/clientCertificates/ClientCertificateDownload";
import { MockCertificateDownload } from "#/testHelpers/clientCertificates";
import { MockAuthMethodsAll, MockUserMember } from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import CreateUserPage from "./CreateUserPage";

afterEach(() => vi.restoreAllMocks());

it("retries certificate issuance without creating the account again", async () => {
	vi.spyOn(API, "getAuthMethods").mockResolvedValue({
		...MockAuthMethodsAll,
		password: { enabled: false },
	});
	vi.spyOn(API, "getRoles").mockResolvedValue([]);
	vi.spyOn(ClientCertificatesAPI, "capabilities").mockResolvedValue({
		enabled: true,
	});
	const account = { ...MockUserMember, login_type: "oidc" as const };
	const create = vi.spyOn(API, "createUser").mockResolvedValue(account);
	const issue = vi
		.spyOn(ClientCertificatesAPI, "issue")
		.mockRejectedValueOnce(new Error("Provider unavailable"))
		.mockResolvedValueOnce(MockCertificateDownload);
	const save = vi
		.spyOn(download, "saveClientCertificate")
		.mockImplementation(() => {});
	renderWithAuth(<CreateUserPage />);
	await userEvent.type(
		await screen.findByLabelText(/Username/),
		account.username,
	);
	await userEvent.type(screen.getByLabelText(/Email/), account.email);
	await userEvent.click(
		await screen.findByRole("checkbox", {
			name: "Create and download a client certificate",
		}),
	);
	await userEvent.type(
		screen.getByLabelText(/Certificate download password/),
		"device-password-123",
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Create user and download" }),
	);
	await userEvent.click(
		await screen.findByRole("button", { name: "Retry certificate issuance" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith(MockCertificateDownload),
	);
	expect(create).toHaveBeenCalledOnce();
	expect(issue).toHaveBeenCalledTimes(2);
	expect(issue).toHaveBeenLastCalledWith(
		account.organization_ids[0],
		account.id,
		{
			label: "Initial device",
			password: "device-password-123",
			days: 90,
		},
	);
});
