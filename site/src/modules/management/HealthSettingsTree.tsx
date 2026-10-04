import { cn } from "cn";
import { BellOffIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import { useLocation } from "react-router";
import { health } from "#/api/queries/debug";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import { SettingsSidebarNavItem as SidebarNavItem } from "#/components/Sidebar/Sidebar";
import { WorkspaceHealthIcon } from "#/modules/platform/workspaceHealth/WorkspaceHealthIcon";
import { HealthIcon } from "#/pages/HealthPage/Content";
import {
	HEALTH_SECTIONS,
	WORKSPACE_HEALTH_PATH,
} from "#/pages/HealthPage/healthSections";

/**
 * General's "Health" entry: a collapsible tree with Workspace Health and each
 * section of the deployment's health report, marked with its severity. The
 * pages open on the right like the other entries. Open while one of them is
 * shown; the report is only fetched once the tree is open.
 */
export const HealthSettingsTree: React.FC = () => {
	const location = useLocation();
	const [open, setOpen] = useState(() =>
		location.pathname.startsWith("/health"),
	);
	const { data: report } = useQuery({ ...health(), enabled: open });

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger
				className={cn(
					"flex w-full cursor-pointer items-center justify-between rounded-md border-0 bg-transparent py-2 px-3 text-left text-sm font-medium transition ease-in-out duration-150 hover:bg-surface-secondary",
					open ? "text-content-primary" : "text-content-secondary",
				)}
			>
				<span className="inline-flex items-center gap-2">
					Health
					{report && <HealthIcon size={14} severity={report.severity} />}
				</span>
				<ChevronRightIcon
					aria-hidden
					className={cn(
						"size-icon-sm transition-transform duration-150 motion-reduce:transition-none",
						open && "rotate-90",
					)}
				/>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="ml-3 mt-1 flex flex-col gap-1 border-0 border-l border-solid border-l-border pl-1">
					<SidebarNavItem href={WORKSPACE_HEALTH_PATH}>
						<span className="inline-flex items-center gap-2">
							<WorkspaceHealthIcon />
							Workspace Health
						</span>
					</SidebarNavItem>
					{HEALTH_SECTIONS.map(({ key, label, path }) => {
						const section = report?.[key];
						return (
							<SidebarNavItem key={key} href={path}>
								<span className="inline-flex w-full items-center gap-2">
									{section && (
										<HealthIcon size={14} severity={section.severity} />
									)}
									{label}
									{section?.dismissed && (
										<BellOffIcon
											aria-label="Warnings muted"
											className="ml-auto size-icon-sm text-content-disabled"
										/>
									)}
								</span>
							</SidebarNavItem>
						);
					})}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
};
