import { fireEvent, screen, waitFor } from "@testing-library/react";
import { API } from "#/api/api";
import {
	MockTemplate,
	MockUserMember,
	MockUserOwner,
} from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { TemplateAccessMenu } from "./TemplateAccessMenu";

describe("TemplateAccessMenu", () => {
	it("allows everyone until a user is picked, and saves each pick at once", async () => {
		vi.spyOn(API, "getTemplateAccessList").mockResolvedValue({ user_ids: [] });
		vi.spyOn(API, "getUsers").mockResolvedValue({
			users: [MockUserOwner, MockUserMember],
			count: 2,
		});
		const set = vi
			.spyOn(API, "setTemplateAccessList")
			.mockImplementation(async (_id, ids) => ({ user_ids: [...ids] }));
		renderWithAuth(<TemplateAccessMenu template={MockTemplate} />);
		const trigger = await screen.findByTestId(
			`template-access-${MockTemplate.name}`,
		);
		await waitFor(() => expect(trigger).toHaveTextContent("Everyone"));
		fireEvent.click(trigger);
		const member = await screen.findByTestId(
			`template-access-user-${MockUserMember.username}`,
		);
		fireEvent.click(member);
		await waitFor(() =>
			expect(set).toHaveBeenCalledWith(MockTemplate.id, [MockUserMember.id]),
		);
		await waitFor(() => expect(trigger).toHaveTextContent("1 user"));
		// back to everyone
		fireEvent.click(screen.getByTestId("template-access-everyone"));
		await waitFor(() =>
			expect(set).toHaveBeenLastCalledWith(MockTemplate.id, []),
		);
		await waitFor(() => expect(trigger).toHaveTextContent("Everyone"));
	});
});
