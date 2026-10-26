import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI, type WorkspaceLockdown } from "#/api/platform";
import { WorkspaceQuarantineAPI } from "#/api/workspaceQuarantine";
import { MockWorkspace } from "#/testHelpers/entities";
import { renderComponent, renderWithAuth } from "#/testHelpers/renderHelpers";
import { MockWorkspaceQuarantine } from "#/testHelpers/workspaceQuarantine";
import {
	LockdownBadge,
	LockdownBanner,
	modeOf,
	networkLocked,
} from "./Lockdown";

const lock = (over: Partial<WorkspaceLockdown>): WorkspaceLockdown => ({
	locked: false,
	modes: [],
	by: null,
	at: null,
	running: true,
	inForce: true,
	canChange: true,
	...over,
});

const renderWith = (ui: React.ReactNode) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
	);

describe("Lock Down", () => {
	afterEach(() => vi.restoreAllMocks());

	it("names the mode: both is Complete", () => {
		expect(modeOf(lock({ modes: ["network", "sudo"] }))).toBe("complete");
		expect(modeOf(lock({ modes: ["network"] }))).toBe("network");
		expect(modeOf(lock({ modes: ["sudo"] }))).toBe("sudo");
		expect(modeOf(lock({}))).toBe("off");
		expect(modeOf(lock({ modes: ["network", "sudo", "freeze"] }))).toBe(
			"freeze",
		);
	});

	it("knows when the network is cut: Network, Complete and Freeze", () => {
		expect(networkLocked(lock({ locked: true, modes: ["network"] }))).toBe(
			true,
		);
		expect(
			networkLocked(
				lock({ locked: true, modes: ["network", "sudo", "freeze"] }),
			),
		).toBe(true);
		expect(networkLocked(lock({ locked: true, modes: ["sudo"] }))).toBe(false);
		expect(networkLocked(undefined)).toBe(false);
	});

	it("centres the notice between two shields, and says a frozen workspace is paused through restarts", async () => {
		vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(
			lock({
				locked: true,
				modes: ["network", "sudo", "freeze"],
				by: "admin",
				canChange: false,
			}),
		);
		renderWith(<LockdownBanner workspace={MockWorkspace} />);
		const banner = await screen.findByTestId("workspace-lockdown-banner");
		expect(banner.className).toContain("justify-center");
		expect(banner.className).toContain("text-center");
		const shields = screen.getAllByTestId("workspace-lockdown-shield");
		expect(shields).toHaveLength(2);
		expect(banner.firstElementChild).toBe(shields[0]);
		expect(banner.lastElementChild).toBe(shields[1]);
		expect(banner.textContent).toContain(
			"Locked down: Frozen (everything paused, no network but Coder, no privilege escalation)",
		);
		expect(banner.textContent).toContain("stays frozen through restarts");
	});

	it("tells everyone who sees the workspace what is locked, by whom, and whether it is in force", async () => {
		vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(
			lock({
				locked: true,
				modes: ["network", "sudo"],
				by: "admin",
				at: new Date().toISOString(),
				canChange: false,
			}),
		);
		renderWith(<LockdownBanner workspace={MockWorkspace} />);
		const banner = await screen.findByTestId("workspace-lockdown-banner");
		expect(banner.textContent).toContain(
			"Locked down (no network but Coder, no privilege escalation)",
		);
		expect(banner.textContent).toContain("By admin");
		expect(banner.textContent).toContain("In force in the running workspace.");
	});

	it("in the Workspaces list: the mode from the list's request, the workspace's own state only once opened", async () => {
		const get = vi
			.spyOn(PlatformAPI, "getLockdown")
			.mockResolvedValue(lock({ locked: true, modes: ["network"] }));
		const row = vi.fn();
		renderWith(
			// biome-ignore lint/a11y/useKeyWithClickEvents: a stand-in for the list's clickable row
			<div onClick={row}>
				<LockdownBadge workspace={MockWorkspace} modes={["network"]} />
			</div>,
		);
		const badge = screen.getByTestId("workspace-lockdown");
		expect(badge.dataset.mode).toBe("network");
		expect(badge).toHaveTextContent("Network");
		expect(get).not.toHaveBeenCalled();
		fireEvent.click(badge);
		expect(row).not.toHaveBeenCalled();
		fireEvent.pointerDown(badge, { button: 0, ctrlKey: false });
		expect(await screen.findByTestId("lockdown-complete")).toBeInTheDocument();
		await waitFor(() => expect(get).toHaveBeenCalled());
	});

	it("an unlocked workspace's badge is a quiet shield", () => {
		renderWith(<LockdownBadge workspace={MockWorkspace} modes={[]} />);
		const badge = screen.getByTestId("workspace-lockdown");
		expect(badge.dataset.mode).toBe("off");
		expect(badge).toHaveAccessibleName(
			`Lock Down ${MockWorkspace.owner_name}/${MockWorkspace.name}`,
		);
	});

	it("shows no control to someone who may not change it", async () => {
		const get = vi
			.spyOn(PlatformAPI, "getLockdown")
			.mockResolvedValue(lock({ canChange: false }));
		renderWith(<LockdownBadge workspace={MockWorkspace} />);
		await waitFor(() => expect(get).toHaveBeenCalled());
		expect(screen.queryByTestId("workspace-lockdown")).toBeNull();
	});

	it("locks a workspace down for an admin", async () => {
		vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(lock({}));
		const set = vi.spyOn(PlatformAPI, "setLockdown").mockResolvedValue({
			...lock({ locked: true, modes: ["network", "sudo"] }),
			applied: "now",
			error: null,
		});
		renderWith(<LockdownBadge workspace={MockWorkspace} />);
		const button = await screen.findByTestId("workspace-lockdown");
		expect(button.dataset.mode).toBe("off");
		fireEvent.pointerDown(button, { button: 0, ctrlKey: false });
		fireEvent.click(await screen.findByTestId("lockdown-complete"));
		await waitFor(() =>
			expect(set).toHaveBeenCalledWith(MockWorkspace.id, "complete"),
		);
		await waitFor(() =>
			expect(screen.getByTestId("workspace-lockdown").dataset.mode).toBe(
				"complete",
			),
		);
	});

	it("shows each item's icon: a pulled plug, the barred gate, the shield, a snowflake", async () => {
		vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(lock({}));
		renderWith(<LockdownBadge workspace={MockWorkspace} />);
		const button = await screen.findByTestId("workspace-lockdown");
		fireEvent.pointerDown(button, { button: 0, ctrlKey: false });
		const network = await screen.findByTestId("lockdown-network");
		expect(network.querySelector("svg.lucide-unplug")).not.toBeNull();
		expect(
			screen
				.getByTestId("lockdown-sudo")
				.querySelector('[data-testid="lockdown-icon-sudo"]'),
		).not.toBeNull();
		expect(
			screen
				.getByTestId("lockdown-complete")
				.querySelector("svg.lucide-shield-alert"),
		).not.toBeNull();
		expect(
			screen
				.getByTestId("lockdown-freeze")
				.querySelector("svg.lucide-snowflake"),
		).not.toBeNull();
	});

	it("freezes a workspace, and shows and deletes its snapshot", async () => {
		const frozen = lock({
			locked: true,
			modes: ["network", "sudo", "freeze"],
			snapshot: {
				kind: "PersistentVolumeClaim",
				name: "coder-freeze-5250ca5d-20261013-120000",
				at: new Date().toISOString(),
				claim: "coder-5250ca5d-home",
				error: null,
				status: "ready",
				processes: 42,
			},
		});
		vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(lock({}));
		const set = vi
			.spyOn(PlatformAPI, "setLockdown")
			.mockResolvedValue({ ...frozen, applied: "now", error: null });
		const del = vi
			.spyOn(PlatformAPI, "deleteLockdownSnapshot")
			.mockResolvedValue({ ...frozen, snapshot: null });
		renderWith(<LockdownBadge workspace={MockWorkspace} />);
		const open = async () =>
			fireEvent.pointerDown(await screen.findByTestId("workspace-lockdown"), {
				button: 0,
				ctrlKey: false,
			});
		await open();
		fireEvent.click(await screen.findByTestId("lockdown-freeze"));
		await waitFor(() =>
			expect(set).toHaveBeenCalledWith(MockWorkspace.id, "freeze"),
		);
		await waitFor(() =>
			expect(screen.getByTestId("workspace-lockdown").dataset.mode).toBe(
				"freeze",
			),
		);
		await open();
		const snap = await screen.findByTestId("lockdown-snapshot");
		expect(snap.textContent).toContain("Snapshot ready");
		expect(snap.textContent).toContain("coder-freeze-5250ca5d-20261013-120000");
		expect(snap.textContent).toContain("42 processes paused");
		fireEvent.click(screen.getByTestId("lockdown-snapshot-delete"));
		await waitFor(() => expect(del).toHaveBeenCalledWith(MockWorkspace.id));
	});

	it("names each item by what it does, green while its lock is off", async () => {
		vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(lock({}));
		renderWith(<LockdownBadge workspace={MockWorkspace} />);
		fireEvent.pointerDown(await screen.findByTestId("workspace-lockdown"), {
			button: 0,
			ctrlKey: false,
		});
		const items = {
			network: await screen.findByTestId("lockdown-network"),
			sudo: screen.getByTestId("lockdown-sudo"),
			complete: screen.getByTestId("lockdown-complete"),
			freeze: screen.getByTestId("lockdown-freeze"),
		};
		expect(items.network).toHaveTextContent("Disconnect Network");
		expect(items.sudo).toHaveTextContent("Disable Privilege Escalation");
		expect(items.complete).toHaveTextContent("Lock Down");
		expect(items.freeze).toHaveTextContent("Freeze");
		for (const item of Object.values(items)) {
			expect(item.dataset.on).toBe("false");
			expect(item.className).toContain("text-content-success");
		}
	});

	it("while locked down, every item is red and undoes its part", async () => {
		vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(
			lock({ locked: true, modes: ["network", "sudo"] }),
		);
		const set = vi.spyOn(PlatformAPI, "setLockdown").mockResolvedValue({
			...lock({ locked: true, modes: ["sudo"] }),
			applied: "now",
			error: null,
		});
		renderWith(<LockdownBadge workspace={MockWorkspace} />);
		fireEvent.pointerDown(await screen.findByTestId("workspace-lockdown"), {
			button: 0,
			ctrlKey: false,
		});
		const network = await screen.findByTestId("lockdown-network");
		await waitFor(() => expect(network).toHaveTextContent("Reconnect Network"));
		expect(network.className).toContain("text-content-destructive");
		expect(screen.getByTestId("lockdown-sudo")).toHaveTextContent(
			"Enable Privilege Escalation",
		);
		expect(screen.getByTestId("lockdown-complete")).toHaveTextContent("Unlock");
		expect(screen.getByTestId("lockdown-freeze").dataset.on).toBe("false");
		// Reconnect Network: privilege escalation stays disabled.
		fireEvent.click(network);
		await waitFor(() =>
			expect(set).toHaveBeenCalledWith(MockWorkspace.id, "sudo"),
		);
	});

	it("adds the network to a privilege lock (Lock Down), and Unlock lifts both", async () => {
		const get = vi
			.spyOn(PlatformAPI, "getLockdown")
			.mockResolvedValue(lock({ locked: true, modes: ["sudo"] }));
		const set = vi.spyOn(PlatformAPI, "setLockdown").mockResolvedValue({
			...lock({ locked: true, modes: ["network", "sudo"] }),
			applied: "now",
			error: null,
		});
		renderWith(<LockdownBadge workspace={MockWorkspace} />);
		const open = async () =>
			fireEvent.pointerDown(await screen.findByTestId("workspace-lockdown"), {
				button: 0,
				ctrlKey: false,
			});
		await open();
		await waitFor(() => expect(get).toHaveBeenCalled());
		const network = await screen.findByTestId("lockdown-network");
		await waitFor(() =>
			expect(network).toHaveTextContent("Disconnect Network"),
		);
		fireEvent.click(network);
		await waitFor(() =>
			expect(set).toHaveBeenCalledWith(MockWorkspace.id, "complete"),
		);
		await open();
		fireEvent.click(await screen.findByTestId("lockdown-complete"));
		await waitFor(() =>
			expect(set).toHaveBeenLastCalledWith(MockWorkspace.id, "off"),
		);
	});

	it("while frozen, only Unfreeze", async () => {
		vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(
			lock({ locked: true, modes: ["network", "sudo", "freeze"] }),
		);
		renderWith(<LockdownBadge workspace={MockWorkspace} />);
		fireEvent.pointerDown(await screen.findByTestId("workspace-lockdown"), {
			button: 0,
			ctrlKey: false,
		});
		const freeze = await screen.findByTestId("lockdown-freeze");
		await waitFor(() => expect(freeze).toHaveTextContent("Unfreeze"));
		expect(freeze).not.toHaveAttribute("data-disabled");
		expect(screen.getByTestId("lockdown-network")).toHaveAttribute(
			"data-disabled",
		);
		expect(screen.getByTestId("lockdown-complete")).toHaveTextContent("Unlock");
	});
});

