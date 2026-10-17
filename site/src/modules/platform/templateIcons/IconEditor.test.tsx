import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI, type TemplateIcon } from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { freeIconName, IconEditor } from "./IconEditor";

vi.mock("../normalizeImage", async (importOriginal) => ({
	...(await importOriginal<typeof import("../normalizeImage")>()),
	// jsdom has no canvas: the picture as it came
	normalizeImage: async () => ({ dataURL: "data:image/png;base64,AAAA" }),
}));

const icon = (name: string): TemplateIcon => ({
	name,
	type: "image/png",
	url: `/__coder-ui/icons/${name}?v=1`,
	bytes: 100,
	uploadedBy: "admin",
	uploadedAt: null,
});

const Harness: React.FC<{ initial: string; fallback?: string }> = ({
	initial,
	fallback,
}) => {
	const [value, setValue] = useState(initial);
	return (
		<>
			<IconEditor
				value={value}
				onChange={setValue}
				fallback={fallback}
				resetLabel="Use the template's"
				uploadName="Data Flow"
			/>
			<output data-testid="value">{value}</output>
		</>
	);
};

const render = (props: React.ComponentProps<typeof Harness>) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<Harness {...props} />
		</QueryClientProvider>,
	);

describe("IconEditor", () => {
	afterEach(() => vi.restoreAllMocks());

	it("never takes another icon's name", () => {
		expect(freeIconName("go", [])).toBe("go");
		expect(freeIconName("go", ["go", "go-2"])).toBe("go-3");
		expect(freeIconName("", [])).toBe("icon");
	});

	it("shows the template's icon faded until one is picked, the uploaded ones a click away, and resets", async () => {
		vi.spyOn(PlatformAPI, "getTemplateIcons").mockResolvedValue({
			icons: [icon("nifi"), icon("airflow")],
			canManage: false,
		});
		render({ initial: "", fallback: "/icon/ubuntu.svg" });
		const preview = screen.getByTestId("icon-preview");
		expect(preview.querySelector("img")).toHaveClass("opacity-45");
		// no Upload for those who may not add icons
		expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull();
		fireEvent.click(await screen.findByRole("option", { name: "airflow" }));
		expect(screen.getByTestId("value")).toHaveTextContent(
			"/__coder-ui/icons/airflow",
		);
		expect(screen.getByRole("option", { name: "airflow" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(preview.querySelector("img")).not.toHaveClass("opacity-45");
		fireEvent.click(screen.getByRole("button", { name: /Use the template's/ }));
		expect(screen.getByTestId("value")).toHaveTextContent("");
	});

	it("uploads a picture to the icon library under a free name and uses it", async () => {
		vi.spyOn(PlatformAPI, "getTemplateIcons").mockResolvedValue({
			icons: [icon("data-flow")],
			canManage: true,
		});
		const upload = vi
			.spyOn(PlatformAPI, "uploadTemplateIcon")
			.mockResolvedValue({ ok: true, url: "/__coder-ui/icons/data-flow-2" });
		render({ initial: "/emojis/1f4bb.png" });
		await screen.findByRole("button", { name: /Upload/ });
		fireEvent.change(screen.getByTestId("icon-upload-input"), {
			target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
		});
		await waitFor(() =>
			expect(upload).toHaveBeenCalledWith({
				name: "data-flow-2",
				dataUrl: "data:image/png;base64,AAAA",
			}),
		);
		await waitFor(() =>
			expect(screen.getByTestId("value")).toHaveTextContent(
				"/__coder-ui/icons/data-flow-2",
			),
		);
	});

	it("takes any address typed", () => {
		vi.spyOn(PlatformAPI, "getTemplateIcons").mockResolvedValue({
			icons: [],
			canManage: false,
		});
		render({ initial: "" });
		fireEvent.change(screen.getByLabelText("Or its address"), {
			target: { value: " /icon/go.svg " },
		});
		expect(screen.getByTestId("value")).toHaveTextContent("/icon/go.svg");
	});
});
