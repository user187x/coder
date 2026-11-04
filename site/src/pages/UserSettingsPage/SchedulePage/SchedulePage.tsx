import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import {
	updateUserQuietHoursSchedule,
	userQuietHoursSchedule,
} from "#/api/queries/settings";
import type { UserQuietHoursScheduleResponse } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { PageLoader } from "#/components/Loader/Loader";
import {
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { UserSettingsHeader } from "../UserSettingsHeader";
import { ScheduleForm } from "./ScheduleForm";

const SchedulePage: React.FC = () => {
	const { user: me } = useAuthenticated();
	const queryClient = useQueryClient();

	const {
		data: quietHoursSchedule,
		error,
		isLoading,
		isError,
	} = useQuery(userQuietHoursSchedule(me.id));

	const {
		mutate: onSubmit,
		error: submitError,
		isPending: mutationLoading,
	} = useMutation(updateUserQuietHoursSchedule(me.id, queryClient));

	if (isLoading) {
		return <PageLoader />;
	}

	if (isError) {
		return <ErrorAlert error={error} />;
	}

	return (
		<>
			<UserSettingsHeader section="schedule">
				<SettingsHeaderTitle>Quiet hours</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Workspaces may be automatically updated during your quiet hours, as
					configured by your administrators.
				</SettingsHeaderDescription>
			</UserSettingsHeader>
			<ScheduleForm
				isLoading={mutationLoading}
				initialValues={quietHoursSchedule as UserQuietHoursScheduleResponse}
				submitError={submitError}
				onSubmit={(values) => {
					onSubmit(values, {
						onSuccess: () => {
							toast.success("Schedule updated successfully.");
						},
					});
				}}
			/>
		</>
	);
};

export default SchedulePage;
