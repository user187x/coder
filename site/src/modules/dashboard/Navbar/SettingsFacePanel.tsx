import { cn } from "cn";
import { useId, useState } from "react";
import {
	ChatGate,
	useChatEnabled,
} from "#/modules/platform/chat/useChatEnabled";
import { SettingsChatPanel } from "./SettingsChatPanel";
import { SettingsDriveFace } from "./SettingsDriveFace";
import "./settingsFacePanel.css";

/** The Chat face's height when it is the first face shown (the Metrics face's usual height). */
const CHAT_FACE_HEIGHT = 436;

/** The faces of the Settings panel's bottom panel, in the order the arrows turn through them. */
export type SettingsFace = "metrics" | "chat" | "drive";

const NAMES: Record<SettingsFace, string> = {
	metrics: "Metrics",
	chat: "Chat",
	drive: "Cloud Drive",
};

/**
 * The Settings panel's bottom panel, which turns between its faces: Metrics (admins), Chat (where chat is on) and the
 * Cloud Drive, compact. A pair of arrow buttons at its top, at its centre, turn it one face that way, in
 * a loop, with a turning animation (none with reduced motion). It replaces the separate quick chat spot: opening chat
 * from the Settings menu turns it to its Chat face.
 */
export const SettingsFacePanel: React.FC<{
	face: SettingsFace;
	onFaceChange: (face: SettingsFace) => void;
	/** The Metrics face (null: the user may not see the cluster's metrics). */
	metrics: React.ReactNode;
	/** The Chat face expanded over the menu's room below its header row (the menu hides the rest meanwhile). */
	chatFull?: boolean;
	onChatFull?: (full: boolean) => void;
}> = ({ face, onFaceChange, metrics, chatFull = false, onChatFull }) => {
	const chatOn = useChatEnabled();
	const faces = (["metrics", "chat", "drive"] as const).filter(
		(f) => (f !== "metrics" || metrics !== null) && (f !== "chat" || chatOn),
	);
	// The direction of the last turn, for its animation.
	const [turn, setTurn] = useState<"left" | "right">("right");
	const arrowFill = `settings-face-arrow-${useId()}`;
	const current = faces.includes(face) ? face : (faces[0] ?? "drive");
	const full = chatFull && current === "chat";
	// The tallest face's height so far: the panel holds it whichever face shows.
	const [tallest, setTallest] = useState(0);
	const measure = (element: HTMLDivElement | null) => {
		// Chat sizes to the faces, not they to it: its conversation scrolls inside, its message box in view.
		if (!element || current === "chat") return;
		const observer = new ResizeObserver(() => {
			// The face's own content, not the height the panel already holds it to
			const height = Math.ceil(
				[...element.children].reduce(
					(sum, child) => sum + child.scrollHeight,
					0,
				),
			);
			setTallest((previous) => Math.max(previous, height));
		});
		observer.observe(element);
		return () => observer.disconnect();
	};
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
			className={cn(
				"settings-face-panel relative mx-1 mt-2 mb-1",
				full ? "flex min-h-0 flex-1 flex-col" : "shrink-0",
			)}
		>
			{faces.length > 1 && (
				<div className="settings-face-arrows">
					<svg width="0" height="0" className="absolute" aria-hidden="true">
						<defs>
							<linearGradient id={arrowFill} x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" className="settings-face-arrow-stop-top" />
								<stop offset="50%" className="settings-face-arrow-stop-mid" />
								<stop
									offset="100%"
									className="settings-face-arrow-stop-bottom"
								/>
							</linearGradient>
						</defs>
					</svg>
					<div className="settings-face-arrow-well">
						<div
							role="group"
							aria-label="Turn the panel"
							className="settings-face-arrow-pair"
						>
							{([-1, 1] as const).map((by) => (
								<button
									key={by}
									type="button"
									className={cn(
										"settings-face-arrow",
										by === -1
											? "settings-face-arrow-prev"
											: "settings-face-arrow-next",
									)}
									aria-label={`Turn to ${nameAt(by)}`}
									title={`Turn to ${nameAt(by)}`}
									onClick={() => step(by)}
								>
									<svg
										className="settings-face-arrow-glyph"
										viewBox="0 0 12 14"
										aria-hidden="true"
									>
										<polygon
											fill={`url(#${arrowFill})`}
											points={by === -1 ? "11,1 11,13 1,7" : "1,1 1,13 11,7"}
										/>
									</svg>
								</button>
							))}
						</div>
					</div>
				</div>
			)}
			{/* Every face as tall as the tallest one shown yet, so the panel keeps one height as it turns */}
			<div
				className={full ? "flex min-h-0 flex-1 flex-col" : "flex flex-col"}
				style={
					full
						? undefined
						: current === "chat"
							? { height: tallest || CHAT_FACE_HEIGHT }
							: { minHeight: tallest || undefined }
				}
			>
				<div
					key={current}
					ref={measure}
					className={cn(
						"settings-face flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [&>*]:flex-1",
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
								expanded={full}
								onExpandedChange={onChatFull}
							/>
						</ChatGate>
					) : (
						<SettingsDriveFace />
					)}
				</div>
			</div>
		</section>
	);
};
