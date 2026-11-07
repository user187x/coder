import { useEffect, useId, useState } from "react";
import { useQueryClient } from "react-query";
import { meKey } from "#/api/queries/users";
import type { User } from "#/api/typesGenerated";
import {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuRadioGroup,
	ContextMenuRadioItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { type ArrowMode, arrowMarkers } from "../workspaceTunnels/cableArrows";
import { EditableTunnelCable } from "../workspaceTunnels/EditableTunnelCable";
import { TunnelCord, tunnelHandles } from "../workspaceTunnels/TunnelCord";
import type { TunnelRoute } from "../workspaceTunnels/tunnelRouting";
import { cablePath, type Point, restingCable } from "./cables";
import {
	DEFAULT_DRIVE_CABLE_STYLE,
	type DriveCableStyle,
	type DriveCableStyles,
	readDriveCableStyles,
	saveDriveCableStyles,
} from "./driveCableStyle";

/**
 * The saved connector styles of one view for the signed-in user (like the tunnel layouts), read when the user changes
 * and saved on every change.
 */
export const useDriveCableStyles = (view: string) => {
	// The signed-in user from the query cache (the auth provider fills it), so this also works outside the provider.
	const userId = useQueryClient().getQueryData<User>(meKey)?.id ?? "anonymous";
	const storageKey = `${view}:${userId}`;
	const [loaded, setLoaded] = useState(storageKey);
	const [styles, setStyles] = useState<DriveCableStyles>(() =>
		readDriveCableStyles(storageKey),
	);
	if (loaded !== storageKey) {
		setLoaded(storageKey);
		setStyles(readDriveCableStyles(storageKey));
	}
	useEffect(() => {
		saveDriveCableStyles(storageKey, styles);
	}, [storageKey, styles]);
	return {
		styles,
		styleOf: (id: string) => styles[id] ?? DEFAULT_DRIVE_CABLE_STYLE,
		update: (id: string, patch: Partial<DriveCableStyle>) =>
			setStyles((current) => ({
				...current,
				[id]: { ...(current[id] ?? DEFAULT_DRIVE_CABLE_STYLE), ...patch },
			})),
	};
};

const ARROWS: { mode: ArrowMode; label: string }[] = [
	{ mode: "none", label: "No arrowheads" },
	{ mode: "start", label: "Arrowhead at the start" },
	{ mode: "end", label: "Arrowhead at the end" },
	{ mode: "both", label: "Arrowheads at both ends" },
];

/** The connector style choices: rope or cable, and for a cable its arrowheads and dashes. */
const DriveCableStyleItems = ({
	value,
	onChange,
}: {
	value: DriveCableStyle;
	onChange: (patch: Partial<DriveCableStyle>) => void;
}) => (
	<>
		<ContextMenuGroup aria-label="Connector style">
			<ContextMenuRadioGroup
				value={value.style}
				onValueChange={(style) =>
					onChange({ style: style === "cable" ? "cable" : "rope" })
				}
			>
				<ContextMenuRadioItem value="rope">Rope</ContextMenuRadioItem>
				<ContextMenuRadioItem value="cable">Cable</ContextMenuRadioItem>
			</ContextMenuRadioGroup>
		</ContextMenuGroup>
		{value.style === "cable" && (
			<>
				<ContextMenuSeparator />
				<ContextMenuGroup aria-label="Arrowheads">
					<ContextMenuRadioGroup
						value={value.arrows}
						onValueChange={(arrows) => {
							const mode = ARROWS.find((a) => a.mode === arrows)?.mode;
							if (mode) {
								onChange({ arrows: mode });
							}
						}}
					>
						{ARROWS.map((a) => (
							<ContextMenuRadioItem key={a.mode} value={a.mode}>
								{a.label}
							</ContextMenuRadioItem>
						))}
					</ContextMenuRadioGroup>
				</ContextMenuGroup>
				<ContextMenuCheckboxItem
					checked={value.dashed}
					onCheckedChange={(dashed) => onChange({ dashed: dashed === true })}
				>
					Dashed
				</ContextMenuCheckboxItem>
			</>
		)}
	</>
);

/** Wraps a rope in the style menu (right-click, or Shift+F10 and the Menu key on the focused rope). */
export const DriveRopeMenu = ({
	value,
	onChange,
	children,
}: {
	value: DriveCableStyle;
	onChange: (patch: Partial<DriveCableStyle>) => void;
	children: React.ReactElement;
}) => (
	<ContextMenu>
		<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
		<ContextMenuContent className="z-[100]">
			<DriveCableStyleItems value={value} onChange={onChange} />
		</ContextMenuContent>
	</ContextMenu>
);

/**
 * A Cloud Drive connector drawn as a workspace tunnel cable: the tunnel cable's spring motion, routing menu and bend
 * handles (EditableTunnelCable), looping out to the right as the rope does.
 */
export const DriveStyledCable = ({
	id,
	from,
	to,
	reach,
	value,
	onChange,
	label,
	onOpen,
	children,
}: {
	id: string;
	from: Point;
	to: Point;
	/** How far right the loop reaches (px). */
	reach: number;
	value: DriveCableStyle;
	onChange: (patch: Partial<DriveCableStyle>) => void;
	label: string;
	onOpen: () => void;
	/** Drawn at the cable's end, over its hit area. */
	children?: React.ReactNode;
}) => {
	const arrowId = `drive-cable-arrow-${useId().replace(/:/g, "")}`;
	const handles = tunnelHandles(from, to, "right", "right", reach);
	return (
		<g data-drive-cable={id} data-cable-style={value.style}>
			<EditableTunnelCable
				from={from}
				to={to}
				defaultPath={cablePath(from, restingCable(handles), to)}
				route={value.route}
				onChange={(route: TunnelRoute) => onChange({ route })}
				label={label}
				onOpen={onOpen}
				pending={value.dashed}
				arrowhead={{ id: arrowId, mode: value.arrows }}
				testId={`drive-cable-${id}`}
				defaultCable={
					<TunnelCord
						from={from}
						to={to}
						fromSide="right"
						toSide="right"
						arc={reach}
						pending={value.dashed}
						markers={arrowMarkers(arrowId, value.arrows)}
					/>
				}
				actions={<DriveCableStyleItems value={value} onChange={onChange} />}
			>
				{children}
			</EditableTunnelCable>
		</g>
	);
};
