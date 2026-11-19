import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

it("remembers an explicit expansion for a default-collapsed card", async () => {
	const user = userEvent.setup();
	const card = (
		<CollapsibleSecurityCard
			id="tls"
			title="TLS Configurations"
			defaultOpen={false}
		>
			<p>Configuration options</p>
		</CollapsibleSecurityCard>
	);
	const { unmount } = render(card);
	await user.click(
		screen.getByRole("button", { name: "Expand TLS Configurations" }),
	);
	unmount();
	render(card);
	await user.click(
		screen.getByRole("button", { name: "Collapse TLS Configurations" }),
	);
	expect(localStorage.getItem("security-expanded-cards")).toBe("[]");
});
