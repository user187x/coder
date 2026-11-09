import { cn } from "cn";
import { useState } from "react";
import {
	ChatGate,
	useChatEnabled,
} from "#/modules/platform/chat/useChatEnabled";
import { CloudDrive } from "#/modules/platform/cloudDrive/CloudDrive";
import { SettingsChatPanel } from "./SettingsChatPanel";
import "./settingsFacePanel.css";

/** The faces of the Settings panel's bottom panel, in the order the dimples turn through them. */
export type SettingsFace = "metrics" | "chat" | "drive";

const NAMES: Record<SettingsFace, string> = {
	metrics: "Metrics",
	chat: "Chat",
	drive: "Cloud Drive",
};

/**
 * The Settings panel's bottom panel, which turns between its faces: Metrics (admins), Chat (where chat is on) and the
 * Cloud Drive, compact. Two dimples at its top, just left and just right of its centre, turn it one face that way, in
 * a loop, with a turning animation (none with reduced motion). It replaces the separate quick chat spot: opening chat
 * from the Settings menu turns it to its Chat face.
 */
export const SettingsFacePanel: React.FC<{
	face: SettingsFace;
	onFaceChange: (face: SettingsFace) => void;
	/** The Metrics face (null: the user may not see the cluster's metrics). */
	metrics: React.ReactNode;
}> = ({ face, onFaceChange, metrics }) => {
	const chatOn = useChatEnabled();
	const faces = (["metrics", "chat", "drive"] as const).filter(
		(f) => (f !== "metrics" || metrics !== null) && (f !== "chat" || chatOn),
	);
	// The direction of the last turn, for its animation.
	const [turn, setTurn] = useState<"left" | "right">("right");
	const current = faces.includes(face) ? face : (faces[0] ?? "drive");
	const step = (by: 1 | -1) => {
		const index = faces.indexOf(current);
		const next = faces[(index + by + faces.length) % faces.length];
		if (!next) return;
		setTurn(by === 1 ? "right" : "left");
		onFaceChange(next);
	};
	const nameAt = (by: 1 | -1) =>
		NAMES[
			faces[(faces.indexOf(current) + by + faces.length) % faces.length] ??
				current
		];
	return (
		<section
			aria-label={`Settings panel: ${NAMES[current]}`}
			data-testid="settings-face-panel"
			data-face={current}
			className="settings-face-panel relative mx-1 mt-2 mb-1"
		>
			{faces.length > 1 && (
				<div className="settings-face-dimples">
					<button
						type="button"
						className="settings-face-dimple"
						aria-label={`Turn to ${nameAt(-1)}`}
						title={`Turn to ${nameAt(-1)}`}
						onClick={() => step(-1)}
					/>
					<button
						type="button"
						className="settings-face-dimple"
						aria-label={`Turn to ${nameAt(1)}`}
						title={`Turn to ${nameAt(1)}`}
						onClick={() => step(1)}
					/>
				</div>
			)}
			<div
				key={current}
				className={cn(
					"settings-face",
					turn === "right"
						? "settings-face-turn-right"
						: "settings-face-turn-left",
				)}
			>
				{current === "metrics" ? (
					metrics
				) : current === "chat" ? (
					<ChatGate>
						<SettingsChatPanel
							onClose={() => onFaceChange(faces[0] ?? "drive")}
						/>
					</ChatGate>
				) : (
					<div className="rounded-lg border border-solid border-border bg-surface-primary p-3">
						<CloudDrive placement="quota" workspaceIds={[]} />
					</div>
				)}
			</div>
		</section>
	);
};
