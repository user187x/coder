import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { createMemoryRouter } from "react-router";
import { GlobalLockdownAPI } from "#/api/globalLockdown";
import { globalLockdownKey } from "#/api/queries/globalLockdown";
import { MockGlobalLockdownState } from "#/testHelpers/globalLockdown";
import { render, renderWithRouter } from "#/testHelpers/renderHelpers";
import { GlobalLockdownCardView, GlobalLockdownGate } from "./GlobalLockdown";

afterEach(() => vi.restoreAllMocks());

describe("Global Lock Down confirmation", () => {
	it("requires agree before requesting a platform lock", async () => {
		const onChange = vi.fn();
		const user = userEvent.setup();
		render(
			<GlobalLockdownCardView
				state={MockGlobalLockdownState}
				onChange={onChange}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "Lock" }));
		const dialog = within(screen.getByRole("dialog"));
		await user.type(dialog.getByLabelText("Type agree to confirm"), "AGREE");
		await user.click(dialog.getByRole("button", { name: "Lock" }));
		expect(onChange).not.toHaveBeenCalled();
		await user.clear(dialog.getByLabelText("Type agree to confirm"));
		await user.type(dialog.getByLabelText("Type agree to confirm"), "agree");
		await user.click(dialog.getByRole("button", { name: "Lock" }));
		expect(onChange).toHaveBeenCalledExactlyOnceWith(
			true,
			"agree",
			expect.any(Function),
		);
	});

	it("does not change the platform when the confirmation is cancelled", async () => {
		const onChange = vi.fn();
		const user = userEvent.setup();
		render(
			<GlobalLockdownCardView
				state={MockGlobalLockdownState}
				onChange={onChange}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "Lock" }));
		await user.type(screen.getByLabelText("Type agree to confirm"), "agree");
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		await user.click(screen.getByRole("button", { name: "Lock" }));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Lock",
			}),
		);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("requests that a confirmed lock be lifted", async () => {
		const onChange = vi.fn();
		const user = userEvent.setup();
		render(
			<GlobalLockdownCardView
				state={{ ...MockGlobalLockdownState, enabled: true, confirmed: true }}
				onChange={onChange}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "Lift lock" }));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Lift lock",
			}),
		);
		expect(onChange).toHaveBeenCalledExactlyOnceWith(
			false,
			"",
			expect.any(Function),
		);
	});
});

it("closes workspace subscriptions when a non-admin becomes locked", async () => {
	const onConnect = vi.fn();
	const onDisconnect = vi.fn();
	const onChatDisconnect = vi.fn();
	const Chat = () => {
		useEffect(() => onChatDisconnect, []);
		return <div>Chat with admins</div>;
	};
	const Workspace = () => {
		useEffect(() => {
			onConnect();
			return onDisconnect;
		}, []);
		return <div>Workspace</div>;
	};
	vi.spyOn(GlobalLockdownAPI, "get").mockResolvedValue({
		...MockGlobalLockdownState,
		admin: false,
	});
	const { queryClient } = renderWithRouter(
		createMemoryRouter(
			[
				{
					path: "/@developer/workspace",
					element: (
						<>
							<GlobalLockdownGate>
								<Workspace />
							</GlobalLockdownGate>
							<Chat />
						</>
					),
				},
			],
			{ initialEntries: ["/@developer/workspace"] },
		),
	);
	await waitFor(() => expect(onConnect).toHaveBeenCalledOnce());
	act(() => {
		queryClient.setQueryData(globalLockdownKey, {
			...MockGlobalLockdownState,
			enabled: true,
			admin: false,
		});
	});
	await waitFor(() => expect(onDisconnect).toHaveBeenCalledOnce());
	expect(onChatDisconnect).not.toHaveBeenCalled();
});

it("keeps other Coder views mounted during lockdown", async () => {
	const onDisconnect = vi.fn();
	const Account = () => {
		useEffect(() => onDisconnect, []);
		return <div>Account settings</div>;
	};
	vi.spyOn(GlobalLockdownAPI, "get").mockResolvedValue({
		...MockGlobalLockdownState,
		enabled: true,
		admin: false,
	});
	const { queryClient } = renderWithRouter(
		createMemoryRouter([
			{
				path: "/",
				element: (
					<GlobalLockdownGate>
						<Account />
					</GlobalLockdownGate>
				),
			},
		]),
	);
	await waitFor(() => expect(GlobalLockdownAPI.get).toHaveBeenCalled());
	act(() => {
		queryClient.setQueryData(globalLockdownKey, {
			...MockGlobalLockdownState,
			enabled: true,
			admin: false,
		});
	});
	expect(onDisconnect).not.toHaveBeenCalled();
});
