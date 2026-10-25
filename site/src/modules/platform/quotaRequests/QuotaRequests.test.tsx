import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { QuotaRequest } from "#/api/quotaRequests";
import { MockOrganization } from "#/testHelpers/entities";
import { MockQuotaRequest } from "#/testHelpers/quotaRequests";
import { render } from "#/testHelpers/renderHelpers";
import { server } from "#/testHelpers/server";
import { QuotaRequestsView } from "./QuotaAdjustments";
import { QuotaRequestButton, QuotaRequestForm } from "./QuotaRequestButton";

it("submits validated resource amounts and a trimmed reason", async () => {
	const submit = vi.fn();
	render(
		<QuotaRequestForm
			organizations={[MockOrganization]}
			requestId="stable-request"
			onSubmit={submit}
		/>,
	);
	await userEvent.type(screen.getByLabelText("Additional CPU cores"), "1.5");
	await userEvent.type(
		screen.getByLabelText("Reason for extra quota"),
		"  Integration tests  ",
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Submit quota request" }),
	);
	expect(submit).toHaveBeenCalledExactlyOnceWith({
		organization_id: MockOrganization.id,
		request_id: "stable-request",
		resources: { cpu: 1.5, memory: 0, workspaces: 0 },
		reason: "Integration tests",
	});
});

it("never submits fractional workspace counts or requests without a reason", async () => {
	const submit = vi.fn();
	render(
		<QuotaRequestForm
			organizations={[MockOrganization]}
			requestId="stable-request"
			onSubmit={submit}
		/>,
	);
	await userEvent.type(screen.getByLabelText("Additional workspaces"), "1.5");
	await userEvent.type(
		screen.getByLabelText("Reason for extra quota"),
		"Tests",
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Submit quota request" }),
	);
	await userEvent.clear(screen.getByLabelText("Additional workspaces"));
	await userEvent.type(screen.getByLabelText("Additional workspaces"), "1");
	await userEvent.clear(screen.getByLabelText("Reason for extra quota"));
	await userEvent.click(
		screen.getByRole("button", { name: "Submit quota request" }),
	);
	expect(submit).not.toHaveBeenCalled();
});

it("passes the selected approval, denial and revocation with the review note", async () => {
	const decide = vi.fn();
	const approved: QuotaRequest = {
		...MockQuotaRequest,
		id: "approved-request",
		status: "approved",
		username: "approved-user",
	};
	render(
		<QuotaRequestsView
			requests={[MockQuotaRequest, approved]}
			organizations={[MockOrganization]}
			onDecide={decide}
		/>,
	);
	await userEvent.type(
		screen.getByLabelText("Review note (optional)"),
		"  Approved for testing  ",
	);
	await userEvent.click(
		screen.getByRole("button", {
			name: `Approve request by ${MockQuotaRequest.username}`,
		}),
	);
	await userEvent.click(
		screen.getByRole("button", {
			name: `Deny request by ${MockQuotaRequest.username}`,
		}),
	);
	await userEvent.click(
		screen.getByRole("button", {
			name: "Revoke extra quota for approved-user",
		}),
	);
	expect(decide.mock.calls).toEqual([
		[MockQuotaRequest, "approve", "Approved for testing"],
		[MockQuotaRequest, "deny", "Approved for testing"],
		[approved, "revoke", "Approved for testing"],
	]);
});

it("retries a failed submission using the same dialog identity and draft", async () => {
	const submitted: unknown[] = [];
	server.use(
		http.get("/api/v2/organizations", () =>
			HttpResponse.json([MockOrganization]),
		),
		http.get("/__coder-ui/api/quota/requests/me", () =>
			HttpResponse.json({ requests: [] }),
		),
		http.get("/__coder-ui/api/quota/me", () =>
			HttpResponse.json({ limited: true, exempt: false }),
		),
		http.post(
			"/__coder-ui/api/organizations/:organization/quota-requests",
			async ({ request }) => {
				submitted.push(await request.json());
				return submitted.length === 1
					? HttpResponse.json(
							{ error: "Temporary request failure" },
							{ status: 503 },
						)
					: HttpResponse.json({ request: MockQuotaRequest });
			},
		),
	);
	render(<QuotaRequestButton />);
	await userEvent.click(
		screen.getByRole("button", { name: "Request extra quota" }),
	);
	await userEvent.type(
		await screen.findByLabelText("Additional CPU cores"),
		"2",
	);
	await userEvent.type(
		screen.getByLabelText("Reason for extra quota"),
		"Integration tests",
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Submit quota request" }),
	);
	await screen.findByRole("alert");
	await userEvent.click(
		await screen.findByRole("button", { name: "Submit quota request" }),
	);
	await waitFor(() => expect(submitted).toHaveLength(2));
	expect(submitted[0]).toEqual(submitted[1]);
	expect(submitted[1]).toMatchObject({
		resources: { cpu: 2, memory: 0, workspaces: 0 },
		reason: "Integration tests",
	});
});
