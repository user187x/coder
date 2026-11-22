import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { type PersistenceReport, PlatformAPI } from "#/api/platform";
import {
	MockDisasterRecovery,
	MockPersistenceReport,
	MockPersistenceReportNeedsAttention,
	MockPersistenceReportNoOperator,
} from "#/testHelpers/platform";
import { render } from "#/testHelpers/renderHelpers";
import { server } from "#/testHelpers/server";
import { PersistenceView } from "./PersistenceView";

const serve = (report: PersistenceReport) => {
	const applied: unknown[] = [];
	server.use(
		http.get("/__coder-ui/api/persistence", () => HttpResponse.json(report)),
		http.post("/__coder-ui/api/persistence/apply", async ({ request }) => {
			applied.push(await request.json());
			return HttpResponse.json({ ok: true, done: ["Done"] });
		}),
	);
	return applied;
};

describe("PersistenceView", () => {
	it("applies every suggested fix with the suggested settings once approved", async () => {
		const applied = serve(MockPersistenceReportNeedsAttention);
		const user = userEvent.setup();
		render(<PersistenceView />);

		await user.click(
			await screen.findByRole("button", {
				name: "Approve suggested fixes (3)",
			}),
		);
		expect(applied).toEqual([]);
		await user.click(screen.getByRole("button", { name: "Apply" }));

		await vi.waitFor(() =>
			expect(applied).toEqual([
				{
					fixes: ["cnpg.instances", "cnpg.storage", "cnpg.backup"],
					settings: MockPersistenceReportNeedsAttention.facts.settings,
				},
			]),
		);
	});

	it("updates an existing backup schedule with a biweekly calendar rule", async () => {
		const applied = serve(MockPersistenceReport);
		const user = userEvent.setup();
		render(<PersistenceView />);

		await user.click(await screen.findByRole("combobox", { name: "Repeats" }));
		await user.click(screen.getByRole("option", { name: "Weekly" }));
		await user.click(screen.getByRole("button", { name: "Mon" }));
		const interval = screen.getByRole("spinbutton", {
			name: "Repeat interval",
		});
		await user.clear(interval);
		await user.type(interval, "2");
		await user.click(screen.getByRole("switch", { name: "AM/PM" }));
		await user.click(screen.getByRole("combobox", { name: "AM or PM" }));
		await user.click(screen.getByRole("option", { name: "PM" }));
		await user.click(
			screen.getByRole("button", { name: "Apply these settings" }),
		);
		await user.click(screen.getByRole("button", { name: "Apply" }));

		await vi.waitFor(() =>
			expect(applied).toEqual([
				{
					fixes: ["cnpg.backup"],
					settings: expect.objectContaining({
						backupRecurrence: expect.objectContaining({
							frequency: "weekly",
							interval: 2,
							weekdays: expect.arrayContaining([1]),
							time: "14:00",
						}),
					}),
				},
			]),
		);
	});

	it("creates a cluster with the values entered in the form", async () => {
		const operatorReady: PersistenceReport = {
			...MockPersistenceReportNoOperator,
			facts: {
				...MockPersistenceReportNoOperator.facts,
				operator: {
					installed: true,
					crd: true,
					namespace: "cnpg-system",
					version: "1.27.0",
					ready: true,
				},
			},
		};
		const applied = serve(operatorReady);
		const user = userEvent.setup();
		render(<PersistenceView />);

		const instances = await screen.findByLabelText("Instances");
		await user.clear(instances);
		await user.type(instances, "2");
		const size = screen.getByLabelText("Storage per instance");
		await user.clear(size);
		await user.type(size, "50Gi");
		await user.click(
			screen.getByRole("button", { name: "Create the cluster" }),
		);
		await user.click(screen.getByRole("button", { name: "Apply" }));

		await vi.waitFor(() =>
			expect(applied).toEqual([
				{
					fixes: ["cnpg.cluster", "cnpg.backup"],
					settings: {
						...operatorReady.facts.settings,
						instances: 2,
						storageSize: "50Gi",
					},
				},
			]),
		);
	});
});

it.each(["None scheduled: Add a target", "Add a target"])(
	"opens and saves the same target editor from %s",
	async (trigger) => {
		serve(MockPersistenceReportNeedsAttention);
		vi.spyOn(PlatformAPI, "getDisasterRecovery").mockResolvedValue(
			MockDisasterRecovery,
		);
		const save = vi
			.spyOn(PlatformAPI, "saveDrTarget")
			.mockResolvedValue(MockDisasterRecovery);
		const user = userEvent.setup();
		render(<PersistenceView />);
		await user.click(await screen.findByRole("button", { name: trigger }));
		await user.type(screen.getByLabelText("Bucket"), "coder-backups");
		await user.click(screen.getByRole("button", { name: "Save" }));
		await vi.waitFor(() =>
			expect(save).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "s3",
					bucket: "coder-backups",
					enabled: true,
				}),
			),
		);
		vi.restoreAllMocks();
	},
);
