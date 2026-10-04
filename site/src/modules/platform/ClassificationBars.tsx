import { useQuery } from "react-query";
import type { ClassificationSettings } from "#/api/platform";
import { classification } from "#/api/queries/platform";
import {
	getBootClassification,
	isEmbeddedFrame,
} from "#/contexts/platformBoot";

const MIN_HEIGHT = 12;
const MAX_HEIGHT = 64;

export const classificationHeight = (height: number): number =>
	Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Number(height) || 24));

export const classificationFontSize = (height: number): number =>
	Math.max(10, Math.min(20, Math.round(height * 0.55)));

const isShown = (
	settings: ClassificationSettings | undefined,
): settings is ClassificationSettings =>
	Boolean(settings?.enabled && settings.text);

/**
 * The classification marking on every page, the sign-in page included: two
 * identical bars glued to the very top and the very bottom of the window,
 * above everything else. The page is inset by the bars' height so nothing
 * hides underneath them.
 */
export const ClassificationBars: React.FC = () => {
	const { data: settings } = useQuery({
		...classification(getBootClassification()),
		enabled: !isEmbeddedFrame(),
	});

	if (isEmbeddedFrame() || !isShown(settings)) {
		return null;
	}

	const height = classificationHeight(settings.height);
	return (
		<>
			<style>{classificationInsetCSS(height, settings.background)}</style>
			<ClassificationBar edge="top" settings={settings} height={height} />
			<ClassificationBar edge="bottom" settings={settings} height={height} />
		</>
	);
};

type ClassificationBarProps = {
	edge: "top" | "bottom";
	settings: ClassificationSettings;
	height: number;
};

const ClassificationBar: React.FC<ClassificationBarProps> = ({
	edge,
	settings,
	height,
}) => {
	return (
		<div
			id={`coder-classification-${edge}`}
			role="note"
			aria-label="Classification"
			// 100vw, not right-0: the page reserves a scrollbar gutter that right-0
			// would leave uncovered.
			className="fixed left-0 w-screen z-[2147483000] flex items-center justify-center px-3 overflow-hidden whitespace-nowrap text-ellipsis font-bold tracking-[.06em] pointer-events-none select-none"
			style={{
				[edge]: 0,
				height,
				lineHeight: `${height}px`,
				fontSize: classificationFontSize(height),
				background: settings.background,
				color: settings.color,
			}}
		>
			{settings.text}
		</div>
	);
};

/**
 * Insets the dashboard by the bars' height: its sticky navbar sits below the
 * top bar, bottom bars and toasts above the bottom one, and full-height
 * screens shrink. The page background is painted in the bars' colour at the
 * edges, because a fixed bar cannot paint into the reserved scrollbar gutter.
 */
const classificationInsetCSS = (height: number, background: string) => {
	const bg = background.replace(/[;{}<>]/g, "");
	return `
html { --coder-classification-h: ${height}px;
  background: linear-gradient(to bottom, ${bg} 0 ${height}px, hsl(var(--surface-primary)) ${height}px calc(100% - ${height}px), ${bg} calc(100% - ${height}px)) fixed !important; }
body { padding-top: ${height}px !important; padding-bottom: ${height}px !important; box-sizing: border-box; }
div.sticky.top-0 { top: ${height}px !important; }
.sticky.bottom-0, .fixed.bottom-0 { bottom: ${height}px !important; }
[data-sonner-toaster][data-y-position=bottom] { bottom: calc(${height}px + 24px) !important; }
.h-screen { height: calc(100vh - ${2 * height}px) !important; }
.min-h-screen { min-height: calc(100vh - ${2 * height}px) !important; }
.max-h-screen { max-height: calc(100vh - ${2 * height}px) !important; }`;
};
