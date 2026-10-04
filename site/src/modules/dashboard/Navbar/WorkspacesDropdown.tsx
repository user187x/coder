import { Link } from "react-router";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";

/**
 * The navbar's "Workspaces" menu, built like the Admin menu: the workspaces
 * list and the templates. Its trigger shows the workspaces icon, drawn at
 * twice its size for sharp HiDPI screens.
 */
export const WorkspacesDropdown: React.FC = () => {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="lg"
					aria-label="Workspaces"
					title="Workspaces"
				>
					<img
						src="/workspaces-icon.png"
						alt=""
						className="size-5 shrink-0 block"
					/>
					<ChevronDownIcon className="text-content-primary" />
				</Button>
			</DropdownMenuTrigger>

			<DropdownMenuContent align="start" className="w-[180px] min-w-auto">
				<nav>
					<DropdownMenuItem asChild>
						<Link to="/workspaces">Workspace</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link to="/templates">Templates</Link>
					</DropdownMenuItem>
				</nav>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
