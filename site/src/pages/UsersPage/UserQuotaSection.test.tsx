import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { QueryClient, QueryClientProvider } from "react-query";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { quotaReport } from "#/api/queries/platform";
import { QuotaRequestsAPI } from "#/api/quotaRequests";
import { Table, TableBody, TableRow } from "#/components/Table/Table";
import { MockUserMember, MockUserOwner } from "#/testHelpers/entities";
import { MockQuotaRequest } from "#/testHelpers/quotaRequests";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { MockQuotaReport } from "#/testHelpers/userQuota";
import { AccountResourcesCell } from "./AccountResourcesCell";
import {
	QuotaEditorContext,
	QuotaUsageCells,
	UserQuotaProvider,
	UserQuotaSection,
} from "./UserQuotaSection";

const Save: React.FC = () => {
	const quota = useContext(QuotaEditorContext);
	return (
		<button type="button" onClick={quota?.onSave}>
			Save
		</button>
	);
};
vi.mock("#/hooks/useAuthenticated", () => ({
	useAuthenticated: () => ({ user: MockUserOwner }),
}));

const setup = (compact = false, section = false, report = MockQuotaReport) => {
	vi.spyOn(PlatformAPI, "getQuotaReport").mockResolvedValue(report);
	const client = new QueryClient();
	renderComponent(
		<QueryClientProvider client={client}>
			<UserQuotaProvider enabled>
				<Table aria-label="Quota">
					<TableBody>
						<TableRow>
							{compact ? (
								<AccountResourcesCell user={MockUserMember} />
							) : (
								<QuotaUsageCells userId={MockUserMember.id} />
							)}
						</TableRow>
					</TableBody>
				</Table>
				{section ? <UserQuotaSection /> : <Save />}
			</UserQuotaProvider>
		</QueryClientProvider>,
	);
	return client;
};
afterEach(() => vi.restoreAllMocks());
it("saves per-user base quota edits without replacing global approved additions", async () => {
	const save = vi
		.spyOn(PlatformAPI, "updateQuota")
		.mockResolvedValue({ ok: true, settings: MockQuotaReport.settings });
	setup();
	const field = await screen.findByRole("textbox", {
		name: `CPU cores for ${MockUserMember.username}`,
	});
	await userEvent.type(field, "5");
	await userEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			...MockQuotaReport.settings,
			users: { [MockUserMember.username]: { cpu: 5 } },
		}),
	);
});
it("preserves an unsaved quota override when background usage refreshes", async () => {
	const save = vi
		.spyOn(PlatformAPI, "updateQuota")
		.mockResolvedValue({ ok: true, settings: MockQuotaReport.settings });
	const client = setup();
	await userEvent.type(
		await screen.findByRole("textbox", {
			name: `CPU cores for ${MockUserMember.username}`,
		}),
		"5",
	);
	act(() =>
		client.setQueryData(quotaReport().queryKey, {
			...MockQuotaReport,
			generatedAt: "2026-10-24T12:01:00Z",
		}),
	);
	await userEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			...MockQuotaReport.settings,
			users: { [MockUserMember.username]: { cpu: 5 } },
		}),
	);
});
it("rejects invalid quota input instead of serializing it as an unlimited value", async () => {
	const save = vi
		.spyOn(PlatformAPI, "updateQuota")
		.mockResolvedValue({ ok: true, settings: MockQuotaReport.settings });
	setup();
	await userEvent.type(
		await screen.findByRole("textbox", {
			name: `CPU cores for ${MockUserMember.username}`,
		}),
		"invalid",
	);
	await userEvent.click(screen.getByRole("button", { name: "Save" }));
	expect(save).not.toHaveBeenCalled();
});

it("preserves resource edits across closing the dropdown and a usage refresh", async () => {
	const save = vi
		.spyOn(PlatformAPI, "updateQuota")
		.mockResolvedValue({ ok: true, settings: MockQuotaReport.settings });
	const client = setup(true);
	const user = userEvent.setup();
	await user.click(
		await screen.findByRole("button", {
			name: new RegExp(`Resources for ${MockUserMember.username}:`),
		}),
	);
	await user.type(
		await screen.findByRole("textbox", {
			name: `CPU cores for ${MockUserMember.username}`,
		}),
		"5",
	);
	await user.keyboard("{Escape}");
	act(() =>
		client.setQueryData(quotaReport().queryKey, {
			...MockQuotaReport,
			generatedAt: "2026-10-24T12:01:00Z",
		}),
	);
	await user.click(
		screen.getByRole("button", {
			name: new RegExp(`Resources for ${MockUserMember.username}:`),
		}),
	);
	await user.type(
		await screen.findByRole("textbox", {
			name: `CPU cores for ${MockUserMember.username}`,
		}),
		"0",
	);
	await user.click(
		within(
			screen.getByRole("dialog", {
				name: `Resources for ${MockUserMember.username}`,
			}),
		).getByRole("button", { name: "Save quota" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			...MockQuotaReport.settings,
			users: { [MockUserMember.username]: { cpu: 50 } },
		}),
	);
});

