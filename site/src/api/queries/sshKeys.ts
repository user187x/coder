import type { QueryClient } from "react-query";
import { API } from "#/api/api";
import type { GitSSHKey } from "#/api/typesGenerated";

const getUserSSHKeyQueryKey = (userId: string) => [userId, "sshKey"];

export const userSSHKey = (userId: string) => {
	return {
		queryKey: getUserSSHKeyQueryKey(userId),
		queryFn: () => API.getUserSSHKey(userId),
	};
};

export const regenerateUserSSHKey = (
	userId: string,
	queryClient: QueryClient,
) => {
	return {
		mutationFn: () => API.regenerateUserSSHKey(userId),
		onSuccess: (newKey: GitSSHKey) => {
			queryClient.setQueryData(getUserSSHKeyQueryKey(userId), newKey);
		},
	};
};

/**
 * Platform: shows a key the user imported (API.importUserSSHKey). The import
 * itself is not a mutation: react-query would keep the private key it was
 * called with in its mutation cache.
 */
export const setUserSSHKey = (
	queryClient: QueryClient,
	userId: string,
	key: GitSSHKey,
) => {
	queryClient.setQueryData(getUserSSHKeyQueryKey(userId), key);
};
