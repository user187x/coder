import { useOutletContext } from "react-router";
import type { HealthcheckReport } from "#/api/typesGenerated";
import { Alert } from "#/components/Alert/Alert";
import {
	GridData,
	GridDataLabel,
	GridDataValue,
	Header,
	HeaderTitle,
	HealthyDot,
	Main,
} from "./Content";
import { MuteWarningsButton } from "./MuteWarningsButton";

const WebsocketPage = () => {
	const healthStatus = useOutletContext<HealthcheckReport>();
	const { websocket } = healthStatus;

	return (
		<>
			<Header>
				<HeaderTitle>
					<HealthyDot severity={websocket.severity} />
					Websocket
				</HeaderTitle>
				<MuteWarningsButton healthcheck="Websocket" />
			</Header>

			<Main>
				{websocket.error && (
					<Alert severity="error" prominent>
						{websocket.error}
					</Alert>
				)}

				{websocket.warnings.map((warning) => {
					return (
						<Alert key={warning.code} severity="warning" prominent dismissible>
							{warning.message}
						</Alert>
					);
				})}

				<GridData className="w-full grid-cols-[auto_minmax(0,1fr)]">
					<GridDataLabel>Status Code</GridDataLabel>
					<GridDataValue>{websocket.code || "Unavailable"}</GridDataValue>

					<GridDataLabel>Response Body</GridDataLabel>
					<GridDataValue className="whitespace-pre-wrap wrap-anywhere">
						{websocket.body ? (
							<code>{websocket.body}</code>
						) : (
							<span className="text-content-secondary">No body message</span>
						)}
					</GridDataValue>
				</GridData>
			</Main>
		</>
	);
};

export default WebsocketPage;
