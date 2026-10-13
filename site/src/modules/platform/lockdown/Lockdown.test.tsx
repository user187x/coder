import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI, type WorkspaceLockdown } from "#/api/platform";
import { MockWorkspace } from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { LockdownBanner, LockdownButton, modeOf } from "./Lockdown";

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
			"Locked down: Complete (no network but Coder, no sudo)",
		);
		expect(banner.textContent).toContain("By admin");
		expect(banner.textContent).toContain("In force in the running workspace.");
	});

	it("shows no control to someone who may not change it", async () => {
		const get = vi
			.spyOn(PlatformAPI, "getLockdown")
			.mockResolvedValue(lock({ canChange: false }));
		renderWith(<LockdownButton workspace={MockWorkspace} />);
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
		renderWith(<LockdownButton workspace={MockWorkspace} />);
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
});
