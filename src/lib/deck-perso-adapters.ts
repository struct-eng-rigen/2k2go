/**
 * Deck-Perso Adapters
 *
 * Adapter functions and types for the deck-perso migration.
 * Transforms Supabase records to VocabCard format for review components.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
	foundation2kDeck,
	getFoundation2kDeck,
	type Foundation2kCard,
} from "@/data/foundation2kDeck";
import { buildCollectedCardSourceLinkPath } from "@/data/immersionVideoRouting";
import type { Database } from "@/integrations/supabase/types";
import {
	resolvePreferredFoundationMedia,
} from "@/lib/foundationDeckMedia";
import type { AppLocale } from "@/lib/appLocale";
import { resolveMediaUrl } from "@/lib/mediaUrl";
import type { GetDueCardsV2Row } from "@/lib/supabase/rpc";
import { repairMojibake } from "@/lib/textEncoding";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Record structure returned by Supabase RPC for due cards.
 */
export type DueCardRecord = GetDueCardsV2Row;

/**
 * Review type for deck-perso modes.
 * - "foundation": Cards from the foundation vocabulary
 * - "collected": Cards collected by the user (mined vocabulary)
 * - "sent": Cards from sentences shared with the user
 * Note: Alphabet deck has its own dedicated mini-deck UX, not FSRS reviews.
 */
export type ReviewType = "foundation" | "collected" | "sent";

/**
 * Scope values for Supabase RPC calls.
 */
export type ReviewScope = string;

/**
 * VocabCard interface for review components.
 * Extended with Supabase tracking fields.
 */
export interface VocabCard {
	id: number | string;
	schedulerCardId?: string;
	focus?: string;
	tags: string[];
	sentBase: string;
	sentFull: string;
	sentFrench: string;
	vocabBase: string;
	vocabFull: string;
	vocabDef: string;
	image?: string;
	vocabAudioUrl?: string;
	sentenceAudioUrl?: string;
	defaultImageUrl?: string | null;
	defaultVocabAudioUrl?: string | null;
	defaultSentenceAudioUrl?: string | null;
	hasCustomImage?: boolean;
	hasCustomVocabAudio?: boolean;
	hasCustomSentenceAudio?: boolean;
	imageHidden?: boolean;
	vocabAudioHidden?: boolean;
	sentenceAudioHidden?: boolean;
	// Additional fields for Supabase tracking
	source?: "foundation" | "vocabulary";
	sourceType?: "foundation" | "collected" | "sent" | "alphabet";
	remoteId?: string;
	vocabularyCardId?: string;
	foundationCardId?: string;
	sourceVideoId?: string | null;
	sourceVideoIsShort?: boolean | null;
	sourceCueId?: string | null;
	sourceWordIndex?: number | null;
	sourceWordStartSeconds?: number | null;
	sourceWordEndSeconds?: number | null;
	sourceLinkUrl?: string | null;
	nextReviewAt?: string | null;
	status?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Maps ReviewType to Supabase RPC scope parameter values.
 * Note: Alphabet deck has its own dedicated mini-deck UX, not FSRS reviews.
 */
export const SCOPE_MAP: Record<ReviewType, ReviewScope> = {
	foundation: "foundation",
	collected: "personal",
	sent: "personal_sent",
};

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Strips Arabic diacritics (harakat) from input string.
 */
export function stripHarakat(input: string | null | undefined): string {
	return (input ?? "")
		.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
		.replace(/ـ/g, "");
}

const normalizeFocusWord = (value: string | null | undefined): string =>
	stripHarakat((value ?? "").replace(/<[^>]*>/g, ""))
		.replace(/\s+/g, " ")
		.trim();

const FOUNDATION_FOCUS_BY_WORD = new Map<string, number>();
foundation2kDeck.forEach((card) => {
	const key = normalizeFocusWord(card.wordAr);
	if (!key || FOUNDATION_FOCUS_BY_WORD.has(key)) {
		return;
	}
	const focusRank = Number.isFinite(card.focus)
		? card.focus
		: card.frequencyRank;
	FOUNDATION_FOCUS_BY_WORD.set(key, focusRank);
});

const FOUNDATION_CARD_BY_LOCALE_AND_RANK: Record<
	AppLocale,
	Map<number, Foundation2kCard>
> = {
	fr: new Map(getFoundation2kDeck("fr").map((card) => [card.frequencyRank, card])),
	en: new Map(getFoundation2kDeck("en").map((card) => [card.frequencyRank, card])),
};

const FOUNDATION_CARD_BY_LOCALE_AND_WORD: Record<
	AppLocale,
	Map<string, Foundation2kCard>
> = {
	fr: new Map(
		getFoundation2kDeck("fr").map((card) => [normalizeFocusWord(card.wordAr), card]),
	),
	en: new Map(
		getFoundation2kDeck("en").map((card) => [normalizeFocusWord(card.wordAr), card]),
	),
};

const readOptionalNumber = (value: unknown): number | null => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	return null;
};

