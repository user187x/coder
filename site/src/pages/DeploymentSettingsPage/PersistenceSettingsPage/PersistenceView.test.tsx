import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { PersistenceReport } from "#/api/platform";
import {
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
