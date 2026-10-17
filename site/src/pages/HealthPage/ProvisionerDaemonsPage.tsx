import { useOutletContext } from "react-router";
import type { HealthcheckReport } from "#/api/typesGenerated";
import { Alert } from "#/components/Alert/Alert";
import { Provisioner } from "#/modules/provisioners/Provisioner";
import { Header, HeaderTitle, HealthyDot, Main } from "./Content";
import { MuteWarningsButton } from "./MuteWarningsButton";
import { ProvisionerRekick } from "./ProvisionerRekick";

const ProvisionerDaemonsPage: React.FC = () => {
	const healthStatus = useOutletContext<HealthcheckReport>();
	const { provisioner_daemons: daemons } = healthStatus;

	return (
		<>
			<Header>
				<HeaderTitle>
					<HealthyDot severity={daemons.severity} />
					Provisioner Daemons
				</HeaderTitle>
				<MuteWarningsButton healthcheck="ProvisionerDaemons" />
			</Header>

			<Main>
				{daemons.error && (
					<Alert severity="error" prominent>
						{daemons.error}
					</Alert>
				)}
				{daemons.warnings.map((warning) => {
					return (
						<Alert key={warning.code} severity="warning" prominent dismissible>
							{warning.message}
						</Alert>
					);
				})}

				<ProvisionerRekick />

				{daemons.items.map(({ provisioner_daemon, warnings }) => (
					<Provisioner
						key={provisioner_daemon.id}
						provisioner={provisioner_daemon}
						warnings={warnings}
					/>
				))}
			</Main>
		</>
	);
};

export default ProvisionerDaemonsPage;
