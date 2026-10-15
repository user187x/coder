import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { MockGitSSHKey, mockApiError } from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import SSHKeysPage from "./SSHKeysPage";

describe("SSH keys Page", () => {
	it("shows the SSH key", async () => {
		renderWithAuth(<SSHKeysPage />);
		await screen.findByText(MockGitSSHKey.public_key);
	});

	describe("regenerate SSH key", () => {
		describe("when it is success", () => {
			it("shows a success message and updates the ssh key on the page", async () => {
				renderWithAuth(<SSHKeysPage />);

				// Wait to the ssh be rendered on the screen
				await screen.findByText(MockGitSSHKey.public_key);

				// Regenerate Key > RSA displays the confirm dialog
				const user = userEvent.setup();
				await user.click(screen.getByTestId("regenerate"));
				await user.click(await screen.findByRole("menuitem", { name: /^RSA/ }));
				const confirmDialog = await screen.findByRole("dialog");
				expect(confirmDialog).toHaveTextContent("Regenerate SSH key as RSA?");
				expect(confirmDialog).toHaveTextContent(
					"A new RSA (4096-bit) key replaces the current one.",
				);
				expect(confirmDialog).toHaveTextContent(
					"You will need to replace the public SSH key on services you use it with, and you'll need to rebuild existing workspaces.",
				);

				const newUserSSHKey =
					"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDSC/ouD/LqiT1Rd99vDv/MwUmqzJuinLTMTpk5kVy66";
				vi.spyOn(API, "regenerateUserSSHKey").mockResolvedValueOnce({
					...MockGitSSHKey,
					public_key: newUserSSHKey,
				});

				// Click on the "Confirm" button
				const confirmButton = within(confirmDialog).getByRole("button", {
					name: "Confirm",
				});
				fireEvent.click(confirmButton);

				// Check if the success message is displayed
				await screen.findByText("SSH Key regenerated successfully (RSA).");

				// Check if the API was called correctly: an RSA key
				expect(API.regenerateUserSSHKey).toBeCalledTimes(1);
				expect(API.regenerateUserSSHKey).toBeCalledWith("me", "rsa4096");

				// Check if the SSH key is updated
				await screen.findByText(newUserSSHKey);
			});
		});

		describe("when it fails", () => {
			it("shows an error message", async () => {
				renderWithAuth(<SSHKeysPage />);

				// Wait to the ssh be rendered on the screen
				await screen.findByText(MockGitSSHKey.public_key);

				vi.spyOn(API, "regenerateUserSSHKey").mockRejectedValueOnce(
					mockApiError({
						message: "Failed to regenerate SSH key",
					}),
				);

				// Regenerate Key > ED25519 displays the confirm dialog
				const user = userEvent.setup();
				await user.click(screen.getByTestId("regenerate"));
				await user.click(
					await screen.findByRole("menuitem", { name: /^ED25519/ }),
				);
				const confirmDialog = await screen.findByRole("dialog");
				expect(confirmDialog).toHaveTextContent(
					"Regenerate SSH key as ED25519?",
				);

				// Click on the "Confirm" button
				const confirmButton = within(confirmDialog).getByRole("button", {
					name: "Confirm",
				});
				fireEvent.click(confirmButton);

				// Check if the error message is displayed
				await screen.findByText("Failed to regenerate SSH key");

				// Check if the API was called correctly: an ED25519 key
				expect(API.regenerateUserSSHKey).toBeCalledTimes(1);
				expect(API.regenerateUserSSHKey).toBeCalledWith("me", "ed25519");
			});
		});
	});
});
