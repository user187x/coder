import type { QueryClient } from "react-query";
import { type AdminNoteChange, AdminNotesAPI } from "../adminNotes";

export const adminNotesKey = (organization: string) =>
	["admin-notes", organization] as const;
export const adminNotes = (organization: string) => ({
	queryKey: adminNotesKey(organization),
	queryFn: () => AdminNotesAPI.list(organization),
	enabled: Boolean(organization),
	refetchInterval: 10000,
});
export const changeAdminNote = (client: QueryClient, organization: string) => ({
	mutationFn: (change: AdminNoteChange) =>
		AdminNotesAPI.change(organization, change),
	onSuccess: (data: Awaited<ReturnType<typeof AdminNotesAPI.change>>) =>
		client.setQueryData(adminNotesKey(organization), data),
	onSettled: () =>
		client.invalidateQueries({ queryKey: adminNotesKey(organization) }),
});
