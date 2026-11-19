import { act, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TerminateSignoff, TerminateSignoffs } from "#/api/platform";
import { MockWorkspace } from "#/testHelpers/entities";
import { renderComponent as render } from "#/testHelpers/renderHelpers";
import { MockWorkspacePowerOperation } from "#/testHelpers/workspacePower";
import { GlobalWorkspaceActionsView } from "./GlobalWorkspaceActions";
import { useTerminateFlash } from "./TerminateSignoff";

it("requires explicit review confirmation for Shut Down", async () => {
	const onRun = vi.fn();
	const user = userEvent.setup();
	render(
		<GlobalWorkspaceActionsView workspaces={[MockWorkspace]} onRun={onRun} />,
	);
	await user.click(screen.getByRole("button", { name: "Shut Down" }));
	const dialog = within(screen.getByRole("dialog"));
	await user.click(dialog.getByRole("button", { name: "Shut Down" }));
	expect(onRun).not.toHaveBeenCalled();
	await user.type(
		dialog.getByLabelText("Type shutdown to confirm"),
		"shutdown",
	);
	await user.click(dialog.getByRole("button", { name: "Shut Down" }));
	expect(onRun).toHaveBeenCalledExactlyOnceWith(
		"shutdown",
		[MockWorkspace],
		true,
	);
});

const otherSignoff = {
	user_id: "other-admin",
	username: "grace",
	name: "Grace",
	fingerprint: "AB:CD",
	signed_at: "2026-11-09T06:00:00Z",
};
const round = (signoffs: TerminateSignoff[]): TerminateSignoffs => ({
	round_id: "round-1",
	deadline_ms: signoffs.length === 2 ? Date.now() + 5000 : null,
	required: 2,
	round_seconds: 900,
	opened_at: signoffs[0]?.signed_at ?? null,
	signoffs,
});

it("signs off on Terminate without running it until a second administrator signs", async () => {
	const onRun = vi.fn();
	const onSign = vi.fn();
	const user = userEvent.setup();
	render(
		<GlobalWorkspaceActionsView
			workspaces={[MockWorkspace]}
			onRun={onRun}
			onSign={onSign}
			userId="me"
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Terminate" }));
	const dialog = within(screen.getByRole("dialog"));
	await user.type(
		dialog.getByLabelText("Type terminate to confirm"),
		"terminate",
	);
	await user.click(dialog.getByRole("button", { name: "Sign off" }));
	expect(onSign).toHaveBeenCalledTimes(1);
	onSign.mock.calls[0][0](round([{ ...otherSignoff, user_id: "me" }]));
	expect(onRun).not.toHaveBeenCalled();
});

it("counts down after the last sign-off, then terminates the reviewed workspaces", async () => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	const onRun = vi.fn();
	const signed = round([otherSignoff, { ...otherSignoff, user_id: "me" }]);
	const onSign = vi.fn();
	const user = userEvent.setup({
		advanceTimers: vi.advanceTimersByTime,
		pointerEventsCheck: 0,
	});
	const view = (signoffs: TerminateSignoffs) => (
		<GlobalWorkspaceActionsView
			workspaces={[MockWorkspace]}
			onRun={onRun}
			onSign={onSign}
			signoffs={signoffs}
			userId="me"
		/>
	);
	const { rerender } = render(view(round([otherSignoff])));
	await user.click(screen.getByRole("button", { name: /Terminate/ }));
	const dialog = within(screen.getByRole("dialog"));
	await user.type(
		dialog.getByLabelText("Type terminate to confirm"),
		"terminate",
	);
	await user.click(dialog.getByRole("button", { name: "Sign off" }));
	act(() => {
		rerender(view(signed));
		onSign.mock.calls[0][0](signed);
	});
	// One flap a second: each its own act, as React renders the next before its timer starts.
	for (let second = 0; second < 4; second++) {
		await act(() => vi.advanceTimersByTimeAsync(1000));
	}
	expect(onRun).not.toHaveBeenCalled();
	await act(() => vi.advanceTimersByTimeAsync(1000));
	expect(onRun).toHaveBeenCalledExactlyOnceWith(
		"terminate",
		[MockWorkspace],
		true,
		"round-1",
	);
	vi.useRealTimers();
});

it("cancels the countdown without terminating", async () => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	const onRun = vi.fn();
	const onCancelTerminate = vi.fn();
	const onPauseTerminate = vi.fn();
	const signed = round([otherSignoff, { ...otherSignoff, user_id: "me" }]);
	const onSign = vi.fn();
	const user = userEvent.setup({
		advanceTimers: vi.advanceTimersByTime,
		pointerEventsCheck: 0,
	});
	const view = (signoffs: TerminateSignoffs) => (
		<GlobalWorkspaceActionsView
			workspaces={[MockWorkspace]}
			onRun={onRun}
			onSign={onSign}
			onCancelTerminate={onCancelTerminate}
			onPauseTerminate={onPauseTerminate}
			signoffs={signoffs}
			userId="me"
		/>
	);
	const { rerender } = render(view(round([otherSignoff])));
	await user.click(screen.getByRole("button", { name: /Terminate/ }));
	const dialog = within(screen.getByRole("dialog"));
	await user.type(
		dialog.getByLabelText("Type terminate to confirm"),
		"terminate",
	);
	await user.click(dialog.getByRole("button", { name: "Sign off" }));
	act(() => {
		rerender(view(signed));
		onSign.mock.calls[0][0](signed);
	});
	await user.click(screen.getByRole("button", { name: "Pause" }));
	expect(onPauseTerminate).toHaveBeenCalledExactlyOnceWith("round-1", true);
	rerender(view({ ...signed, paused_ms: 4000 }));
	await act(() => vi.advanceTimersByTimeAsync(8000));
	expect(onRun).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(onCancelTerminate).toHaveBeenCalledTimes(1);
	await act(() => vi.advanceTimersByTimeAsync(8000));
	expect(onRun).not.toHaveBeenCalled();
	vi.useRealTimers();
});

