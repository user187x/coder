import { screen, within } from "@testing-library/react";
import type { ImageAddons as Addons } from "#/api/images";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { ImageAddons } from "./ImageAddons";

const addons: Addons = {
	base: "codercom/enterprise-base:ubuntu",
	builtAt: "2026-10-13T11:00:00Z",
	software: [
		{
			name: "k9s",
			what: "Kubernetes in the terminal",
			group: "Kubernetes",
			version: "0.50.18",
		},
		{
			name: "code-server",
			what: "VS Code in the browser",
			group: "Apps",
			version: "4.141.0",
		},
		{
			name: "JetBrains Mono Nerd Font",
			what: "The default font",
			group: "Fonts",
			version: null,
		},
	],
	packages: {
		added: [
			{ name: "firefox", version: "157.0.1" },
			{ name: "xfce4", version: "4.20.1" },
		],
		dependencies: 800,
		upgraded: 3,
		installed: 1300,
	},
	python: {
		environment: "/opt/venv",
		packages: [{ name: "numpy", version: "2.4.0" }],
	},
};

describe("ImageAddons", () => {
	it("lists every program with its version, apps first, then the packages", () => {
		renderComponent(<ImageAddons addons={addons} />);
		const rows = screen.getAllByTestId("addon");
		expect(
			rows.map((r) => within(r).getAllByRole("cell")[0].textContent),
		).toEqual(["code-server", "k9s", "JetBrains Mono Nerd Font"]);
		expect(within(rows[0]).getByText("4.141.0")).toBeInTheDocument();
		expect(within(rows[2]).getByText("–")).toBeInTheDocument(); // a font has no version
		expect(screen.getByText(/2 apt packages added/)).toBeInTheDocument();
		expect(screen.getByText(/800 they depend on/)).toBeInTheDocument();
		expect(screen.getByText("firefox")).toBeInTheDocument();
		expect(screen.getByText(/1 Python packages/)).toBeInTheDocument();
		expect(
			screen.getByText("codercom/enterprise-base:ubuntu"),
		).toBeInTheDocument();
	});
});
