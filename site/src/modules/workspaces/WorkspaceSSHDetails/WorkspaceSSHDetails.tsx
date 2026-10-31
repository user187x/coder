import { useEffect, useState } from "react";
import { useQuery } from "react-query";
import { getErrorMessage } from "#/api/errors";
import { deploymentSSHConfig } from "#/api/queries/deployment";
import { workspaceById } from "#/api/queries/workspaces";
import type { Workspace } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import { CodeExample } from "#/components/CodeExample/CodeExample";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "#/components/Popover/Popover";
import { useDebouncedFunction } from "#/hooks/debounce";

type HoverEvents = Pick<
	React.ComponentProps<"span">,
	"onPointerEnter" | "onPointerLeave" | "onFocusCapture" | "onBlurCapture"
>;
export const WorkspaceSSHDetails = ({
	workspace,
	disabled,
	children,
}: {
	workspace: Workspace;
	disabled?: boolean;
	children: (events: HoverEvents) => React.ReactElement;
}) => {
	const [open, setOpen] = useState(false);
	const { debounced: changeOpen, cancelDebounce: clear } = useDebouncedFunction(
		(next: boolean) => setOpen(next),
		(next: boolean) => (next ? 600 : 200),
	);
	useEffect(() => clear, [clear]);
	const show = () => {
		if (!disabled) changeOpen(true);
	};
	const hide = () => changeOpen(false);
	const current = useQuery({
		...workspaceById(workspace.id),
		enabled: open,
		retry: false,
		staleTime: 0,
		refetchInterval: open ? 5000 : false,
	});
	const config = useQuery({
		...deploymentSSHConfig(),
		enabled: open,
		retry: false,
	});
	const agents =
		current.data?.latest_build.resources.flatMap((resource) =>
			(resource.agents ?? []).filter((agent) =>
				agent.display_apps.includes("ssh_helper"),
			),
		) ?? [];
	const running = current.data?.latest_build.status === "running";
	const error = current.error || config.error;
	return (
		<Popover open={open && !disabled} onOpenChange={setOpen}>
			<PopoverAnchor asChild>
				{children({
					onPointerEnter: (event) => {
						if (event.pointerType !== "touch") show();
					},
					onPointerLeave: hide,
					onFocusCapture: show,
					onBlurCapture: hide,
				})}
			</PopoverAnchor>
			<PopoverContent
				side="top"
				align="start"
				className="w-[420px] max-w-[calc(100vw-32px)] p-4"
				aria-label={`SSH access for ${workspace.name}`}
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => event.preventDefault()}
				onPointerEnter={clear}
				onPointerLeave={hide}
				onFocusCapture={clear}
				onBlurCapture={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget)) hide();
				}}
			>
				<div className="flex items-center justify-between gap-3">
					<h3 className="m-0 text-base">
						SSH · {workspace.owner_name}/{workspace.name}
					</h3>
					<Button size="sm" variant="subtle" onClick={() => setOpen(false)}>
						Close
					</Button>
				</div>
				{(current.isLoading || config.isLoading) && (
					<p className="text-sm text-content-secondary">
						Checking current SSH access…
					</p>
				)}
				{error && (
					<p role="alert" className="text-sm text-content-destructive">
						{getErrorMessage(error, "Could not retrieve SSH details.")}{" "}
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								void current.refetch();
								void config.refetch();
							}}
						>
							Retry
						</Button>
					</p>
				)}
				{current.data && !running && (
					<p className="text-sm text-content-secondary">
						Workspace is {current.data.latest_build.status}. SSH will be
						available after it is running and an agent connects.
					</p>
				)}
				{current.isSuccess && agents.length === 0 && (
					<p className="text-sm text-content-secondary">
						No SSH agent is currently provisioned for this workspace.
					</p>
				)}
				{config.data &&
					agents.map((agent) => {
						const available = running && agent.status === "connected";
						const host = `${agent.name}.${workspace.name}.${workspace.owner_name}.${config.data.hostname_suffix}`;
						return (
							<div
								key={agent.id}
								className="mt-3 border-0 border-t border-solid border-border pt-3"
							>
								<p className="m-0 text-sm">
									<strong>{agent.name}</strong> ·{" "}
									{available ? "Connected" : agent.status}
								</p>
								<p className="mb-1 text-xs text-content-secondary">
									Connect through the Coder CLI:
								</p>
								<CodeExample
									code={`coder ssh ${workspace.owner_name}/${workspace.name}.${agent.name}`}
									copyLabel={`Copy Coder command for ${agent.name}`}
									secret={false}
								/>
								<p className="mb-1 text-xs text-content-secondary">
									SSH host after running <code>coder config-ssh</code>:
								</p>
								<CodeExample
									code={`ssh ${host}`}
									copyLabel={`Copy SSH command for ${agent.name}`}
									secret={false}
								/>
							</div>
						);
					})}
				<p className="mb-0 text-xs text-content-secondary">
					Uses the deployment's configured SSH host and current agent, so it
					works without guessing a private node IP. Sign into this deployment
					with the Coder CLI first.
				</p>
			</PopoverContent>
		</Popover>
	);
};
