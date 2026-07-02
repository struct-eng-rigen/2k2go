import type { PostgrestError } from "@supabase/supabase-js";
import { getFoundation2kDeck } from "@/data/foundation2kDeck";
import {
	resolvePreferredFoundationMedia,
} from "@/lib/foundationDeckMedia";
import type { AppLocale } from "@/lib/appLocale";
import { resolveMediaUrl } from "@/lib/mediaUrl";
import {
	stripHarakat,
	type ReviewType,
	type VocabCard,
} from "@/lib/deck-perso-adapters";
import type { GetDueCardsV2Row } from "@/lib/supabase/rpc";
import {
	deckPersoDueReviewInternals,
	type BinaryReviewRating,
	type ServiceResult,
	type SubmitReviewSchedulerPayload,
} from "@/services/deckPersoService";

export type ReviewMutationOptions = {
	mode: "preview" | "real";
};

const {
	DUE_SUNSET_GUARD_BLOCKED_ERROR_MESSAGE,
	CLIENT_UNAVAILABLE_ERROR,
	SHADOW_DIFF_REASON_CODES,
	resolveClient,
	resolveCardKey,
	resolveAccountKey,
	createServiceError,
	fromPostgrestError,
	fromUnknownError,
	toJsonCompatible,
	isBrowserOffline,
	getOrCreateClientReviewId,
	enqueueReviewSubmission,
	fetchResolvedUserVocabularyCardMediaById,
	fetchCollectedSourceOccurrencesByVocabularyCardId,
	resolveDueVocabularyCardId,
	isAlphabetDueRecord,
	applyCollectedSourceOccurrenceToDueRecord,
	applyUserVocabularyCardMediaToDueVocabularyRow,
	orderFoundationCardsByFocus,
	mapCardToReviewType,
	resolveSchedulerShadowDiffContext,
	isDeckPersoSchedulerRollbackToLegacyEnabled,
	isDeckPersoSchedulerLegacyFallbackSunsetGuardEnabled,
	shouldFallbackToLegacyDueFetch,
	shouldAllowLegacyFallbackOnTransportFailure,
	shouldAllowLegacyFallbackOnInvalidRuntimePayload,
	resolveActiveWeightsVersion,
	insertSchedulerShadowDiffEvent,
	serializeShadowOutput,
	serializeShadowError,
	normalizeSchedulerQueueRows,
	summarizeDueCardsDiff,
	guardPreviewMode,
	submitReviewNow,
	getDueCardsV2,
	supabaseCardToVocabCard,
	parseSchedulerDueResponse,
} = deckPersoDueReviewInternals;

type ReviewDataClient = Parameters<
	typeof fetchResolvedUserVocabularyCardMediaById
>[0];

type CanonicalReviewCardRow = {
	id: string;
	term: string | null;
	translation: string | null;
	transliteration: string | null;
	example_term: string | null;
	example_translation: string | null;
	frequency_rank: number | null;
	image_url: string | null;
	audio_url: string | null;
	sentence_audio_url: string | null;
};

type FoundationDeckContentRecord = {
	category: string | null;
	exampleSentenceAr: string;
	exampleSentenceFr: string;
	wordAr: string;
	wordFr: string;
};

const toOptionalNonEmptyString = (value: unknown): string | null => {
	if (typeof value !== "string") {
		return null;
	}

	const trimmedValue = value.trim();
	return trimmedValue.length > 0 ? trimmedValue : null;
};

const normalizeFoundationWordKey = (value: unknown): string => {
	const normalizedValue = toOptionalNonEmptyString(value);
	if (!normalizedValue) {
		return "";
	}

	return stripHarakat(normalizedValue).replace(/\s+/g, " ").trim();
};

const foundationDeckContentByLocaleAndWordKey: Record<
	AppLocale,
	Map<string, FoundationDeckContentRecord>
> = {
	fr: new Map(),
	en: new Map(),
};

(["fr", "en"] as AppLocale[]).forEach((locale) => {
	getFoundation2kDeck(locale).forEach((card) => {
		const key = normalizeFoundationWordKey(card.wordAr);
		if (!key || foundationDeckContentByLocaleAndWordKey[locale].has(key)) {
			return;
		}

		foundationDeckContentByLocaleAndWordKey[locale].set(key, {
			category: card.category,
			exampleSentenceAr: card.exampleSentenceAr,
			exampleSentenceFr: card.exampleSentenceFr,
			wordAr: card.wordAr,
			wordFr: card.wordFr,
		});
	});
});

