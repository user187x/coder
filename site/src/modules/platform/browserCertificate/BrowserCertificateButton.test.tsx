import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as certificateAPI from "#/api/browserCertificate";
import { MockBrowserCertificate } from "#/testHelpers/browserCertificate";
import { render } from "#/testHelpers/renderHelpers";
import { BrowserCertificateButton } from "./BrowserCertificateButton";

it("imports the saved certificate through the workspace app and clears its password", async () => {
	vi.spyOn(certificateAPI, "getBrowserCertificateStatus").mockResolvedValue({
		state: "locked",
		message: "Unlock your saved certificate.",
		csrf: "test-csrf",
	});
	const importCertificate = vi
		.spyOn(certificateAPI, "importBrowserCertificate")
		.mockResolvedValue({ message: "Browser relaunched." });
	render(
		<BrowserCertificateButton baseUrl="/certificate/">
			Browser Certificate
		</BrowserCertificateButton>,
	);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Browser Certificate" }));
	await user.type(
		screen.getByLabelText("Certificate password"),
		"test-password",
	);
	await user.click(
		screen.getByRole("button", { name: "Import and relaunch browser" }),
	);
	await waitFor(() =>
		expect(importCertificate).toHaveBeenCalledWith(
			"/certificate/",
			"test-csrf",
			undefined,
			"test-password",
		),
	);
	await user.click(screen.getByRole("button", { name: "Close" }));
	await user.click(screen.getByRole("button", { name: "Browser Certificate" }));
	await user.click(
		screen.getByRole("button", { name: "Import and relaunch browser" }),
	);
	await waitFor(() =>
		expect(importCertificate).toHaveBeenLastCalledWith(
			"/certificate/",
			"test-csrf",
			undefined,
			"",
		),
	);
});

it("only reimports an installed certificate after explicitly choosing Replace", async () => {
	vi.spyOn(certificateAPI, "getBrowserCertificateStatus").mockResolvedValue(
		MockBrowserCertificate,
	);
	const importCertificate = vi
		.spyOn(certificateAPI, "importBrowserCertificate")
		.mockResolvedValue({ message: "Browser relaunched." });
	render(
		<BrowserCertificateButton baseUrl="/certificate/">
			Browser Certificate
		</BrowserCertificateButton>,
	);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Browser Certificate" }));
	await user.click(
		await screen.findByRole("button", { name: "Replace certificate" }),
	);
	expect(importCertificate).not.toHaveBeenCalled();
	await user.type(
		screen.getByLabelText("Certificate password"),
		"replacement-password",
	);
	await user.click(
		screen.getByRole("button", { name: "Import and relaunch browser" }),
	);
	await waitFor(() =>
		expect(importCertificate).toHaveBeenCalledWith(
			"/certificate/",
			"story-csrf",
			undefined,
			"replacement-password",
		),
	);
});
