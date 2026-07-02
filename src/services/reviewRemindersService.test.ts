import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, getSessionMock, refreshSessionMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	getSessionMock: vi.fn(),
	refreshSessionMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
	supabase: {
		functions: {
			invoke: invokeMock,
		},
		auth: {
			getSession: getSessionMock,
			refreshSession: refreshSessionMock,
		},
	},
}));

describe("reviewRemindersService", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		getSessionMock.mockReset();
		refreshSessionMock.mockReset();
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("sends explicit auth headers for reminder preference updates", async () => {
		getSessionMock.mockResolvedValue({
			data: { session: { access_token: "access-token-1" } },
			error: null,
		});
		invokeMock.mockResolvedValue({
			data: {
				preferences: {
					user_id: "user-1",
					enabled: true,
					email_enabled: true,
					calendar_enabled: false,
					web_push_enabled: false,
					created_at: "2026-04-12T00:00:00.000Z",
					updated_at: "2026-04-12T00:00:00.000Z",
				},
				calendar: {
					token: "token",
					feed_url_https: null,
					subscribe_url_webcal: null,
					handoff_url: null,
				},
				web_push: {
					enabled: false,
					vapid_configured: false,
					vapid_public_key: null,
					active_subscription_count: 0,
				},
				reminder_app_url: "https://example.com/reminders",
			},
			error: null,
		});

		const { updateReviewReminderPreferences } = await import(
			"@/services/reviewRemindersService"
		);
		const result = await updateReviewReminderPreferences(
			{ enabled: true, email_enabled: true },
			{ userId: "user-1" },
		);

		expect(result.ok).toBe(true);
		expect(invokeMock).toHaveBeenCalledWith(
			"review-reminders-config-v1",
			expect.objectContaining({
				method: "PATCH",
				body: { preferences: { enabled: true, email_enabled: true } },
				headers: expect.objectContaining({
					Authorization: "Bearer access-token-1",
				}),
			}),
		);
	});

	it("refreshes auth and retries once after an unauthorized function response", async () => {
		getSessionMock
			.mockResolvedValueOnce({
				data: { session: { access_token: "expired-token" } },
				error: null,
			})
			.mockResolvedValueOnce({
				data: { session: { access_token: "fresh-token" } },
				error: null,
			});
		refreshSessionMock.mockResolvedValue({ data: { session: null }, error: null });
		invokeMock
			.mockResolvedValueOnce({
				data: null,
				error: {
					message: "Edge Function returned a non-2xx status code",
					context: { status: 401 },
				},
			})
			.mockResolvedValueOnce({
				data: {
					preferences: {
						user_id: "user-1",
						enabled: true,
						email_enabled: true,
						calendar_enabled: false,
						web_push_enabled: false,
						created_at: "2026-04-12T00:00:00.000Z",
						updated_at: "2026-04-12T00:00:00.000Z",
					},
					calendar: {
						token: "token",
						feed_url_https: null,
						subscribe_url_webcal: null,
						handoff_url: null,
					},
					web_push: {
						enabled: false,
						vapid_configured: false,
						vapid_public_key: null,
						active_subscription_count: 0,
					},
					reminder_app_url: "https://example.com/reminders",
				},
				error: null,
			});

		const { updateReviewReminderPreferences } = await import(
			"@/services/reviewRemindersService"
		);
		const result = await updateReviewReminderPreferences(
			{ enabled: true },
			{ userId: "user-1" },
		);

		expect(result.ok).toBe(true);
		expect(refreshSessionMock).toHaveBeenCalledTimes(1);
		expect(invokeMock).toHaveBeenCalledTimes(2);
		expect(invokeMock).toHaveBeenLastCalledWith(
			"review-reminders-config-v1",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer fresh-token",
				}),
			}),
		);
	});

	it("fails early when no authenticated session is available", async () => {
		getSessionMock.mockResolvedValue({
			data: { session: null },
			error: null,
		});

		const { updateReviewReminderPreferences } = await import(
			"@/services/reviewRemindersService"
		);
		const result = await updateReviewReminderPreferences(
			{ enabled: false },
			{ userId: "user-1" },
		);

		expect(result).toEqual({
			ok: false,
			error: {
				code: "NOT_AUTHENTICATED",
				message: "You must be signed in to update reminder settings.",
			},
		});
		expect(invokeMock).not.toHaveBeenCalled();
	});
});
