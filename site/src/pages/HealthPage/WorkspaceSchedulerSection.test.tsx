import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI } from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { MockSchedulerReport } from "#/testHelpers/userQuota";
import { WorkspaceSchedulerSection } from "./WorkspaceSchedulerSection";

afterEach(() => vi.restoreAllMocks());

const setup = () => {
	vi.spyOn(PlatformAPI, "getSchedulerReport").mockResolvedValue(
		MockSchedulerReport,
	);
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<WorkspaceSchedulerSection />
		</QueryClientProvider>,
	);
};

it("labels the admin exemption switch", async () => {
	setup();
	expect(
		await screen.findByRole("switch", { name: "Administrators Exempt" }),
	).toBeChecked();
});

it("saves the enforced days after pressing a day off", async () => {
	const save = vi.spyOn(PlatformAPI, "updateScheduler").mockResolvedValue({
		ok: true,
		settings: MockSchedulerReport.settings,
	});
	setup();
	const tuesday = await screen.findByRole("button", { name: "Tuesday" });
	expect(tuesday).toHaveAttribute("aria-pressed", "true");

	await userEvent.click(tuesday);
	expect(tuesday).toHaveAttribute("aria-pressed", "false");
	await userEvent.click(screen.getByRole("button", { name: "Save scheduler" }));

	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			...MockSchedulerReport.settings,
			enforcedDays: [0, 1, 3, 4, 5, 6],
		}),
	);
});

it("blocks saving with no enforced day", async () => {
	setup();
	for (const name of [
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
		"Sunday",
	]) {
		await userEvent.click(await screen.findByRole("button", { name }));
	}
	expect(screen.getByRole("alert")).toHaveTextContent("Pick at least one day.");
	expect(screen.getByRole("button", { name: "Save scheduler" })).toBeDisabled();
});
