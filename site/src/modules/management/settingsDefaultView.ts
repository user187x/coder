import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";

/**
 * The admin settings page the user returns to when they open Settings without a page of their own (/deployment, the
 * breadcrumb's Settings): the one they set with a category's right-click "Default View". Kept with their UI
 * preferences; none set: the usual first page.
 */
export const useSettingsDefaultView = () => {
	const client = useQueryClient();
	const preferences = useQuery({ ...userUIPreferences(), retry: false });
	const save = useMutation({
		...updateUserUIPreferences(client),
		onSuccess: (settings, changes) => {
			client.setQueryData(userUIPreferences().queryKey, settings);
			toast.success(
				changes.settings_default_view
					? "Settings opens on this page from now on."
					: "Settings opens on its usual first page again.",
			);
		},
		onError: (error) =>
			toast.error(getErrorMessage(error, "Could not save the default view.")),
	});
	return {
		path: preferences.data?.settings_default_view ?? null,
		loading: preferences.isLoading,
		set: (path: string | null) => save.mutate({ settings_default_view: path }),
	};
};