it("reviews an account quota request from its resource dropdown", async () => {
	vi.spyOn(QuotaRequestsAPI, "list").mockResolvedValue({
		requests: [MockQuotaRequest],
	});
	vi.spyOn(API, "getOrganizations").mockResolvedValue([]);
	const decide = vi.spyOn(QuotaRequestsAPI, "decide").mockResolvedValue({
		request: { ...MockQuotaRequest, status: "approved" },
	});
	setup(true);
	const user = userEvent.setup();
	await user.click(
		await screen.findByRole("button", {
			name: new RegExp(`Resources for ${MockUserMember.username}:`),
		}),
	);
	await user.click(
		await screen.findByRole("button", { name: /Quota Requests/ }),
	);
	await user.click(
		await screen.findByRole("button", {
			name: `Approve request by ${MockUserMember.username}`,
		}),
	);
	await waitFor(() =>
		expect(decide).toHaveBeenCalledWith({
			request: MockQuotaRequest,
			action: "approve",
			reason: "",
		}),
	);
});

it("saves independent per-instance CPU and cumulative memory modes with account overrides", async () => {
	const save = vi
		.spyOn(PlatformAPI, "updateQuota")
		.mockResolvedValue({ ok: true, settings: MockQuotaReport.settings });
	setup(false, true);
	await userEvent.type(
		await screen.findByRole("textbox", {
			name: `CPU cores for ${MockUserMember.username}`,
		}),
		"5",
	);
	await userEvent.click(
		screen.getByRole("combobox", { name: "CPU cores limit applies to" }),
	);
	await userEvent.click(
		screen.getByRole("option", { name: "Per workspace instance" }),
	);
	await userEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			...MockQuotaReport.settings,
			resourceModes: {
				cpu: "instance",
				memory: "cumulative",
				disk: "cumulative",
			},
			users: { [MockUserMember.username]: { cpu: 5 } },
		}),
	);
});

it("labels the admin exemption switch", async () => {
	setup(false, true);
	expect(
		await screen.findByRole("switch", { name: "Administrators Exempt" }),
	).not.toBeChecked();
});

it("saves disk quota overrides with the other resources", async () => {
	const save = vi
		.spyOn(PlatformAPI, "updateQuota")
		.mockResolvedValue({ ok: true, settings: MockQuotaReport.settings });
	setup();
	await userEvent.type(
		await screen.findByRole("textbox", {
			name: `Disk (GB) for ${MockUserMember.username}`,
		}),
		"50",
	);
	await userEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			...MockQuotaReport.settings,
			users: { [MockUserMember.username]: { disk: 50 } },
		}),
	);
});

it("saves quota exclusions by account ID and preserves them during usage refreshes", async () => {
	const save = vi
		.spyOn(PlatformAPI, "updateQuota")
		.mockResolvedValue({ ok: true, settings: MockQuotaReport.settings });
	const client = setup(false, true);
	const user = userEvent.setup();
	await user.click(
		await screen.findByRole("combobox", { name: "Excluded users" }),
	);
	await user.click(
		screen.getByRole("option", { name: MockUserMember.username }),
	);
	act(() =>
		client.setQueryData(quotaReport().queryKey, {
			...MockQuotaReport,
			generatedAt: "2026-10-31T12:00:00Z",
		}),
	);
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			...MockQuotaReport.settings,
			excludedUsers: [MockUserMember.id],
		}),
	);
});

it("removes an exclusion without deleting the account's quota overrides", async () => {
	const settings = {
		...MockQuotaReport.settings,
		users: { [MockUserMember.username]: { cpu: 5 } },
		excludedUsers: [MockUserMember.id],
	};
	const save = vi.spyOn(PlatformAPI, "updateQuota").mockResolvedValue({
		ok: true,
		settings: { ...settings, excludedUsers: [] },
	});
	setup(false, true, { ...MockQuotaReport, settings });
	const user = userEvent.setup();
	await user.click(
		await screen.findByRole("combobox", { name: "Excluded users" }),
	);
	await user.keyboard("{Backspace}");
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({ ...settings, excludedUsers: [] }),
	);
});

it("discards an exclusion while preserving the saved limits", async () => {
	const save = vi
		.spyOn(PlatformAPI, "updateQuota")
		.mockResolvedValue({ ok: true, settings: MockQuotaReport.settings });
	setup(false, true);
	const user = userEvent.setup();
	await user.click(
		await screen.findByRole("combobox", { name: "Excluded users" }),
	);
	await user.click(
		screen.getByRole("option", { name: MockUserMember.username }),
	);
	await user.click(screen.getByRole("button", { name: "Discard changes" }));
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(save).not.toHaveBeenCalled();
});

it("switches user quota off at once, keeping the limits", async () => {
	const off = { ...MockQuotaReport.settings, enabled: false };
	const save = vi
		.spyOn(PlatformAPI, "updateQuota")
		.mockResolvedValue({ ok: true, settings: off });
	setup(false, true);
	const toggle = await screen.findByRole("switch", { name: "User quota" });
	expect(toggle).toBeChecked();
	await userEvent.click(toggle);
	await waitFor(() => expect(save).toHaveBeenCalledWith(off));
	await waitFor(() =>
		expect(
			screen.getByRole("switch", { name: "User quota" }),
		).not.toBeChecked(),
	);
});
