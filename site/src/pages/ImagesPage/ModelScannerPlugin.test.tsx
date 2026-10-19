import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { ImagesAPI, type ModelScanner } from "#/api/images";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { ModelScannerPanel, ShowScannerButton } from "./ModelSecurity";

const scanner = (over: Partial<ModelScanner> = {}): ModelScanner => ({
	enabled: false,
	canEdit: true,
	hidden: false,
	image: "",
	defaultImage: "",
	custom: false,
	candidate: null,
	candidateError: null,
	checking: false,
	error: null,
	garak: null,
	llamaCpp: {},
	python: null,
	builtAt: null,
	calibration: null,
	detectorModels: [],
	datasets: [],
	probes: { active: 0, total: 0 },
	profiles: [],
	profile: "standard",
	releaseGrade: "D",
	latest: {},
	queue: [],
	running: [],
	...over,
});

const wrap = (node: React.ReactNode) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			{node}
		</QueryClientProvider>,
	);

describe("The model scanner, a plug-in", () => {
	afterEach(() => vi.restoreAllMocks());

	it("says no scanner is hooked up, offers Import scanner, and hides on its switch", async () => {
		vi.spyOn(ImagesAPI, "modelScanner").mockResolvedValue(scanner());
		const save = vi
			.spyOn(ImagesAPI, "saveModelScanner")
			.mockResolvedValue(scanner({ hidden: true }));
		wrap(<ModelScannerPanel />);
		expect(await screen.findByTestId("model-scanner-absent")).toHaveTextContent(
			"LLM scanning (garak) is not hooked up",
		);
		fireEvent.click(screen.getByTestId("model-scanner-import"));
		expect(
			await screen.findByTestId("model-scanner-import-dialog"),
		).toHaveTextContent("Import the LLM scanner");
		fireEvent.keyDown(document.activeElement ?? document.body, {
			key: "Escape",
		});
		fireEvent.click(screen.getByTestId("model-scanner-hide"));
		await waitFor(() => expect(save).toHaveBeenCalledWith({ hidden: true }));
	});

	it("hidden: nothing but a Show LLM scanning button for admins", async () => {
		vi.spyOn(ImagesAPI, "modelScanner").mockResolvedValue(
			scanner({ hidden: true }),
		);
		const save = vi
			.spyOn(ImagesAPI, "saveModelScanner")
			.mockResolvedValue(scanner());
		wrap(
			<>
				<ModelScannerPanel />
				<ShowScannerButton />
			</>,
		);
		const show = await screen.findByTestId("model-scanner-show");
		expect(screen.queryByTestId("model-scanner-absent")).toBeNull();
		fireEvent.click(show);
		await waitFor(() => expect(save).toHaveBeenCalledWith({ hidden: false }));
	});

	it("hooked up: the scanner's line, no plug-in notice", async () => {
		vi.spyOn(ImagesAPI, "modelScanner").mockResolvedValue(
			scanner({ enabled: true, garak: "0.17.1", image: "reg/coder-garak:1" }),
		);
		wrap(<ModelScannerPanel />);
		expect(await screen.findByTestId("garak-version")).toHaveTextContent(
			"0.17.1",
		);
		expect(screen.queryByTestId("model-scanner-absent")).toBeNull();
	});
});
