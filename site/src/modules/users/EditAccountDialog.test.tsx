import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { API } from "#/api/api";
import {
	assignableRole,
	MockAuditorRole,
	MockUserMember,
} from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { EditAccountDialog } from "./EditAccountDialog";

const setup = (rolesReadOnly = false) => {
	vi.spyOn(API, "getRoles").mockResolvedValue([
		assignableRole(MockAuditorRole, true),
	]);
	const profile = vi
		.spyOn(API, "updateProfile")
		.mockResolvedValue({ ...MockUserMember, name: "Updated name" });
	const roles = vi
		.spyOn(API, "updateUserRoles")
		.mockResolvedValue({ ...MockUserMember, roles: [MockAuditorRole] });
	const onClose = vi.fn();
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<EditAccountDialog
				user={MockUserMember}
				rolesReadOnly={rolesReadOnly}
				onClose={onClose}
			/>
		</QueryClientProvider>,
	);
	return { profile, roles, onClose, user: userEvent.setup() };
};
afterEach(() => vi.restoreAllMocks());

it("saves profile and roles through their existing endpoints after confirmation", async () => {
	const { user, profile, roles, onClose } = setup();
	await user.clear(screen.getByLabelText("Name"));
	await user.type(screen.getByLabelText("Name"), "Updated name");
	await user.click(await screen.findByLabelText("Auditor", { exact: false }));
	expect(profile).not.toHaveBeenCalled();
	expect(roles).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	expect(profile).toHaveBeenCalledWith(
		MockUserMember.id,
		expect.objectContaining({ name: "Updated name" }),
	);
	expect(roles).toHaveBeenCalledWith(["auditor"], MockUserMember.id);
});

it.each(["profile", "roles"] as const)(
	"retries only the failed %s change after partial success",
	async (failed) => {
		const state = setup();
		state[failed].mockRejectedValueOnce(new Error("Permission denied"));
		await state.user.clear(screen.getByLabelText("Name"));
		await state.user.type(screen.getByLabelText("Name"), "Updated name");
		await state.user.click(
			await screen.findByLabelText("Auditor", { exact: false }),
		);
		await state.user.click(screen.getByRole("button", { name: "Save" }));
		const retry = await screen.findByRole("button", {
			name: "Retry remaining changes",
		});
		expect(state.onClose).not.toHaveBeenCalled();
		await state.user.click(retry);
		await waitFor(() => expect(state.onClose).toHaveBeenCalledOnce());
		expect(state.profile).toHaveBeenCalledTimes(failed === "profile" ? 2 : 1);
		expect(state.roles).toHaveBeenCalledTimes(failed === "roles" ? 2 : 1);
	},
);

it("cancels without changing the account", async () => {
	const { user, profile, roles, onClose } = setup();
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(onClose).toHaveBeenCalledOnce();
	expect(profile).not.toHaveBeenCalled();
	expect(roles).not.toHaveBeenCalled();
});

it("preserves synchronized roles while allowing profile edits", async () => {
	const { user, profile, roles, onClose } = setup(true);
	await user.clear(screen.getByLabelText("Name"));
	await user.type(screen.getByLabelText("Name"), "Updated name");
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	expect(profile).toHaveBeenCalledOnce();
	expect(roles).not.toHaveBeenCalled();
	expect(API.getRoles).not.toHaveBeenCalled();
});
