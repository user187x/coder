import { Alert, AlertDescription } from "#/components/Alert/Alert";

type QueuedForCapacityCalloutProps = {
	hasLicense: boolean;
	agentHoursHardLimit?: number;
};

export const QueuedForCapacityCallout: React.FC<
	QueuedForCapacityCalloutProps
> = ({ hasLicense, agentHoursHardLimit }) => {
	let limitMessage = "Your team has reached the limit for active agents.";
	if (hasLicense) {
		limitMessage =
			"Your team has reached your license’s limit for active agents.";
	}
	if (agentHoursHardLimit !== undefined) {
		limitMessage = `Your team has reached the ${agentHoursHardLimit}-hour Agent Hours hard limit.`;
	}

	return (
		<Alert severity="warning" className="mt-2">
			<AlertDescription>
				{limitMessage} This agent is queued and will start automatically when
				capacity is available.
			</AlertDescription>
		</Alert>
	);
};
