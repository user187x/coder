import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import * as BrowserSessions from "#/api/browserSessions";
import { workspaceByIdKey } from "#/api/queries/workspaces";
import type * as ProxyContextModule from "#/contexts/ProxyContext";
import { render } from "#/testHelpers/renderHelpers";
import { MockSupportBrowserWorkspace } from "#/testHelpers/screenShare";
import { WorkspaceControlScreen } from "./WorkspaceControlScreen";

const appLink = vi.hoisted(() =>
	vi.fn(() => ({ href: "https://workspace.example/", label: "Browser" })),
);
vi.mock("#/modules/apps/useAppLink", () => ({ useAppLink: appLink }));
vi.mock("#/contexts/ProxyContext", async (original) => ({
	...(await original<typeof ProxyContextModule>()),
	useProxy: () => ({ proxy: { preferredWildcardHostname: "*.example" } }),
}));
afterEach(() => {
	vi.restoreAllMocks();
	appLink.mockReset();
});

it("isolates support from the dashboard and gates input with origin-checked messages", async () => {
	vi.spyOn(API, "getWorkspace").mockResolvedValue(MockSupportBrowserWorkspace);
	const close = vi.spyOn(BrowserSessions, "closeBrowserSession");
	const ended = vi.fn();
	const { unmount } = render(
		<WorkspaceControlScreen workspaceId="ws-1" onEnded={ended} />,
	);
	const frame = await screen.findByTitle<HTMLIFrameElement>(
		"TestUser2/dev Browser",
	);
	expect(frame.src).toBe(
		`https://workspace.example/support?support=1&support_build=${MockSupportBrowserWorkspace.latest_build.id}&resize=scale&view_only=true`,
	);
	if (!frame.contentWindow) throw new Error("Missing support frame window");
	const send = vi.spyOn(frame.contentWindow, "postMessage");
	const ready = {
		source: frame.contentWindow,
		origin: "https://workspace.example",
		data: { type: "coder:support-ready" },
	};
	act(() =>
		window.dispatchEvent(
			new MessageEvent("message", {
				...ready,
				origin: "https://attacker.example",
			}),
		),
	);
	act(() =>
		window.dispatchEvent(
			new MessageEvent("message", { ...ready, source: window }),
		),
	);
	expect(send).not.toHaveBeenCalled();
	act(() => window.dispatchEvent(new MessageEvent("message", ready)));
	expect(send).toHaveBeenLastCalledWith(
		{ type: "coder:support-control", enabled: false },
		ready.origin,
	);
	const acknowledged = (enabled: boolean) =>
		new MessageEvent("message", {
			...ready,
			data: { type: "coder:support-control-state", enabled },
		});
	send.mockClear();
	await userEvent.click(
		screen.getByRole("button", { name: "Enable mouse and keyboard" }),
	);
	expect(send).not.toHaveBeenCalled();
	act(() => window.dispatchEvent(acknowledged(false)));
	await userEvent.click(
		screen.getByRole("button", { name: "Enable mouse and keyboard" }),
	);
	expect(send).toHaveBeenLastCalledWith(
		{ type: "coder:support-control", enabled: true },
		ready.origin,
	);
	act(() => window.dispatchEvent(acknowledged(true)));
	await userEvent.click(screen.getByRole("button", { name: "View only" }));
	expect(send).toHaveBeenLastCalledWith(
		{ type: "coder:support-control", enabled: false },
		ready.origin,
	);
	act(() =>
		window.dispatchEvent(
			new MessageEvent("message", {
				...ready,
				data: { type: "coder:support-ended" },
			}),
		),
	);
	expect(ended).toHaveBeenCalledOnce();
	unmount();
	expect(close).not.toHaveBeenCalled();
});

