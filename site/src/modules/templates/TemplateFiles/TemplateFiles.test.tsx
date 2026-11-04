import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { MockResizeObserver } from "#/testHelpers/resizeObserver";
import { TemplateFiles } from "./TemplateFiles";

const { editorActions } = vi.hoisted(() => ({
	editorActions: new Map<string, () => void>(),
}));
vi.mock("#/components/SyntaxHighlighter/SyntaxHighlighter", () => ({
	SyntaxHighlighter: ({
		editorProps,
		compareWith,
	}: {
		editorProps: { onMount: (pane: object) => void };
		compareWith?: string;
	}) => {
		editorActions.clear();
		editorProps.onMount({
			updateOptions: () => {},
			addAction: ({ label, run }: { label: string; run: () => void }) =>
				editorActions.set(label, run),
		});
		return <output aria-label="Comparison">{compareWith}</output>;
	},
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
		{
			extraRoutes: [
				{ path: "/templates/default/versions/v1/edit", element: <div /> },
			],
		},
	);
	await user.click(
		await screen.findByRole("tab", { name: "scripts/start up.sh" }),
	);
	expect(decodeURIComponent(router.state.location.hash)).toBe(
		"#scripts/start up.sh",
	);
	await waitFor(() =>
		expect(
			screen.getByRole("tab", { name: "scripts/start up.sh" }),
		).toHaveAttribute("aria-selected", "true"),
	);
	await act(async () => editorActions.get("Edit file")?.());
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

it("can switch between the source and diff without granting edit access", async () => {
	renderWithAuth(
		<TemplateFiles
			templateName="default"
			organizationName="default"
			versionName="v1"
			canEdit={false}
			currentFiles={{ "main.tf": "new" }}
			baseFiles={{ "main.tf": "previous" }}
		/>,
	);
	const comparison = await screen.findByLabelText("Comparison");
	expect(comparison).toHaveTextContent("previous");
	expect(editorActions.has("Edit file")).toBe(false);
	act(() => editorActions.get("Hide diff view")?.());
	expect(comparison).toBeEmptyDOMElement();
	act(() => editorActions.get("Show diff view")?.());
	expect(comparison).toHaveTextContent("previous");
});