it("opens quarantine review from the shield without changing isolation", async () => {
	vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(lock({}));
	const get = vi
		.spyOn(WorkspaceQuarantineAPI, "get")
		.mockResolvedValue({ ...MockWorkspaceQuarantine, enabled: false });
	const set = vi.spyOn(WorkspaceQuarantineAPI, "set");
	renderWithAuth(
		<LockdownBadge workspace={MockWorkspace} modes={[]} goldIcon />,
	);
	const user = userEvent.setup();
	await user.click(
		await screen.findByRole("button", {
			name: `Lock Down ${MockWorkspace.owner_name}/${MockWorkspace.name}`,
		}),
	);
	await user.click(screen.getByRole("menuitem", { name: "Quarantine" }));
	await waitFor(() =>
		expect(get).toHaveBeenCalledWith(
			MockWorkspace.organization_id,
			MockWorkspace.id,
		),
	);
	expect(set).not.toHaveBeenCalled();
});

it("uses dashboard lockdown actions in an account panel", async () => {
	vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(lock({}));
	const set = vi
		.spyOn(PlatformAPI, "setLockdown")
		.mockResolvedValue({
			...lock({ modes: ["network"], locked: true }),
			applied: "now",
			error: null,
		});
	renderWith(<LockdownBadge workspace={MockWorkspace} panel />);
	const user = userEvent.setup();
	await user.click(
		await screen.findByRole("button", { name: /Disconnect Network/ }),
	);
	await waitFor(() =>
		expect(set).toHaveBeenCalledWith(MockWorkspace.id, "network"),
	);
});
