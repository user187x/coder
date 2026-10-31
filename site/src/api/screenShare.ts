import { platformRequest } from "./platform";
export type ScreenShareSession = {
	id: string;
	organization_id: string;
	sharer: string;
	viewer: string;
	sharer_name: string;
	viewer_name: string;
	workspace_id: string | null;
	label: string;
	status: "requested" | "sharing" | "ended";
	mode?: "screen" | "dashboard";
	offer: string | null;
	answer: string | null;
	expires_at: string;
};
type ScreenShareState = {
	canShare?: boolean;
	sessions: ScreenShareSession[];
	iceServers: RTCIceServer[];
};
type ScreenShareAction =
	| { action: "request"; workspace: string; mode?: "screen" | "dashboard" }
	| { action: "request_peer"; peer: string; mode?: "screen" | "dashboard" }
	| { action: "create"; peer: string }
	| { action: "end" | "heartbeat"; id: string }
	| { action: "offer" | "answer"; id: string; sdp: string };
const path = `${platformRequest.base}/api/screen-share`;
export const ScreenShareAPI = {
	state: () => platformRequest.get<ScreenShareState>(path, { timeout: 10000 }),
	update: (action: ScreenShareAction) =>
		platformRequest.post<{ session: ScreenShareSession }>(
			path,
			action,
			undefined,
			{
				timeout: 10000,
			},
		),
};