it("revokes input if the viewer does not acknowledge enabling it", async () => {
	vi.spyOn(API, "getWorkspace").mockResolvedValue(MockSupportBrowserWorkspace);
	render(<WorkspaceControlScreen workspaceId="ws-1" onEnded={vi.fn()} />);
	const frame = await screen.findByTitle<HTMLIFrameElement>(
		"TestUser2/dev Browser",
	);
	if (!frame.contentWindow) throw new Error("Missing support frame window");
	const send = vi.spyOn(frame.contentWindow, "postMessage");
	act(() =>
		window.dispatchEvent(
			new MessageEvent("message", {
				source: frame.contentWindow,
				origin: "https://workspace.example",
				data: { type: "coder:support-control-state", enabled: false },
			}),
		),
	);
	vi.useFakeTimers();
	try {
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		await user.click(
			screen.getByRole("button", { name: "Enable mouse and keyboard" }),
		);
		expect(send).toHaveBeenLastCalledWith(
			{ type: "coder:support-control", enabled: true },
			"https://workspace.example",
		);
		act(() => vi.advanceTimersByTime(15000));
		expect(send).toHaveBeenLastCalledWith(
			{ type: "coder:support-control", enabled: false },
			"https://workspace.example",
		);
	} finally {
		vi.useRealTimers();
	}
});

it("disconnects when workspace access is revoked", async () => {
	const get = vi
		.spyOn(API, "getWorkspace")
		.mockResolvedValue(MockSupportBrowserWorkspace);
	const { queryClient } = render(
		<WorkspaceControlScreen workspaceId="ws-1" onEnded={vi.fn()} />,
	);
	const frame = await screen.findByTitle<HTMLIFrameElement>(
		"TestUser2/dev Browser",
	);
	if (!frame.contentWindow) throw new Error("Missing support frame window");
	const send = vi.spyOn(frame.contentWindow, "postMessage");
	const ready = new MessageEvent("message", {
		source: frame.contentWindow,
		origin: "https://workspace.example",
		data: { type: "coder:support-ready" },
	});
	act(() => window.dispatchEvent(ready));
	expect(send).toHaveBeenCalledOnce();
	send.mockClear();
	get.mockRejectedValue(new Error("Forbidden"));
	await act(() => queryClient.invalidateQueries());
	await waitFor(() =>
		expect(queryClient.getQueryState(workspaceByIdKey("ws-1"))?.status).toBe(
			"error",
		),
	);
	act(() => window.dispatchEvent(ready));
	expect(send).not.toHaveBeenCalled();
});

it.each(["http://workspace.example/", window.location.origin])(
	"refuses an insecure app host %s",
	async (href) => {
		appLink.mockReturnValue({ href, label: "Browser" });
		vi.spyOn(API, "getWorkspace").mockResolvedValue(
			MockSupportBrowserWorkspace,
		);
		render(<WorkspaceControlScreen workspaceId="ws-1" onEnded={vi.fn()} />);
		await screen.findByText(
			"Workspace support requires an isolated HTTPS app host.",
		);
		expect(
			screen.queryByTitle("TestUser2/dev Browser"),
		).not.toBeInTheDocument();
	},
);

it("asks a desktop viewer for full JPEG quality", async () => {
	const [resource] = MockSupportBrowserWorkspace.latest_build.resources;
	const [agent] = resource?.agents ?? [];
	if (!resource || !agent) throw new Error("Missing support agent fixture");
	vi.spyOn(API, "getWorkspace").mockResolvedValue({
		...MockSupportBrowserWorkspace,
		latest_build: {
			...MockSupportBrowserWorkspace.latest_build,
			resources: [
				{
					...resource,
					agents: [
						{
							...agent,
							apps: agent.apps.map((app) => ({
								...app,
								slug: "desktop",
								display_name: "Desktop",
							})),
						},
					],
				},
			],
		},
	});
	render(<WorkspaceControlScreen workspaceId="ws-1" onEnded={vi.fn()} />);
	const frame = await screen.findByTitle<HTMLIFrameElement>(
		"TestUser2/dev Desktop",
	);
	expect(new URL(frame.src).searchParams.get("quality")).toBe("9");
});
