import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
	supabase: {
		functions: {
			invoke: invokeMock,
		},
	},
}));

describe("recordDeckDownloadClick", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.unstubAllEnvs();
		invokeMock.mockReset();
	});

	it("passes the tracking payload to the Edge Function", async () => {
		invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
		const input = {
			clickId: "click-1234567890abcd",
			deckKey: "enki_deck",
			sourceName: "landing_main_cta",
			pagePath: "/",
			referrer: null,
			locale: "en",
			userId: null,
			visitorId: "visitor-1",
		};

		const { recordDeckDownloadClick } = await import(
			"@/services/deckDownloadTrackingService"
		);

		await recordDeckDownloadClick(input);

		expect(invokeMock).toHaveBeenCalledWith("deck-download-init", {
			body: input,
		});
	});

	it("throws when the Edge Function returns an error", async () => {
		invokeMock.mockResolvedValue({ data: null, error: new Error("Boom") });

		const { recordDeckDownloadClick } = await import(
			"@/services/deckDownloadTrackingService"
		);

		await expect(
			recordDeckDownloadClick({
				clickId: "click-abcdef1234567890",
				deckKey: "enki_deck",
				sourceName: "landing_main_cta",
				pagePath: "/",
				referrer: null,
				locale: "en",
				userId: null,
				visitorId: "visitor-2",
			}),
		).rejects.toThrow("Boom");
	});
});
