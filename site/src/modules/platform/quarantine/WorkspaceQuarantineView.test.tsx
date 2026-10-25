import { render as renderPlain, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "#/testHelpers/renderHelpers";
import { WorkspaceQuarantineView } from "./WorkspaceQuarantineView";

it("requires a reason and explicit confirmation before quarantine", async () => {
	const user = userEvent.setup();
	const onChange = vi.fn();
	render(
		<WorkspaceQuarantineView
			name="developer/workspace"
			enabled={false}
			canManage
			onChange={onChange}
			onRetry={vi.fn()}
		/>,
	);
	await user.click(
		screen.getByRole("button", { name: "Quarantine workspace" }),
	);
	const dialog = within(screen.getByRole("dialog"));
	await user.click(
		dialog.getByRole("button", { name: "Quarantine workspace" }),
	);
	expect(onChange).not.toHaveBeenCalled();
	await user.type(
		dialog.getByLabelText("Reason"),
		"Investigating unexpected traffic",
	);
	await user.click(dialog.getByRole("button", { name: "Cancel" }));
	expect(onChange).not.toHaveBeenCalled();
	await user.click(
		screen.getByRole("button", { name: "Quarantine workspace" }),
	);
	await user.type(screen.getByLabelText("Reason"), "  Incident review  ");
	await user.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "Quarantine workspace",
		}),
	);
	expect(onChange).toHaveBeenCalledExactlyOnceWith(
		true,
		"Incident review",
		expect.any(Function),
	);
});

it("releases only after confirmation without requesting a start", async () => {
	const user = userEvent.setup();
	const onChange = vi.fn();
	render(
		<WorkspaceQuarantineView
			name="developer/workspace"
			enabled
			canManage
			onChange={onChange}
			onRetry={vi.fn()}
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Release quarantine" }));
	expect(onChange).not.toHaveBeenCalled();
	await user.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "Release quarantine",
		}),
	);
	expect(onChange).toHaveBeenCalledExactlyOnceWith(
		false,
		"",
		expect.any(Function),
	);
});

it("retries status without changing the requested policy", async () => {
	const user = userEvent.setup();
	const onRetry = vi.fn();
	const onChange = vi.fn();
	render(
		<WorkspaceQuarantineView
			name="developer/workspace"
			error={new Error("Status unavailable")}
			onRetry={onRetry}
			onChange={onChange}
		/>,
	);
	await user.click(
		screen.getByRole("button", { name: "Retry quarantine status" }),
	);
	expect(onRetry).toHaveBeenCalledOnce();
	expect(onChange).not.toHaveBeenCalled();
});

it("keeps the reviewed activation intent if polling changes policy while the dialog is open", async () => {
	const user = userEvent.setup();
	const onChange = vi.fn();
	const view = renderPlain(
		<WorkspaceQuarantineView
			name="developer/workspace"
			enabled={false}
			canManage
			onChange={onChange}
			onRetry={vi.fn()}
		/>,
	);
	await user.click(
		screen.getByRole("button", { name: "Quarantine workspace" }),
	);
	await user.type(screen.getByLabelText("Reason"), "Review");
	view.rerender(
		<WorkspaceQuarantineView
			name="developer/workspace"
			enabled
			canManage
			onChange={onChange}
			onRetry={vi.fn()}
		/>,
	);
	await user.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "Quarantine workspace",
		}),
	);
	expect(onChange).toHaveBeenCalledExactlyOnceWith(
		true,
		"Review",
		expect.any(Function),
	);
});

it("enforces the server UTF-8 byte limit before submitting a reason", async () => {
	const user = userEvent.setup();
	const onChange = vi.fn();
	render(
		<WorkspaceQuarantineView
			name="developer/workspace"
			enabled={false}
			canManage
			onChange={onChange}
			onRetry={vi.fn()}
		/>,
	);
	await user.click(
		screen.getByRole("button", { name: "Quarantine workspace" }),
	);
	await user.click(screen.getByLabelText("Reason"));
	await user.paste("é".repeat(501));
	await user.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "Quarantine workspace",
		}),
	);
	expect(onChange).not.toHaveBeenCalled();
});