it("shows the shared countdown to the first signer without running it", async () => {
	vi.useFakeTimers();
	try {
		const onRun = vi.fn();
		const signoffs = round([
			otherSignoff,
			{ ...otherSignoff, user_id: "last-admin" },
		]);
		render(
			<GlobalWorkspaceActionsView
				workspaces={[]}
				signoffs={signoffs}
				userId="other-admin"
				onRun={onRun}
			/>,
		);
		screen.getByRole("region", {
			name: "Terminate countdown: 5 seconds remaining",
		});
		await act(() => vi.advanceTimersByTimeAsync(3000));
		screen.getByRole("region", {
			name: "Terminate countdown: 2 seconds remaining",
		});
		await act(() => vi.advanceTimersByTimeAsync(2000));
		screen.getByRole("region", {
			name: "Terminate countdown: 0 seconds remaining",
		});
		expect(onRun).not.toHaveBeenCalled();
	} finally {
		vi.useRealTimers();
	}
});

it("flashes once at the shared deadline after a remote resume", async () => {
	vi.useFakeTimers();
	const append = vi.spyOn(document.body, "append");
	try {
		const signed = round([
			otherSignoff,
			{ ...otherSignoff, user_id: "last-admin" },
		]);
		const { rerender } = renderHook<
			ReturnType<typeof useTerminateFlash>,
			TerminateSignoffs
		>(useTerminateFlash, {
			initialProps: { ...signed, paused_ms: 3000 },
		});
		await act(() => vi.advanceTimersByTimeAsync(7000));
		expect(append).not.toHaveBeenCalled();
		rerender({ ...signed, deadline_ms: Date.now() + 3000 });
		await act(() => vi.advanceTimersByTimeAsync(2999));
		expect(append).not.toHaveBeenCalled();
		await act(() => vi.advanceTimersByTimeAsync(1));
		expect(append).toHaveBeenCalledTimes(1);
		rerender({ ...signed, deadline_ms: Date.now() });
		await act(() => vi.advanceTimersByTimeAsync(2500));
		expect(append).toHaveBeenCalledTimes(1);
	} finally {
		append.mockRestore();
		vi.useRealTimers();
	}
});

it("requests revocation for the signed-in administrator's round", async () => {
	const onRevokeSignoff = vi.fn();
	render(
		<GlobalWorkspaceActionsView
			workspaces={[]}
			onRun={vi.fn()}
			signoffs={round([{ ...otherSignoff, user_id: "me" }])}
			userId="me"
			onRevokeSignoff={onRevokeSignoff}
		/>,
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Revoke my sign-off" }),
	);
	expect(onRevokeSignoff).toHaveBeenCalledExactlyOnceWith("round-1");
});

it("keeps the reviewed workspace snapshot when the list refreshes", async () => {
	const onRun = vi.fn();
	const user = userEvent.setup();
	const { rerender } = render(
		<GlobalWorkspaceActionsView
			workspaces={[
				MockWorkspace,
				{ ...MockWorkspace, id: "system-prebuild", is_prebuild: true },
			]}
			onRun={onRun}
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Shut Down" }));
	rerender(
		<GlobalWorkspaceActionsView
			workspaces={[
				MockWorkspace,
				{ ...MockWorkspace, id: "new-workspace", name: "new-workspace" },
			]}
			onRun={onRun}
		/>,
	);
	await user.type(
		screen.getByLabelText("Type shutdown to confirm"),
		"shutdown",
	);
	await user.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "Shut Down",
		}),
	);
	expect(onRun).toHaveBeenCalledExactlyOnceWith(
		"shutdown",
		[MockWorkspace],
		true,
	);
});

it.each([true, false])(
	"submits administrator exclusion %s with the reviewed targets",
	async (exclude) => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		const administrator = {
			...MockWorkspace,
			id: "admin-workspace",
			owner_id: "admin-owner",
			owner_name: "admin",
		};
		render(
			<GlobalWorkspaceActionsView
				workspaces={[MockWorkspace, administrator]}
				administratorIds={[administrator.owner_id]}
				onRun={onRun}
			/>,
		);
		if (!exclude)
			await user.click(
				screen.getByRole("switch", {
					name: "Exclude administrator workspaces",
				}),
			);
		await user.click(screen.getByRole("button", { name: "Shut Down" }));
		await user.type(
			screen.getByLabelText("Type shutdown to confirm"),
			"shutdown",
		);
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Shut Down",
			}),
		);
		expect(onRun).toHaveBeenCalledExactlyOnceWith(
			"shutdown",
			exclude
				? [MockWorkspace]
				: expect.arrayContaining([MockWorkspace, administrator]),
			exclude,
		);
	},
);

it("clears individual or completed entries without submitting power actions", async () => {
	const onClear = vi.fn();
	const onRun = vi.fn();
	const completed = {
		...MockWorkspacePowerOperation,
		status: "partial" as const,
	};
	const running = {
		...MockWorkspacePowerOperation,
		id: "running-operation",
		status: "running" as const,
	};
	render(
		<GlobalWorkspaceActionsView
			workspaces={[MockWorkspace]}
			operations={[completed, running]}
			onRun={onRun}
			onClear={onClear}
		/>,
	);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Clear entry" }));
	expect(onClear).toHaveBeenLastCalledWith([completed]);
	await user.click(
		screen.getByRole("button", { name: "Clear completed entries" }),
	);
	expect(onClear).toHaveBeenLastCalledWith([completed]);
	expect(onRun).not.toHaveBeenCalled();
});
