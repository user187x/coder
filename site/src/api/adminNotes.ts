import { platformRequest } from "./platform";

export type AdminNote = {
	id: string;
	organization_id: string;
	author_id: string;
	author_name: string;
	text: string;
	shared: boolean;
	revision: number;
	created_at: string;
	updated_at: string;
	can_edit: boolean;
	unread: boolean;
};

export type AdminNoteChange =
	| { action: "create"; text: string; shared: boolean }
	| {
			action: "update";
			id: string;
			revision: number;
			text: string;
			shared: boolean;
	  }
	| { action: "delete" | "read"; id: string; revision: number };

const path = (org: string) =>
	`${platformRequest.base}/api/organizations/${encodeURIComponent(org)}/admin-notes`;

export const AdminNotesAPI = {
	list: (org: string) => platformRequest.get<{ notes: AdminNote[] }>(path(org)),
	change: (org: string, change: AdminNoteChange) =>
		platformRequest.post<{ notes: AdminNote[] }>(path(org), change),
};
