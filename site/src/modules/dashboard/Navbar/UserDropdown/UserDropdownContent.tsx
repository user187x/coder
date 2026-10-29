import {
	ArrowLeftRightIcon,
	ChevronDownIcon,
	CircleUserIcon,
	CopyIcon,
	LogOutIcon,
	PaletteIcon,
	TerminalIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import type * as TypesGen from "#/api/typesGenerated";
import { CheckIcon } from "#/components/AnimatedIcons/Check";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "#/components/DropdownMenu/DropdownMenu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { useClipboard } from "#/hooks/useClipboard";
import { startNavbarArrange } from "#/modules/platform/navbarOrder/navbarOrder";
import { SupportIcon } from "../SupportIcon";
import { AnimationsToggleItem } from "./AnimationsToggleItem";
import { ThemeToggleItem } from "./ThemeToggleItem";

type UserDropdownContentProps = {
	user: TypesGen.User;
	buildInfo?: TypesGen.BuildInfoResponse;
	/** Extra content for the profile area, rendered below the profile link
	 * (e.g. AI spend). The consumer supplies its own separator if needed. */
	profileExtra?: React.ReactNode;
	supportLinks: readonly TypesGen.LinkConfig[];
	onSignOut: () => void;
};

export const UserDropdownContent: React.FC<UserDropdownContentProps> = ({
	user,
	buildInfo,
	profileExtra,
	supportLinks,
	onSignOut,
}) => {
	const { showCopiedSuccess, copyToClipboard } = useClipboard();
	const versionClipboard = useClipboard();
	const [appearanceOpen, setAppearanceOpen] = useState(false);
	const appearanceId = useId();

	return (
		<>
			<DropdownMenuItem className="flex items-center gap-3" asChild>
				<Link to="/settings/account">
					<div className="flex flex-col">
						<span className="text-content-primary">{user.username}</span>
						<span className="text-xs font-semibold">{user.email}</span>
					</div>
				</Link>
			</DropdownMenuItem>
			{profileExtra}
			<DropdownMenuSeparator />
			<DropdownMenuItem asChild>
				<Link to="/install">
					<TerminalIcon />
					<span>Install CLI</span>
				</Link>
			</DropdownMenuItem>
			<DropdownMenuItem asChild>
				<Link to="/settings/account">
					<CircleUserIcon />
					<span>Account</span>
				</Link>
			</DropdownMenuItem>
			<DropdownMenuItem onClick={onSignOut}>
				<LogOutIcon />
				<span>Sign Out</span>
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem
				aria-expanded={appearanceOpen}
				aria-controls={appearanceId}
				onSelect={(event) => {
					event.preventDefault();
					setAppearanceOpen(!appearanceOpen);
				}}
			>
				<PaletteIcon />
				<span>Appearance</span>
				<ChevronDownIcon
					className={appearanceOpen ? "ml-auto rotate-180" : "ml-auto"}
				/>
			</DropdownMenuItem>
			{appearanceOpen && (
				<div
					id={appearanceId}
					className="pl-3 border-l border-solid border-border ml-3"
					role="group"
					aria-label="Appearance options"
				>
					<ThemeToggleItem />
					<AnimationsToggleItem />
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={() => startNavbarArrange()}>
						<ArrowLeftRightIcon />
						<span>Rearrange top bar</span>
					</DropdownMenuItem>
				</div>
			)}
			{supportLinks.map((link) => (
				<DropdownMenuItem key={link.name} asChild>
					<a href={link.target} target="_blank" rel="noreferrer">
						{link.icon && <SupportIcon icon={link.icon} />}
						<span>{link.name}</span>
					</a>
				</DropdownMenuItem>
			))}
			<DropdownMenuSeparator />
			{buildInfo?.version && (
				<DropdownMenuItem
					className="text-xs"
					title="Copy build version"
					aria-label={`Copy build version ${buildInfo.version}`}
					onSelect={(event) => {
						event.preventDefault();
						versionClipboard.copyToClipboard(buildInfo.version);
					}}
				>
					<span className="shrink-0">Version</span>
					<span className="truncate flex-1 font-mono">{buildInfo.version}</span>
					{versionClipboard.showCopiedSuccess ? (
						<CheckIcon className="size-icon-xs! ml-auto" />
					) : (
						<CopyIcon className="size-icon-xs! ml-auto" />
					)}
				</DropdownMenuItem>
			)}
			{buildInfo?.deployment_id && (
				<Tooltip disableHoverableContent>
					<TooltipTrigger asChild>
						<DropdownMenuItem
							className="text-xs"
							onSelect={(e) => {
								e.preventDefault();
								copyToClipboard(buildInfo.deployment_id);
							}}
						>
							<span className="shrink-0">Deployment ID</span>
							<span className="truncate flex-1">{buildInfo.deployment_id}</span>
							{showCopiedSuccess ? (
								<CheckIcon className="size-icon-xs! ml-auto" />
							) : (
								<CopyIcon className="size-icon-xs! ml-auto" />
							)}
						</DropdownMenuItem>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						{showCopiedSuccess ? "Copied!" : "Copy deployment ID"}
					</TooltipContent>
				</Tooltip>
			)}
			<DropdownMenuItem className="text-xs" disabled>
				<span>&copy; {new Date().getFullYear()} Coder Technologies, Inc.</span>
			</DropdownMenuItem>
		</>
	);
};
