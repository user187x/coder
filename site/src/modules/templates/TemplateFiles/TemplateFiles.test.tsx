import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { MockResizeObserver } from "#/testHelpers/resizeObserver";
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

it("advances the file strip without changing the open file", async () => {
	MockResizeObserver.reset();
	vi.stubGlobal("ResizeObserver", MockResizeObserver);
	try {
		const user = userEvent.setup();
		const { router } = renderWithAuth(
			<TemplateFiles
				templateName="browser"
				organizationName="default"
				versionName="v1"
				currentFiles={{ "main.tf": "tf", "scripts/lockdown.sh": "shell" }}
			/>,
		);
		const list = await screen.findByRole("tablist", { name: "Template files" });
		Object.defineProperties(list, {
			clientWidth: { value: 300 },
			scrollWidth: { value: 900 },
			scrollBy: { value: vi.fn() },
		});
		act(() => MockResizeObserver.getLast().simulateResize(300));
		await user.click(screen.getByRole("button", { name: "Next files" }));
		expect(list.scrollBy).toHaveBeenCalledWith({ left: 225, behavior: "auto" });
		expect(router.state.location.hash).toBe("");
	} finally {
		vi.unstubAllGlobals();
	}
});
