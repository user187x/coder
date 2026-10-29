import { closeBrowserSession } from "#/api/browserSessions";

export const closeWorkspaceBrowserSession = (baseUrl: string, id: string) => ({
	mutationFn: () => closeBrowserSession(baseUrl, id),
});
