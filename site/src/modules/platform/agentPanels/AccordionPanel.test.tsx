import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import type { WorkspaceApp } from "#/api/typesGenerated";
import {
	MockWorkspace,
	MockWorkspaceAgent,
	MockWorkspaceApp,
} from "#/testHelpers/entities";
import { AccordionPanel } from "./AccordionPanel";
import { AddPanelTab } from "./AddPanelTab";
import { canBePanel } from "./AgentAppPanel";
import { AgentPortPanel, AgentWebPanel, webAddress } from "./AgentLinkPanels";
import { TERMINAL_EXITED } from "./terminalExited";

const base = {
	id: "app:x",
	initiallyOpen: false,
	height: undefined,
	onHeightChange: vi.fn(),
	onRemove: vi.fn(),
	handle: null,
};

describe("the accordion panel", () => {
	it("starts the default app session on readiness and preserves it when collapsed", async () => {
		const start = vi.fn();
		const stop = vi.fn();
		const Session = () => {
			useEffect(() => {
				start();
				return stop;
			}, []);
			return null;
		};
		const content = (unavailable?: string) => (
			<AccordionPanel
				{...base}
				initiallyOpen
				title="Browser"
				kind="app"
				slug="browser"
				unavailable={unavailable}
			>
				<Session />
			</AccordionPanel>
		);
		const { rerender, unmount } = render(content("Starting"));
		expect(start).not.toHaveBeenCalled();
		rerender(content());
		expect(start).toHaveBeenCalledTimes(1);
		await userEvent.click(screen.getByRole("button", { name: "Browser" }));
		rerender(content());
		expect(start).toHaveBeenCalledTimes(1);
		expect(stop).not.toHaveBeenCalled();
		unmount();
		expect(stop).toHaveBeenCalledTimes(1);
	});

	it("closes and recreates a browser unless Keep session is enabled", async () => {
		const close = vi.fn().mockResolvedValue(undefined);
		const start = vi.fn();
		const stop = vi.fn();
		const Session = () => {
			useEffect(() => {
				start();
				return stop;
			}, []);
			return null;
		};
		render(
			<AccordionPanel
				{...base}
				initiallyOpen
				title="Web Browser"
				kind="app"
				slug="neko-browser"
				onCloseSession={close}
			>
				<Session />
			</AccordionPanel>,
		);
		await userEvent.click(screen.getByRole("button", { name: "Web Browser" }));
		expect(close).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
		await userEvent.click(screen.getByRole("button", { name: "Web Browser" }));
		expect(start).toHaveBeenCalledTimes(2);
		await userEvent.click(screen.getByRole("switch", { name: "Keep session" }));
		await userEvent.click(screen.getByRole("button", { name: "Web Browser" }));
		expect(close).toHaveBeenCalledTimes(1);
		expect(stop).toHaveBeenCalledTimes(1);
	});

	it("keeps the browser session mounted when closing fails", async () => {
		const stop = vi.fn();
		const Session = () => {
			useEffect(() => stop, []);
			return null;
		};
		const close = vi.fn().mockRejectedValue(new Error("Unavailable"));
		render(
			<AccordionPanel
				{...base}
				initiallyOpen
				title="Web Browser"
				kind="app"
				slug="neko-browser"
				onCloseSession={close}
			>
				<Session />
			</AccordionPanel>,
		);
		await userEvent.click(screen.getByRole("button", { name: "Web Browser" }));
		expect(close).toHaveBeenCalledTimes(1);
		expect(stop).not.toHaveBeenCalled();
	});

	it("wraps anything: closed it shows nothing, opened it mounts it and keeps it when rolled up", () => {
		render(
			<AccordionPanel {...base} title="Anything" kind="custom" slug="anything">
				<p>the app</p>
			</AccordionPanel>,
		);
		expect(screen.queryByText("the app")).toBeNull();
		const header = screen.getByRole("button", { name: "Anything" });
		fireEvent.click(header);
		expect(screen.getByText("the app")).toBeVisible();
		fireEvent.click(header);
		// rolled up: still there (an app keeps its state), only hidden
		expect(screen.getByText("the app")).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: "Remove the Anything panel" }),
		);
		expect(base.onRemove).toHaveBeenCalled();
	});

	it("its terminal's shell exiting rolls it up and starts over (unmounted: the next open is a new session)", () => {
		render(
			<AccordionPanel
				{...base}
				initiallyOpen
				title="Ghostty"
				kind="app"
				slug="ghostty"
			>
				<iframe title="terminal" />
			</AccordionPanel>,
		);
		const frame = screen.getByTitle("terminal") as HTMLIFrameElement;
		// another window's message is not its terminal's
		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: TERMINAL_EXITED },
					origin: window.location.origin,
					source: window,
				}),
			);
		});
		expect(screen.getByTitle("terminal")).toBeInTheDocument();
		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: TERMINAL_EXITED },
					origin: window.location.origin,
					source: frame.contentWindow,
				}),
			);
		});
		expect(screen.queryByTitle("terminal")).toBeNull();
		expect(screen.getByRole("button", { name: "Ghostty" })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
	});

	it("does not open while it can't, and says why", () => {
		render(
			<AccordionPanel
				{...base}
				initiallyOpen
				title="Later"
				unavailable="Opens when the workspace is ready"
				kind="app"
				slug="later"
			>
				<p>the app</p>
			</AccordionPanel>,
		);
		expect(screen.getByText("Opens when the workspace is ready")).toBeVisible();
		expect(screen.queryByText("the app")).toBeNull();
	});
});

