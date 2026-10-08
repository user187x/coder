import {
	CircleUserIcon,
	CopyIcon,
	LogOutIcon,
	MonitorIcon,
	TerminalIcon,
} from "lucide-react";
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
import { supportsCoderDesktop } from "#/utils/platform";
import { SupportIcon } from "../SupportIcon";
import { ThemeToggleItem } from "./ThemeToggleItem";

const CODER_DESKTOP_DOCS_URL = "https://coder.com/docs/user-guides/desktop";

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
			{supportsCoderDesktop() && (
				<DropdownMenuItem asChild>
					<a href={CODER_DESKTOP_DOCS_URL} target="_blank" rel="noreferrer">
						<MonitorIcon />
						<span>Install Coder Desktop</span>
					</a>
				</DropdownMenuItem>
			)}
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
			<ThemeToggleItem />
			{supportLinks.map((link) => (
				<DropdownMenuItem key={link.name} asChild>
					<a href={link.target} target="_blank" rel="noreferrer">
						{link.icon && <SupportIcon icon={link.icon} />}
						<span>{link.name}</span>
					</a>
				</DropdownMenuItem>
			))}
			<DropdownMenuSeparator />
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
