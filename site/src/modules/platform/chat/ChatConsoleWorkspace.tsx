import { cn } from "cn";
import { useEffect, useState } from "react";
import { useQuery } from "react-query";
import { useLocation } from "react-router";
import type { ChatPeer } from "#/api/platform";
import { chatSettings } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Loader } from "#/components/Loader/Loader";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/Tabs/Tabs";
import { OnlineUsersCard } from "#/pages/DeploymentSettingsPage/OnlineUsersPage/OnlineUsersPage";
import { ChatConsole } from "./ChatConsole";
import {
	ChatEnabledCard,
	DiscoveryCard,
	PairsCard,
	PeersCard,
	RetentionCard,
	ScreenSharingCard,
} from "./ChatConsolePanels";
import { ChatPeople } from "./ChatPeople";
import { selectInConsole } from "./chatStore";

/** One console for conversations, presence, connections and administration. */
export const ChatConsoleWorkspace = ({
	className,
	actions,
	...props
}: React.ComponentProps<typeof ChatConsole>) => {
	const { hash } = useLocation();
	const [tab, setTab] = useState(
		hash === "#online-users" ? "people" : "conversations",
	);
	const [visited, setVisited] = useState(() => new Set(["conversations", tab]));
	const select = (next: string) => {
		setTab(next);
		setVisited((previous) => new Set([...previous, next]));
	};
	useEffect(() => {
		if (hash === "#online-users") {
			setTab("people");
			setVisited((previous) => new Set([...previous, "people"]));
		}
	}, [hash]);
	const open = (peer: ChatPeer) => {
		selectInConsole(peer, true);
		select("conversations");
	};
	return (
		<Tabs
			value={tab}
			onValueChange={select}
			className={cn(
				"flex min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-lg border border-solid border-border bg-surface-primary",
				className,
			)}
		>
			<div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-border px-3">
				<TabsList
					aria-label="Chat console views"
					className="min-w-0 flex-1 flex-wrap gap-x-4 gap-y-0 border-0"
				>
					<TabsTrigger value="conversations">Conversations</TabsTrigger>
					<TabsTrigger value="people">People</TabsTrigger>
					<TabsTrigger value="connections">Connections</TabsTrigger>
					<TabsTrigger value="settings">Settings</TabsTrigger>
				</TabsList>
				{actions}
			</div>
			<TabsContent
				value="conversations"
				forceMount
				hidden={tab !== "conversations"}
				className="min-h-0 flex-1 data-[state=inactive]:hidden"
			>
				<ChatConsole {...props} className="h-full rounded-none border-0" />
			</TabsContent>
			{visited.has("people") && (
				<TabsContent
					value="people"
					forceMount
					hidden={tab !== "people"}
					className="min-h-0 flex-1 overflow-auto p-4 data-[state=inactive]:hidden"
				>
					<div className="flex flex-col gap-4">
						<OnlineUsersCard onOpen={open} />
						<section
							aria-label="Who is around"
							className="rounded-lg border border-solid border-border p-4 bg-surface-primary"
						>
							<h3 className="m-0 mb-3 text-sm font-semibold">Who is around</h3>
							<ChatPeople onOpen={open} />
						</section>
					</div>
				</TabsContent>
			)}
			{visited.has("connections") && (
				<TabsContent
					value="connections"
					forceMount
					hidden={tab !== "connections"}
					className="min-h-0 flex-1 overflow-auto p-4 data-[state=inactive]:hidden"
				>
					<PairsCard onOpen={open} />
				</TabsContent>
			)}
			{visited.has("settings") && (
				<TabsContent
					value="settings"
					forceMount
					hidden={tab !== "settings"}
					className="min-h-0 flex-1 overflow-auto p-4 data-[state=inactive]:hidden"
				>
					<ConsoleSettings />
				</TabsContent>
			)}
		</Tabs>
	);
};

const ConsoleSettings = () => {
	const query = useQuery(chatSettings());
	if (!query.data)
		return query.isLoading ? <Loader /> : <ErrorAlert error={query.error} />;
	return (
		<div className="flex flex-col gap-4">
			{query.isError && <ErrorAlert error={query.error} />}
			<ChatEnabledCard enabled={query.data.enabled !== false} />
			<PeersCard settings={query.data} />
			<DiscoveryCard settings={query.data} />
			<ScreenSharingCard settings={query.data} />
			<RetentionCard settings={query.data} />
		</div>
	);
};
