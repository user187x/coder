import { render, screen } from "@testing-library/react";
import { quotaLevel, WorkspaceQuotaPillView } from "./WorkspaceQuotaPill";

const none = { workspaces: null, cpu: null, memory: null, disk: null };

describe("WorkspaceQuotaPillView", () => {
	it("shows nothing when no limit applies (none set, or an exempt admin)", () => {
		const { container } = render(
			<WorkspaceQuotaPillView
				quota={{ limited: false, exempt: true, limits: none }}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("shows each limit set: what is used, of what, and what is left", () => {
		render(
			<WorkspaceQuotaPillView
				quota={{
					limited: true,
					exempt: false,
					limits: { workspaces: 3, cpu: 8, memory: null, disk: null },
					usage: { workspaces: 3, cpu: 6.5, memory: 12, disk: 0 },
					left: { workspaces: 0, cpu: 1.5, memory: null, disk: null },
					atLimit: true,
				}}
			/>,
		);
		const ws = screen.getByTestId("quota-workspaces");
		expect(ws).toHaveTextContent("3/3");
		expect(ws).toHaveTextContent("(0 left)");
		expect(ws).toHaveAttribute("data-level", "full");
		const cpu = screen.getByTestId("quota-cpu");
		expect(cpu).toHaveTextContent("6.5/8 cores");
		expect(cpu).toHaveTextContent("(1.5 left)");
		expect(cpu).toHaveAttribute("data-level", "near");
		expect(screen.queryByTestId("quota-memory")).toBeNull();
	});

	it("levels: fine under 80%, near from 80%, full at the limit", () => {
		expect(quotaLevel(1, 4)).toBe("ok");
		expect(quotaLevel(4, 5)).toBe("near");
		expect(quotaLevel(5, 5)).toBe("full");
		expect(quotaLevel(0, 0)).toBe("full");
	});
});
