import { fireEvent, render, screen } from "@testing-library/react";
import type {
	WorkspaceAgentListeningPort,
	WorkspaceApp,
} from "#/api/typesGenerated";
import {
	MockWorkspace,
	MockWorkspaceAgent,
	MockWorkspaceApp,
} from "#/testHelpers/entities";
import { AccordionPanel } from "./AccordionPanel";
import { AddPanelTab } from "./AddPanelTab";
import { canBePanel } from "./AgentAppPanel";
import { AgentPortPanel, AgentWebPanel, webAddress } from "./AgentLinkPanels";

const base = {
	id: "app:x",
	initiallyOpen: false,
	height: undefined,
	onHeightChange: vi.fn(),
	onRemove: vi.fn(),
	handle: null,
};

describe("the accordion panel", () => {
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

	it("adds an app, a port or a web address from the + tab", () => {
		const onAdd = vi.fn();
		const ports: WorkspaceAgentListeningPort[] = [
			{ port: 8080, process_name: "vite", network: "tcp" },
		];
		render(
			<AddPanelTab
				apps={[
					app({ id: "a", slug: "code-server", display_name: "code-server" }),
					app({ id: "b", slug: "htop", display_name: "htop", command: "htop" }),
				]}
				ports={ports}
				protocol="https"
				disabled={false}
				onAdd={onAdd}
			/>,
		);
		const open = () =>
			fireEvent.pointerDown(
				screen.getByRole("button", { name: "Add a panel" }),
				{
					button: 0,
					ctrlKey: false,
				},
			);
		open();
		expect(
			screen.getByRole("menuitem", { name: /htop.*terminal/ }),
		).toBeVisible();
		fireEvent.click(screen.getByRole("menuitem", { name: /8080/ }));
		expect(onAdd).toHaveBeenLastCalledWith({
			kind: "port",
			port: 8080,
			protocol: "https",
			process: "vite",
		});
		open();
		fireEvent.click(screen.getByRole("menuitem", { name: /A web address/ }));
		fireEvent.change(screen.getByLabelText("Address"), {
			target: { value: "https://grafana.example.com/d/abc" },
		});
		fireEvent.change(screen.getByLabelText("Name (optional)"), {
			target: { value: "Grafana" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add the panel" }));
		expect(onAdd).toHaveBeenLastCalledWith({
			kind: "web",
			url: "https://grafana.example.com/d/abc",
			name: "Grafana",
		});
	});
});