const resolveFoundationDeckContentRecord = (
	wordAr: string | null | undefined,
	locale: AppLocale,
): FoundationDeckContentRecord | null => {
	const key = normalizeFoundationWordKey(wordAr);
	return key
		? (foundationDeckContentByLocaleAndWordKey[locale].get(key) ?? null)
		: null;
};

const hasMissingReviewCardMedia = (card: VocabCard): boolean =>
	!toOptionalNonEmptyString(card.image) ||
		!toOptionalNonEmptyString(card.vocabAudioUrl) ||
		!toOptionalNonEmptyString(card.sentenceAudioUrl);

const isFoundationReviewCard = (card: VocabCard): boolean =>
	card.source === "foundation" || card.sourceType === "foundation";

const buildResolvedMediaValue = ({
	existingValue,
	fallbackValue,
	hidden,
	overlayValue,
}: {
	existingValue: string | null | undefined;
	fallbackValue: string | null | undefined;
	hidden: boolean;
	overlayValue: string | null | undefined;
}): string | null => {
	if (hidden) {
		return null;
	}

	return (
		resolveMediaUrl(existingValue) ??
		resolveMediaUrl(overlayValue) ??
		resolveMediaUrl(fallbackValue)
	);
};

const resolveHydratedFocusValue = ({
	canonicalFrequencyRank,
	existingFocus,
	foundationFrequencyRank,
}: {
	canonicalFrequencyRank: number | null | undefined;
	existingFocus: string | null | undefined;
	foundationFrequencyRank: number | null | undefined;
}): string | undefined => {
	const normalizedExistingFocus = toOptionalNonEmptyString(existingFocus);
	if (normalizedExistingFocus) {
		return normalizedExistingFocus;
	}

	if (
		typeof canonicalFrequencyRank === "number" &&
		Number.isFinite(canonicalFrequencyRank) &&
		canonicalFrequencyRank > 0
	) {
		return String(Math.floor(canonicalFrequencyRank));
	}

	if (
		typeof foundationFrequencyRank === "number" &&
		Number.isFinite(foundationFrequencyRank) &&
		foundationFrequencyRank > 0
	) {
		return String(Math.floor(foundationFrequencyRank));
	}

	return undefined;
};

const chunkIds = (ids: string[], chunkSize = 200): string[][] => {
	if (ids.length === 0) {
		return [];
	}

	const chunks: string[][] = [];
	for (let index = 0; index < ids.length; index += chunkSize) {
		chunks.push(ids.slice(index, index + chunkSize));
	}

	return chunks;
};

const normalizeDistinctIds = (values: Array<string | null | undefined>): string[] =>
	Array.from(
		new Set(
			values.filter(
				(value): value is string => typeof value === "string" && value.length > 0,
			),
		),
	);

const fetchCanonicalReviewCardRowsById = async (
	client: ReviewDataClient,
	cardIds: string[],
): Promise<Map<string, CanonicalReviewCardRow>> => {
	const rowsById = new Map<string, CanonicalReviewCardRow>();
	const normalizedIds = Array.from(
		new Set(
			cardIds
				.map((value) => toOptionalNonEmptyString(value))
				.filter((value): value is string => value !== null),
		),
	);
	if (normalizedIds.length === 0) {
		return rowsById;
	}

	const fromMethod = (client as unknown as {
		from?: (table: string) => any;
	}).from;
	const from = typeof fromMethod === "function" ? fromMethod.bind(client) : null;
	if (!from) {
		return rowsById;
	}

	for (const idChunk of chunkIds(normalizedIds)) {
		try {
			const { data, error } = await from("cards_v1")
				.select(
					"id,term,translation,transliteration,example_term,example_translation,frequency_rank,image_url,audio_url,sentence_audio_url",
				)
				.in("id", idChunk);

			if (error) {
				console.error("Unable to load canonical review card media rows:", error);
				return rowsById;
			}

			(data ?? []).forEach((row: CanonicalReviewCardRow) => {
				const rowId = toOptionalNonEmptyString(row.id);
				if (rowId) {
					rowsById.set(rowId, row);
				}
			});
		} catch (error) {
			console.error("Unable to load canonical review card media rows:", error);
			return rowsById;
		}
	}

	return rowsById;
};