const resolveLocalizedFoundationCard = (
	record: DueCardRecord,
	baseWord: string,
	locale: AppLocale,
): Foundation2kCard | null => {
	const frequencyRank = readOptionalNumber(
		(record as { frequency_rank?: unknown }).frequency_rank,
	);
	if (frequencyRank != null) {
		const cardByRank = FOUNDATION_CARD_BY_LOCALE_AND_RANK[locale].get(
			Math.floor(frequencyRank),
		);
		if (cardByRank) {
			return cardByRank;
		}
	}

	const wordKey = normalizeFocusWord(baseWord);
	return wordKey
		? (FOUNDATION_CARD_BY_LOCALE_AND_WORD[locale].get(wordKey) ?? null)
		: null;
};

const coerceFocusValue = (value: unknown): string | undefined => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	return undefined;
};

const resolveFocusValue = (
	record: GetDueCardsV2Row,
	baseWord: string | null | undefined,
	isFoundation: boolean,
): string | undefined => {
	const focusCandidate = coerceFocusValue(
		(record as { focus?: unknown }).focus ??
			(record as { frequency_rank?: unknown }).frequency_rank ??
			(record as { frequencyRank?: unknown }).frequencyRank,
	);
	if (focusCandidate) {
		return focusCandidate;
	}

	if (!isFoundation) {
		return undefined;
	}

	const key = normalizeFocusWord(baseWord);
	const focusFromDeck = key ? FOUNDATION_FOCUS_BY_WORD.get(key) : undefined;
	return focusFromDeck != null ? String(focusFromDeck) : undefined;
};
/**
 * Transforms a Supabase DueCardRecord to VocabCard format.
 */
