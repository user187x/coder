import { platformGet, platformPost, type QuotaKey } from "./platform";

export type ExtraResources = Record<QuotaKey, number>;
export type QuotaRequest = {
	id: string;
	organization_id: string;
	user_id: string;
	username: string;
	resources: ExtraResources;
	reason: string;
	status: "pending" | "approved" | "denied" | "revoked";
	created_at: number;
	reviewed_at?: number;
	reviewed_by?: string;
	review_reason?: string;
};

export type CreateQuotaRequest = {
	organization_id: string;
	request_id: string;
	resources: ExtraResources;
	reason: string;
};

export type QuotaDecision = "approve" | "deny" | "revoke";
const root = "/__coder-ui/api";

export const QuotaRequestsAPI = {
	list: (admin: boolean) =>
		platformGet<{ requests: QuotaRequest[] }>(
			`${root}/quota/requests${admin ? "" : "/me"}`,
		),
	create: (value: CreateQuotaRequest) =>
		platformPost<{ request: QuotaRequest }>(
			`${root}/organizations/${encodeURIComponent(value.organization_id)}/quota-requests`,
			{
				request_id: value.request_id,
				resources: value.resources,
				reason: value.reason,
			},
		),
	decide: (value: {
		request: QuotaRequest;
		action: QuotaDecision;
		reason: string;
	}) =>
		platformPost<{ request: QuotaRequest }>(
			`${root}/organizations/${encodeURIComponent(value.request.organization_id)}/quota-requests/${encodeURIComponent(value.request.id)}/${value.action}`,
			{ reason: value.reason },
		),
};
