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
 * The navbar's "Resources" menu, built like the Admin menu: the workspaces
 * list, the templates and the workspace images built for them. Its trigger shows the workspaces icon, drawn at
 * twice its size for sharp HiDPI screens, in the version that reads on the
 * selected theme (black on light, white on dark), and the word "Resources".
 */
export const WorkspacesDropdown: React.FC = () => {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="lg" title="Workspaces and templates">
					<img
						src="/workspaces-icon-light.png"
						alt=""
						className="size-5 shrink-0 block dark:hidden"
					/>
					<img
						src="/workspaces-icon-dark.png"
						alt=""
						className="size-5 shrink-0 hidden dark:block"
					/>
					Resources
					<ChevronDownIcon className="text-content-primary" />
				</Button>
			</DropdownMenuTrigger>

			<DropdownMenuContent align="start" className="w-[180px] min-w-auto">
				<nav>
					<DropdownMenuItem asChild>
						<Link to="/workspaces">Workspaces</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link to="/templates">Templates</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link to="/images">Images</Link>
					</DropdownMenuItem>
				</nav>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