const enrichDueRowsWithResolvedMedia = async (
	client: ReviewDataClient,
	rows: GetDueCardsV2Row[],
): Promise<GetDueCardsV2Row[]> => {
	if (rows.length === 0) {
		return rows;
	}

	// Keep row-level enrichment limited to live-public data: due contracts plus
	// user-specific overlays/source occurrences. Canonical card fallback happens
	// later via cards_v1 so this path does not depend on hidden legacy tables.

	const vocabularyCardIds = normalizeDistinctIds(
		rows.map((record) => resolveDueVocabularyCardId(record)),
	);
	const userMediaRowsById = await fetchResolvedUserVocabularyCardMediaById(
		client,
		vocabularyCardIds,
	);
	const sourceOccurrencesById =
		await fetchCollectedSourceOccurrencesByVocabularyCardId(
			client,
			vocabularyCardIds,
		);

	return rows.map((record) => {
		const vocabularyCardId = resolveDueVocabularyCardId(record);
		const baseEnrichedRecord = vocabularyCardId
			? applyCollectedSourceOccurrenceToDueRecord(
					applyUserVocabularyCardMediaToDueVocabularyRow(
						record,
						userMediaRowsById.get(vocabularyCardId),
					),
					sourceOccurrencesById.get(vocabularyCardId),
				)
			: record;

		return baseEnrichedRecord;
	});
};

