import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { platformRequest } from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { CoderReplicas } from "./CoderReplicas";

it("applies a chosen replica count with the displayed resource version", async () => {
	const get = vi.spyOn(platformRequest, "get").mockResolvedValue({
		desired: 2,
		ready: 2,
		automated: false,
		resourceVersion: "4",
	});
	const post = vi.spyOn(platformRequest, "post").mockResolvedValue({
		desired: 3,
		ready: 2,
		automated: false,
		resourceVersion: "5",
	});
	renderComponent(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<CoderReplicas />
		</QueryClientProvider>,
	);
	await userEvent.selectOptions(
		await screen.findByRole("combobox", { name: "Replicas" }),
		"3",
	);
	await userEvent.click(screen.getByRole("button", { name: "Apply replicas" }));
	await waitFor(() =>
		expect(post).toHaveBeenCalledWith(expect.stringContaining("/coder-scale"), {
			replicas: 3,
			resourceVersion: "4",
		}),
	);
	get.mockRestore();
	post.mockRestore();
});

it("offers only as many replicas as nodes can run, and lowers a stranded request", async () => {
	const get = vi.spyOn(platformRequest, "get").mockResolvedValue({
		desired: 4,
		ready: 2,
		automated: false,
		resourceVersion: "7",
		maxReplicas: 2,
		nodes: [
			{ name: "agent-0", coder: true, fits: true, reason: null },
			{ name: "agent-1", coder: true, fits: true, reason: null },
		],
	});
	const post = vi.spyOn(platformRequest, "post").mockResolvedValue({
		desired: 2,
		ready: 2,
		automated: false,
		resourceVersion: "8",
	});
	renderComponent(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<CoderReplicas />
		</QueryClientProvider>,
	);
	const select = await screen.findByRole("combobox", { name: "Replicas" });
	const offered = Array.from(
		(select as HTMLSelectElement).options,
		(option) => [option.value, option.disabled] as const,
	);
	expect(offered).toEqual([
		["2", false],
		["4", true],
	]);
	await userEvent.selectOptions(select, "2");
	await userEvent.click(screen.getByRole("button", { name: "Apply replicas" }));
	await waitFor(() =>
		expect(post).toHaveBeenCalledWith(expect.stringContaining("/coder-scale"), {
			replicas: 2,
			resourceVersion: "7",
		}),
	);
	get.mockRestore();
	post.mockRestore();
});
