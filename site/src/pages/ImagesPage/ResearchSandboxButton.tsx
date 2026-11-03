import { FlaskConicalIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { ImagesAPI } from "#/api/images";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/Dialog/Dialog";

type ResearchSandboxButtonProps = {
	sandbox: Awaited<ReturnType<typeof ImagesAPI.list>>["researchSandbox"];
};

export const ResearchSandboxButton = ({
	sandbox,
}: ResearchSandboxButtonProps) => {
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="lg">
					<FlaskConicalIcon />
					Deploy research sandbox
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Deploy research sandbox</DialogTitle>
					<DialogDescription>
						Create a dedicated workspace with the kernel and eBPF research
						projects, compiled modules, and a disposable Linux guest.
					</DialogDescription>
				</DialogHeader>
				{sandbox ? (
					<div className="flex flex-col gap-3 text-sm">
						<p className="m-0">
							Start with 2 CPU cores and 4 GiB of memory. Review the name,
							resources, and schedule before creating the workspace.
						</p>
						<p className="m-0 text-content-secondary">
							Inside its terminal, run <code>sandbox-guest</code> to open the
							guest. Research modules load only when you choose to run them
							inside that guest.
						</p>
					</div>
				) : (
					<p role="status" className="m-0 text-sm text-content-secondary">
						No research sandbox image has been configured for this deployment.
					</p>
				)}
				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						disabled={!sandbox}
						onClick={() => {
							if (!sandbox) return;
							const parameters = new URLSearchParams({
								name: "research-sandbox",
								"param.workspace_image": "custom",
								"param.workspace_image_custom": sandbox.image,
								"param.cpu": "2",
								"param.memory": "4",
							});
							navigate(
								`/templates/${encodeURIComponent(sandbox.template)}/workspace?${parameters}`,
							);
						}}
					>
						Continue to workspace setup
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