const hydrateReviewCardsWithResolvedMedia = async (
	client: ReviewDataClient,
	cards: VocabCard[],
	locale: AppLocale = "fr",
): Promise<VocabCard[]> => {
	const cardsNeedingHydration = cards.filter(hasMissingReviewCardMedia);
	if (cardsNeedingHydration.length === 0) {
		return cards;
	}

	const canonicalCardRowsById = await fetchCanonicalReviewCardRowsById(
		client,
		cardsNeedingHydration
			.map((card) => toOptionalNonEmptyString(card.schedulerCardId))
			.filter((value): value is string => value !== null),
	);

	const vocabularyCardIds = normalizeDistinctIds(
		cardsNeedingHydration.map((card) =>
			toOptionalNonEmptyString(card.vocabularyCardId),
		),
	);
	const vocabularyUserMediaById =
		vocabularyCardIds.length > 0
			? await fetchResolvedUserVocabularyCardMediaById(client, vocabularyCardIds)
			: new Map();

	return cards.map((card) => {
		if (!hasMissingReviewCardMedia(card)) {
			return card;
		}

		const canonicalCardRow = toOptionalNonEmptyString(card.schedulerCardId)
			? (canonicalCardRowsById.get(card.schedulerCardId as string) ?? null)
			: null;

		if (isFoundationReviewCard(card)) {
			const foundationWordAr =
				toOptionalNonEmptyString(card.vocabFull) ??
				toOptionalNonEmptyString(card.vocabBase) ??
				null;
			if (!foundationWordAr) {
				return card;
			}

			const foundationContent = resolveFoundationDeckContentRecord(
				foundationWordAr,
				locale,
			);
			const foundationSentenceAr =
				toOptionalNonEmptyString(card.sentFull) ??
				toOptionalNonEmptyString(foundationContent?.exampleSentenceAr);
			const focusFromCard = Number.parseInt(
				toOptionalNonEmptyString(card.focus) ?? "",
				10,
			);
			const foundationMedia = resolvePreferredFoundationMedia({
				frequencyRank:
					Number.isFinite(focusFromCard) && focusFromCard > 0
						? focusFromCard
						: typeof canonicalCardRow?.frequency_rank === "number"
							? canonicalCardRow.frequency_rank
							: null,
				vocabFull: foundationWordAr,
				vocabBase: stripHarakat(foundationWordAr),
				sentence: foundationSentenceAr,
			});
			const resolvedVocabFull =
				toOptionalNonEmptyString(card.vocabFull) ??
				foundationWordAr ??
				foundationContent?.wordAr ??
				card.vocabFull;
			const resolvedSentFull =
				toOptionalNonEmptyString(card.sentFull) ??
				toOptionalNonEmptyString(foundationContent?.exampleSentenceAr) ??
				card.sentFull;

			return {
				...card,
				focus: resolveHydratedFocusValue({
					canonicalFrequencyRank: canonicalCardRow?.frequency_rank ?? null,
					existingFocus: card.focus,
					foundationFrequencyRank: null,
				}),
				vocabFull: resolvedVocabFull,
				vocabBase:
					toOptionalNonEmptyString(card.vocabBase) ?? stripHarakat(resolvedVocabFull),
				vocabDef:
					toOptionalNonEmptyString(foundationContent?.wordFr) ??
					toOptionalNonEmptyString(card.vocabDef) ??
					toOptionalNonEmptyString(canonicalCardRow?.translation) ??
					card.vocabDef,
				sentFull: resolvedSentFull,
				sentBase:
					toOptionalNonEmptyString(card.sentBase) ?? stripHarakat(resolvedSentFull),
				sentFrench:
					toOptionalNonEmptyString(foundationContent?.exampleSentenceFr) ??
					toOptionalNonEmptyString(card.sentFrench) ??
					toOptionalNonEmptyString(canonicalCardRow?.example_translation) ??
					card.sentFrench,
				image: buildResolvedMediaValue({
					existingValue: card.image,
					fallbackValue:
						toOptionalNonEmptyString(canonicalCardRow?.image_url) ??
						foundationMedia.imageUrl ??
						null,
					hidden: false,
					overlayValue: null,
				}),
				vocabAudioUrl: buildResolvedMediaValue({
					existingValue: card.vocabAudioUrl,
					fallbackValue:
						toOptionalNonEmptyString(canonicalCardRow?.audio_url) ??
						foundationMedia.vocabAudioUrl ??
						null,
					hidden: false,
					overlayValue: null,
				}),
				sentenceAudioUrl: buildResolvedMediaValue({
					existingValue: card.sentenceAudioUrl,
					fallbackValue:
						toOptionalNonEmptyString(canonicalCardRow?.sentence_audio_url) ??
						foundationMedia.sentenceAudioUrl ??
						null,
					hidden: false,
					overlayValue: null,
				}),
				defaultImageUrl:
					card.defaultImageUrl ??
					toOptionalNonEmptyString(canonicalCardRow?.image_url) ??
					foundationMedia.imageUrl ??
					null,
				defaultVocabAudioUrl:
					card.defaultVocabAudioUrl ??
					toOptionalNonEmptyString(canonicalCardRow?.audio_url) ??
					foundationMedia.vocabAudioUrl ??
					null,
				defaultSentenceAudioUrl:
					card.defaultSentenceAudioUrl ??
					toOptionalNonEmptyString(canonicalCardRow?.sentence_audio_url) ??
					foundationMedia.sentenceAudioUrl ??
					null,
				hasCustomImage: card.hasCustomImage,
				hasCustomVocabAudio: card.hasCustomVocabAudio,
				hasCustomSentenceAudio: card.hasCustomSentenceAudio,
				imageHidden: card.imageHidden,
				vocabAudioHidden: card.vocabAudioHidden,
				sentenceAudioHidden: card.sentenceAudioHidden,
			};
		}

		const vocabularyCardId = toOptionalNonEmptyString(card.vocabularyCardId);
		const userMedia = vocabularyCardId
			? (vocabularyUserMediaById.get(vocabularyCardId) ?? null)
			: null;

		return {
			...card,
			focus: resolveHydratedFocusValue({
				canonicalFrequencyRank: canonicalCardRow?.frequency_rank ?? null,
				existingFocus: card.focus,
				foundationFrequencyRank: null,
			}),
			vocabFull:
				toOptionalNonEmptyString(card.vocabFull) ??
				toOptionalNonEmptyString(canonicalCardRow?.term) ??
				card.vocabFull,
			vocabBase:
				toOptionalNonEmptyString(card.vocabBase) ??
				toOptionalNonEmptyString(canonicalCardRow?.term)?.replace(
					/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g,
					"",
				) ??
				card.vocabBase,
			vocabDef:
				toOptionalNonEmptyString(card.vocabDef) ??
				toOptionalNonEmptyString(canonicalCardRow?.translation) ??
				card.vocabDef,
			sentFull:
				toOptionalNonEmptyString(card.sentFull) ??
				toOptionalNonEmptyString(canonicalCardRow?.example_term) ??
				card.sentFull,
			sentFrench:
				toOptionalNonEmptyString(card.sentFrench) ??
				toOptionalNonEmptyString(canonicalCardRow?.example_translation) ??
				card.sentFrench,
			image: buildResolvedMediaValue({
				existingValue: card.image,
				fallbackValue: toOptionalNonEmptyString(canonicalCardRow?.image_url),
				hidden: userMedia?.imageHidden ?? false,
				overlayValue: userMedia?.imageUrl ?? null,
			}),
			vocabAudioUrl: buildResolvedMediaValue({
				existingValue: card.vocabAudioUrl,
				fallbackValue: toOptionalNonEmptyString(canonicalCardRow?.audio_url),
				hidden: userMedia?.vocabAudioHidden ?? false,
				overlayValue: userMedia?.vocabAudioUrl ?? null,
			}),
			sentenceAudioUrl: buildResolvedMediaValue({
				existingValue: card.sentenceAudioUrl,
				fallbackValue: toOptionalNonEmptyString(canonicalCardRow?.sentence_audio_url),
				hidden: userMedia?.sentenceAudioHidden ?? false,
				overlayValue: userMedia?.sentenceAudioUrl ?? null,
			}),
			defaultImageUrl:
				card.defaultImageUrl ??
				toOptionalNonEmptyString(canonicalCardRow?.image_url),
			defaultVocabAudioUrl:
				card.defaultVocabAudioUrl ??
				toOptionalNonEmptyString(canonicalCardRow?.audio_url),
			defaultSentenceAudioUrl:
				card.defaultSentenceAudioUrl ??
				toOptionalNonEmptyString(canonicalCardRow?.sentence_audio_url),
			hasCustomImage:
				card.hasCustomImage ?? (userMedia?.hasCustomImage ?? false),
			hasCustomVocabAudio:
				card.hasCustomVocabAudio ?? (userMedia?.hasCustomVocabAudio ?? false),
			hasCustomSentenceAudio:
				card.hasCustomSentenceAudio ??
				(userMedia?.hasCustomSentenceAudio ?? false),
			imageHidden: card.imageHidden ?? (userMedia?.imageHidden ?? false),
			vocabAudioHidden:
				card.vocabAudioHidden ?? (userMedia?.vocabAudioHidden ?? false),
			sentenceAudioHidden:
				card.sentenceAudioHidden ?? (userMedia?.sentenceAudioHidden ?? false),
		};
	});
};

