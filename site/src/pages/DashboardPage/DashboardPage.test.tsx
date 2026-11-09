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
	// No "0" and no sentence: an N/A pill beside the title, the card greyed out.
	expect(
		within(gpu).getByTitle("No workspace has a GPU enabled"),
	).toHaveTextContent("N/A");
	expect(gpu).not.toHaveTextContent(/^GPU\s*0/);
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

it("counts the workspaces with the Cloud Drive connected and lists each", async () => {
	vi.spyOn(PlatformAPI, "getCloudDriveConnections").mockResolvedValue({
		disconnected: ["ws-data"],
		shared: [],
		older: [],
		workspaceConnections: [],
	});
	setup();
	const user = userEvent.setup();
	const card = await screen.findByRole("region", { name: "Cloud Drive" });
	expect(await within(card).findByText("1 of 2 connected")).toHaveTextContent(
		"1 of 2 connected",
	);
	await user.click(
		within(card).getByRole("button", { name: "Show workspaces" }),
	);
	expect(within(card).getByText("data").closest("div")).toHaveTextContent(
		"dataDisconnected",
	);
});

it("keeps the Network card when none of the workspaces is running", async () => {
	setup({
		...MockQuotaMeResources,
		workspaces: MockQuotaMeResources.workspaces.map((w) => ({
			...w,
			running: false,
		})),
	});
	expect(
		await screen.findByText(
			"None of your workspaces is running: their traffic shows here while one runs.",
		),
	).toBeInTheDocument();
	expect(PlatformAPI.getWorkspaceNetwork).not.toHaveBeenCalled();
});

it("measures a per-workspace disk limit against every workspace the account may have", async () => {
	setup({
		...MockQuotaMeResources,
		resourceModes: { ...MockQuotaMeResources.resourceModes, disk: "instance" },
		// 25 GB per workspace, three workspaces: 75 GB in all; the quota counts the largest (20 GB).
		limits: { ...MockQuotaMeResources.limits, disk: 25 },
		usage: { ...MockQuotaMeResources.usage, disk: 40 },
	});
	const rings = await screen.findByRole("img", { name: /Disk: 30 of 75 GB/ });
	expect(rings).toHaveAccessibleName(
		/Disk: 30 of 75 GB allocated \(40% of quota\), within quota/,
	);
});

it("lays out the cards after Summary in the order the user dragged them into", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		dashboard_card_order: ["network", "memory"],
	});
	setup();
	await screen.findByRole("region", { name: "Network" });
	const titles = screen
		.getAllByRole("region")
		.map((r) => r.getAttribute("aria-label"))
		.filter((t) =>
			["Summary", "Network", "Memory", "Workspaces"].includes(t ?? ""),
		);
	expect(titles).toEqual(["Summary", "Network", "Memory", "Workspaces"]);
	expect(screen.getByRole("button", { name: "Move Network" })).toHaveAttribute(
		"aria-roledescription",
		"sortable",
	);
});

it("shows one workspace's network activity when chosen from the Network pill", async () => {
	setup();
	const user = userEvent.setup();
	const pill = await screen.findByRole("button", {
		name: "Network activity shown: Combined Network Activity",
	});
	await user.click(pill);
	const [first] = MockQuotaMeResources.workspaces.filter((w) => w.running);
	await user.click(
		await screen.findByRole("menuitemradio", {
			name: `${first.name} Network Activity`,
		}),
	);
	expect(
		await screen.findByRole("button", {
			name: `Network activity shown: ${first.name} Network Activity`,
		}),
	).toHaveAttribute("aria-haspopup", "menu");
});
