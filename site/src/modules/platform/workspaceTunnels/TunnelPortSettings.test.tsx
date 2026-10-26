import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { render } from "#/testHelpers/renderHelpers";
import { MockWorkspaceTunnel } from "#/testHelpers/workspaceTunnels";
import { TunnelPortSettings } from "./TunnelPortSettings";

const tunnel = {
	...MockWorkspaceTunnel,
	ports: null,
	revision: 5,
	port_settings_supported: true,
};
afterEach(() => vi.restoreAllMocks());
it("saves explicit TCP and UDP services with the reviewed revision", async () => {
	const update = vi
		.spyOn(PlatformAPI, "updateWorkspaceTunnelPorts")
		.mockResolvedValue({ tunnel: { ...tunnel, revision: 6 } });
	render(<TunnelPortSettings tunnel={tunnel} />);
	const user = userEvent.setup();
	await user.click(screen.getByRole("checkbox", { name: "Allow all ports" }));
	await user.type(
		screen.getByRole("textbox", { name: "TCP service ports" }),
		"27182, 8080",
	);
	await user.type(
		screen.getByRole("textbox", { name: "UDP service ports" }),
		"5353",
	);
	await user.click(screen.getByRole("button", { name: "Save port settings" }));
	await waitFor(() =>
		expect(update).toHaveBeenCalledWith(tunnel.organization_id, tunnel.id, 5, [
			{ protocol: "tcp", port: 27182 },
			{ protocol: "tcp", port: 8080 },
			{ protocol: "udp", port: 5353 },
		]),
	);
});
it("does not submit empty, invalid, or duplicate port rules", async () => {
	const update = vi.spyOn(PlatformAPI, "updateWorkspaceTunnelPorts");
	render(<TunnelPortSettings tunnel={tunnel} />);
	const user = userEvent.setup();
	await user.click(screen.getByRole("checkbox", { name: "Allow all ports" }));
	for (const text of ["", "0", "65536", "80, 80", "22; touch file"]) {
		const input = screen.getByRole("textbox", { name: "TCP service ports" });
		await user.clear(input);
		if (text) await user.type(input, text);
		await user.click(
			screen.getByRole("button", { name: "Save port settings" }),
		);
	}
	expect(update).not.toHaveBeenCalled();
});