export async function fetchDueCardsByReviewTypes(
	reviewTypes: ReviewType[],
	limitPerScope = 40,
	locale: AppLocale = "fr",
): Promise<ServiceResult<VocabCard[]>> {
	const client = resolveClient();
	if (!client) {
		return { ok: false, error: CLIENT_UNAVAILABLE_ERROR };
	}

	if (reviewTypes.length === 0) {
		return { ok: true, data: [] };
	}

	try {
		const selectedTypes = new Set<ReviewType>(reviewTypes);

		const fetchLegacyDueCards = async (): Promise<{
			cards: VocabCard[];
			rowsByReviewType: Record<string, unknown[]>;
		}> => {
			const cards: VocabCard[] = [];
			let runningIndex = 0;
			const rowsByReviewType: Record<string, unknown[]> = {};
			const dueRowsByReviewType = new Map<ReviewType, GetDueCardsV2Row[]>();

			const response = await getDueCardsV2(client, {
				p_limit: Math.max(1, limitPerScope * Math.max(reviewTypes.length, 1)),
			});
			if (response.error) {
				throw response.error;
			}

			const rows = Array.isArray(response.data) ? response.data : [];
			reviewTypes.forEach((reviewType) => {
				dueRowsByReviewType.set(reviewType, []);
				rowsByReviewType[reviewType] = [];
			});

			rows.forEach((row) => {
				const card = supabaseCardToVocabCard(row, 0, locale);
				const reviewType = mapCardToReviewType(card);
				if (!reviewType || !selectedTypes.has(reviewType)) {
					return;
				}

				const existingRows = dueRowsByReviewType.get(reviewType) ?? [];
				existingRows.push(row);
				dueRowsByReviewType.set(reviewType, existingRows);
				rowsByReviewType[reviewType].push(toJsonCompatible(row));
			});

			const allDueRows = Array.from(dueRowsByReviewType.values()).flat();
			const enrichedRows = await enrichDueRowsWithResolvedMedia(
				client,
				allDueRows,
			);
			const enrichedRowsQueue = [...enrichedRows];

			reviewTypes.forEach((reviewType) => {
				const rows = dueRowsByReviewType.get(reviewType) ?? [];
				rows.forEach(() => {
					const record = enrichedRowsQueue.shift();
					if (!record) {
						return;
					}
					if (isAlphabetDueRecord(record)) {
						return;
					}

					const card = supabaseCardToVocabCard(record, runningIndex, locale);
					runningIndex += 1;
					cards.push(card);
				});
			});

			const hydratedCards = await hydrateReviewCardsWithResolvedMedia(
				client,
				cards,
				locale,
			);
			const orderedCards = orderFoundationCardsByFocus(hydratedCards);
			return {
				cards: orderedCards,
				rowsByReviewType,
			};
		};

		const invokeClient = client as unknown as {
			functions?: {
				invoke?: (
					name: string,
					options?: { body?: Record<string, unknown> },
				) => Promise<{ data: unknown; error: unknown }>;
			};
		};
		const invoke =
			typeof invokeClient.functions?.invoke === "function"
				? (name: string, options?: { body?: Record<string, unknown> }) =>
					invokeClient.functions!.invoke!(name, options)
				: null;
		const canUseRuntimeDueScheduler =
			invoke !== null &&
			!isDeckPersoSchedulerRollbackToLegacyEnabled();

		const shadowDiffContext = canUseRuntimeDueScheduler
			? await resolveSchedulerShadowDiffContext(client)
			: { userId: null, enabled: false };

		if (canUseRuntimeDueScheduler) {
			const legacyFallbackSunsetGuardEnabled = true;
			const queueLimit = Math.max(
				1,
				Math.min(
					50,
					Math.floor(limitPerScope * Math.max(reviewTypes.length, 1)),
				),
			);
			const requestNowUtc = new Date().toISOString();
			const runtimeRequestPayload = {
				schema_version: 1,
				now_utc: requestNowUtc,
				queue_limit: queueLimit,
				include_new_candidates: true,
				candidate_new_limit: queueLimit,
			};

			let runtimeInvokeData: unknown = null;
			let runtimeInvokeError: unknown = null;
			try {
				const invokeResult = await invoke("scheduler-due-v1", {
					body: runtimeRequestPayload,
				});
				runtimeInvokeData = invokeResult.data;
				runtimeInvokeError = invokeResult.error;
			} catch (invokeError) {
				runtimeInvokeError = invokeError;
			}

			if (runtimeInvokeError) {
				if (shouldFallbackToLegacyDueFetch(runtimeInvokeError)) {
					const bypassSunsetGuard =
						shouldAllowLegacyFallbackOnTransportFailure(runtimeInvokeError);
					if (!legacyFallbackSunsetGuardEnabled && !bypassSunsetGuard) {
						if (shadowDiffContext.enabled && shadowDiffContext.userId) {
							const weightsVersion = await resolveActiveWeightsVersion(
								client,
								shadowDiffContext.userId,
							);

							await insertSchedulerShadowDiffEvent(client, {
								userId: shadowDiffContext.userId,
								operation: "due_fetch",
								primaryPath: "runtime_edge",
								occurredAt: requestNowUtc,
								requestNowUtc,
								weightsVersion,
								schedulerInputs: {
									review_types: reviewTypes,
									limit_per_scope: limitPerScope,
									queue_limit: queueLimit,
									runtime_request: runtimeRequestPayload,
								},
								runtimeOutput: serializeShadowOutput(null, runtimeInvokeError),
								legacyOutput: serializeShadowOutput(null),
								diffSummary: {
									matches: false,
									reason:
										SHADOW_DIFF_REASON_CODES.RUNTIME_DUE_FALLBACK_BLOCKED_BY_SUNSET_GUARD,
									runtime_error: serializeShadowError(runtimeInvokeError),
								},
							});
						}

						return {
							ok: false,
							error: createServiceError(
								"RPC_ERROR",
								DUE_SUNSET_GUARD_BLOCKED_ERROR_MESSAGE,
								true,
							),
						};
					}

					const legacyFallbackResult = await fetchLegacyDueCards();

					if (shadowDiffContext.enabled && shadowDiffContext.userId) {
						const weightsVersion = await resolveActiveWeightsVersion(
							client,
							shadowDiffContext.userId,
						);

						await insertSchedulerShadowDiffEvent(client, {
							userId: shadowDiffContext.userId,
							operation: "due_fetch",
							primaryPath: "legacy_sql",
							occurredAt: requestNowUtc,
							requestNowUtc,
							weightsVersion,
							schedulerInputs: {
								review_types: reviewTypes,
								limit_per_scope: limitPerScope,
								queue_limit: queueLimit,
								runtime_request: runtimeRequestPayload,
							},
							runtimeOutput: serializeShadowOutput(null, runtimeInvokeError),
							legacyOutput: serializeShadowOutput({
								rows_by_review_type: legacyFallbackResult.rowsByReviewType,
								selected_cards: legacyFallbackResult.cards,
							}),
							diffSummary: {
								matches: false,
								reason: SHADOW_DIFF_REASON_CODES.RUNTIME_DUE_FALLBACK_TO_LEGACY,
								legacy_count: legacyFallbackResult.cards.length,
								runtime_error: serializeShadowError(runtimeInvokeError),
							},
						});
					}

					return { ok: true, data: legacyFallbackResult.cards };
				}

				throw runtimeInvokeError;
			}

			let runtimeResponse: ReturnType<typeof parseSchedulerDueResponse> | null =
				null;
			let runtimeParseError: unknown = null;
			try {
				runtimeResponse = parseSchedulerDueResponse(runtimeInvokeData);
			} catch (parseError) {
				runtimeParseError = parseError;
			}

			if (!runtimeResponse) {
				const bypassSunsetGuard =
					shouldAllowLegacyFallbackOnInvalidRuntimePayload({
						runtimePayload: runtimeInvokeData,
						runtimeParseError,
					});
				if (!legacyFallbackSunsetGuardEnabled && !bypassSunsetGuard) {
					if (shadowDiffContext.enabled && shadowDiffContext.userId) {
						const weightsVersion = await resolveActiveWeightsVersion(
							client,
							shadowDiffContext.userId,
						);

						await insertSchedulerShadowDiffEvent(client, {
							userId: shadowDiffContext.userId,
							operation: "due_fetch",
							primaryPath: "runtime_edge",
							occurredAt: requestNowUtc,
							requestNowUtc,
							weightsVersion,
							schedulerInputs: {
								review_types: reviewTypes,
								limit_per_scope: limitPerScope,
								queue_limit: queueLimit,
								runtime_request: runtimeRequestPayload,
							},
							runtimeOutput: serializeShadowOutput(
								{ invoke_response: runtimeInvokeData },
								runtimeParseError,
							),
							legacyOutput: serializeShadowOutput(null),
							diffSummary: {
								matches: false,
								reason:
									SHADOW_DIFF_REASON_CODES.RUNTIME_DUE_FALLBACK_BLOCKED_BY_SUNSET_GUARD,
								runtime_error: serializeShadowError(runtimeParseError),
							},
						});
					}

					return {
						ok: false,
						error: createServiceError(
							"RPC_ERROR",
							DUE_SUNSET_GUARD_BLOCKED_ERROR_MESSAGE,
							true,
						),
					};
				}

				const legacyFallbackResult = await fetchLegacyDueCards();

				if (shadowDiffContext.enabled && shadowDiffContext.userId) {
					const weightsVersion = await resolveActiveWeightsVersion(
						client,
						shadowDiffContext.userId,
					);

					await insertSchedulerShadowDiffEvent(client, {
						userId: shadowDiffContext.userId,
						operation: "due_fetch",
						primaryPath: "legacy_sql",
						occurredAt: requestNowUtc,
						requestNowUtc,
						weightsVersion,
						schedulerInputs: {
							review_types: reviewTypes,
							limit_per_scope: limitPerScope,
							queue_limit: queueLimit,
							runtime_request: runtimeRequestPayload,
						},
						runtimeOutput: serializeShadowOutput(
							{ invoke_response: runtimeInvokeData },
							runtimeParseError,
						),
						legacyOutput: serializeShadowOutput({
							rows_by_review_type: legacyFallbackResult.rowsByReviewType,
							selected_cards: legacyFallbackResult.cards,
						}),
						diffSummary: {
							matches: false,
							reason: SHADOW_DIFF_REASON_CODES.RUNTIME_DUE_INVALID_PAYLOAD,
							legacy_count: legacyFallbackResult.cards.length,
							runtime_error: serializeShadowError(runtimeParseError),
						},
					});
				}

				return { ok: true, data: legacyFallbackResult.cards };
			}

			const runtimeRows = normalizeSchedulerQueueRows(runtimeResponse);
			const enrichedRuntimeRows = await enrichDueRowsWithResolvedMedia(
				client,
				runtimeRows,
			);

			const runtimeCards: VocabCard[] = [];
			let runtimeIndex = 0;

			enrichedRuntimeRows.forEach((record) => {
				if (isAlphabetDueRecord(record)) {
					return;
				}

				const card = supabaseCardToVocabCard(record, runtimeIndex, locale);
				const reviewType = mapCardToReviewType(card);
				if (!reviewType || !selectedTypes.has(reviewType)) {
					return;
				}

				runtimeIndex += 1;
				runtimeCards.push(card);
			});

			const hydratedRuntimeCards = await hydrateReviewCardsWithResolvedMedia(
				client,
				runtimeCards,
				locale,
			);
			const orderedRuntimeCards = orderFoundationCardsByFocus(hydratedRuntimeCards);

			if (shadowDiffContext.enabled && shadowDiffContext.userId) {
				let legacyCards: VocabCard[] = [];
				let legacyRowsByReviewType: Record<string, unknown[]> = {};
				let legacyShadowError: unknown = null;

				try {
					const legacyResult = await fetchLegacyDueCards();
					legacyCards = legacyResult.cards;
					legacyRowsByReviewType = legacyResult.rowsByReviewType;
				} catch (legacyError) {
					legacyShadowError = legacyError;
				}

				const weightsVersion = await resolveActiveWeightsVersion(
					client,
					shadowDiffContext.userId,
				);

				const diffSummary = legacyShadowError
					? {
							matches: false,
							reason: SHADOW_DIFF_REASON_CODES.LEGACY_DUE_SHADOW_FAILED,
							runtime_count: orderedRuntimeCards.length,
							legacy_error: serializeShadowError(legacyShadowError),
						}
					: summarizeDueCardsDiff(orderedRuntimeCards, legacyCards);

				await insertSchedulerShadowDiffEvent(client, {
					userId: shadowDiffContext.userId,
					operation: "due_fetch",
					primaryPath: "runtime_edge",
					occurredAt: requestNowUtc,
					requestNowUtc,
					weightsVersion,
					schedulerInputs: {
						review_types: reviewTypes,
						limit_per_scope: limitPerScope,
						queue_limit: queueLimit,
						runtime_request: runtimeRequestPayload,
					},
					runtimeOutput: serializeShadowOutput({
						invoke_response: runtimeResponse,
						selected_cards: orderedRuntimeCards,
					}),
					legacyOutput: serializeShadowOutput(
						{
							rows_by_review_type: legacyRowsByReviewType,
							selected_cards: legacyCards,
						},
						legacyShadowError,
					),
					diffSummary,
				});
			}

			return { ok: true, data: orderedRuntimeCards };
		}

		const legacyResult = await fetchLegacyDueCards();
		return { ok: true, data: legacyResult.cards };
	} catch (error) {
		return {
			ok: false,
			error:
				error &&
				typeof error === "object" &&
				"code" in (error as PostgrestError)
					? fromPostgrestError(error as PostgrestError)
					: fromUnknownError(error),
		};
	}
}

