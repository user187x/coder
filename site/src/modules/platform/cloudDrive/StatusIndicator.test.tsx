import { render, screen } from "@testing-library/react";
import { StatusIndicator } from "./CloudDriveSettings";

const connected = {
	connected: true,
	error: null,
	latencyMs: 3,
	bucketExists: true,
	checkedAt: 1,
};

describe("StatusIndicator", () => {
	it("flashes its green light like an LED while the drive transfers, and only while connected", () => {
		const { rerender } = render(
			<StatusIndicator status={connected} compact active />,
		);
		const light = screen.getByTestId("cloud-drive-status-light");
		expect(light).toHaveAttribute("data-active", "true");
		expect(light).toHaveClass("cd-led-active", "bg-content-success");
		rerender(<StatusIndicator status={connected} compact />);
		expect(light).not.toHaveAttribute("data-active");
		rerender(
			<StatusIndicator
				status={{ ...connected, connected: false, error: "down" }}
				compact
				active
			/>,
		);
		expect(light).not.toHaveClass("cd-led-active");
	});
});
