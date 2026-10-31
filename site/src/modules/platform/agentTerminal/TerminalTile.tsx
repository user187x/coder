import { cn } from "cn";
import { Columns2Icon, Rows2Icon } from "lucide-react";
import { useRef, useState } from "react";
import {
	ContextMenuItem,
	ContextMenuSeparator,
} from "#/components/ContextMenu/ContextMenu";
import { WorkspaceTerminal } from "#/modules/terminal/WorkspaceTerminal";
import { generateConnectionSessionId } from "#/utils/random";
import type { SplitDirection } from "./terminalLayout";
import { MIN_TERMINAL_COLS, MIN_TERMINAL_ROWS } from "./terminalSession";

type Props = Omit<
	React.ComponentProps<typeof WorkspaceTerminal>,
	"sessionId"
> & {
	index: number;
	showDimensions: boolean;
	onEnd: () => void;
	onSelect: () => void;
	selected: boolean;
	bounds:
		| { left: number; top: number; width: number; height: number }
		| undefined;
	canSplit: boolean;
	onSplit: (direction: SplitDirection) => void;
};

/** One PTY connection; resizing or adding a sibling never replaces its identity. */
export const TerminalTile = ({
	index,
	showDimensions,
	onEnd,
	onSelect,
	selected,
	bounds,
	canSplit,
	onSplit,
	...props
}: Props) => {
	const [clientSessionId] = useState(generateConnectionSessionId);
	const connected = useRef(false);
	const ended = useRef(false);
	const finish = () => {
		if (ended.current) return;
		ended.current = true;
		onEnd();
	};
	const [dimensions, setDimensions] = useState<{
		cols: number;
		rows: number;
	}>();
	return (
		<div
			role="group"
			aria-label={`Terminal ${index + 1}`}
			onFocusCapture={onSelect}
			onPointerDown={onSelect}
			style={
				bounds && {
					left: `${bounds.left}%`,
					top: `${bounds.top}%`,
					width: `${bounds.width}%`,
					height: `${bounds.height}%`,
				}
			}
			className={cn(
				"absolute min-h-0 min-w-0 overflow-hidden border border-solid border-border",
				selected && "ring-1 ring-inset ring-border-focus",
			)}
		>
			<WorkspaceTerminal
				{...props}
				contextMenuItems={
					<>
						<ContextMenuSeparator />
						<ContextMenuItem
							disabled={!canSplit}
							onSelect={() => onSplit("vertical")}
						>
							<Columns2Icon className="size-4" /> Split vertically
						</ContextMenuItem>
						<ContextMenuItem
							disabled={!canSplit}
							onSelect={() => onSplit("horizontal")}
						>
							<Rows2Icon className="size-4" /> Split horizontally
						</ContextMenuItem>
					</>
				}
				sessionId={clientSessionId}
				onExit={finish}
				onResize={(cols, rows) => setDimensions({ cols, rows })}
				onStatusChange={(status) => {
					if (status === "connected") connected.current = true;
					else if (status === "disconnected" && connected.current) finish();
				}}
			/>
			{dimensions && showDimensions && (
				<span
					className={cn(
						"pointer-events-none absolute right-5 top-3 z-[1] rounded-full border border-solid bg-surface-primary/85 px-2 py-0.5 font-mono text-[10px] tabular-nums",
						dimensions.cols < MIN_TERMINAL_COLS ||
							dimensions.rows < MIN_TERMINAL_ROWS
							? "border-border-warning text-content-warning"
							: "border-border text-content-secondary",
					)}
				>
					{dimensions.cols}x{dimensions.rows}
				</span>
			)}
		</div>
	);
};