export function supabaseCardToVocabCard(
	record: DueCardRecord,
	index: number,
	locale: AppLocale = "fr",
): VocabCard {
	const readOptionalString = (value: unknown): string | undefined => {
		if (typeof value !== "string") {
			return undefined;
		}

		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	};

	const readOptionalBoolean = (value: unknown): boolean | undefined => {
		if (typeof value !== "boolean") {
			return undefined;
		}

		return value;
	};

	const vocabularyCardId = readOptionalString(record.vocabulary_card_id);
	const foundationCardId = readOptionalString(record.foundation_card_id);
	const schedulerCardId = readOptionalString(
		(record as { card_id?: unknown }).card_id,
	);
	const id = vocabularyCardId ?? foundationCardId ?? schedulerCardId ?? `due-${index}`;
	const sourceRaw = readOptionalString(record.source)?.toLowerCase();
	const normalizedSource: "foundation" | "vocabulary" | undefined =
		sourceRaw === "foundation"
			? "foundation"
			: sourceRaw === "vocabulary"
				? "vocabulary"
				: undefined;
	const sourceTypeRaw = (record as { source_type?: unknown }).source_type;
	const normalizedSourceTypeRaw =
		typeof sourceTypeRaw === "string" ? sourceTypeRaw.trim().toLowerCase() : "";
	const hasFoundationCardId = (foundationCardId ?? "").length > 0;
	const isFoundationMediaCard =
		normalizedSource === "foundation" ||
		hasFoundationCardId ||
		normalizedSourceTypeRaw === "foundation";
	const effectiveSource: "foundation" | "vocabulary" | undefined =
		normalizedSource === "foundation" || hasFoundationCardId
			? "foundation"
			: normalizedSource;
	const baseArabic = repairMojibake(
		record.word_ar ?? (record as { term?: unknown }).term ?? record.example_sentence_ar ?? "",
	);
	const rawSentence = repairMojibake(
		record.example_sentence_ar ??
			((record as { example_term?: unknown }).example_term as string | null | undefined) ??
			baseArabic,
	);
	const sentenceWithFocus =
		!rawSentence || rawSentence.includes("<b>") || !baseArabic
			? rawSentence
			: rawSentence.replace(baseArabic, `<b>${baseArabic}</b>`);
	const sentenceAr = sentenceWithFocus || baseArabic;
	const sentenceFr = repairMojibake(
		record.example_sentence_fr ??
			((record as { example_translation?: unknown }).example_translation as
				| string
				| null
				| undefined) ??
			record.word_fr ??
			((record as { translation?: unknown }).translation as string | null | undefined) ??
			"",
	);
	const categoryLabel = repairMojibake(record.category ?? "").trim();
	const normalizedCategory = categoryLabel.toLowerCase();
	const sourceType: "foundation" | "collected" | "sent" | "alphabet" =
		isFoundationMediaCard
			? "foundation"
			: normalizedSourceTypeRaw === "sent"
				? "sent"
				: normalizedSourceTypeRaw === "alphabet" ||
						normalizedCategory === "alphabet_arabe"
					? "alphabet"
					: "collected";
	const foundationFrequencyRank = readOptionalNumber(
		(record as { frequency_rank?: unknown }).frequency_rank,
	);
	const localizedFoundationCard = isFoundationMediaCard
		? resolveLocalizedFoundationCard(record, baseArabic, locale)
		: null;
	const foundationMedia = isFoundationMediaCard
		? resolvePreferredFoundationMedia({
				frequencyRank: foundationFrequencyRank,
				vocabFull: baseArabic,
				vocabBase: stripHarakat(baseArabic),
				sentence: sentenceAr,
		  })
		: {};
	const vocabAudioUrl =
		resolveMediaUrl(foundationMedia.vocabAudioUrl) ??
		resolveMediaUrl(readOptionalString(record.audio_url));
	const sentenceAudioUrl =
		resolveMediaUrl(foundationMedia.sentenceAudioUrl) ??
		resolveMediaUrl(
			(record as { sentence_audio_url?: unknown }).sentence_audio_url,
		);
	const imageUrl =
		resolveMediaUrl(foundationMedia.imageUrl) ??
		resolveMediaUrl((record as { image_url?: unknown }).image_url);
	const defaultImageUrl = resolveMediaUrl(
		(record as { default_image_url?: unknown }).default_image_url,
	);
	const defaultVocabAudioUrl = resolveMediaUrl(
		(record as { default_audio_url?: unknown }).default_audio_url,
	);
	const defaultSentenceAudioUrl = resolveMediaUrl(
		(record as { default_sentence_audio_url?: unknown })
			.default_sentence_audio_url,
	);
	const hasCustomImage = readOptionalBoolean(
		(record as { has_custom_image?: unknown }).has_custom_image,
	);
	const hasCustomVocabAudio = readOptionalBoolean(
		(record as { has_custom_vocab_audio?: unknown }).has_custom_vocab_audio,
	);
	const hasCustomSentenceAudio = readOptionalBoolean(
		(record as { has_custom_sentence_audio?: unknown })
			.has_custom_sentence_audio,
	);
	const imageHidden = readOptionalBoolean(
		(record as { image_hidden?: unknown }).image_hidden,
	);
	const vocabAudioHidden = readOptionalBoolean(
		(record as { vocab_audio_hidden?: unknown }).vocab_audio_hidden,
	);
	const sentenceAudioHidden = readOptionalBoolean(
		(record as { sentence_audio_hidden?: unknown }).sentence_audio_hidden,
	);
	const focusTag = isFoundationMediaCard ? "Vocab. Fondation" : "Vocab. Minage";
	const focusValue = resolveFocusValue(
		record,
		record.word_ar ?? baseArabic,
		isFoundationMediaCard,
	);
	const tags = [categoryLabel || undefined, focusTag].filter(
		Boolean,
	) as string[];
	const sourceVideoId = readOptionalString(
		(record as { source_video_id?: unknown }).source_video_id,
	);
	const sourceVideoIsShortRaw = (record as { source_video_is_short?: unknown })
		.source_video_is_short;
	const sourceVideoIsShort =
		typeof sourceVideoIsShortRaw === "boolean" ? sourceVideoIsShortRaw : null;
	const sourceCueIdValue = (record as { source_cue_id?: unknown })
		.source_cue_id;
	const sourceCueId =
		typeof sourceCueIdValue === "number" && Number.isFinite(sourceCueIdValue)
			? String(sourceCueIdValue)
			: readOptionalString(sourceCueIdValue);
	const sourceWordIndex = readOptionalNumber(
		(record as { source_word_index?: unknown }).source_word_index,
	);
	const sourceWordStartSeconds = readOptionalNumber(
		(record as { source_word_start_seconds?: unknown })
			.source_word_start_seconds,
	);
	const sourceWordEndSeconds = readOptionalNumber(
		(record as { source_word_end_seconds?: unknown }).source_word_end_seconds,
	);
	const sourceLinkUrl =
		readOptionalString(
			(record as { source_link_url?: unknown }).source_link_url,
		) ??
		buildCollectedCardSourceLinkPath({
			sourceVideoId,
			sourceVideoIsShort,
			sourceWordStartSeconds,
		});
	const fsrsStateRaw = (record as { fsrs_state?: unknown }).fsrs_state;
	// FSRS state enum: 0=New, 1=Learning, 2=Review, 3=Relearning
	const statusFromFsrsState =
		typeof fsrsStateRaw === "number" && Number.isFinite(fsrsStateRaw)
			? fsrsStateRaw === 0
				? "new"
				: fsrsStateRaw === 1
					? "learning"
					: fsrsStateRaw === 2
						? "review"
						: fsrsStateRaw === 3
							? "relearning"
							: undefined
			: undefined;
	const rawStatus =
		readOptionalString((record as { status?: unknown }).status) ??
		readOptionalString((record as { state?: unknown }).state);
	const status =
		typeof rawStatus === "string" && rawStatus.length > 0
			? rawStatus.toLowerCase()
			: statusFromFsrsState;

	return {
		id,
		schedulerCardId,
		focus: focusValue,
		tags: tags.length > 0 ? tags : ["Vocab"],
		sentBase: stripHarakat(sentenceAr),
		sentFull: sentenceAr,
		sentFrench: localizedFoundationCard?.exampleSentenceFr ?? sentenceFr,
		vocabBase: stripHarakat(baseArabic),
		vocabFull: baseArabic,
		vocabDef:
			localizedFoundationCard?.wordFr ??
			repairMojibake(
				record.word_fr ??
					((record as { translation?: unknown }).translation as
						| string
						| null
						| undefined) ??
					sentenceFr,
			),
		image: imageUrl,
		vocabAudioUrl,
		sentenceAudioUrl,
		defaultImageUrl: defaultImageUrl ?? null,
		defaultVocabAudioUrl: defaultVocabAudioUrl ?? null,
		defaultSentenceAudioUrl: defaultSentenceAudioUrl ?? null,
		hasCustomImage,
		hasCustomVocabAudio,
		hasCustomSentenceAudio,
		imageHidden,
		vocabAudioHidden,
		sentenceAudioHidden,
		source: effectiveSource,
		sourceType,
		remoteId: id,
		vocabularyCardId,
		foundationCardId,
		sourceVideoId,
		sourceVideoIsShort,
		sourceCueId,
		sourceWordIndex,
		sourceWordStartSeconds,
		sourceWordEndSeconds,
		sourceLinkUrl,
		nextReviewAt:
			record.next_review_at ??
			((record as { due_at?: unknown }).due_at as string | null | undefined),
		status,
	};
}

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

