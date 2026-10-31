import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { createMemoryRouter } from "react-router";
import type { Workspace } from "#/api/typesGenerated";
import { MockWorkspace } from "#/testHelpers/entities";
import { MockBanner } from "#/testHelpers/platform";
import { render, renderWithRouter } from "#/testHelpers/renderHelpers";
import { BannerScrollView } from "./BannerScrollView";
import {
	TerminalConnectorAvatar,
	TerminalConnectorCable,
} from "./TerminalConnector";
import {
	connectBannerTerminal,
	registerTerminalBanner,
	resetConnector,
	updateConnector,
	useTerminalConnector,
} from "./terminalConnector";

const sessions = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));
vi.mock(import("./TerminalConnector"), async (importOriginal) => {
	const original = await importOriginal();
	const { useEffect } = await import("react");
	return {
		...original,
		BannerWorkspaceTerminal: ({ workspace }: { workspace: Workspace }) => {
			useEffect(() => {
				sessions.open(workspace.id);
				return () => sessions.close(workspace.id);
			}, [workspace.id]);
			return <div />;
		},
	};
});

it("routes direct connections to one visible banner and releases unmounted targets", async () => {
	const changed = vi.fn();
	const Observe = () => {
		changed(useTerminalConnector());
		return null;
	};
	const removeHidden = registerTerminalBanner("hidden-banner", () => false);
	const removeVisible = registerTerminalBanner("visible-banner", () => true);
	try {
		render(<Observe />);
		await act(() => {
			expect(connectBannerTerminal(MockWorkspace)).toBe(true);
		});
		expect(changed).toHaveBeenLastCalledWith(
			expect.objectContaining({
				ownerId: "visible-banner",
				workspace: MockWorkspace,
				armed: false,
			}),
		);
		removeVisible();
		expect(connectBannerTerminal(MockWorkspace)).toBe(false);
	} finally {
		removeHidden();
		removeVisible();
	}
});

afterEach(() => {
	resetConnector();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

it("opens one terminal in the banner that armed the connector and closes its session", async () => {
	const Banner = ({ name }: { name: string }) => {
		const anchor = useRef<HTMLDivElement>(null);
		return (
			<section aria-label={name} ref={anchor}>
				<BannerScrollView anchor={anchor} banner={MockBanner} />
			</section>
		);
	};
	renderWithRouter(
		createMemoryRouter(
			[
				{
					path: "/workspaces",
					element: (
						<>
							<Banner name="Desktop banner" />
							<Banner name="Mobile banner" />
							<TerminalConnectorAvatar workspace={MockWorkspace}>
								<span>Avatar</span>
							</TerminalConnectorAvatar>
						</>
					),
				},
			],
			{ initialEntries: ["/workspaces"] },
		),
	);
	const user = userEvent.setup();
	const banner = within(screen.getByRole("region", { name: "Desktop banner" }));
	await user.click(
		banner.getByRole("button", { name: "Read the whole announcement" }),
	);
	await user.keyboard("terminal{Enter}");
	const avatar = screen.getByRole("button", {
		name: `Connect ${MockWorkspace.name} to banner terminal`,
	});
	for (let i = 0; i < 6 && document.activeElement !== avatar; i++) {
		await user.tab();
	}
	await user.keyboard("{Enter}");
	await waitFor(() =>
		expect(sessions.open).toHaveBeenCalledExactlyOnceWith(MockWorkspace.id),
	);
	await user.click(
		screen.getByRole("button", { name: "Expand announcement panel" }),
	);
	await user.click(
		screen.getByRole("button", { name: "Restore announcement panel" }),
	);
	expect(sessions.open).toHaveBeenCalledExactlyOnceWith(MockWorkspace.id);
	expect(sessions.close).not.toHaveBeenCalled();
	await user.click(
		banner.getByRole("button", { name: "Close the full announcement" }),
	);
	await waitFor(() =>
		expect(sessions.close).toHaveBeenCalledExactlyOnceWith(MockWorkspace.id),
	);
});
it("connects the chosen workspace with the keyboard and cancels arming with Escape", async () => {
	const connected = vi.fn();
	const Observe = () => {
		const state = useTerminalConnector();
		connected(state);
		return null;
	};
	render(
		<>
			<TerminalConnectorAvatar workspace={MockWorkspace}>
				<span>Avatar</span>
			</TerminalConnectorAvatar>
			<TerminalConnectorCable />
			<Observe />
		</>,
	);
	const user = userEvent.setup();
	await act(() => updateConnector({ armed: true }));
	await user.tab();
	await user.keyboard("{Enter}");
	await waitFor(() =>
		expect(connected).toHaveBeenLastCalledWith(
			expect.objectContaining({ workspace: MockWorkspace, armed: false }),
		),
	);
	await act(() => {
		resetConnector();
		updateConnector({ armed: true });
	});
	await user.keyboard("{Escape}");
	await waitFor(() =>
		expect(connected).toHaveBeenLastCalledWith(
			expect.objectContaining({ workspace: null, armed: false }),
		),
	);
});
