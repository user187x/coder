import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { TableCard } from "#/modules/platform/tableCard/TableCard";
import { DeploymentFooter } from "./DeploymentBanner";

it("keeps refresh available once when the primary table is replaced or removed", async () => {
	const refresh = vi.fn();
	const user = userEvent.setup();
	function Page() {
		const content = useRef<HTMLElement>(null);
		const [tables, setTables] = useState(["Templates", "Workspaces"]);
		return (
			<>
				<main ref={content}>
					{tables.map((name) => (
						<section aria-label={name} key={name}>
							<TableCard summary={name}>
								<button
									type="button"
									onClick={() => setTables(tables.filter((t) => t !== name))}
								>
									Close {name}
								</button>
							</TableCard>
						</section>
					))}
				</main>
				<DeploymentFooter content={content}>
					<button type="button" onClick={refresh}>
						Refresh stats
					</button>
				</DeploymentFooter>
			</>
		);
	}
	render(<Page />);
	for (const name of ["Templates", "Workspaces"]) {
		const region = within(screen.getByRole("region", { name }));
		await user.click(
			await region.findByRole("button", { name: "Refresh stats" }),
		);
		await user.click(region.getByRole("button", { name: `Close ${name}` }));
	}
	await user.click(
		await screen.findByRole("button", { name: "Refresh stats" }),
	);
	expect(refresh).toHaveBeenCalledTimes(3);
});
