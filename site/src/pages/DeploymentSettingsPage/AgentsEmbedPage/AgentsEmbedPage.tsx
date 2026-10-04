import { useLayoutEffect, useRef } from "react";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { embedFrameAttributes } from "#/contexts/platformBoot";
import { pageTitle } from "#/utils/page";

const AGENTS_PATH = "/agents";

/**
 * General > AI > Agents: Coder Agents itself, inside General. The page is
 * framed: it keeps its own scrolling panes and fills the rest of the window,
 * and its links that leave Agents navigate the dashboard around it.
 */
const AgentsEmbedPage: React.FC = () => {
	const frame = useRef<HTMLIFrameElement>(null);

	// Down to the bottom of the window (above the bottom classification bar).
	useLayoutEffect(() => {
		const fit = () => {
			const el = frame.current;
			if (!el) {
				return;
			}
			const top = el.getBoundingClientRect().top + window.scrollY;
			el.style.height = `calc(100vh - ${Math.round(top) + 40}px - var(--coder-classification-h, 0px))`;
		};
		fit();
		window.addEventListener("resize", fit);
		return () => window.removeEventListener("resize", fit);
	}, []);

	return (
		<>
			<title>{pageTitle("Agents")}</title>
			<SettingsHeader>
				<SettingsHeaderTitle>Agents</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Coder Agents: AI agents that work in your workspaces. Chats open right
					here.
				</SettingsHeaderDescription>
			</SettingsHeader>
			<iframe
				ref={frame}
				title="Agents"
				src={AGENTS_PATH}
				allow="clipboard-read; clipboard-write"
				className="block min-h-[560px] w-full rounded-lg border border-solid border-border"
				{...embedFrameAttributes(AGENTS_PATH)}
			/>
		</>
	);
};

export default AgentsEmbedPage;
