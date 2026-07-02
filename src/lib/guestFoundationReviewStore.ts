import { foundation2kDeck, getFoundation2kDeck } from "@/data/foundation2kDeck";
import type { AppLocale } from "@/lib/appLocale";
import type { VocabCard } from "@/lib/deck-perso-adapters";
import { getGuestId } from "@/lib/guestSession";
import type { SearchCardsV2Row } from "@/lib/supabase/rpc";

export type GuestFoundationReviewStatus = "new" | "learning" | "review";
export type GuestFoundationReviewRating = "fail" | "pass";

interface GuestFoundationReviewItem {
	foundationCardId: string;
	frequencyRank: number;
	status: GuestFoundationReviewStatus;
	nextReviewAt: string;
	addedAt: string;
	lastReviewedAt: string | null;
	reviewCount: number;
}

interface GuestFoundationReviewState {
	version: 1;
	items: GuestFoundationReviewItem[];
}

export const GUEST_FOUNDATION_REVIEW_UPDATED_EVENT =
	"arur:guest-foundation-review-updated";
export const GUEST_FOUNDATION_DEFAULT_CARD_COUNT = 20;

const STORAGE_KEY_PREFIX = "deck_perso_guest_foundation_reviews_v1";
const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 2 * ONE_DAY_MS;
const THREE_DAYS_MS = 3 * ONE_DAY_MS;

const safeLocalStorage = (): Storage | null => {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		return window.localStorage;
	} catch {
		return null;
	}
};

const resolveStorageScope = (scope?: string | null): string => {
	const normalizedScope = scope?.trim();
	if (normalizedScope) {
		return normalizedScope;
	}

	return getGuestId() ?? "guest";
};

const resolveStorageKey = (scope?: string | null): string =>
	`${STORAGE_KEY_PREFIX}:${resolveStorageScope(scope)}`;

const emitGuestFoundationReviewUpdate = (scope?: string | null): void => {
	if (typeof window === "undefined") {
		return;
	}

	window.dispatchEvent(
		new CustomEvent(GUEST_FOUNDATION_REVIEW_UPDATED_EVENT, {
			detail: { scope: resolveStorageScope(scope) },
		}),
	);
};

const buildInitialState = (now = new Date()): GuestFoundationReviewState => {
	const nowIso = now.toISOString();

	return {
		version: 1,
		items: foundation2kDeck
			.slice(0, GUEST_FOUNDATION_DEFAULT_CARD_COUNT)
			.map((card) => ({
				foundationCardId: `guest-foundation-${card.frequencyRank}`,
				frequencyRank: card.frequencyRank,
				status: "new",
				nextReviewAt: nowIso,
				addedAt: nowIso,
				lastReviewedAt: null,
				reviewCount: 0,
			})),
	};
};

const normalizeStatus = (
	value: unknown,
): GuestFoundationReviewStatus | null => {
	if (value === "new" || value === "learning" || value === "review") {
		return value;
	}

	return null;
};

const normalizeState = (
	value: unknown,
	fallback: GuestFoundationReviewState,
): GuestFoundationReviewState => {
	if (!value || typeof value !== "object") {
		return fallback;
	}

	const candidateItems = Array.isArray((value as { items?: unknown }).items)
		? (value as { items: unknown[] }).items
		: [];

	if (candidateItems.length === 0) {
		return fallback;
	}

	const itemByRank = new Map<number, GuestFoundationReviewItem>();

	candidateItems.forEach((item) => {
		if (!item || typeof item !== "object") {
			return;
		}

		const nextItem = item as Partial<GuestFoundationReviewItem>;
		const frequencyRank = Number.parseInt(
			String(nextItem.frequencyRank ?? ""),
			10,
		);
		const status = normalizeStatus(nextItem.status);
		const nextReviewAt =
			typeof nextItem.nextReviewAt === "string" ? nextItem.nextReviewAt : null;

		if (
			!Number.isFinite(frequencyRank) ||
			frequencyRank < 1 ||
			frequencyRank > foundation2kDeck.length ||
			!status ||
			!nextReviewAt
		) {
			return;
		}

		itemByRank.set(frequencyRank, {
			foundationCardId:
				typeof nextItem.foundationCardId === "string" &&
				nextItem.foundationCardId
					? nextItem.foundationCardId
					: `guest-foundation-${frequencyRank}`,
			frequencyRank,
			status,
			nextReviewAt,
			addedAt:
				typeof nextItem.addedAt === "string" && nextItem.addedAt
					? nextItem.addedAt
					: (fallback.items[frequencyRank - 1]?.addedAt ??
						fallback.items[0].addedAt),
			lastReviewedAt:
				typeof nextItem.lastReviewedAt === "string"
					? nextItem.lastReviewedAt
					: null,
			reviewCount: Math.max(
				0,
				Number.isFinite(nextItem.reviewCount)
					? Number(nextItem.reviewCount)
					: 0,
			),
		});
	});

	if (itemByRank.size === 0) {
		return fallback;
	}

	return {
		version: 1,
		items: fallback.items.map(
			(fallbackItem) =>
				itemByRank.get(fallbackItem.frequencyRank) ?? fallbackItem,
		),
	};
};

const persistState = (
	state: GuestFoundationReviewState,
	scope?: string | null,
): void => {
	const storage = safeLocalStorage();
	if (!storage) {
		return;
	}

	try {
		storage.setItem(resolveStorageKey(scope), JSON.stringify(state));
	} catch {
		return;
	}
};

