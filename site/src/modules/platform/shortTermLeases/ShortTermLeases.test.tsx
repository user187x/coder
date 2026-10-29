import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { ShortTermLeasesAPI } from "#/api/shortTermLeases";
import { MockOrganization } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import {
	MockBrowserTemplate,
	MockShortTermLease,
} from "#/testHelpers/shortTermLeases";
import { LeaseExtensionButton } from "./LeaseExtensionButton";
import { LeaseLoginPage } from "./LeaseLoginPage";
import { ShortTermLeases } from "./ShortTermLeases";

beforeEach(() => {
	vi.spyOn(API, "getOrganizations").mockResolvedValue([MockOrganization]);
	vi.spyOn(API, "getTemplates").mockResolvedValue([MockBrowserTemplate]);
	vi.spyOn(ShortTermLeasesAPI, "list").mockResolvedValue([MockShortTermLease]);
});
afterEach(() => vi.restoreAllMocks());
it("issues an isolated Browser lease with the default 15 minute duration", async () => {
	const create = vi
		.spyOn(ShortTermLeasesAPI, "create")
		.mockResolvedValue(MockShortTermLease);
	render(
		<ShortTermLeases clock={() => Date.parse(MockShortTermLease.issued_at)} />,
	);
	const button = await screen.findByRole("button", { name: "New Lease" });
	await screen.findByRole("button", { name: "Extend 15 min" });
	await userEvent.click(button);
	await waitFor(() =>
		expect(create).toHaveBeenCalledWith(MockOrganization.id, {
			template_id: MockBrowserTemplate.id,
			minutes: 15,
		}),
	);
});
it("extends the selected lease without changing another account", async () => {
	const update = vi
		.spyOn(ShortTermLeasesAPI, "update")
		.mockResolvedValue(MockShortTermLease);
	render(
		<ShortTermLeases clock={() => Date.parse(MockShortTermLease.issued_at)} />,
	);
	await userEvent.click(
		await screen.findByRole("button", { name: "Extend 15 min" }),
	);
	await waitFor(() =>
		expect(update).toHaveBeenCalledWith(
			MockOrganization.id,
			MockShortTermLease.user_id,
			{ minutes: 15, revoke: false },
		),
	);
});
it("requests an extension for the current temporary account", async () => {
	const request = vi
		.spyOn(ShortTermLeasesAPI, "request")
		.mockResolvedValue(MockShortTermLease);
	render(<LeaseExtensionButton lease={MockShortTermLease} />);
	await userEvent.click(
		screen.getByRole("button", { name: "Request Extension" }),
	);
	await waitFor(() => expect(request).toHaveBeenCalledOnce());
});

it("submits the provided lease token through the lease login API", async () => {
	const login = vi
		.spyOn(ShortTermLeasesAPI, "login")
		.mockImplementation(() => new Promise(() => {}));
	render(<LeaseLoginPage />);
	await userEvent.type(
		screen.getByLabelText("Session token"),
		"  example-test-token  ",
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Open Browser workspace" }),
	);
	await waitFor(() => expect(login).toHaveBeenCalledWith("example-test-token"));
});
