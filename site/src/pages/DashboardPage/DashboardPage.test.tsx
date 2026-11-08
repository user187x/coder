import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI, type QuotaMeResources } from "#/api/platform";
import { HUD_REFRESH_MS } from "#/api/queries/platform";
import { MockUserMember } from "#/testHelpers/entities";
import {
	MockCloudDriveSettings,
	MockSafeSummary,
} from "#/testHelpers/platform";
import { render } from "#/testHelpers/renderHelpers";
import {
	MockDashboardResourceHistory,
	MockQuotaMeResources,
} from "#/testHelpers/userQuota";
import DashboardPage from "./DashboardPage";

vi.mock("#/hooks/useAuthenticated", () => ({
	useAuthenticated: () => ({
		user: MockUserMember,
		permissions: { viewDeploymentConfig: false },
	}),
}));

const setup = (resources: QuotaMeResources = MockQuotaMeResources) => {
	const quota = vi
		.spyOn(PlatformAPI, "getQuotaMeResources")
		.mockResolvedValue(resources);
	const history = vi
		.spyOn(PlatformAPI, "getWorkspaceResourceHistory")
		.mockResolvedValue(MockDashboardResourceHistory);
	vi.spyOn(PlatformAPI, "getWorkspaceNetwork").mockResolvedValue({
		windowSeconds: 300,
		agents: {},
	});
	vi.spyOn(PlatformAPI, "getSafe").mockResolvedValue(MockSafeSummary);
	vi.spyOn(PlatformAPI, "cloudDriveSettings").mockResolvedValue(
		MockCloudDriveSettings,
	);
	render(<DashboardPage />);
	return { quota, history };
};

const summary = () => screen.getByRole("region", { name: "Summary" });

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it("shows each allocation against the quota", async () => {
	setup();
	const rings = await screen.findByRole("img", { name: /CPU: 6 of 8 cores/ });
	expect(rings).toHaveAccessibleName(
		"Memory: 12 of 16 GB allocated (75% of quota), within quota; " +
			"CPU: 6 of 8 cores allocated (75% of quota), within quota; " +
			"Disk: 30 of 50 GB allocated (60% of quota), within quota",
	);
	expect(screen.getByRole("meter", { name: "Disk allocated" })).toHaveAttribute(
		"aria-valuetext",
		"30 of 50 GB used (60% of quota), within quota",
	);
	expect(
		screen.getByRole("meter", { name: "Cloud Drive used" }),
	).toHaveAttribute(
		"aria-valuetext",
		"4 GB of 20 GB used (20% of quota), within quota",
	);
	await within(summary()).findByText("1.5 of 4 cores");
});

it.each([
	[7, "near quota", "Near quota"],
	[8, "at or over quota", "At or over quota"],
])("marks %d of 8 cores as %s", async (cpu, inLabel, badge) => {
	setup({
		...MockQuotaMeResources,
		usage: { ...MockQuotaMeResources.usage, cpu },
	});
	const rings = await screen.findByRole("img", {
		name: new RegExp(`CPU: ${cpu} of 8 cores`),
	});
	expect(rings).toHaveAccessibleName(
		expect.stringContaining(
			`CPU: ${cpu} of 8 cores allocated (${Math.round((cpu / 8) * 100)}% of quota), ${inLabel}`,
		),
	);
	expect(within(summary()).getAllByText(badge)).toHaveLength(1);
});

it("keeps the GPU card, saying no workspace has a GPU, without GPUs", async () => {
	setup();
	const gpu = await screen.findByRole("region", { name: "GPU" });
	expect(gpu).toHaveTextContent("No workspace has a GPU enabled");
});

it("shows the GPUs a running workspace claims", async () => {
	const [dev, data] = MockQuotaMeResources.workspaces;
	setup({ ...MockQuotaMeResources, workspaces: [{ ...dev, gpus: 2 }, data] });
	const gpu = await screen.findByRole("region", { name: "GPU" });
	expect(within(gpu).getByRole("definition")).toHaveTextContent("2 GPU");
});

it("stops refreshing while Live is switched off", async () => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	const { quota, history } = setup();
	const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
	await screen.findByRole("img", { name: /CPU: 6 of 8 cores/ });
	await act(() => vi.advanceTimersByTimeAsync(HUD_REFRESH_MS + 500));
	await waitFor(() => expect(quota.mock.calls.length).toBeGreaterThan(1));

	const live = screen.getByRole("button", { name: "Live" });
	await user.click(live);
	expect(live).toHaveAttribute("aria-pressed", "false");
	const quotaCalls = quota.mock.calls.length;
	const historyCalls = history.mock.calls.length;
	await act(() => vi.advanceTimersByTimeAsync(HUD_REFRESH_MS * 3));
	expect(quota).toHaveBeenCalledTimes(quotaCalls);
	expect(history).toHaveBeenCalledTimes(historyCalls);
});

it("writes a ring's reading in the middle while its legend is pointed at", async () => {
	setup();
	const user = userEvent.setup();
	const rings = await screen.findByRole("img", { name: /CPU: 6 of 8 cores/ });
	expect(within(rings).queryByText("6/8 cores")).toBeNull();
	const cpu = within(summary())
		.getAllByRole("listitem")
		.find((item) => item.textContent?.startsWith("CPU"));
	if (!cpu) {
		throw new Error("no CPU legend entry");
	}
	await user.hover(cpu);
	expect(within(rings).getByText("6/8 cores")).toHaveTextContent("6/8 cores");
	await user.unhover(cpu);
	expect(within(rings).queryByText("6/8 cores")).toBeNull();
});

it.each(["Workspaces", "Disks"])(
	"folds the %s card's workspaces behind Show workspaces",
	async (title) => {
		setup();
		const user = userEvent.setup();
		const card = await screen.findByRole("region", { name: title });
		const toggle = await within(card).findByRole("button", {
			name: "Show workspaces",
		});
		expect(toggle).toHaveAttribute("aria-expanded", "false");
		await user.click(toggle);
		expect(
			within(card).getByRole("button", { name: "Hide workspaces" }),
		).toHaveAttribute("aria-expanded", "true");
		expect(
			within(card).getByText(MockQuotaMeResources.workspaces[0].name),
		).toHaveTextContent(MockQuotaMeResources.workspaces[0].name);
	},
);

it("badges each card with what the account was given", async () => {
	setup();
	const memory = await screen.findByRole("region", { name: "Memory" });
	expect(within(memory).getByText("16 GB")).toHaveTextContent("16 GB");
	expect(
		within(screen.getByRole("region", { name: "Disks" })).getByText("50 GB"),
	).toHaveTextContent("50 GB");
});
