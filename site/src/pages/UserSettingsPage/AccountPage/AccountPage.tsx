import { useQuery } from "react-query";
import { useSearchParams } from "react-router";
import { groupsForUser } from "#/api/queries/groups";
import { authMethods } from "#/api/queries/users";
import {
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { useAuthContext } from "#/contexts/auth/AuthProvider";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { AccountAvatar } from "#/modules/platform/avatar/AccountAvatar";
import { UserSettingsHeader } from "../UserSettingsHeader";
import { AccountForm } from "./AccountForm";
import { AccountUserGroups } from "./AccountUserGroups";

const AccountPage: React.FC = () => {
	const { permissions, user: me } = useAuthenticated();
	const { updateProfile, updateProfileError, isUpdatingProfile } =
		useAuthContext();
	const { entitlements } = useDashboard();
	const [search] = useSearchParams();
	const authMethodsQuery = useQuery(authMethods());

	const hasGroupsFeature = entitlements.features.user_role_management.enabled;
	const groupsQuery = useQuery({
		...groupsForUser(me.id),
		enabled: hasGroupsFeature,
	});

	return (
		<div className="flex flex-col gap-12">
			<div>
				<UserSettingsHeader section="account">
					<SettingsHeaderTitle>Account</SettingsHeaderTitle>
					<SettingsHeaderDescription>
						Update your account info.
					</SettingsHeaderDescription>
				</UserSettingsHeader>
				<AccountAvatar user={me} />
				<AccountForm
					focusUsername={search.get("edit") === "username"}
					editable={permissions?.updateUsers ?? false}
					emailEditable={me.login_type === "password"}
					providerAccountURL={
						me.login_type === "oidc"
							? authMethodsQuery.data?.oidc.accountUrl
							: undefined
					}
					email={me.email}
					updateProfileError={updateProfileError}
					isLoading={isUpdatingProfile}
					initialValues={{
						username: me.username,
						name: me.name ?? "",
						avatar_url: me.avatar_url ?? "",
					}}
					onSubmit={updateProfile}
				/>
			</div>

			{hasGroupsFeature && (
				<AccountUserGroups
					groups={groupsQuery.data}
					loading={groupsQuery.isLoading}
					error={groupsQuery.error}
				/>
			)}
		</div>
	);
};

export default AccountPage;
