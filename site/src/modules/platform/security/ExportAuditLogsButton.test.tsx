import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { MockAuditLog, MockAuditLog2 } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { ExportAuditLogsButton } from "./ExportAuditLogsButton";

afterEach(() => vi.restoreAllMocks());

it("downloads every matching event instead of the current page or capped count", async () => {
	const get = vi.spyOn(API, "getAuditLogs").mockResolvedValue({
		audit_logs: [MockAuditLog, MockAuditLog2],
		count: 1,
		count_cap: 1,
	});
	const download = vi.fn<(file: Blob, filename: string) => void>();
	render(<ExportAuditLogsButton filter="action:login" download={download} />);
	await userEvent.click(screen.getByRole("button", { name: "Export Logs" }));
	await waitFor(() => expect(download).toHaveBeenCalledOnce());
	expect(get).toHaveBeenCalledWith({ q: "action:login", offset: 0, limit: 0 });
	const [file, name] = download.mock.calls[0];
	expect(file).toBeInstanceOf(Blob);
	expect(name).toMatch(/^coder-security-logs-.*\.json$/);
	const content = await file.text();
	expect(JSON.parse(content)).toMatchObject({
		filter: "action:login",
		count: 2,
		audit_logs: [MockAuditLog, MockAuditLog2],
	});
});

it("does not download an incomplete file when the audit request is denied", async () => {
	const get = vi
		.spyOn(API, "getAuditLogs")
		.mockRejectedValue(new Error("Forbidden"));
	const download = vi.fn();
	render(<ExportAuditLogsButton filter="" download={download} />);
	await userEvent.click(screen.getByRole("button", { name: "Export Logs" }));
	await waitFor(() => expect(get).toHaveBeenCalledOnce());
	expect(download).not.toHaveBeenCalled();
});
