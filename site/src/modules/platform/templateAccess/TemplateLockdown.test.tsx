import { fireEvent, screen, waitFor } from "@testing-library/react";
import { API } from "#/api/api";
import {
	MockTemplate,
	MockUserMember,
	MockUserOwner,
} from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { TemplateLockdown } from "./TemplateLockdown";

describe("TemplateLockdown", () => {
	beforeEach(() => {
		vi.spyOn(API, "getUsers").mockResolvedValue({
			users: [MockUserOwner, MockUserMember],
			count: 2,
		});
	});

	it("locks the template down, adds a member, and opens it again", async () => {
		vi.spyOn(API, "getTemplateAccessList").mockResolvedValue({
			user_ids: [],
			restricted: false,
		});
		const set = vi
			.spyOn(API, "setTemplateAccessList")
			.mockImplementation(async (_id, list) => ({
				user_ids: [...list.user_ids],
				restricted: list.restricted || list.user_ids.length > 0,
			}));
		renderWithAuth(<TemplateLockdown template={MockTemplate} canUpdate />);
		const lock = await screen.findByTestId("template-lockdown-switch");
		expect(lock).toHaveAttribute("aria-pressed", "false");
		expect(screen.getByText(/Everyone in the organization/)).toBeVisible();

		// locked with nobody listed: only the template's admins
		fireEvent.click(lock);
		await waitFor(() =>
			expect(set).toHaveBeenCalledWith(MockTemplate.id, {
				user_ids: [],
				restricted: true,
			}),
		);
		expect(await screen.findByText("No members yet")).toBeVisible();

		fireEvent.click(screen.getByTestId("template-lockdown-add"));
		fireEvent.click(
			await screen.findByTestId(
				`template-lockdown-user-${MockUserMember.username}`,
			),
		);
		await waitFor(() =>
			expect(set).toHaveBeenLastCalledWith(MockTemplate.id, {
				user_ids: [MockUserMember.id],
				restricted: true,
			}),
		);
		expect(
			await screen.findByLabelText(`Remove ${MockUserMember.username}`),
		).toBeVisible();

		// open again: everyone, the list cleared
		fireEvent.click(screen.getByTestId("template-lockdown-switch"));
		await waitFor(() =>
			expect(set).toHaveBeenLastCalledWith(MockTemplate.id, {
				user_ids: [],
				restricted: false,
			}),
		);
	});

	it("tells those who cannot change it so, without reading the list", async () => {
		const get = vi.spyOn(API, "getTemplateAccessList");
		renderWithAuth(
			<TemplateLockdown template={MockTemplate} canUpdate={false} />,
		);
		expect(await screen.findByText(/Only those who can update/)).toBeVisible();
		expect(get).not.toHaveBeenCalled();
	});
});
