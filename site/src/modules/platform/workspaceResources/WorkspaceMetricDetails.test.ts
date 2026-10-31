import {
	MockResourceHistorySamples,
	MockWorkspaceResourceHistory,
} from "#/testHelpers/workspaceResources";
import { metricHistorySamples } from "./WorkspaceMetricDetails";

it("preserves real zero readings and gaps while excluding invalid or out-of-window samples", () => {
	const base = MockResourceHistorySamples[0];
	const zero = { ...base, share: 0 };
	expect(
		metricHistorySamples(
			[
				zero,
				{ ...base, t: base.t - 1 },
				{ ...base, t: MockWorkspaceResourceHistory.asOf + 1 },
				{ ...base, share: Number.NaN },
				{ ...base, share: -1 },
				{ ...base, t: Number.POSITIVE_INFINITY },
			],
			MockWorkspaceResourceHistory,
		),
	).toEqual([zero]);
});
