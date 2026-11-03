import { act } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { ClusterNetworkAPI } from "#/api/clusterNetwork";
import { PlatformAPI } from "#/api/platform";
import {
	MockHealthyClusterNetworkReport,
	MockHealthyMeshReport,
} from "#/testHelpers/clusterNetwork";
import { renderWithRouter } from "#/testHelpers/renderHelpers";
import { NetworkStatusIndicator } from "./NetworkStatusIndicator";

describe("NetworkStatusIndicator refresh", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it.each(["/deployment/users", "/deployment/network"])(
		"shares live queries without overriding the map's Pause control on %s",
		async (path) => {
			vi.useFakeTimers();
			const report = vi
				.spyOn(PlatformAPI, "getNetworkReport")
				.mockResolvedValue(MockHealthyClusterNetworkReport);
			const mesh = vi
				.spyOn(ClusterNetworkAPI, "mesh")
				.mockResolvedValue(MockHealthyMeshReport);
			const { unmount, queryClient } = renderWithRouter(
				createMemoryRouter(
					[{ path: "*", element: <NetworkStatusIndicator /> }],
					{ initialEntries: [path] },
				),
			);
			await act(async () => {
				await vi.advanceTimersByTimeAsync(10_001);
			});
			expect(report).toHaveBeenCalledTimes(
				path === "/deployment/network" ? 1 : 3,
			);
			expect(mesh).toHaveBeenCalledTimes(
				path === "/deployment/network" ? 1 : 2,
			);
			unmount();
			queryClient.clear();
		},
	);
});
