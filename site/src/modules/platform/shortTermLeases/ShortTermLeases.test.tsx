import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { ShortTermLeasesAPI } from "#/api/shortTermLeases";
import {
	MockDefaultOrganization,
	MockOrganization,
	MockOrganization2,
} from "#/testHelpers/entities";
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
	vi.mocked(API.getOrganizations).mockResolvedValue([MockDefaultOrganization]);
	const create = vi
		.spyOn(ShortTermLeasesAPI, "create")
		.mockResolvedValue(MockShortTermLease);
	render(
		<ShortTermLeases clock={() => Date.parse(MockShortTermLease.issued_at)} />,
	);
	const button = await screen.findByRole("button", { name: "New Lease" });
	await screen.findByRole("button", { name: "Extend…" });
	await userEvent.click(button);
	await userEvent.click(screen.getByRole("button", { name: "Issue lease" }));
	await waitFor(() =>
		expect(create).toHaveBeenCalledWith(MockOrganization.id, {
			template_id: MockBrowserTemplate.id,
			minutes: 15,
			auto_remove_history: false,
			terms: {
				no_root: true,
				sandbox_only: true,
				firewall: true,
				website_mode: "all",
				websites: [],
			},
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
	await userEvent.click(await screen.findByRole("button", { name: "Extend…" }));
	await userEvent.click(screen.getByRole("button", { name: "Extend lease" }));
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

it("removes an expired lease from history", async () => {
	const remove = vi.spyOn(ShortTermLeasesAPI, "remove").mockResolvedValue({});
	render(
		<ShortTermLeases
			clock={() => Date.parse(MockShortTermLease.expires_at) + 1}
		/>,
	);
	await userEvent.click(
		await screen.findByRole("button", { name: "Delete history" }),
	);
	await waitFor(() =>
		expect(remove).toHaveBeenCalledWith(
			MockOrganization.id,
			MockShortTermLease.user_id,
		),
	);
});

it("keeps a delayed one-time token available through dismissal attempts", async () => {
	const user = userEvent.setup();
	const clipboard = vi.spyOn(navigator.clipboard, "writeText");
	const issued = { ...MockShortTermLease, token: "one-time-lease-token" };
	const result = Promise.withResolvers<typeof issued>();
	vi.spyOn(ShortTermLeasesAPI, "create").mockReturnValue(result.promise);
	render(
		<ShortTermLeases clock={() => Date.parse(MockShortTermLease.issued_at)} />,
	);
	await screen.findByRole("button", { name: "Extend…" });
	await user.click(screen.getByRole("button", { name: "New Lease" }));
	await user.click(screen.getByRole("button", { name: "Issue lease" }));
	await user.keyboard("{Escape}");
	await act(async () => result.resolve(issued));
	await user.keyboard("{Escape}");
	await user.click(
		await screen.findByRole("button", { name: "Copy lease token" }),
	);
	await waitFor(() => expect(clipboard).toHaveBeenCalledWith(issued.token));
});

it("extends leases independently of a canceled creation form and across organizations", async () => {
	vi.mocked(API.getOrganizations).mockResolvedValue([
		MockOrganization,
		MockOrganization2,
	]);
	const lease = {
		...MockShortTermLease,
		organization_id: MockOrganization2.id,
	};
	vi.mocked(ShortTermLeasesAPI.list).mockImplementation(async (org) =>
		org === MockOrganization2.id ? [lease] : [],
	);
	const update = vi
		.spyOn(ShortTermLeasesAPI, "update")
		.mockResolvedValue(lease);
	render(<ShortTermLeases clock={() => Date.parse(lease.issued_at)} />);
	await screen.findByRole("button", { name: "Extend…" });
	await userEvent.click(screen.getByRole("button", { name: "New Lease" }));
	await userEvent.clear(screen.getByRole("spinbutton", { name: "Minutes" }));
	await userEvent.keyboard("{Escape}");
	await userEvent.click(screen.getByRole("button", { name: "Extend…" }));
	const duration = screen.getByRole("spinbutton", {
		name: "Extension minutes",
	});
	await userEvent.clear(duration);
	await userEvent.type(duration, "30");
	await userEvent.click(screen.getByRole("button", { name: "Extend lease" }));
	await waitFor(() =>
		expect(update).toHaveBeenCalledWith(MockOrganization2.id, lease.user_id, {
			minutes: 30,
			revoke: false,
		}),
	);
});