describe("any app in a panel", () => {
	const app = (over: Partial<WorkspaceApp>): WorkspaceApp => ({
		...MockWorkspaceApp,
		...over,
	});

	it("takes the workspace's apps, command apps and external web pages; not hidden ones or IDEs on the computer", () => {
		expect(canBePanel(app({}))).toBe(true);
		expect(canBePanel(app({ command: "btop" }))).toBe(true);
		expect(
			canBePanel(app({ external: true, url: "https://docs.example.com" })),
		).toBe(true);
		expect(canBePanel(app({ hidden: true }))).toBe(false);
		expect(
			canBePanel(
				app({ external: true, url: "vscode://coder.coder-remote/open" }),
			),
		).toBe(false);
		expect(
			canBePanel(
				app({
					external: true,
					url: "jetbrains://gateway?token=$SESSION_TOKEN",
				}),
			),
		).toBe(false);
	});

	it("knows a web address", () => {
		expect(webAddress(" https://example.com/a ")?.host).toBe("example.com");
		expect(webAddress("ftp://example.com")).toBeNull();
		expect(webAddress("not an address")).toBeNull();
	});

	it("shows a listening port through port forwarding, and a web page sandboxed on Coder's own host", () => {
		render(
			<>
				<AgentPortPanel
					{...base}
					id="app:p"
					initiallyOpen
					workspace={MockWorkspace}
					agent={MockWorkspaceAgent}
					ready
					host="*.coder.example.com"
					port={3000}
					protocol="http"
					process="node"
				/>
				<AgentWebPanel
					{...base}
					id="app:w"
					initiallyOpen
					url={`${window.location.origin}/some/page`}
				/>
			</>,
		);
		const port = screen.getByTitle("node :3000");
		expect(port.getAttribute("src")).toMatch(/^http:\/\/3000--/);
		expect(screen.getByText("HTTP :3000")).toBeVisible();
		const page = screen.getByTitle(window.location.host);
		expect(page.getAttribute("sandbox")).not.toMatch(/allow-same-origin/);
	});

	it("adds multiple independent terminal panels from the menu", async () => {
		const onAdd = vi.fn();
		render(<AddPanelTab apps={[]} terminal disabled={false} onAdd={onAdd} />);
		for (let i = 0; i < 2; i++) {
			await userEvent.click(
				screen.getByRole("button", { name: "Add a panel" }),
			);
			await userEvent.click(screen.getByRole("menuitem", { name: "Terminal" }));
		}
		expect(onAdd.mock.calls).toEqual([
			[{ kind: "terminal" }],
			[{ kind: "terminal" }],
		]);
	});

	it("adds an app from the + tab - apps only, no ports or web addresses", () => {
		const onAdd = vi.fn();
		render(
			<AddPanelTab
				apps={[
					app({ id: "a", slug: "code-server", display_name: "code-server" }),
					app({ id: "b", slug: "htop", display_name: "htop", command: "htop" }),
				]}
				disabled={false}
				onAdd={onAdd}
			/>,
		);
		fireEvent.pointerDown(screen.getByRole("button", { name: "Add a panel" }), {
			button: 0,
			ctrlKey: false,
		});
		expect(
			screen.getByRole("menuitem", { name: /htop.*terminal/ }),
		).toBeVisible();
		expect(screen.queryByText("Open ports")).toBeNull();
		expect(screen.queryByRole("menuitem", { name: /web address/ })).toBeNull();
		fireEvent.click(screen.getByRole("menuitem", { name: /code-server/ }));
		expect(onAdd).toHaveBeenLastCalledWith({
			kind: "app",
			slug: "code-server",
		});
	});
});
