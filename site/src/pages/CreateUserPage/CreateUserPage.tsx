import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { CertificateRequest } from "#/api/clientCertificates";
import { getErrorDetail, getErrorMessage } from "#/api/errors";
import {
	clientCertificateCapabilities,
	issueCertificateForUser,
} from "#/api/queries/clientCertificates";
import { roles } from "#/api/queries/roles";
import { authMethods, createUser } from "#/api/queries/users";
import type { User } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Loader } from "#/components/Loader/Loader";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { useFeatureVisibility } from "#/modules/dashboard/useFeatureVisibility";
import {
	ClientCertificateDownload,
	saveClientCertificate,
} from "#/modules/platform/clientCertificates/ClientCertificateDownload";
import { pageTitle } from "#/utils/page";
import { CreateUserForm } from "./CreateUserForm";

const CreateUserPage: React.FC = () => {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const createUserMutation = useMutation(createUser(queryClient));
	const authMethodsQuery = useQuery(authMethods());
	const capability = useQuery(clientCertificateCapabilities());
	const issue = useMutation(issueCertificateForUser(queryClient));
	const [createdUser, setCreatedUser] = useState<User | null>(null);
	const [certificateRequest, setCertificateRequest] =
		useState<CertificateRequest | null>(null);
	const issueFor = (user: User, request: CertificateRequest) =>
		issue.mutate(
			{ organization: user.organization_ids[0], user: user.id, request },
			{
				onSuccess: (credential) => {
					setCertificateRequest(null);
					saveClientCertificate(credential);
				},
			},
		);
	const rolesQuery = useQuery(roles());
	const { showOrganizations } = useDashboard();
	const { service_accounts: serviceAccountsEnabled } = useFeatureVisibility();

	if (createdUser)
		return (
			<div className="mx-auto max-w-xl space-y-4 py-8">
				<h1 className="text-xl font-semibold">
					Account created: {createdUser.username}
				</h1>
				{issue.error && <ErrorAlert error={issue.error} />}
				{issue.isPending && <p>Issuing the device certificate…</p>}
				{issue.data && <ClientCertificateDownload credential={issue.data} />}
				{issue.isError && certificateRequest && (
					<Button onClick={() => issueFor(createdUser, certificateRequest)}>
						Retry certificate issuance
					</Button>
				)}
				<Button
					variant="outline"
					disabled={issue.isPending}
					onClick={() => navigate("..", { relative: "path" })}
				>
					Back to accounts
				</Button>
			</div>
		);
	return (
		<>
			<title>{pageTitle("New user")}</title>

			{!authMethodsQuery.data ? (
				authMethodsQuery.error ? (
					<ErrorAlert error={authMethodsQuery.error} />
				) : (
					<Loader />
				)
			) : (
				<CreateUserForm
					certificatesEnabled={capability.data?.enabled}
					error={createUserMutation.error}
					isLoading={createUserMutation.isPending}
					onSubmit={async (user) => {
						const mutation = createUserMutation.mutateAsync(
							{
								username: user.username,
								name: user.name,
								email: user.email,
								organization_ids: [user.organization],
								login_type: user.login_type,
								password: user.password,
								user_status: null,
								service_account: user.service_account,
								roles: [...user.roles],
							},
							{
								onSuccess: (created) => {
									if (user.issue_certificate) {
										const request = {
											label: "Initial device",
											password: user.certificate_password,
											days: 90,
										};
										setCreatedUser(created);
										setCertificateRequest(request);
										issueFor(created, request);
										return;
									}
									navigate("..", { relative: "path" });
								},
							},
						);
						const requestedAccount = user.service_account
							? "service account"
							: "user";
						toast.promise(mutation, {
							loading: `Creating ${requestedAccount} "${user.username}"...`,
							success: (created) =>
								`${created.is_service_account ? "Service account" : "User"} "${created.username}" created successfully.`,
							error: (e) => ({
								message: getErrorMessage(
									e,
									`Failed to create ${requestedAccount} "${user.username}".`,
								),
								description: getErrorDetail(e),
							}),
						});
					}}
					onCancel={() => {
						navigate("..", { relative: "path" });
					}}
					authMethods={authMethodsQuery.data}
					showOrganizations={showOrganizations}
					serviceAccountsEnabled={serviceAccountsEnabled}
					availableRoles={rolesQuery.data}
					rolesLoading={rolesQuery.isLoading}
					rolesError={rolesQuery.error}
				/>
			)}
		</>
	);
};

export default CreateUserPage;
