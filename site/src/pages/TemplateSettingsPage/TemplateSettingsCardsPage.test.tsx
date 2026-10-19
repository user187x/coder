import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import type { Template } from "#/api/typesGenerated";
import {
	MockEntitlementsWithScheduling,
	MockTemplate,
	MockTemplateVersion,
	MockTemplateVersion2,
	MockTemplateVersionVariable1,
	MockTemplateVersionVariable2,
} from "#/testHelpers/entities";
import { renderWithTemplateSettingsLayout } from "#/testHelpers/renderHelpers";
import TemplateSettingsCardsPage from "./TemplateSettingsCardsPage";

// The createAndBuildTemplateVersion mutation polls getTemplateVersion behind
// a real `delay(1000)` call: no wall-clock wait in the tests.
vi.mock("#/utils/delay", () => ({
	delay: () => Promise.resolve(),
}));

const renderPage = async (template: Template = MockTemplate) => {
	vi.spyOn(API, "getTemplateByName").mockResolvedValue(template);
	vi.spyOn(API, "getTemplateVersion").mockResolvedValue(MockTemplateVersion);
	vi.spyOn(API, "getTemplateVersionVariables").mockResolvedValue([
		MockTemplateVersionVariable1,
		MockTemplateVersionVariable2,
	]);
	// The icon editor lists the uploaded icons (Templates > Icons).
	vi.spyOn(PlatformAPI, "getTemplateIcons").mockResolvedValue({
		icons: [],
		canManage: false,
	});
	renderWithTemplateSettingsLayout(<TemplateSettingsCardsPage />, {
		route: `/templates/${template.name}/settings`,
		path: "/templates/:template/settings",
		extraRoutes: [{ path: `/templates/${template.name}`, element: null }],
	});
	await screen.findByTestId("workspace-settings-general");
	await screen.findByLabelText(MockTemplateVersionVariable1.name);
};

const saveBar = () => screen.queryByTestId("save-bar");
const toggle = (name: RegExp) => screen.getByRole("button", { name });

