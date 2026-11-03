import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { TemplateFiles } from "./TemplateFiles";

vi.mock("#/components/SyntaxHighlighter/SyntaxHighlighter", () => ({
	SyntaxHighlighter: () => null,
}));
it("shares a file selection between the tabs, address and edit destination", async () => {
	const user = userEvent.setup();
	const { router } = renderWithAuth(
		<TemplateFiles
			templateName="default"
			organizationName="default"
			versionName="v1"
			currentFiles={{ "main.tf": "template", "scripts/start up.sh": "echo ok" }}
		/>,
	);
	await user.click(
		await screen.findByRole("tab", { name: "scripts/start up.sh" }),
	);
	expect(decodeURIComponent(router.state.location.hash)).toBe(
		"#scripts/start up.sh",
	);
	await user.click(screen.getByRole("link", { name: "Edit" }));
	expect(new URLSearchParams(router.state.location.search).get("path")).toBe(
		"scripts/start up.sh",
	);
});
