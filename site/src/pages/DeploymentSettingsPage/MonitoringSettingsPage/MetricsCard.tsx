import { BracesIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "#/components/Button/Button";
import { Label } from "#/components/Label/Label";
import { Switch } from "#/components/Switch/Switch";
import { AuditEndpointCard } from "#/modules/platform/security/AuditEndpointCard";

/**
 * Monitoring > Metrics: an organization's metrics for an external system to collect, through the same protected
 * endpoint and collector grants as the Security section's audit logs (Expose Metrics Endpoint), as JSON or in the
 * Prometheus text format.
 */
export const MetricsCard: React.FC = () => {
	const id = useId();
	const [expose, setExpose] = useState(false);
	const [prometheus, setPrometheus] = useState(false);
	return (
		<section
			aria-labelledby={`${id}-heading`}
			className="mt-6 flex flex-col gap-4 rounded-xl border border-solid border-border bg-surface-primary p-6"
		>
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div>
					<h2 id={`${id}-heading`} className="m-0 text-lg font-semibold">
						Metrics
					</h2>
					<p className="mb-0 text-sm text-content-secondary">
						An organization's members, templates and workspaces by state, for an
						external monitoring system to collect.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-4">
					<div className="flex items-center gap-2">
						<Switch
							id={`${id}-prometheus`}
							checked={prometheus}
							onCheckedChange={setPrometheus}
						/>
						<Label htmlFor={`${id}-prometheus`} className="font-normal">
							Export Prometheus-friendly format
						</Label>
					</div>
					<Button
						variant="outline"
						size="sm"
						aria-expanded={expose}
						onClick={() => setExpose((value) => !value)}
					>
						<BracesIcon />
						Expose Metrics Endpoint
					</Button>
				</div>
			</div>
			{expose && <AuditEndpointCard kind="metrics" prometheus={prometheus} />}
		</section>
	);
};