const loadState = (scope?: string | null): GuestFoundationReviewState => {
	const fallback = buildInitialState();
	const storage = safeLocalStorage();

	if (!storage) {
		return fallback;
	}

	try {
		const raw = storage.getItem(resolveStorageKey(scope));
		if (!raw) {
			persistState(fallback, scope);
			return fallback;
		}

		const normalized = normalizeState(JSON.parse(raw), fallback);
		persistState(normalized, scope);
		return normalized;
	} catch {
		persistState(fallback, scope);
		return fallback;
	}
};

const isDueAt = (nextReviewAt: string, now = Date.now()): boolean => {
	const dueAt = Date.parse(nextReviewAt);
	if (Number.isNaN(dueAt)) {
		return true;
	}

	return dueAt <= now;
};

const resolveScore = (item: GuestFoundationReviewItem): number => {
	if (item.status === "review") {
		return 0.78;
	}

	if (item.status === "learning") {
		return 0.42;
	}

	return 0;
};

const toVocabCard = (
	item: GuestFoundationReviewItem,
	locale: AppLocale = "fr",
): VocabCard => {
	const foundationDeck = getFoundation2kDeck(locale);
	const foundationCard =
		foundationDeck[item.frequencyRank - 1] ?? foundation2kDeck[item.frequencyRank - 1];
	const tags = foundationCard.category
		? foundationCard.category
				.split(",")
				.map((tag) => tag.trim())
				.filter(Boolean)
		: [];

	return {
		id: item.foundationCardId,
		focus: String(foundationCard.focus),
		tags,
		sentBase: foundationCard.exampleSentenceAr,
		sentFull: foundationCard.exampleSentenceAr,
		sentFrench: foundationCard.exampleSentenceFr,
		vocabBase: foundationCard.wordAr,
		vocabFull: foundationCard.wordAr,
		vocabDef: foundationCard.wordFr,
		source: "foundation",
		sourceType: "foundation",
		foundationCardId: item.foundationCardId,
		status: item.status,
		nextReviewAt: item.nextReviewAt,
	};
};

export const getGuestFoundationRows = (
	scope?: string | null,
	locale: AppLocale = "fr",
): SearchCardsV2Row[] =>
	loadState(scope).items.map((item) => {
		const foundationDeck = getFoundation2kDeck(locale);
		const foundationCard =
			foundationDeck[item.frequencyRank - 1] ?? foundation2kDeck[item.frequencyRank - 1];

		return {
			category: foundationCard.category,
			foundation_card_id: item.foundationCardId,
			is_added: true,
			is_seen: item.reviewCount > 0,
			score: resolveScore(item),
			source: "foundation",
			source_type: "foundation",
			transliteration: null,
			vocabulary_card_id: null,
			word_ar: foundationCard.wordAr,
			word_fr: foundationCard.wordFr,
			added_at: item.addedAt,
		};
	});

export const getGuestFoundationDueCount = (
	scope?: string | null,
	now = Date.now(),
): number =>
	loadState(scope).items.filter((item) => isDueAt(item.nextReviewAt, now))
		.length;

export const getGuestFoundationDueCards = (
	scope?: string | null,
	now = Date.now(),
	locale: AppLocale = "fr",
): VocabCard[] =>
	loadState(scope)
		.items.filter((item) => isDueAt(item.nextReviewAt, now))
		.sort((left, right) => {
			const dueDelta =
				Date.parse(left.nextReviewAt) - Date.parse(right.nextReviewAt);
			if (dueDelta !== 0) {
				return dueDelta;
			}

			return left.frequencyRank - right.frequencyRank;
		})
		.map((item) => toVocabCard(item, locale));

export const submitGuestFoundationReview = (
	cardId: string,
	rating: GuestFoundationReviewRating,
	scope?: string | null,
	now = new Date(),
):
	| { ok: true; nextReviewAt: string; status: GuestFoundationReviewStatus }
	| {
			ok: false;
			error: string;
	  } => {
	const currentState = loadState(scope);
	const item = currentState.items.find(
		(candidate) => candidate.foundationCardId === cardId,
	);

	if (!item) {
		return {
			ok: false,
			error: "Carte locale introuvable.",
		};
	}

	const nowMs = now.getTime();
	let nextStatus: GuestFoundationReviewStatus;
	let nextReviewAtMs: number;

	if (rating === "fail") {
		nextStatus = "learning";
		nextReviewAtMs = nowMs + TEN_MINUTES_MS;
	} else if (item.status === "new") {
		nextStatus = "learning";
		nextReviewAtMs = nowMs + ONE_DAY_MS;
	} else if (item.status === "learning") {
		nextStatus = "review";
		nextReviewAtMs = nowMs + TWO_DAYS_MS;
	} else {
		nextStatus = "review";
		nextReviewAtMs = nowMs + THREE_DAYS_MS;
	}

	const nextReviewAt = new Date(nextReviewAtMs).toISOString();
	const nextState: GuestFoundationReviewState = {
		version: 1,
		items: currentState.items.map((candidate) =>
			candidate.foundationCardId === cardId
				? {
						...candidate,
						status: nextStatus,
						nextReviewAt,
						lastReviewedAt: now.toISOString(),
						reviewCount: candidate.reviewCount + 1,
					}
				: candidate,
		),
	};

	persistState(nextState, scope);
	emitGuestFoundationReviewUpdate(scope);

	return {
		ok: true,
		nextReviewAt,
		status: nextStatus,
	};
};

export const resetGuestFoundationReviewState = (
	scope?: string | null,
): void => {
	const storage = safeLocalStorage();
	if (!storage) {
		return;
	}

	try {
		storage.removeItem(resolveStorageKey(scope));
	} catch {
		return;
	}

	emitGuestFoundationReviewUpdate(scope);
};