export async function submitReviewForCard(
	card: VocabCard,
	rating: BinaryReviewRating,
	options: ReviewMutationOptions,
): Promise<ServiceResult<SubmitReviewSchedulerPayload | null>> {
	const previewGuard = guardPreviewMode("Submit review", options?.mode);
	if (previewGuard) {
		return { ok: false, error: previewGuard };
	}

	const cardKey = resolveCardKey(card);
	if (!cardKey) {
		return {
			ok: false,
			error: createServiceError(
				"UNKNOWN",
				"This card could not be found on the server.",
				false,
			),
		};
	}

	const client = resolveClient();
	const accountKey = await resolveAccountKey(client);

	if (!client || isBrowserOffline()) {
		const clientReviewId = getOrCreateClientReviewId(cardKey);
		enqueueReviewSubmission(accountKey, cardKey, card, rating, clientReviewId);
		return {
			ok: false,
			error: createServiceError(
				"RPC_ERROR",
				"Connection unavailable. Review queued and will sync automatically.",
				true,
			),
		};
	}

	const result = await submitReviewNow(card, rating);
	if (!result.ok && result.error.retryable) {
		const clientReviewId = getOrCreateClientReviewId(cardKey);
		enqueueReviewSubmission(accountKey, cardKey, card, rating, clientReviewId);
	}
	return result;
}

export type { BinaryReviewRating };