type RuntimeSupabaseConfig = {
	SUPABASE_URL?: string;
	SUPABASE_PUBLISHABLE_KEY?: string;
	DECK_PERSO_REAL_MODE_ENABLED?: boolean;
	PROGRESSION_REAL_MODE_ENABLED?: boolean;
	DECK_PERSO_FORCE_MODE?: "preview" | "real" | null;
	PROGRESSION_FORCE_MODE?: "preview" | "real" | null;
	DECK_PERSO_ROLLBACK_TO_PREVIEW?: boolean;
	PROGRESSION_ROLLBACK_TO_PREVIEW?: boolean;
};

type WindowWithSupabaseConfig = Window & {
	__SUPABASE_CONFIG__?: RuntimeSupabaseConfig;
};

const normalizeOptionalString = (value: unknown): string | undefined => {
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmedValue = value.trim();
	return trimmedValue.length > 0 ? trimmedValue : undefined;
};

const decodeBase64UrlSegment = (segment: string): string | null => {
	if (typeof globalThis.atob !== "function") {
		return null;
	}

	const normalizedSegment = segment.replace(/-/g, "+").replace(/_/g, "/");
	const paddingLength = (4 - (normalizedSegment.length % 4)) % 4;
	const padding = "=".repeat(paddingLength);

	try {
		return globalThis.atob(`${normalizedSegment}${padding}`);
	} catch {
		return null;
	}
};

