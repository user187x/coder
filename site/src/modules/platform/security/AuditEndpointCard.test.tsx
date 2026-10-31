import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import {
	MockAuditCollector,
	MockAuditCollectorConfiguration,
	MockOrganization,
	MockOrganization2,
} from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { AuditEndpointCard } from "./AuditEndpointCard";

beforeEach(() => {
	vi.spyOn(API, "getOrganizations").mockResolvedValue([
		MockOrganization,
		MockOrganization2,
	]);
	vi.spyOn(API, "getAuditCollectors").mockResolvedValue(
		MockAuditCollectorConfiguration,
	);
});
afterEach(() => vi.restoreAllMocks());

it("grants and revokes an exact identity in the selected organization", async () => {
	const create = vi
		.spyOn(API, "createAuditCollector")
		.mockResolvedValue(MockAuditCollector);
	const revoke = vi
		.spyOn(API, "deleteAuditCollector")
		.mockResolvedValue(undefined);
	render(<AuditEndpointCard />);
	await userEvent.selectOptions(
		await screen.findByRole("combobox", { name: "Audit organization" }),
		MockOrganization2.id,
	);
	await userEvent.type(
		await screen.findByRole("textbox", { name: "Name" }),
		"Security collector",
	);
	await userEvent.type(
		screen.getByRole("textbox", { name: "Keycloak client ID" }),
		"collector-client",
	);
	await userEvent.type(
		screen.getByRole("textbox", { name: "Subject (sub)" }),
		"collector-subject",
	);
	await userEvent.clear(
		screen.getByRole("spinbutton", { name: "Access lifetime (days)" }),
	);
	await userEvent.type(
		screen.getByRole("spinbutton", { name: "Access lifetime (days)" }),
		"7",
	);
	await userEvent.click(screen.getByRole("button", { name: "Grant access" }));
	await waitFor(() =>
		expect(create).toHaveBeenCalledWith(MockOrganization2.id, {
			name: "Security collector",
			subject: "collector-subject",
			client_id: "collector-client",
			valid_days: 7,
		}),
	);
	await userEvent.click(
		screen.getByRole("button", { name: `Revoke ${MockAuditCollector.name}` }),
	);
	await waitFor(() =>
		expect(revoke).toHaveBeenCalledWith(
			MockOrganization2.id,
			MockAuditCollector.id,
		),
	);
	expect(API.getAuditCollectors).toHaveBeenCalledWith(MockOrganization2.id);
});

it("keeps a failed grant editable for retry", async () => {
	const create = vi
		.spyOn(API, "createAuditCollector")
		.mockRejectedValueOnce(new Error("Service unavailable"))
		.mockResolvedValue(MockAuditCollector);
	render(<AuditEndpointCard />);
	await userEvent.type(
		await screen.findByRole("textbox", { name: "Name" }),
		"Collector",
	);
	await userEvent.type(
		screen.getByRole("textbox", { name: "Keycloak client ID" }),
		"client",
	);
	await userEvent.type(
		screen.getByRole("textbox", { name: "Subject (sub)" }),
		"subject",
	);
	await userEvent.click(screen.getByRole("button", { name: "Grant access" }));
	await userEvent.click(
		await screen.findByRole("button", { name: "Refresh access" }),
	);
	await userEvent.click(screen.getByRole("button", { name: "Grant access" }));
	await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
	expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
});