describe("TemplateSettingsCardsPage", () => {
	beforeEach(() => {
		vi.spyOn(API, "getEntitlements").mockResolvedValue(
			MockEntitlementsWithScheduling,
		);
	});
	afterEach(() => vi.restoreAllMocks());

	it("has its cards, and no save bar until something changes", async () => {
		await renderPage();
		for (const id of [
			"general",
			"operations",
			"ports",
			"deprecate",
			"schedule",
			"variables",
			"permissions",
			"parameters",
		]) {
			expect(
				screen.getByTestId(`workspace-settings-${id}`),
			).toBeInTheDocument();
		}
		expect(saveBar()).toBeNull();
		expect(screen.getByTestId("at-a-glance")).toHaveTextContent("Status");
	});

	it("saves the template's own settings in one metadata update", async () => {
		const user = userEvent.setup();
		const update = vi
			.spyOn(API, "updateTemplateMeta")
			.mockResolvedValue({ ...MockTemplate, display_name: "New name" });
		await renderPage();
		const displayName = screen.getByLabelText("Display name");
		await user.clear(displayName);
		await user.type(displayName, "New name");
		await user.click(toggle(/allow users to rename their workspaces/i));
		const bar = await screen.findByTestId("save-bar");
		expect(bar).toHaveTextContent("Saved to the template at once.");
		await user.click(within(bar).getByRole("button", { name: "Save changes" }));
		await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
		expect(update).toHaveBeenCalledWith(
			MockTemplate.id,
			expect.objectContaining({
				name: MockTemplate.name,
				display_name: "New name",
				allow_workspace_renames: !MockTemplate.allow_workspace_renames,
			}),
		);
	});

	it("reflects the template's rename setting", async () => {
		await renderPage({ ...MockTemplate, allow_workspace_renames: true });
		expect(toggle(/allow users to rename their workspaces/i)).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	it("keeps module caching off and locked when the deployment disables it", async () => {
		const user = userEvent.setup();
		await renderPage({
			...MockTemplate,
			module_cache_disabled_by_deployment: true,
		});
		const cache = toggle(/disable terraform module caching/i);
		expect(cache).toHaveAttribute("aria-pressed", "true");
		expect(cache).toBeDisabled();
		await user.click(cache);
		expect(cache).toHaveAttribute("aria-pressed", "true");
		expect(saveBar()).toBeNull();
	});

	it("holds a name it cannot take", async () => {
		const user = userEvent.setup();
		const update = vi.spyOn(API, "updateTemplateMeta");
		await renderPage();
		const name = screen.getByLabelText("Name");
		await user.clear(name);
		await user.type(name, "bad!name");
		await user.click(
			within(await screen.findByTestId("save-bar")).getByRole("button", {
				name: "Save changes",
			}),
		);
		expect(
			await screen.findByText(/Special characters .* are not supported/),
		).toBeInTheDocument();
		expect(update).not.toHaveBeenCalled();
	});

	it("saves the schedule in hours and days as milliseconds, after its confirmation", async () => {
		const user = userEvent.setup();
		const update = vi
			.spyOn(API, "updateTemplateMeta")
			.mockResolvedValue(MockTemplate);
		await renderPage();
		const ttl = screen.getByLabelText("Default autostop (hours)");
		await user.clear(ttl);
		await user.type(ttl, "1");
		await user.click(toggle(/Failure Cleanup/i));
		await user.click(toggle(/Dormancy Threshold/i));
		await user.click(toggle(/Dormancy Auto-Deletion/i));
		await user.click(
			within(await screen.findByTestId("save-bar")).getByRole("button", {
				name: "Save changes",
			}),
		);
		// Dormancy and deletion thresholds that affect workspaces are confirmed.
		await user.click(await screen.findByTestId("confirm-button"));
		await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
		expect(update).toHaveBeenCalledWith(
			MockTemplate.id,
			expect.objectContaining({
				default_ttl_ms: 3600000,
				failure_ttl_ms: 7 * 86400000,
				time_til_dormant_ms: 180 * 86400000,
				time_til_dormant_autodelete_ms: 30 * 86400000,
			}),
		);
		expect(update.mock.calls[0][1]).not.toHaveProperty("agents_allowed");
	});

	it("saves its own settings first, then the schedule", async () => {
		const user = userEvent.setup();
		const update = vi
			.spyOn(API, "updateTemplateMeta")
			.mockResolvedValue(MockTemplate);
		await renderPage();
		const displayName = screen.getByLabelText("Display name");
		await user.clear(displayName);
		await user.type(displayName, "Both");
		const reminder = screen.getByLabelText("Autostop reminder (hours)");
		await user.clear(reminder);
		await user.type(reminder, "2");
		await user.click(
			within(await screen.findByTestId("save-bar")).getByRole("button", {
				name: "Save changes",
			}),
		);
		await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
		expect(update.mock.calls[0][1]).toMatchObject({ display_name: "Both" });
		expect(update.mock.calls[1][1]).toMatchObject({
			time_til_autostop_notify_ms: 2 * 3600000,
		});
		expect(update.mock.calls[1][1]).not.toHaveProperty("display_name");
	});

	it("publishes changed variables as a new version", async () => {
		const user = userEvent.setup();
		const create = vi
			.spyOn(API, "createTemplateVersion")
			.mockResolvedValue(MockTemplateVersion2);
		const publish = vi
			.spyOn(API, "updateActiveTemplateVersion")
			.mockResolvedValue({ message: "done" });
		const toastSuccess = vi.spyOn(toast, "success");
		await renderPage();
		const first = screen.getByLabelText(MockTemplateVersionVariable1.name);
		await user.clear(first);
		await user.type(first, "Hello world");
		const bar = await screen.findByTestId("save-bar");
		expect(bar).toHaveTextContent(
			"Changed variables publish a new version of the template.",
		);
		await user.click(
			within(bar).getByRole("button", { name: "Save and publish" }),
		);
		await waitFor(() =>
			expect(toastSuccess).toHaveBeenCalledWith(
				`Template "${MockTemplate.name}" variables updated successfully.`,
			),
		);
		expect(create).toHaveBeenCalledWith(
			MockTemplate.organization_id,
			expect.objectContaining({
				user_variable_values: expect.arrayContaining([
					{ name: MockTemplateVersionVariable1.name, value: "Hello world" },
				]),
			}),
		);
		expect(publish).toHaveBeenCalledWith(MockTemplate.id, {
			id: MockTemplateVersion2.id,
		});
	});

	it("puts everything back with Discard", async () => {
		const user = userEvent.setup();
		await renderPage();
		const displayName = screen.getByLabelText("Display name");
		await user.clear(displayName);
		await user.type(displayName, "Changed");
		await user.click(
			within(await screen.findByTestId("save-bar")).getByRole("button", {
				name: "Discard",
			}),
		);
		expect(displayName).toHaveValue(MockTemplate.display_name);
		expect(saveBar()).toBeNull();
	});
});
