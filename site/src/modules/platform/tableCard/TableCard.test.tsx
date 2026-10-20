import { act, fireEvent, render, screen } from "@testing-library/react";
import { TableCard } from "./TableCard";

const table = (
	<table>
		<tbody>
			<tr data-hint="Open coder">
				<td>
					<button type="button" title="Restart coder">
						r
					</button>
					<span>plain</span>
					<button type="button" aria-label="Open Terminal">
						t
					</button>
				</td>
			</tr>
		</tbody>
	</table>
);

describe("TableCard", () => {
	it("says what the table holds, and in one place what the element pointed at or focused does", () => {
		render(
			<TableCard summary="Showing 2 of 2 workspaces" hint="Point at anything">
				{table}
			</TableCard>,
		);
		const hint = screen.getByTestId("table-card-hint");
		expect(screen.getByTestId("table-card-footer")).toHaveTextContent(
			"Showing 2 of 2 workspaces",
		);
		expect(hint).toHaveTextContent("Point at anything");

		const restart = screen.getByTitle("Restart coder");
		fireEvent.pointerOver(restart);
		expect(hint).toHaveTextContent("Restart coder");
		// said in the footer, not by a browser tooltip as well
		expect(restart).not.toHaveAttribute("title");
		expect(restart).toHaveAttribute("data-hint", "Restart coder");

		fireEvent.pointerOver(screen.getByText("plain"));
		expect(hint).toHaveTextContent("Open coder");

		act(() => screen.getByRole("button", { name: "Open Terminal" }).focus());
		expect(hint).toHaveTextContent("Open Terminal");

		fireEvent.pointerLeave(screen.getByText("plain").closest(".table-card")!);
		expect(hint).toHaveTextContent("Point at anything");
	});

	it("has no footer without a summary", () => {
		render(<TableCard>{table}</TableCard>);
		expect(screen.queryByTestId("table-card-footer")).toBeNull();
	});
});
