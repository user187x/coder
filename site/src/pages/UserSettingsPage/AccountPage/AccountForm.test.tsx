import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UpdateUserProfileRequest } from "#/api/typesGenerated";
import { MockUserMember } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { AccountForm } from "./AccountForm";

// NOTE: it does not matter what the role props of MockUser are set to,
//       only that editable is set to true or false. This is passed from
//       the call to /authorization done by auth provider
describe("AccountForm", () => {
	describe("when editable is set to true", () => {
		it("allows updating username", async () => {
			// Given
			const mockInitialValues: UpdateUserProfileRequest = {
				username: MockUserMember.username,
				name: MockUserMember.name ?? MockUserMember.username,
				avatar_url: MockUserMember.avatar_url ?? "",
			};

			// When
			render(
				<AccountForm
					emailEditable
					editable
					email={MockUserMember.email}
					initialValues={mockInitialValues}
					isLoading={false}
					onSubmit={vi.fn()}
				/>,
			);

			// Then
			const el = await screen.findByLabelText("Username");
			expect(el).toBeEnabled();
			const btn = await screen.findByRole("button", {
				name: /Update account/i,
			});
			expect(btn).toBeEnabled();
		});
	});

	it("sets name autocomplete to name", async () => {
		// Given
		const mockInitialValues: UpdateUserProfileRequest = {
			username: MockUserMember.username,
			name: MockUserMember.name ?? MockUserMember.username,
			avatar_url: MockUserMember.avatar_url ?? "",
		};

		// When
		render(
			<AccountForm
				emailEditable
				editable
				email={MockUserMember.email}
				initialValues={mockInitialValues}
				isLoading={false}
				onSubmit={vi.fn()}
			/>,
		);

		// Then
		const nameInput = await screen.findByLabelText("Name");
		expect(nameInput).toHaveAttribute("autocomplete", "name");
	});
	describe("when editable is set to false", () => {
		it("does not allow updating username", async () => {
			// Given
			const mockInitialValues: UpdateUserProfileRequest = {
				username: MockUserMember.username,
				name: MockUserMember.name ?? MockUserMember.username,
				avatar_url: MockUserMember.avatar_url ?? "",
			};

			// When
			render(
				<AccountForm
					emailEditable
					editable={false}
					email={MockUserMember.email}
					initialValues={mockInitialValues}
					isLoading={false}
					onSubmit={vi.fn()}
				/>,
			);

			// Then
			const el = await screen.findByLabelText("Username");
			expect(el).toBeDisabled();
		});
	});
});

it("submits an email change with current-password confirmation", async () => {
	const onSubmit = vi.fn();
	const user = userEvent.setup();
	render(
		<AccountForm
			editable={false}
			emailEditable
			email={MockUserMember.email}
			initialValues={{
				username: MockUserMember.username,
				name: MockUserMember.name ?? "",
				avatar_url: "",
			}}
			isLoading={false}
			onSubmit={onSubmit}
		/>,
	);
	await user.clear(screen.getByLabelText("Email"));
	await user.type(screen.getByLabelText("Email"), "updated@example.test");
	await user.type(
		screen.getByLabelText(/Current password/),
		"confirmed-password",
	);
	await user.click(screen.getByRole("button", { name: "Update account" }));
	await waitFor(() =>
		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				email: "updated@example.test",
				current_password: "confirmed-password",
				username: MockUserMember.username,
			}),
		),
	);
});
