import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MockListeningPortsResponse,
	MockSharedPortsResponse,
	MockTemplate,
	MockWorkspace,
	MockWorkspaceAgent,
} from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import {
	getWorkspaceListeningPortsProtocol,
	portForwardURL,
} from "#/utils/portForward";
import { openPortCount, PortForwardPopoverView } from "./PortForwardButton";

const HOST = "*.example.com";

const renderPopover = () =>
	render(
		<PortForwardPopoverView
			host={HOST}
			workspace={MockWorkspace}
			agent={MockWorkspaceAgent}
			template={MockTemplate}
			sharedPorts={MockSharedPortsResponse.shares}
			listeningPorts={MockListeningPortsResponse.ports}
			portSharingControlsEnabled
			refetchSharedPorts={vi.fn()}
		/>,
	);

const expectedURL = (port: number) =>
	portForwardURL(
		HOST,
		port,
		MockWorkspaceAgent.name,
		MockWorkspace.name,
		MockWorkspace.owner_name,
		getWorkspaceListeningPortsProtocol(MockWorkspace.id),
	);

const typePort = (text: string) =>
	userEvent.type(screen.getByRole("textbox", { name: "Filter ports" }), text);

describe("PortForwardPopoverView", () => {
	it("adds an accessible name to each shared-port delete button", () => {
		renderPopover();

		expect(
			screen.getAllByRole("button", { name: "Delete shared port" }),
		).toHaveLength(MockSharedPortsResponse.shares.length);
	});

	it("opens the typed port in a new tab, ignoring leading zeros and whitespace", async () => {
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		renderPopover();

		await typePort(" 09999 {enter}");

		expect(open).toHaveBeenCalledWith(expectedURL(9999), "_blank");
	});

	it("does not connect when the text is not only a port number", async () => {
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		renderPopover();

		await typePort("8080abc{enter}");
		await userEvent.click(screen.getByRole("button", { name: "Connect" }));

		expect(open).not.toHaveBeenCalled();
	});

	it("does not connect to a port outside the valid range", async () => {
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		renderPopover();

		await typePort("5{enter}");
		await userEvent.click(screen.getByRole("button", { name: "Connect" }));

		expect(open).not.toHaveBeenCalled();
	});
});

describe("openPortCount", () => {
	it("counts each port once, listening or shared on this agent", () => {
		const share = (agent_name: string, port: number) => ({
			workspace_id: "w",
			agent_name,
			port,
			share_level: "authenticated" as const,
			protocol: "http" as const,
		});
		expect(
			openPortCount(
				"main",
				[{ process_name: "", network: "tcp", port: 8110 }],
				[
					share("main", 7777),
					share("main", 8888),
					share("main", 8989),
					share("other", 9000),
				],
			),
		).toBe(4);
		expect(
			openPortCount(
				"main",
				[{ process_name: "node", network: "tcp", port: 7777 }],
				[share("main", 7777)],
			),
		).toBe(1);
	});
});