const isServiceRoleJwt = (value: string): boolean => {
	const segments = value.split(".");
	if (segments.length !== 3) {
		return false;
	}

	const payload = decodeBase64UrlSegment(segments[1]);
	if (!payload) {
		return false;
	}

	try {
		const parsedPayload = JSON.parse(payload) as { role?: unknown };
		return parsedPayload.role === "service_role";
	} catch {
		return false;
	}
};

const isUnsafeBrowserSupabaseKey = (value: string): boolean =>
	value.startsWith("sb_secret_") || isServiceRoleJwt(value);

let cachedSupabaseLoose: SupabaseClient<Database> | null = null;

/**
 * Returns a cached Supabase client.
 * Supports runtime config from window.__SUPABASE_CONFIG__.
 */
export function getSupabaseLoose(): SupabaseClient<Database> | null {
	if (cachedSupabaseLoose) return cachedSupabaseLoose;
	if (typeof window === "undefined") return null;

	const runtimeConfig = (window as WindowWithSupabaseConfig)
		.__SUPABASE_CONFIG__;

	const SUPABASE_URL =
		normalizeOptionalString(runtimeConfig?.SUPABASE_URL) ??
		normalizeOptionalString(import.meta.env.VITE_SUPABASE_URL) ??
		normalizeOptionalString(import.meta.env.SUPABASE_URL);
	const rawSupabasePublishableKey =
		normalizeOptionalString(runtimeConfig?.SUPABASE_PUBLISHABLE_KEY) ??
		normalizeOptionalString(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ??
		normalizeOptionalString(import.meta.env.SUPABASE_KEY);

	const normalizedSupabasePublishableKey =
		normalizeOptionalString(rawSupabasePublishableKey);
	const SUPABASE_PUBLISHABLE_KEY =
		normalizedSupabasePublishableKey &&
		!isUnsafeBrowserSupabaseKey(normalizedSupabasePublishableKey)
			? normalizedSupabasePublishableKey
			: undefined;

	if (normalizedSupabasePublishableKey && !SUPABASE_PUBLISHABLE_KEY) {
		console.error(
			"Refusing to use a Supabase service-role key in browser config. Set a publishable key instead.",
		);
	}

	if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
		return null;
	}

	cachedSupabaseLoose = createClient<Database>(
		SUPABASE_URL,
		SUPABASE_PUBLISHABLE_KEY,
		{
			auth: {
				storage: typeof localStorage !== "undefined" ? localStorage : undefined,
				persistSession: typeof localStorage !== "undefined",
				autoRefreshToken: true,
			},
		},
	);

	return cachedSupabaseLoose;
}
