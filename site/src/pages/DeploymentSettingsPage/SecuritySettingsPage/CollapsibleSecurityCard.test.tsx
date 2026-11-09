import { fireEvent, render, screen } from "@testing-library/react";
import { CollapsibleSecurityCard } from "./CollapsibleSecurityCard";

afterEach(() => localStorage.clear());

it("folds a card to its title and remembers it", () => {
	const { unmount } = render(
		<CollapsibleSecurityCard id="certificates" title="Certificates">
			<p>Certificate list</p>
		</CollapsibleSecurityCard>,
	);
	expect(screen.queryByText("Certificate list")).not.toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "Collapse Certificates" }),
	);
	expect(screen.queryByText("Certificate list")).toBeNull();
	unmount();
	render(
		<CollapsibleSecurityCard id="certificates" title="Certificates">
			<p>Certificate list</p>
		</CollapsibleSecurityCard>,
	);
	expect(screen.queryByText("Certificate list")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Expand Certificates" }));
	expect(screen.queryByText("Certificate list")).not.toBeNull();
});
