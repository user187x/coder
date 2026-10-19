import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { API } from "#/api/api";
import type * as TypesGen from "#/api/typesGenerated";
import { createDeferred } from "#/testHelpers/deferred";
import {
	MockPreviewParameter,
	MockPreviewParameter1,
	MockPreviewParameter2,
	MockPreviewParameter4,
	MockPreviewParameter7,
	MockProvisionerJob,
	MockTemplate,
	MockWorkspace,
	MockWorkspaceBuild,
	MockWorkspaceBuildParameter1,
	MockWorkspaceBuildParameter4,
	MockWorkspaceBuildParameter7,
} from "#/testHelpers/entities";
import {
	checkParameters,
	editParameters,
	isBuildParameter,
} from "#/testHelpers/parameters";
import {
	renderWithWorkspaceSettingsLayout,
	waitForLoaderToBeRemoved,
} from "#/testHelpers/renderHelpers";
import {
	type MockWebSocketServer,
	mockDynamicParameterWebSocket,
} from "#/testHelpers/websockets";
import WorkspaceSettingsCardsPage from "./WorkspaceSettingsCardsPage";

const option = (name: string, value: string) => ({
	name,
	description: "",
	value: { valid: true, value },
	icon: "",
});

/** The template's CPU choice (tiles here). */
const cpu = (value: string): TypesGen.PreviewParameter => ({
	...MockPreviewParameter,
	name: "cpu",
	display_name: "CPU",
	form_type: "radio",
	required: false,
	options: [option("2 Cores", "2"), option("4 Cores", "4")],
	value: { valid: true, value },
	default_value: { valid: true, value: "2" },
	order: 1,
});

/** The GPU parameter as the templates have it: disabled (styling) but on the AI template. */
const gpus = (disabled: boolean, value = "0"): TypesGen.PreviewParameter => ({
	...MockPreviewParameter,
	name: "gpus",
	display_name: "GPUs",
	form_type: "radio",
	required: false,
	options: [
		option("None (CPU)", "0"),
		option("1 GPU", "1"),
		option("2 GPUs", "2"),
	],
	value: { valid: true, value },
	default_value: { valid: true, value: "0" },
	styling: { disabled },
	order: 2,
});

async function connect(
	publisher: MockWebSocketServer,
	parameters: readonly TypesGen.PreviewParameter[],
	id = -1,
): Promise<void> {
	await waitFor(() => {
		expect(API.templateVersionDynamicParameters).toHaveBeenCalled();
	});
	await act(async () => {
		if (id === -1) {
			publisher.publishOpen(new Event("open"));
		}
		publisher.publishMessage(
			new MessageEvent("message", {
				data: JSON.stringify({ id, parameters, diagnostics: [] }),
			}),
		);
	});
}

const renderPage = (workspace: TypesGen.Workspace = MockWorkspace) => {
	vi.spyOn(API, "getWorkspaceByOwnerAndName").mockResolvedValue(workspace);
	return renderWithWorkspaceSettingsLayout(<WorkspaceSettingsCardsPage />, {
		route: `/@${workspace.owner_name}/${workspace.name}/settings`,
		path: "/:username/:workspace/settings",
		extraRoutes: [
			{ path: "/:username/:workspace", element: <div>Workspace Page</div> },
		],
	});
};

const saveBar = () => screen.queryByTestId("save-bar");

describe("WorkspaceSettingsCardsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(API, "getTemplateByName").mockResolvedValue(MockTemplate);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("build parameters", () => {
		it("waits for and sends the build's values, and shows no save bar until something changes", async () => {
			const { promise, resolve } =
				createDeferred<TypesGen.WorkspaceBuildParameter[]>();
			vi.spyOn(API, "getWorkspaceBuildParameters").mockReturnValueOnce(promise);
			const [, publisher] = mockDynamicParameterWebSocket();
			renderPage();
			await connect(publisher, [
				MockPreviewParameter1,
				MockPreviewParameter4,
				MockPreviewParameter7,
			]);
			expect(publisher.clientSentData).toHaveLength(0);

			const buildParameters = [
				MockWorkspaceBuildParameter1,
				MockWorkspaceBuildParameter4,
				MockWorkspaceBuildParameter7,
			];
			await act(async () => {
				resolve(buildParameters);
			});
			await waitFor(() => {
				expect(publisher.clientSentData).toHaveLength(1);
				expect(JSON.parse(publisher.clientSentData[0] as string)).toEqual(
					expect.objectContaining({
						id: 0,
						inputs: Object.fromEntries(
							buildParameters.map((p) => [p.name, p.value]),
						),
					}),
				);
			});
			await connect(
				publisher,
				[
					MockPreviewParameter1,
					MockPreviewParameter4,
					MockPreviewParameter7,
				].map((p) => ({
					...p,
					value: {
						valid: true,
						value: buildParameters.find((b) => b.name === p.name)?.value ?? "",
					},
				})),
				0,
			);

			// Parameters without a control of their own: the template's fields, under Environment.
			await waitForLoaderToBeRemoved();
			await checkParameters(...buildParameters);
			expect(saveBar()).toBeNull();
		});

		it("does not clobber build parameters: a new field shows, nothing to save", async () => {
			const buildParameters = [
				MockWorkspaceBuildParameter1,
				MockWorkspaceBuildParameter4,
				MockWorkspaceBuildParameter7,
			];
			vi.spyOn(API, "getWorkspaceBuildParameters").mockResolvedValueOnce(
				buildParameters,
			);
			const [, publisher] = mockDynamicParameterWebSocket();
			renderPage();
			await connect(publisher, [
				MockPreviewParameter1,
				MockPreviewParameter4,
				MockPreviewParameter7,
			]);
			await waitFor(() => expect(publisher.clientSentData).toHaveLength(1));
			await connect(
				publisher,
				[
					MockPreviewParameter1,
					MockPreviewParameter2, // new field
					MockPreviewParameter4,
					MockPreviewParameter7,
				],
				0,
			);

			await waitForLoaderToBeRemoved();
			await checkParameters(
				MockWorkspaceBuildParameter1,
				MockWorkspaceBuildParameter4,
				MockWorkspaceBuildParameter7,
				MockPreviewParameter2,
			);
			// The template's new field is not a change of the user's: nothing to save.
			expect(saveBar()).toBeNull();
		});

		it("does not clobber edited parameters", async () => {
			vi.spyOn(API, "getWorkspaceBuildParameters").mockResolvedValueOnce([]);
			const [, publisher] = mockDynamicParameterWebSocket();
			renderPage();
			await connect(publisher, [
				MockPreviewParameter1,
				MockPreviewParameter4,
				MockPreviewParameter7,
			]);
			await waitForLoaderToBeRemoved();
			await checkParameters(
				MockPreviewParameter1,
				MockPreviewParameter4,
				MockPreviewParameter7,
			);

			// Make the debounce fire after each macrotask.
			vi.useFakeTimers();
			vi.setTimerTickMode("nextTimerAsync");
			const edited = [
				{ name: MockPreviewParameter1.name, value: "" },
				{ name: MockPreviewParameter7.name, value: "not-blank" },
			];
			editParameters(...edited);
			await waitFor(() => {
				expect(publisher.clientSentData).toHaveLength(1);
				expect(JSON.parse(publisher.clientSentData[0] as string)).toEqual(
					expect.objectContaining({
						id: 0,
						inputs: Object.fromEntries(
							[...edited, MockPreviewParameter4].map((p) => [
								p.name,
								isBuildParameter(p) ? p.value : p.value.value,
							]),
						),
					}),
				);
			});
			await connect(
				publisher,
				[
					MockPreviewParameter1,
					MockPreviewParameter2,
					MockPreviewParameter4,
					MockPreviewParameter7,
				],
				0,
			);
			await checkParameters(
				...edited,
				MockPreviewParameter4,
				MockPreviewParameter2,
			);
		});

		it("applies a changed tile with a new build, the running workspace restarted after asking", async () => {
			vi.spyOn(API, "getWorkspaceBuildParameters").mockResolvedValueOnce([]);
			const stop = vi
				.spyOn(API, "stopWorkspace")
				.mockResolvedValue(MockWorkspaceBuild);
			vi.spyOn(API, "waitForBuild").mockResolvedValue({
				...MockProvisionerJob,
				status: "succeeded",
			});
			const build = vi
				.spyOn(API, "postWorkspaceBuild")
				.mockResolvedValue(MockWorkspaceBuild);
			const patch = vi.spyOn(API, "patchWorkspace").mockResolvedValue();
			const [, publisher] = mockDynamicParameterWebSocket();
			const user = userEvent.setup();
			renderPage();
			await connect(publisher, [cpu("2")]);
			const tiles = await screen.findByTestId("parameter-field-cpu");
			expect(
				within(tiles).getByRole("button", { name: "2 Cores" }),
			).toHaveAttribute("aria-pressed", "true");

			await user.click(within(tiles).getByRole("button", { name: "4 Cores" }));
			expect(
				within(tiles).getByRole("button", { name: "4 Cores" }),
			).toHaveAttribute("aria-pressed", "true");
			// At a glance follows the form
			expect(screen.getByTestId("at-a-glance")).toHaveTextContent("4 cores");
			await waitFor(() => expect(publisher.clientSentData).toHaveLength(1));
			// Until the backend has evaluated the change, it cannot be applied.
			expect(
				within(await screen.findByTestId("save-bar")).getByRole("button", {
					name: "Update and restart",
				}),
			).toBeDisabled();
			await connect(publisher, [cpu("4")], 0);

			const bar = await screen.findByTestId("save-bar");
			expect(bar).toHaveTextContent(
				"Resource and environment changes restart the workspace.",
			);
			const apply = within(bar).getByRole("button", {
				name: "Update and restart",
			});
			await waitFor(() => expect(apply).toBeEnabled());
			await user.click(apply);
			const dialog = await screen.findByRole("dialog");
			expect(dialog).toHaveTextContent("Restart your workspace?");
			expect(build).not.toHaveBeenCalled();
			await user.click(within(dialog).getByRole("button", { name: "Restart" }));

			await waitFor(() =>
				expect(build).toHaveBeenCalledWith(MockWorkspace.id, {
					transition: "start",
					template_version_id: undefined,
					rich_parameter_values: [{ name: "cpu", value: "4" }],
					reason: "dashboard",
				}),
			);
			expect(stop).toHaveBeenCalledWith(MockWorkspace.id);
			expect(patch).not.toHaveBeenCalled();
			expect(await screen.findByText("Workspace Page")).toBeInTheDocument();
		});

		it("greys the GPU switch where the template disables it", async () => {
			vi.spyOn(API, "getWorkspaceBuildParameters").mockResolvedValueOnce([]);
			const [, publisher] = mockDynamicParameterWebSocket();
			renderPage();
			await connect(publisher, [gpus(true)]);
			const strip = await screen.findByTestId("gpu");
			expect(strip).toHaveTextContent("Not available with this template.");
			const toggle = within(strip).getByTestId("gpu-switch");
			expect(toggle).toBeDisabled();
			expect(toggle).toHaveAttribute("aria-pressed", "false");
		});

		it("turns the GPU on where the template offers it, and asks how many", async () => {
			vi.spyOn(API, "getWorkspaceBuildParameters").mockResolvedValueOnce([]);
			const [, publisher] = mockDynamicParameterWebSocket();
			const user = userEvent.setup();
			renderPage();
			await connect(publisher, [gpus(false)]);
			const strip = await screen.findByTestId("gpu");
			expect(strip).toHaveTextContent("Attach a GPU to this workspace.");
			await user.click(within(strip).getByTestId("gpu-switch"));
			expect(within(strip).getByTestId("gpu-switch")).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			expect(
				within(strip).getByRole("button", { name: "1 GPU" }),
			).toHaveAttribute("aria-pressed", "true");
			expect(screen.getByTestId("at-a-glance")).toHaveTextContent("GPUOn");
			await waitFor(() =>
				expect(
					JSON.parse(publisher.clientSentData[0] as string).inputs,
				).toEqual({ gpus: "1" }),
			);
		});
	});

	describe("General", () => {
		beforeEach(() => {
			vi.spyOn(API, "getWorkspaceBuildParameters").mockResolvedValue([]);
		});

		it("saves a new name by itself: no build, the page follows the name", async () => {
			const [, publisher] = mockDynamicParameterWebSocket();
			const patch = vi.spyOn(API, "patchWorkspace").mockResolvedValue();
			const build = vi.spyOn(API, "postWorkspaceBuild");
			const user = userEvent.setup();
			renderPage();
			await connect(publisher, [MockPreviewParameter1]);
			const name = await screen.findByLabelText("Workspace name");
			await user.clear(name);
			await user.type(name, "new-name");
			expect(name).toHaveValue("new-name");
			const bar = await screen.findByTestId("save-bar");
			expect(bar).toHaveTextContent("Saved as they are: nothing restarts.");
			await user.click(
				within(bar).getByRole("button", { name: "Save changes" }),
			);
			await waitFor(() =>
				expect(patch).toHaveBeenCalledWith(MockWorkspace.id, {
					name: "new-name",
				}),
			);
			expect(build).not.toHaveBeenCalled();
		});

		it("locks the name when the template disables renaming", async () => {
			const [, publisher] = mockDynamicParameterWebSocket();
			renderPage({ ...MockWorkspace, allow_renames: false });
			await connect(publisher, []);
			const name = await screen.findByLabelText("Workspace name");
			expect(name).toBeDisabled();
			expect(
				screen.getByText(
					"Renaming is disabled by the template — it can be destructive.",
				),
			).toBeInTheDocument();
		});

		it("holds a name it cannot take, and Discard puts everything back", async () => {
			const [, publisher] = mockDynamicParameterWebSocket();
			const patch = vi.spyOn(API, "patchWorkspace");
			const user = userEvent.setup();
			renderPage();
			await connect(publisher, [cpu("2")]);
			const name = await screen.findByLabelText("Workspace name");
			await user.clear(name);
			await user.type(name, "bad!name");
			await user.click(
				within(screen.getByTestId("parameter-field-cpu")).getByRole("button", {
					name: "4 Cores",
				}),
			);
			const bar = await screen.findByTestId("save-bar");
			await act(async () => {
				screen
					.getByTestId("form")
					.dispatchEvent(
						new Event("submit", { bubbles: true, cancelable: true }),
					);
			});
			expect(
				await screen.findByText(/Special characters .* are not supported/),
			).toBeInTheDocument();
			expect(patch).not.toHaveBeenCalled();

			await user.click(within(bar).getByRole("button", { name: "Discard" }));
			expect(name).toHaveValue(MockWorkspace.name);
			expect(
				within(screen.getByTestId("parameter-field-cpu")).getByRole("button", {
					name: "2 Cores",
				}),
			).toHaveAttribute("aria-pressed", "true");
			expect(saveBar()).toBeNull();
		});
	});

	describe("Schedule", () => {
		beforeEach(() => {
			vi.spyOn(API, "getWorkspaceBuildParameters").mockResolvedValue([]);
		});

		it("follows the template: autostart off where it is not allowed, only its days", async () => {
			vi.spyOn(API, "getTemplateByName").mockResolvedValue({
				...MockTemplate,
				allow_user_autostart: false,
			});
			const [, publisher] = mockDynamicParameterWebSocket();
			renderPage();
			await connect(publisher, []);
			const autostart = await screen.findByTestId("autostart");
			expect(
				within(autostart).getByRole("button", { name: "Autostart" }),
			).toBeDisabled();
			expect(within(autostart).getByLabelText("Start time")).toBeDisabled();
			for (const day of ["Mon", "Sun"]) {
				expect(
					within(autostart).getByRole("button", { name: day }),
				).toBeDisabled();
			}
			expect(autostart).toHaveTextContent(
				"The template for this workspace does not allow modification of autostart.",
			);
		});

		it("saves autostart's days through its endpoint, without a build", async () => {
			vi.spyOn(API, "getTemplateByName").mockResolvedValue({
				...MockTemplate,
				autostart_requirement: {
					days_of_week: [
						"monday",
						"tuesday",
						"wednesday",
						"thursday",
						"friday",
						"saturday",
						"sunday",
					],
				},
			});
			const autostartSpy = vi
				.spyOn(API, "putWorkspaceAutostart")
				.mockResolvedValue();
			const autostopSpy = vi.spyOn(API, "putWorkspaceAutostop");
			const build = vi.spyOn(API, "postWorkspaceBuild");
			const [, publisher] = mockDynamicParameterWebSocket();
			const user = userEvent.setup();
			renderPage();
			await connect(publisher, []);
			const autostart = await screen.findByTestId("autostart");
			// The workspace starts Monday to Friday at 9:30: add Saturday
			expect(
				within(autostart).getByRole("button", { name: "Mon" }),
			).toHaveAttribute("aria-pressed", "true");
			await user.click(within(autostart).getByRole("button", { name: "Sat" }));
			const bar = await screen.findByTestId("save-bar");
			await user.click(
				within(bar).getByRole("button", { name: "Save changes" }),
			);
			await waitFor(() =>
				expect(autostartSpy).toHaveBeenCalledWith(MockWorkspace.id, {
					schedule: "CRON_TZ=Canada/Eastern 30 09 * * 1,2,3,4,5,6",
				}),
			);
			expect(autostopSpy).not.toHaveBeenCalled();
			expect(build).not.toHaveBeenCalled();
		});

		it("asks for at least one day", async () => {
			const [, publisher] = mockDynamicParameterWebSocket();
			const user = userEvent.setup();
			renderPage();
			await connect(publisher, []);
			const autostart = await screen.findByTestId("autostart");
			await user.click(
				within(autostart).getByRole("button", { name: "Clear" }),
			);
			expect(
				await within(autostart).findByText(
					"Must set at least one day of week if autostart is enabled.",
				),
			).toBeInTheDocument();
		});
	});

	describe("Sharing", () => {
		beforeEach(() => {
			vi.spyOn(API, "getWorkspaceBuildParameters").mockResolvedValue([]);
		});

		it("is there only for those who may share the workspace", async () => {
			const [, publisher] = mockDynamicParameterWebSocket();
			renderPage();
			await connect(publisher, []);
			await screen.findByTestId("workspace-settings-general");
			expect(screen.queryByTestId("workspace-settings-sharing")).toBeNull();
			expect(
				screen.queryByRole("link", { name: "Sharing" }),
			).not.toBeInTheDocument();
		});
	});
});
