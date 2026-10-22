import { render, screen } from "@testing-library/react";
import { BuildFooterBar } from "./BuildFooterBar";
import { BuildFooterEnd } from "./footerEnd";

describe("BuildFooterBar", () => {
	it("puts the build's time just after its name, and the card's Uptime at the far right", () => {
		render(
			<BuildFooterEnd.Provider value={<span>Uptime 1h 40m</span>}>
				<BuildFooterBar open={false} onOpenChange={vi.fn()} total="4.25s" />
			</BuildFooterEnd.Provider>,
		);
		const bar = screen.getByTestId("build-timeline-bar");
		const label = bar.querySelector(".build-footer-label");
		expect(label).toHaveTextContent("Build timeline4.25s");
		expect(screen.getByTestId("build-timeline-end")).toHaveTextContent(
			"Uptime 1h 40m",
		);
		expect(bar.lastElementChild).toBe(screen.getByTestId("build-timeline-end"));
	});
});
