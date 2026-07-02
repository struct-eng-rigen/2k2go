import type { ChangeEvent, FormEvent } from "react";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAppLocale, useIsEnglishApp } from "@/contexts/AppLocaleContext";
import { useAuth } from "@/contexts/AuthContext";
import type {
	PreviewReviewCard,
	PreviewYoutubeRecommendationsResult,
} from "@/features/preview-new-concept/types";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useProfile, type UserProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreateAppSessionVisitorId } from "@/lib/appSessionVisitor";
import {
	clampProfileNewCardsPerDay,
	isSupportedProfileCountry,
	PROFILE_COUNTRY_OPTIONS,
	PROFILE_NEW_CARDS_PER_DAY_DEFAULT,
	PROFILE_NEW_CARDS_PER_DAY_MAX,
	PROFILE_NEW_CARDS_PER_DAY_MIN,
} from "@/lib/profilePreferences";
import { resolveReviewReminderEmailEnabled } from "@/lib/settingsPreferences";
import {
	PROFILE_UPDATED_EVENT,
	type ProfileUpdatedDetail,
} from "@/lib/profileEvents";
import {
	measureTextLayout,
	usePretextAutoResize,
	usePretextContainerWidth,
} from "@/features/preview-new-concept/usePretext";
import { ensureAppRuntimeProfiler } from "@/features/preview-new-concept/pretextRuntimeProfiler";
import { usePendingReviewsCount } from "@/hooks/usePendingReviewsCount";
import type { VocabGridData } from "@/lib/vocabGrid";
import type {
	DeckSourceType,
	SearchCardsV2Row,
} from "@/services/deckPersoService";
import type {
	FriendListItem,
	IncomingFriendRequest,
	OutgoingFriendRequest,
} from "@/services/friendsService";
import { getProfileSocialSummary } from "@/services/profilePageService";
import { fetchWordsAcquiredCount } from "@/services/profileProgressService";

const LazyVocabGrid = lazy(() =>
	import("@/components/VocabGrid").then((module) => ({
		default: module.VocabGrid,
	})),
);
const LazyKeyboardWithPreviewDemo = lazy(
	() => import("@/components/keyboard-with-preview-demo"),
);
const LazyCardsReview = lazy(() =>
	import("@/components/deck-perso-visual/CardsReview").then((module) => ({
		default: module.CardsReview,
	})),
);
const LazyWhy2000ToGoPage = lazy(
	() => import("@/pages/WhyItWorksPage"),
);

function useAppV2WordsAcquiredCount(userId: string | null | undefined): {
	wordsAcquiredCount: number;
	loading: boolean;
} {
	const [wordsAcquiredCount, setWordsAcquiredCount] = useState(0);
	const [loading, setLoading] = useState(Boolean(userId));

	useEffect(() => {
		let cancelled = false;

		if (!userId) {
			setWordsAcquiredCount(0);
			setLoading(false);
			return () => {
				cancelled = true;
			};
		}

		setLoading(true);

		void (async () => {
			try {
				const result = await fetchWordsAcquiredCount(userId);
				if (cancelled || !result.ok) {
					return;
				}

				setWordsAcquiredCount(result.data);
			} catch (error) {
				if (!cancelled) {
					console.error("Error loading app-v2 words acquired count:", error);
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [userId]);

	return { wordsAcquiredCount, loading };
}

const APP_V2_BASE_PATH = "/app";
const APP_V2_LEGACY_BASE_PATH = "/app-v2";
const HOME_V2_PATH = "/home";
const APP_PUBLIC_BASE_PATH = (import.meta.env.BASE_URL ?? "/").replace(
	/\/+$/,
	"",
);
const HOME_V2_PUBLIC_PATH = `${APP_PUBLIC_BASE_PATH}${HOME_V2_PATH}`;
const LOGIN_V2_PATH = "/login";
const LEGACY_DOCS_PATH_SEGMENT = "pourquoi-2000-to-go";
const DOCS_PATH_SEGMENT = "why-2000-to-go";
const LEGACY_KEYBOARD_PATH_SEGMENT = "clavier-arabe-en-ligne";
const KEYBOARD_PATH_SEGMENT = "arabic-keyboard";
const LEGACY_IMMERSION_VIDEO_PATH_SEGMENT = "video-immersion";
const OLDER_LEGACY_IMMERSION_VIDEO_PATH_SEGMENT = "immersion-video";
const IMMERSION_VIDEO_PATH_SEGMENT = "video-immersion-ai";
const OWN_APP_V2_PROFILE_SEGMENT = "me";
const DEFAULT_APP_V2_PROFILE_USERNAME = "user__eadd48eb";
const APP_V2_GUEST_REMAINING_CARDS = PROFILE_NEW_CARDS_PER_DAY_DEFAULT;
const APP_V2_DEFAULT_WEEKLY_REMAINING_CARDS =
	PROFILE_NEW_CARDS_PER_DAY_DEFAULT * 7;
const APP_V2_TOTAL_DECK_CARDS = 2000;
const APP_V2_HOME_METRICS_CACHE_TTL_MS = 5_000;
const APP_V2_ADMIN_OVERVIEW_CACHE_KEY = "app:admin-overview:v2";
const APP_V2_ADMIN_OVERVIEW_POLL_INTERVAL_MS = 60_000;
const APP_V2_PROFILE_CACHE_TTL_MS = 5 * 60_000;
const APP_V2_FOUNDATION_REMAINING_CACHE_TTL_MS = 5 * 60_000;
const APP_V2_ACCOUNT_BANK_SEARCH_LIMIT = 500;
const APP_V2_ACCOUNT_BANK_MAX_FETCH_PAGES = 24;
const APP_V2_ACCOUNT_BANK_CACHE_TTL_MS = 5 * 60_000;
const APP_V2_ACCOUNT_BANK_SOURCE_TYPES: DeckSourceType[] = [
	"foundation",
	"collected",
	"sent",
];
const APP_V2_ACCOUNT_BANK_GRADIENT_COLORS = [
	"#e62e2e",
	"#e6442e",
	"#e65a2e",
	"#e6702e",
	"#e6872e",
	"#e69d2e",
	"#e6b32e",
	"#e6c92e",
	"#e6df2e",
	"#d8e62e",
	"#c2e62e",
	"#abe62e",
	"#95e62e",
	"#7fe62e",
	"#69e62e",
	"#53e62e",
	"#3de62e",
	"#2ee635",
	"#2ee64c",
	"#2ee662",
	"#2ee678",
	"#2ee68e",
	"#2ee6a4",
	"#2ee6ba",
	"#2ee6d0",
	"#2ee6e6",
] as const;
const APP_V2_ACCOUNT_BANK_LEGEND_GRADIENT =
	"linear-gradient(90deg, #e62e2e, #e65a2e, #e6c92e, #2ee6a4, #2ee6e6)";

type AppV2HomeMetricsSnapshot = {
	weeklyRemainingCount: number;
	averageReviewsPerDay: number;
	finishInDays: number | null;
	updatedAt: number;
};

type AppV2ProfileCacheSnapshot = {
	profile: UserProfile;
	updatedAt: number;
};

type AppV2AccountBankCacheSnapshot = {
	gridData: VocabGridData;
	updatedAt: number;
};

const baseTextStyle = {
	fontSize: "13.3333px",
	fontFamily: "Arial, sans-serif",
} as const;

const plainLinkStyle = {
	...baseTextStyle,
	color: "#000000",
	textDecoration: "underline",
} as const;

function AppV2SectionLoading({ text = "chargement..." }: { text?: string }) {
	const isEnglish = useIsEnglishApp();
	return (
		<p style={{ ...baseTextStyle, marginTop: "14px" }}>
			{text === "chargement..." && isEnglish ? "loading..." : text}
		</p>
	);
}

const appV2MainStyle = {
	fontFamily: "Arial, sans-serif",
	fontSize: "13.3333px",
	backgroundColor: "#f7f6f2",
	color: "#000000",
	position: "fixed",
	inset: 0,
	overflowY: "auto",
} as const;

const appV2ButtonBaseStyle = {
	fontSize: "13.3333px",
	fontFamily: "Arial, sans-serif",
	color: "#000000",
	border: "1px solid #000000",
	borderRadius: "3px",
	padding: "1% 6px",
	paddingTop: "1px",
	paddingBottom: "1px",
} as const;

const appV2HighlightNumberStyle = {
	color: "#c61b1b",
	fontWeight: 700,
} as const;

const APP_V2_PRETEXT_BODY_FONT = "400 13.3333px Arial, sans-serif";
const APP_V2_PRETEXT_BODY_LINE_HEIGHT_PX = 18;
const APP_V2_PRETEXT_HOME_MAX_TITLE_FONT_PX = 96;
const APP_V2_PRETEXT_HOME_MIN_TITLE_FONT_PX = 44;

function findLargestSingleLineFontSize(
	text: string,
	maxWidth: number,
	maxFontSizePx: number,
	minFontSizePx: number,
	fontFamily: string,
	profileMeta?: { pagePath?: string; blockId?: string },
): number {
	if (!text.trim() || maxWidth <= 0) {
		return maxFontSizePx;
	}

	for (let fontSize = maxFontSizePx; fontSize >= minFontSizePx; fontSize -= 2) {
		const result = measureTextLayout(
			text,
			`400 ${fontSize}px ${fontFamily}`,
			maxWidth,
			fontSize,
			profileMeta,
		);
		if (result && result.lineCount <= 1) {
			return fontSize;
		}
	}

	return minFontSizePx;
}

function normalizePathname(pathname: string): string {
	const normalized = pathname.replace(/\/+$/g, "");
	if (normalized === APP_V2_LEGACY_BASE_PATH) {
		return APP_V2_BASE_PATH;
	}
	if (normalized.startsWith(`${APP_V2_LEGACY_BASE_PATH}/`)) {
		return `${APP_V2_BASE_PATH}${normalized.slice(APP_V2_LEGACY_BASE_PATH.length)}`;
	}
	return normalized.length > 0 ? normalized : APP_V2_BASE_PATH;
}

function decodePathSegment(value: string | undefined): string | null {
	if (!value) {
		return null;
	}

	try {
		const decoded = decodeURIComponent(value).trim();
		return decoded.length > 0 ? decoded : null;
	} catch {
		const fallback = value.trim();
		return fallback.length > 0 ? fallback : null;
	}
}

function normalizeProfileCacheKeySegment(value: string): string {
	return value.trim().toLowerCase();
}

function normalizeAppV2BankArabicWord(
	value: string | null | undefined,
): string {
	return (value ?? "").replace(/\u0640/g, "").trim();
}

function clampAppV2BankScore(value: number | null | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return 0;
	}

	return Math.max(0, Math.min(10, value * 10));
}

function getAppV2BankMasteryColor(score: number): string {
	const palette = APP_V2_ACCOUNT_BANK_GRADIENT_COLORS;
	const clampedScore = Math.max(0, Math.min(10, score));
	const position = (clampedScore / 10) * (palette.length - 1);
	const lowerIndex = Math.floor(position);
	const upperIndex = Math.ceil(position);

	if (lowerIndex === upperIndex) {
		return palette[lowerIndex];
	}

	const hexToRgb = (hex: string): [number, number, number] => {
		const normalized = hex.replace("#", "");
		return [
			Number.parseInt(normalized.slice(0, 2), 16),
			Number.parseInt(normalized.slice(2, 4), 16),
			Number.parseInt(normalized.slice(4, 6), 16),
		];
	};

	const toHex = (value: number): string =>
		Math.max(0, Math.min(255, Math.round(value)))
			.toString(16)
			.padStart(2, "0");

	const mixAmount = position - lowerIndex;
	const [startR, startG, startB] = hexToRgb(palette[lowerIndex]);
	const [endR, endG, endB] = hexToRgb(palette[upperIndex]);

	const mixedR = startR + (endR - startR) * mixAmount;
	const mixedG = startG + (endG - startG) * mixAmount;
	const mixedB = startB + (endB - startB) * mixAmount;

	return `#${toHex(mixedR)}${toHex(mixedG)}${toHex(mixedB)}`;
}

function toAppV2AccountBankGridData(rows: SearchCardsV2Row[]): VocabGridData {
	const uniqueByArabicWord = new Map<string, SearchCardsV2Row>();

	rows.forEach((row) => {
		const normalizedWord = normalizeAppV2BankArabicWord(
			typeof row.word_ar === "string"
				? row.word_ar
				: typeof row.term === "string"
					? row.term
					: null,
		);
		if (!normalizedWord) {
			return;
		}

		const currentRow = uniqueByArabicWord.get(normalizedWord);
		const currentScore = clampAppV2BankScore(
			currentRow?.maturity_score ?? currentRow?.score,
		);
		const nextScore = clampAppV2BankScore(row.maturity_score ?? row.score);

		if (!currentRow || nextScore >= currentScore) {
			uniqueByArabicWord.set(normalizedWord, row);
		}
	});

	const units = Array.from(uniqueByArabicWord.values()).map((row, index) => {
		const score = clampAppV2BankScore(row.maturity_score ?? row.score);
		const isSeen = Boolean(row.is_seen);
		const unitId =
			row.foundation_card_id ??
			row.vocabulary_card_id ??
			(typeof row.card_id === "string" && row.card_id.trim().length > 0
				? row.card_id.trim()
				: null) ??
			`app-v2-bank-unit-${row.word_ar ?? ""}-${index}`;
		const normalizedWord = normalizeAppV2BankArabicWord(
			typeof row.word_ar === "string"
				? row.word_ar
				: typeof row.term === "string"
					? row.term
					: null,
		);

		return {
			id: unitId,
			word: normalizedWord,
			vocabBase: normalizedWord,
			vocabFull: normalizedWord,
			score,
			seenCount: isSeen ? 1 : 0,
			unseenCount: isSeen ? 0 : 1,
			avgInterval: score,
			color: getAppV2BankMasteryColor(score),
			category: row.category || undefined,
		};
	});

	const known = units.filter((unit) => unit.seenCount > 0).length;
	const total = units.length;

	return {
		units,
		summary: {
			total,
			known,
			knownPercent: total === 0 ? 0 : Math.round((known / total) * 1000) / 10,
		},
	};
}

function getAppV2AccountBankCacheKey(userId: string): string {
	return `app:account-bank:v4:${userId.trim()}`;
}

function readAppV2AccountBankCache(userId: string): VocabGridData | null {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const rawValue = window.localStorage.getItem(
			getAppV2AccountBankCacheKey(userId),
		);
		if (!rawValue) {
			return null;
		}

		const parsedValue = JSON.parse(rawValue) as AppV2AccountBankCacheSnapshot;
		if (
			!parsedValue ||
			typeof parsedValue !== "object" ||
			typeof parsedValue.updatedAt !== "number" ||
			typeof parsedValue.gridData !== "object" ||
			parsedValue.gridData === null
		) {
			return null;
		}

		if (Date.now() - parsedValue.updatedAt > APP_V2_ACCOUNT_BANK_CACHE_TTL_MS) {
			return null;
		}

		return parsedValue.gridData;
	} catch {
		return null;
	}
}

function writeAppV2AccountBankCache(
	userId: string,
	gridData: VocabGridData,
): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		const payload: AppV2AccountBankCacheSnapshot = {
			gridData,
			updatedAt: Date.now(),
		};
		window.localStorage.setItem(
			getAppV2AccountBankCacheKey(userId),
			JSON.stringify(payload),
		);
	} catch {
		// Ignore localStorage write failures.
	}
}

function getAppV2ProfileCacheByUsernameKey(username: string): string {
	return `app:profile:username:${normalizeProfileCacheKeySegment(username)}`;
}

function getAppV2ProfileCacheByUserIdKey(userId: string): string {
	return `app:profile:user:${userId.trim()}`;
}

function readAppV2ProfileCache(cacheKey: string): UserProfile | null {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const rawValue = window.localStorage.getItem(cacheKey);
		if (!rawValue) {
			return null;
		}

		const parsedValue = JSON.parse(rawValue) as AppV2ProfileCacheSnapshot;
		if (
			!parsedValue ||
			typeof parsedValue !== "object" ||
			typeof parsedValue.updatedAt !== "number" ||
			!parsedValue.profile ||
			typeof parsedValue.profile !== "object"
		) {
			return null;
		}

		if (Date.now() - parsedValue.updatedAt > APP_V2_PROFILE_CACHE_TTL_MS) {
			return null;
		}

		return parsedValue.profile;
	} catch {
		return null;
	}
}

function writeAppV2ProfileCache(profile: UserProfile): void {
	if (typeof window === "undefined") {
		return;
	}

	const snapshot: AppV2ProfileCacheSnapshot = {
		profile,
		updatedAt: Date.now(),
	};

	const nextUsername = profile.username?.trim();
	const keys = [
		profile.user_id ? getAppV2ProfileCacheByUserIdKey(profile.user_id) : null,
		nextUsername ? getAppV2ProfileCacheByUsernameKey(nextUsername) : null,
	].filter((cacheKey): cacheKey is string => Boolean(cacheKey));

	for (const cacheKey of keys) {
		try {
			window.localStorage.setItem(cacheKey, JSON.stringify(snapshot));
		} catch {
			// Ignore local cache write failures.
		}
	}
}

function removeAppV2ProfileCacheByUsername(username: string | null | undefined): void {
	if (typeof window === "undefined") {
		return;
	}

	const normalizedUsername = username?.trim().toLowerCase() ?? "";
	if (normalizedUsername.length === 0) {
		return;
	}

	try {
		window.localStorage.removeItem(
			getAppV2ProfileCacheByUsernameKey(normalizedUsername),
		);
	} catch {
		// Ignore local cache removal failures.
	}
}

function buildAppV2AccountPath(username: string): string {
	return `${APP_V2_BASE_PATH}/account/${encodeURIComponent(username)}`;
}

function resolveAppV2ProfileUsername(value: string | null | undefined): string {
	return decodePathSegment(value ?? undefined) ?? OWN_APP_V2_PROFILE_SEGMENT;
}

const SETTINGS_AVATAR_MAX_BYTES = 1 * 1024 * 1024;
const SETTINGS_AVATAR_MAX_DIMENSION_PX = 720;

async function compressSettingsAvatarImage(file: File): Promise<Blob> {
	if (file.size > SETTINGS_AVATAR_MAX_BYTES) {
		throw new Error("avatar-too-large");
	}

	const objectUrl = URL.createObjectURL(file);
	try {
		const image = await new Promise<HTMLImageElement>((resolve, reject) => {
			const nextImage = new Image();
			nextImage.onload = () => {
				resolve(nextImage);
			};
			nextImage.onerror = () => {
				reject(new Error("avatar-decode-failed"));
			};
			nextImage.src = objectUrl;
		});

		const sourceWidth = image.naturalWidth || image.width;
		const sourceHeight = image.naturalHeight || image.height;
		const ratio =
			sourceWidth > 0 && sourceHeight > 0
				? Math.min(
					1,
					SETTINGS_AVATAR_MAX_DIMENSION_PX / Math.max(sourceWidth, sourceHeight),
				)
				: 1;

		const targetWidth = Math.max(1, Math.round(sourceWidth * ratio));
		const targetHeight = Math.max(1, Math.round(sourceHeight * ratio));

		const canvas = document.createElement("canvas");
		canvas.width = targetWidth;
		canvas.height = targetHeight;
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("avatar-canvas-failed");
		}

		context.drawImage(image, 0, 0, targetWidth, targetHeight);

		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(result) => {
					if (!result) {
						reject(new Error("avatar-encode-failed"));
						return;
					}
					resolve(result);
				},
				"image/webp",
				0.86,
			);
		});

		if (blob.size > SETTINGS_AVATAR_MAX_BYTES) {
			throw new Error("avatar-too-large");
		}

		return blob;
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

function resolveCanonicalAppV2Path(pathname: string): string | null {
	const profilePathMatch = pathname.match(
		new RegExp(
			`^${APP_V2_BASE_PATH}/(account|compte|profil|profile)(?:/(.+))?$`,
		),
	);

	if (profilePathMatch) {
		const [, slug, usernameSegment] = profilePathMatch;
		const canonicalUsername = resolveAppV2ProfileUsername(usernameSegment);
		const canonicalProfilePath = buildAppV2AccountPath(canonicalUsername);

		if (slug !== "account" || canonicalProfilePath !== pathname) {
			return canonicalProfilePath;
		}

		return null;
	}

	if (pathname === `${APP_V2_BASE_PATH}/camarades`) {
		return `${APP_V2_BASE_PATH}/contacts`;
	}

	if (pathname === `${APP_V2_BASE_PATH}/end`) {
		return `${APP_V2_BASE_PATH}/${IMMERSION_VIDEO_PATH_SEGMENT}`;
	}

	if (
		pathname === `${APP_V2_BASE_PATH}/${LEGACY_IMMERSION_VIDEO_PATH_SEGMENT}` ||
		pathname === `${APP_V2_BASE_PATH}/${OLDER_LEGACY_IMMERSION_VIDEO_PATH_SEGMENT}`
	) {
		return `${APP_V2_BASE_PATH}/${IMMERSION_VIDEO_PATH_SEGMENT}`;
	}

	if (pathname === `${APP_V2_BASE_PATH}/${LEGACY_KEYBOARD_PATH_SEGMENT}`) {
		return `${APP_V2_BASE_PATH}/${KEYBOARD_PATH_SEGMENT}`;
	}

	if (pathname === `${APP_V2_BASE_PATH}/${LEGACY_DOCS_PATH_SEGMENT}`) {
		return `${APP_V2_BASE_PATH}/${DOCS_PATH_SEGMENT}`;
	}

	if (pathname.startsWith(`${APP_V2_BASE_PATH}/${LEGACY_DOCS_PATH_SEGMENT}/`)) {
		return `${APP_V2_BASE_PATH}/${DOCS_PATH_SEGMENT}${pathname.slice((`${APP_V2_BASE_PATH}/${LEGACY_DOCS_PATH_SEGMENT}`).length)}`;
	}

	return null;
}

function useAppV2InlineMessage(durationMs = 2000) {
	const [message, setMessage] = useState<string | null>(null);
	const timeoutRef = useRef<number | null>(null);

	const showMessage = useCallback(
		(nextMessage: string) => {
			setMessage(nextMessage);
			if (timeoutRef.current !== null) {
				window.clearTimeout(timeoutRef.current);
			}
			timeoutRef.current = window.setTimeout(() => {
				setMessage(null);
				timeoutRef.current = null;
			}, durationMs);
		},
		[durationMs],
	);

	useEffect(() => {
		return () => {
			if (timeoutRef.current !== null) {
				window.clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	return { message, showMessage };
}

function AppV2ToastSuppressionStyle() {
	return (
		<style>{`
			[data-sonner-toaster],
			[data-sonner-toast] {
				display: none !important;
			}
		`}</style>
	);
}

function resolveContactDisplayName(friend: FriendListItem): string {
	const fullName = [friend.firstName, friend.lastName]
		.filter(Boolean)
		.join(" ")
		.trim();

	if (fullName) {
		return fullName;
	}

	if (friend.username?.trim()) {
		return `@${friend.username.trim()}`;
	}

	return "contact";
}

function formatLastActivityLabel(
	activityAt: string | null,
	isEnglish: boolean,
): string | null {
	if (!activityAt) {
		return null;
	}

	const date = new Date(activityAt);
	if (Number.isNaN(date.getTime())) {
		return null;
	}

	const now = Date.now();
	const elapsedSeconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));

	if (elapsedSeconds < 60) {
		return isEnglish
			? `${elapsedSeconds} second${elapsedSeconds > 1 ? "s" : ""} ago`
			: `il y a ${elapsedSeconds} seconde${elapsedSeconds > 1 ? "s" : ""}`;
	}

	const elapsedMinutes = Math.floor(elapsedSeconds / 60);
	if (elapsedMinutes < 60) {
		return isEnglish
			? `${elapsedMinutes} minute${elapsedMinutes > 1 ? "s" : ""} ago`
			: `il y a ${elapsedMinutes} minute${elapsedMinutes > 1 ? "s" : ""}`;
	}

	const elapsedHours = Math.floor(elapsedMinutes / 60);
	if (elapsedHours < 24) {
		return isEnglish
			? `${elapsedHours} hour${elapsedHours > 1 ? "s" : ""} ago`
			: `il y a ${elapsedHours} heure${elapsedHours > 1 ? "s" : ""}`;
	}

	const elapsedDays = Math.floor(elapsedHours / 24);
	if (elapsedDays < 7) {
		return isEnglish
			? `${elapsedDays} day${elapsedDays > 1 ? "s" : ""} ago`
			: `il y a ${elapsedDays} jour${elapsedDays > 1 ? "s" : ""}`;
	}

	const elapsedWeeks = Math.floor(elapsedDays / 7);
	if (elapsedWeeks < 5) {
		return isEnglish
			? `${elapsedWeeks} week${elapsedWeeks > 1 ? "s" : ""} ago`
			: `il y a ${elapsedWeeks} semaine${elapsedWeeks > 1 ? "s" : ""}`;
	}

	const elapsedMonths = Math.floor(elapsedDays / 30);
	if (elapsedMonths < 12) {
		return isEnglish
			? `${elapsedMonths} month${elapsedMonths > 1 ? "s" : ""} ago`
			: `il y a ${elapsedMonths} mois`;
	}

	const elapsedYears = Math.floor(elapsedDays / 365);
	return isEnglish
		? `${elapsedYears} year${elapsedYears > 1 ? "s" : ""} ago`
		: `il y a ${elapsedYears} an${elapsedYears > 1 ? "s" : ""}`;
}

function resolveProfileDisplayName(
	profile: {
		first_name: string | null;
		last_name: string | null;
		username: string | null;
	} | null,
): string {
	if (!profile) {
		return "compte";
	}

	const fullName =
		`${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim();
	if (fullName.length > 0) {
		return fullName;
	}

	return profile.username?.trim() || "compte";
}

function getAppV2HomeMetricsCacheKey(userId: string): string {
	return `app:home-metrics:v1:${userId}`;
}

function getAppV2FoundationRemainingCacheKey(userId: string | null): string {
	return userId
		? `app:foundation-remaining:${userId}`
		: "app:foundation-remaining:guest";
}

function readAppV2FoundationRemainingCache(
	userId: string | null,
): number | null {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const rawValue = window.localStorage.getItem(
			getAppV2FoundationRemainingCacheKey(userId),
		);
		if (!rawValue) {
			return null;
		}

		const parsedValue = JSON.parse(rawValue) as {
			remaining?: unknown;
			updatedAt?: unknown;
		};
		const remaining = Number(parsedValue?.remaining);
		const updatedAt = Number(parsedValue?.updatedAt);
		if (!Number.isFinite(remaining) || !Number.isFinite(updatedAt)) {
			return null;
		}

		if (Date.now() - updatedAt > APP_V2_FOUNDATION_REMAINING_CACHE_TTL_MS) {
			return null;
		}

		return Math.max(0, Math.floor(remaining));
	} catch {
		return null;
	}
}

function writeAppV2FoundationRemainingCache(
	userId: string | null,
	remaining: number,
): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(
			getAppV2FoundationRemainingCacheKey(userId),
			JSON.stringify({
				remaining: Math.max(0, Math.floor(remaining)),
				updatedAt: Date.now(),
			}),
		);
	} catch {
		// Ignore local cache write failures.
	}
}

type AppV2AdminOverviewTotals = {
	uniqueVisitorsTotal: number;
	accountsTotal: number;
	deckDownloadsTotal: number;
};

type AppV2AdminOverviewCacheSnapshot = AppV2AdminOverviewTotals & {
	updatedAt: number;
};

function readAppV2AdminOverviewCache(): AppV2AdminOverviewCacheSnapshot | null {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const rawValue = window.localStorage.getItem(APP_V2_ADMIN_OVERVIEW_CACHE_KEY);
		if (!rawValue) {
			return null;
		}

		const parsedValue = JSON.parse(rawValue) as AppV2AdminOverviewCacheSnapshot;
		if (
			typeof parsedValue?.uniqueVisitorsTotal !== "number" ||
			typeof parsedValue?.accountsTotal !== "number" ||
			typeof parsedValue?.deckDownloadsTotal !== "number" ||
			typeof parsedValue?.updatedAt !== "number"
		) {
			return null;
		}

		return {
			uniqueVisitorsTotal: Math.max(
				0,
				Math.floor(parsedValue.uniqueVisitorsTotal),
			),
			accountsTotal: Math.max(0, Math.floor(parsedValue.accountsTotal)),
			deckDownloadsTotal: Math.max(
				0,
				Math.floor(parsedValue.deckDownloadsTotal),
			),
			updatedAt: parsedValue.updatedAt,
		};
	} catch {
		return null;
	}
}

function writeAppV2AdminOverviewCache(
	totals: AppV2AdminOverviewTotals,
): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(
			APP_V2_ADMIN_OVERVIEW_CACHE_KEY,
			JSON.stringify({
				uniqueVisitorsTotal: Math.max(
					0,
					Math.floor(totals.uniqueVisitorsTotal),
				),
				accountsTotal: Math.max(0, Math.floor(totals.accountsTotal)),
				deckDownloadsTotal: Math.max(
					0,
					Math.floor(totals.deckDownloadsTotal),
				),
				updatedAt: Date.now(),
			}),
		);
	} catch {
		// Ignore local cache write failures.
	}
}

function parseNonNegativeInteger(value: unknown, fallback = 0): number {
	const parsedValue =
		typeof value === "number"
			? value
			: typeof value === "string"
				? Number.parseInt(value, 10)
				: Number.NaN;

	if (!Number.isFinite(parsedValue)) {
		return Math.max(0, Math.floor(fallback));
	}

	return Math.max(0, Math.floor(parsedValue));
}

function parseAppV2AdminOverviewResponse(
	value: unknown,
): AppV2AdminOverviewTotals | null {
	const firstRow = Array.isArray(value) ? value[0] : null;
	if (!firstRow || typeof firstRow !== "object") {
		return null;
	}

	const overviewRow = firstRow as Record<string, unknown>;
	return {
		uniqueVisitorsTotal: parseNonNegativeInteger(
			overviewRow.unique_visitors_total,
			0,
		),
		accountsTotal: parseNonNegativeInteger(overviewRow.accounts_total, 0),
		deckDownloadsTotal: parseNonNegativeInteger(
			overviewRow.deck_downloads_total,
			0,
		),
	};
}

function readAppV2HomeMetricsCache(
	userId: string,
): AppV2HomeMetricsSnapshot | null {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const rawValue = window.localStorage.getItem(
			getAppV2HomeMetricsCacheKey(userId),
		);
		if (!rawValue) {
			return null;
		}

		const parsedValue = JSON.parse(rawValue) as AppV2HomeMetricsSnapshot;
		if (
			typeof parsedValue?.weeklyRemainingCount !== "number" ||
			typeof parsedValue?.averageReviewsPerDay !== "number" ||
			typeof parsedValue?.updatedAt !== "number"
		) {
			return null;
		}

		const finishInDays =
			typeof parsedValue.finishInDays === "number"
				? Math.max(0, Math.floor(parsedValue.finishInDays))
				: null;

		return {
			weeklyRemainingCount: Math.max(
				0,
				Math.floor(parsedValue.weeklyRemainingCount),
			),
			averageReviewsPerDay: Math.max(
				0,
				Math.floor(parsedValue.averageReviewsPerDay),
			),
			finishInDays,
			updatedAt: parsedValue.updatedAt,
		};
	} catch {
		return null;
	}
}

function writeAppV2HomeMetricsCache(
	userId: string,
	snapshot: AppV2HomeMetricsSnapshot,
): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(
			getAppV2HomeMetricsCacheKey(userId),
			JSON.stringify(snapshot),
		);
	} catch {
		// Ignore local cache write failures.
	}
}

function AppV2TopNav({ monComptePath }: { monComptePath: string }) {
	const { locale } = useAppLocale();
	const isEnglish = locale === "en";
	const [isOtherMenuOpen, setIsOtherMenuOpen] = useState(false);
	const otherMenuRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!isOtherMenuOpen) {
			return;
		}

		const handleClickOutside = (event: MouseEvent | TouchEvent) => {
			const target = event.target as Node | null;
			if (!target || !otherMenuRef.current) {
				return;
			}

			if (!otherMenuRef.current.contains(target)) {
				setIsOtherMenuOpen(false);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		document.addEventListener("touchstart", handleClickOutside);

		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("touchstart", handleClickOutside);
		};
	}, [isOtherMenuOpen]);

	return (
		<div style={{ ...baseTextStyle, textAlign: "center", marginTop: "8px" }}>
			<Link
				to={APP_V2_BASE_PATH}
				style={plainLinkStyle}
				onClick={(event) => {
					if (
						normalizePathname(window.location.pathname) === APP_V2_BASE_PATH
					) {
						event.preventDefault();
						window.location.reload();
					}
				}}
			>
				{isEnglish ? "home" : "accueil"}
			</Link>
			{" • "}
			<Link
				to={monComptePath}
				style={plainLinkStyle}
				onClick={(event) => {
					if (normalizePathname(window.location.pathname) === monComptePath) {
						event.preventDefault();
						window.location.reload();
					}
				}}
			>
				{isEnglish ? "my account" : "mon compte"}
			</Link>
			{" • "}
			<Link
				to={`${APP_V2_BASE_PATH}/${DOCS_PATH_SEGMENT}`}
				style={plainLinkStyle}
			>
				{isEnglish ? "why 2000 to go?" : "pourquoi 2000 to go ?"}
			</Link>
			{" • "}
			<div
				ref={otherMenuRef}
				style={{ display: "inline-block", position: "relative" }}
			>
				<button
					type="button"
					onClick={() => {
						setIsOtherMenuOpen((previous) => !previous);
					}}
					aria-haspopup="menu"
					aria-expanded={isOtherMenuOpen}
					style={{
						...plainLinkStyle,
						display: "inline",
						cursor: "pointer",
						background: "none",
						border: 0,
						padding: 0,
					}}
				>
					{isEnglish ? "more" : "plus"}
				</button>
				{isOtherMenuOpen ? (
					<div
						role="menu"
						style={{
							position: "absolute",
							right: 0,
							marginTop: "4px",
							padding: "6px 8px",
							border: "1px solid #000000",
							backgroundColor: "#ffffff",
							textAlign: "left",
							whiteSpace: "nowrap",
							zIndex: 30,
						}}
					>
						<p style={{ ...baseTextStyle, margin: 0 }}>
							<Link
								to={`${APP_V2_BASE_PATH}/${KEYBOARD_PATH_SEGMENT}`}
								style={plainLinkStyle}
								onClick={() => {
									setIsOtherMenuOpen(false);
								}}
							>
								{isEnglish ? "online Arabic keyboard" : "clavier arabe en ligne"}
							</Link>{" "}
							<span>({isEnglish ? "beta" : "bêta"})</span>
						</p>
						<p style={{ ...baseTextStyle, margin: "4px 0 0 0" }}>
							<span style={{ color: "#cc0000", fontWeight: 700 }}>New!</span>{" "}
							<Link
								to={`${APP_V2_BASE_PATH}/${IMMERSION_VIDEO_PATH_SEGMENT}`}
								style={plainLinkStyle}
								onClick={() => {
									setIsOtherMenuOpen(false);
								}}
							>
								{isEnglish ? "video immersion ai" : "immersion vidéo ia"}
							</Link>{" "}
							<span>({isEnglish ? "beta" : "bêta"})</span>
						</p>
					</div>
				) : null}
			</div>
		</div>
	);
}

function AppV2ErrorPage() {
	const isEnglish = useIsEnglishApp();
	const navigate = useNavigate();
	const [isRetryHovered, setIsRetryHovered] = useState(false);
	const [isHomeHovered, setIsHomeHovered] = useState(false);

	return (
		<main
			style={{
				fontFamily: "Arial, sans-serif",
				fontSize: "13.3333px",
				backgroundColor: "#ffffff",
				color: "#000000",
				position: "fixed",
				inset: 0,
				overflowY: "auto",
			}}
		>
			<AppV2ToastSuppressionStyle />
			<div
				style={{ maxWidth: "760px", margin: "80px auto 0", padding: "0 16px" }}
			>
				<p style={baseTextStyle}>{isEnglish ? "error" : "erreur"}</p>
				<p style={baseTextStyle}>
					{isEnglish ? "something went wrong." : "une erreur est survenue."}
				</p>
				<p style={{ ...baseTextStyle, marginTop: "10px" }}>
					<button
						type="button"
						onMouseEnter={() => {
							setIsRetryHovered(true);
						}}
						onMouseLeave={() => {
							setIsRetryHovered(false);
						}}
						onClick={() => {
							window.location.reload();
						}}
						style={{
							...appV2ButtonBaseStyle,
							backgroundColor: isRetryHovered ? "#e3e3e3" : "#efefef",
						}}
					>
						{isEnglish ? "retry" : "réessayer"}
					</button>{" "}
					<button
						type="button"
						onMouseEnter={() => {
							setIsHomeHovered(true);
						}}
						onMouseLeave={() => {
							setIsHomeHovered(false);
						}}
						onClick={() => {
							navigate(HOME_V2_PATH);
						}}
						style={{
							...appV2ButtonBaseStyle,
							backgroundColor: isHomeHovered ? "#e3e3e3" : "#efefef",
						}}
					>
						{isEnglish ? "home" : "accueil"}
					</button>
				</p>
			</div>
		</main>
	);
}

function AppV2KeyboardPage() {
	const isEnglish = useIsEnglishApp();
	return (
		<div style={{ textAlign: "left", marginTop: "14px" }}>
			<p style={{ ...baseTextStyle, textAlign: "center" }}>
				{isEnglish ? "online Arabic keyboard (beta)" : "clavier arabe en ligne (bêta)"}
			</p>
			<style>{`
				[data-testid="keyboard-preview-text"] {
					border: 1px solid #000000 !important;
					border-radius: 0 !important;
					background: #ffffff !important;
					padding: 6px !important;
					color: #000000 !important;
					font-family: Arial, sans-serif !important;
					font-size: 14px !important;
					font-weight: 400 !important;
					line-height: 1.35 !important;
				}

				[data-testid="keyboard-preview-content"] {
					font-family: Arial, sans-serif !important;
					font-size: 14px !important;
					font-weight: 400 !important;
				}

				[data-testid="keyboard-placeholder-text"] {
					color: #666666 !important;
					font-family: Arial, sans-serif !important;
					font-size: 14px !important;
					font-weight: 400 !important;
				}

				[data-testid="keyboard-inline-suggestion"] {
					color: #777777 !important;
					font-family: Arial, sans-serif !important;
					font-size: 14px !important;
					font-weight: 400 !important;
				}

				[data-testid="keyboard-copy-action"],
				[data-testid="keyboard-clear-action"],
				[data-testid="keyboard-translate-action"] {
					color: #7a7a7a !important;
				}

				[data-testid="keyboard-copy-action"]:not(:disabled),
				[data-testid="keyboard-clear-action"]:not(:disabled),
				[data-testid="keyboard-translate-action"]:not(:disabled) {
					color: #000000 !important;
				}
			`}</style>
			<div style={{ marginTop: "10px" }}>
				<Suspense fallback={<AppV2SectionLoading />}>
					<LazyKeyboardWithPreviewDemo compactSpacing plainHtmlMode />
				</Suspense>
			</div>
		</div>
	);
}

function AppV2ImmersionVideoPage({
	hasSession,
	userId,
	wordsAcquiredCount,
	wordsAcquiredCountLoading,
}: {
	hasSession: boolean;
	userId: string | null;
	wordsAcquiredCount: number;
	wordsAcquiredCountLoading: boolean;
}) {
	const isEnglish = useIsEnglishApp();
	const [recommendationsLoading, setRecommendationsLoading] = useState(false);
	const [result, setResult] =
		useState<PreviewYoutubeRecommendationsResult | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const { message: inlineMessage, showMessage } = useAppV2InlineMessage();
	const [isRefreshHovered, setIsRefreshHovered] = useState(false);
	const [calculationStatus, setCalculationStatus] = useState<string | null>(
		null,
	);
	const [loadingDotsCount, setLoadingDotsCount] = useState(1);
	const wordsKnownCacheKey = userId
		? `app:words-known-count:${userId}`
		: "app:words-known-count:guest";
	const recommendationsCacheKey = userId
		? `app:immersion-video-recommendations:${userId}`
		: null;
	const [cachedWordsKnownCount, setCachedWordsKnownCount] = useState<number>(
		() => {
			if (typeof window === "undefined") {
				return 0;
			}

			const rawValue = window.localStorage.getItem(
				userId
					? `app:words-known-count:${userId}`
					: "app:words-known-count:guest",
			);
			const parsedValue = rawValue ? Number(rawValue) : Number.NaN;
			return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0;
		},
	);
	const displayedWordsKnownCount =
		wordsAcquiredCountLoading && cachedWordsKnownCount > 0
			? cachedWordsKnownCount
			: wordsAcquiredCount;
	const minimumWordsForSuggestions = 10;
	const hasEnoughWordsForSuggestions =
		displayedWordsKnownCount >= minimumWordsForSuggestions;
	const shouldShowZeroWordsWarning = displayedWordsKnownCount === 0;

	const recommendationCacheIdentity = userId ? `user:${userId}:app` : null;

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const rawValue = window.localStorage.getItem(wordsKnownCacheKey);
		const parsedValue = rawValue ? Number(rawValue) : Number.NaN;
		setCachedWordsKnownCount(
			Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0,
		);
	}, [wordsKnownCacheKey]);

	useEffect(() => {
		if (wordsAcquiredCountLoading || typeof window === "undefined") {
			return;
		}

		setCachedWordsKnownCount(wordsAcquiredCount);
		try {
			window.localStorage.setItem(
				wordsKnownCacheKey,
				String(wordsAcquiredCount),
			);
		} catch {
			// Ignore cache write failures.
		}
	}, [wordsAcquiredCountLoading, wordsAcquiredCount, wordsKnownCacheKey]);

	useEffect(() => {
		if (!recommendationsCacheKey || typeof window === "undefined") {
			return;
		}

		const cachedValue = window.localStorage.getItem(recommendationsCacheKey);
		if (!cachedValue) {
			return;
		}

		try {
			const parsedValue = JSON.parse(
				cachedValue,
			) as PreviewYoutubeRecommendationsResult;
			if (parsedValue && Array.isArray(parsedValue.recommendations)) {
				setResult(parsedValue);
			}
		} catch {
			// Ignore malformed cache payloads.
		}
	}, [recommendationsCacheKey]);

	useEffect(() => {
		if (!recommendationsLoading) {
			setLoadingDotsCount(1);
			return;
		}

		const intervalId = window.setInterval(() => {
			setLoadingDotsCount((previous) => (previous >= 3 ? 1 : previous + 1));
		}, 320);

		return () => {
			window.clearInterval(intervalId);
		};
	}, [recommendationsLoading]);

	const loadRecommendations = useCallback(
		async (forceRefresh = false) => {
			if (!hasSession) {
				showMessage(
					isEnglish
						? "Sign in to generate video immersion suggestions."
						: "Connecte-toi pour calculer des suggestions d'immersion vidéo.",
				);
				return;
			}

			setRecommendationsLoading(true);
			setErrorMessage(null);
			setCalculationStatus(
				isEnglish
					? "Gathering all the vocabulary words you have learned..."
					: "Regroupement de tous tes mots de vocabulaire appris...",
			);
			try {
				const [
					{ fetchDueCardsByReviewTypes },
					{ fetchPreviewYoutubeRecommendations },
				] = await Promise.all([
					import("@/services/deckPersoDueReviewService"),
					import("@/features/preview-new-concept/services"),
				]);

				const cardsResponse = await fetchDueCardsByReviewTypes([
					"foundation",
					"collected",
					"sent",
				]);

				if (!cardsResponse.ok) {
					throw new Error(
						isEnglish
							? "Unable to load source cards."
							: "Impossible de charger les cartes source.",
					);
				}

				const seedWords = Array.from(
					new Set(
						cardsResponse.data
							.map((card: PreviewReviewCard) => card.vocabBase.trim())
							.filter((word) => word.length > 0),
					),
				);

				setCalculationStatus(
					isEnglish
						? "Generating search terms from your vocabulary..."
						: "Génération des termes de recherche basés sur ton vocabulaire...",
				);

				setCalculationStatus(
					isEnglish
						? "Analyzing the most relevant videos..."
						: "Analyse des meilleures vidéos pertinentes...",
				);
				const data = await fetchPreviewYoutubeRecommendations(
					seedWords,
					wordsAcquiredCount,
					3,
					{
						cacheIdentity: recommendationCacheIdentity,
						forceRefresh,
					},
				);
				setCalculationStatus(
					isEnglish
						? "Finalizing your immersion suggestions..."
						: "Finalisation de tes suggestions d'immersion...",
				);
				setResult(data);
				if (recommendationsCacheKey && typeof window !== "undefined") {
					try {
						window.localStorage.setItem(
							recommendationsCacheKey,
							JSON.stringify(data),
						);
					} catch {
						// Ignore cache write failures.
					}
				}
				showMessage(
					isEnglish
						? "Video suggestions updated."
						: "Suggestions vidéo mises à jour.",
				);
			} catch (error) {
				const nextMessage =
					error instanceof Error && error.message.trim().length > 0
						? error.message
						: isEnglish
							? "Unable to generate video suggestions."
							: "Impossible de calculer les suggestions vidéo.";
				setErrorMessage(nextMessage);
				showMessage(nextMessage);
			} finally {
				setRecommendationsLoading(false);
				setCalculationStatus(null);
			}
		},
		[
			hasSession,
			isEnglish,
			recommendationCacheIdentity,
			recommendationsCacheKey,
			showMessage,
			wordsAcquiredCount,
		],
	);

	return (
		<div style={{ textAlign: "left", marginTop: "14px" }}>
			<p style={baseTextStyle}>
				<span style={{ color: "#cc0000", fontWeight: 700 }}>New!</span>{" "}
				{isEnglish ? "video immersion ai (beta)" : "immersion vidéo ia (bêta)"}
			</p>

			<div
				style={{
					marginTop: "10px",
					padding: "10px",
					backgroundColor: "#efefef",
					border: "1px solid #d6d6d6",
				}}
			>
				<p style={baseTextStyle}>
					{isEnglish ? "words known to date" : "mots connus à ce jour"}: {displayedWordsKnownCount}
				</p>

				{shouldShowZeroWordsWarning ? (
					<p
						style={{
							...baseTextStyle,
							marginTop: "8px",
							marginBottom: 0,
							color: "#c61b1b",
						}}
					>
						{isEnglish
							? "0 words yet. Go learn at least 10 words to get personalized video suggestions."
							: "0 mot pour l'instant. Apprends au moins 10 mots pour obtenir des suggestions vidéo personnalisées."}
					</p>
				) : null}

				<p style={{ ...baseTextStyle, marginTop: "8px" }}>
					<button
						type="button"
						onMouseEnter={() => {
							setIsRefreshHovered(true);
						}}
						onMouseLeave={() => {
							setIsRefreshHovered(false);
						}}
						onClick={() => {
							void loadRecommendations(true);
						}}
						disabled={
							!hasSession || recommendationsLoading || !hasEnoughWordsForSuggestions
						}
						style={{
							...appV2ButtonBaseStyle,
							backgroundColor: isRefreshHovered ? "#e3e3e3" : "#efefef",
							opacity: hasEnoughWordsForSuggestions ? 1 : 0.5,
						}}
					>
						{recommendationsLoading
							? `${isEnglish ? "calculating" : "calcul"}${".".repeat(loadingDotsCount)}`
							: isEnglish
								? "generate suggestions"
								: "calculer les suggestions"}
					</button>
				</p>

				{calculationStatus ? (
					<p style={{ ...baseTextStyle, marginTop: "6px", marginBottom: 0 }}>
						{calculationStatus}
					</p>
				) : null}

				{inlineMessage ? (
					<p style={{ ...baseTextStyle, marginTop: "6px", marginBottom: 0 }}>
						{inlineMessage}
					</p>
				) : null}

				{!hasSession ? (
					<p style={{ ...baseTextStyle, marginTop: "8px" }}>
						{isEnglish
							? "sign in to unlock video suggestion generation."
							: "connecte-toi pour débloquer le calcul des suggestions vidéo."}
					</p>
				) : null}

				{errorMessage ? (
					<p style={{ ...baseTextStyle, marginTop: "8px" }}>{errorMessage}</p>
				) : null}

				{result?.isLocked ? null : null}

				{result && !result.isLocked && result.recommendations.length > 0 ? (
					<ul
						style={{ ...baseTextStyle, marginTop: "8px", paddingLeft: "18px" }}
					>
						{result.recommendations.map((recommendation) => (
							<li key={recommendation.id} style={{ marginBottom: "10px" }}>
								<a
									href={recommendation.videoUrl}
									target="_blank"
									rel="noopener noreferrer"
									style={plainLinkStyle}
								>
									{recommendation.title}
								</a>
								<div style={baseTextStyle}>
									{recommendation.channelTitle} • {recommendation.durationLabel}{" "}
									• {isEnglish ? "comprehension" : "compréhension"}{" "}
									{recommendation.comprehensionPercentage ?? "--"}
									{recommendation.comprehensionPercentage !== null ? "%" : ""}
								</div>
								{recommendation.summaryFr ? (
									<div style={{ ...baseTextStyle, marginTop: "2px" }}>
										{recommendation.summaryFr}
									</div>
								) : null}
							</li>
						))}
					</ul>
				) : null}
			</div>

			<p
				style={{
					...baseTextStyle,
					marginTop: "8px",
					fontSize: "13.333px",
					color: "#777777",
					fontStyle: "italic",
				}}
			>
				{isEnglish
					? "tip: the very own vocabulary you know unlocks matching youtube content using ai-powered data matching, so you get the most efficient immersive content."
					: "astuce : interroge des vidéos youtube et calcule le pourcentage de vocabulaire d'une vidéo qui recoupe tes mots connus. résultats : regarde des vidéos que tu comprends vraiment. tes mots débloquent les bonnes vidéos youtube. zéro temps perdu sur du contenu trop dur."}
			</p>
		</div>
	);
}

function AppV2ProfilePage({
	username,
	onSignOut,
}: {
	username: string;
	onSignOut: () => void;
}) {
	const isEnglish = useIsEnglishApp();
	const { user } = useAuth();
	const normalizedUsername = username.trim().toLowerCase();
	const targetUserId =
		normalizedUsername === OWN_APP_V2_PROFILE_SEGMENT ? user?.id : undefined;
	const { profile, loading, error, isOwnProfile, updateProfile } =
		useProfile(targetUserId ? undefined : username, targetUserId);
	const [isEditingBio, setIsEditingBio] = useState(false);
	const [bioInput, setBioInput] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [isEditButtonHovered, setIsEditButtonHovered] = useState(false);
	const [isSignOutHovered, setIsSignOutHovered] = useState(false);
	const [bankGridData, setBankGridData] = useState<VocabGridData | null>(null);
	const [isBankGridLoading, setIsBankGridLoading] = useState(false);
	const [bankGridError, setBankGridError] = useState<string | null>(null);
	const [profileAudioRecordedCount, setProfileAudioRecordedCount] = useState(0);
	const [profileLastActivityAt, setProfileLastActivityAt] = useState<string | null>(
		null,
	);
	const [cachedProfile, setCachedProfile] = useState<UserProfile | null>(() =>
		readAppV2ProfileCache(getAppV2ProfileCacheByUsernameKey(username)),
	);
	const { message: bioInlineMessage, showMessage: showBioInlineMessage } =
		useAppV2InlineMessage();

	useEffect(() => {
		setCachedProfile(
			readAppV2ProfileCache(getAppV2ProfileCacheByUsernameKey(username)),
		);
	}, [username]);

	useEffect(() => {
		if (!profile) {
			return;
		}

		setCachedProfile(profile);
		writeAppV2ProfileCache(profile);
	}, [profile]);

	const displayedProfile = profile ?? cachedProfile;
	const isOwnDisplayedProfile =
		isOwnProfile ||
		(Boolean(user?.id) && displayedProfile?.user_id === user?.id);

	useEffect(() => {
		setBioInput(displayedProfile?.bio ?? "");
	}, [displayedProfile?.bio]);

	useEffect(() => {
		let cancelled = false;
		const userId = displayedProfile?.user_id;

		if (!userId) {
			setProfileAudioRecordedCount(0);
			setProfileLastActivityAt(null);
			return () => {
				cancelled = true;
			};
		}

		void (async () => {
			try {
				const summary = await getProfileSocialSummary(userId);
				if (cancelled) {
					return;
				}

				setProfileAudioRecordedCount(summary.audioRecordedCount);
				setProfileLastActivityAt(summary.lastActivityAt);
			} catch (summaryError) {
				if (cancelled) {
					return;
				}

				console.error("Error loading profile social summary:", summaryError);
				setProfileAudioRecordedCount(0);
				setProfileLastActivityAt(null);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [displayedProfile?.user_id]);

	useEffect(() => {
		if (!isOwnDisplayedProfile || !user?.id) {
			setBankGridData(null);
			setBankGridError(null);
			setIsBankGridLoading(false);
			return;
		}

		let cancelled = false;
		const cachedGridData = readAppV2AccountBankCache(user.id);
		if (cachedGridData) {
			setBankGridData(cachedGridData);
			setBankGridError(null);
		}

		const loadBankGridData = async () => {
			setIsBankGridLoading(!cachedGridData);
			setBankGridError(null);

			try {
				const { searchAppVocabularyBank } = await import(
					"@/services/appVocabularySearchService"
				);
				const allRows: SearchCardsV2Row[] = [];
				let offset = 0;

				for (
					let pageIndex = 0;
					pageIndex < APP_V2_ACCOUNT_BANK_MAX_FETCH_PAGES;
					pageIndex += 1
				) {
					const result = await searchAppVocabularyBank(
						"",
						APP_V2_ACCOUNT_BANK_SEARCH_LIMIT,
						APP_V2_ACCOUNT_BANK_SOURCE_TYPES,
						offset,
					);

					if (!result.ok) {
						throw new Error(result.error.message);
					}

					const pageRows = Array.isArray(result.data) ? result.data : [];
					// Include all cards: new (unseen) cards appear as white tiles in the grid.
					allRows.push(...pageRows);

					if (pageIndex === 0 && pageRows.length > 0 && !cancelled) {
						setBankGridData(toAppV2AccountBankGridData(allRows));
					}

					if (pageRows.length < APP_V2_ACCOUNT_BANK_SEARCH_LIMIT) {
						break;
					}

					offset += pageRows.length;
				}

				if (cancelled) {
					return;
				}

				const nextGridData = toAppV2AccountBankGridData(allRows);
				setBankGridData(nextGridData);
				writeAppV2AccountBankCache(user.id, nextGridData);
			} catch (loadError) {
				if (cancelled) {
					return;
				}

				console.error("Error loading app-v2 account bank grid:", loadError);
				if (!cachedGridData) {
					setBankGridData(null);
					setBankGridError(
						isEnglish
							? "Unable to load your vocabulary bank."
							: "Impossible de charger ta banque de vocabulaire.",
					);
				}
			} finally {
				if (!cancelled) {
					setIsBankGridLoading(false);
				}
			}
		};

		void loadBankGridData();

		return () => {
			cancelled = true;
		};
	}, [isEnglish, isOwnDisplayedProfile, user?.id]);

	const displayName = resolveProfileDisplayName(displayedProfile);
	const usernameValue = displayedProfile?.username?.trim() || "";
	const isBankGridEmpty =
		!isBankGridLoading &&
		!bankGridError &&
		Boolean(bankGridData) &&
		(bankGridData?.units?.length ?? 0) === 0;
	const countryValue = displayedProfile?.location?.trim() || "";
	const rawProfileBio = displayedProfile?.bio?.trim() || "";
	const displayedProfileBio = rawProfileBio.length > 0 ? rawProfileBio : "...";
	const lastActivityLabel = formatLastActivityLabel(profileLastActivityAt, isEnglish);
	const profileAudioRecordedLabel = isEnglish
		? `total audios recorded : ${profileAudioRecordedCount}`
		: `total des audios enregistrés : ${profileAudioRecordedCount}`;
	const profileLastActivityLabel =
		lastActivityLabel ?? (isEnglish ? "unknown" : "inconnue");
	const bioTextareaRef = usePretextAutoResize(
		bioInput,
		APP_V2_PRETEXT_BODY_FONT,
		APP_V2_PRETEXT_BODY_LINE_HEIGHT_PX,
		8,
		80,
		260,
		{ blockId: "app-v2-profile:bio-textarea" },
	);

	const handleSaveBio = useCallback(async () => {
		if (!isOwnDisplayedProfile) {
			showBioInlineMessage(
				isEnglish
					? "You can only edit your own bio."
					: "Tu peux modifier uniquement ta propre bio.",
			);
			return;
		}

		setIsSaving(true);
		try {
			await updateProfile({ bio: bioInput });
			setIsEditingBio(false);
			showBioInlineMessage(isEnglish ? "Bio updated." : "Bio mise à jour.");
		} catch (saveError) {
			console.error("Error saving app-v2 bio:", saveError);
			showBioInlineMessage(
				isEnglish
					? "Unable to update the bio."
					: "Impossible de mettre à jour la bio.",
			);
		} finally {
			setIsSaving(false);
		}
	}, [bioInput, isEnglish, isOwnDisplayedProfile, showBioInlineMessage, updateProfile]);

	if (loading && !displayedProfile) {
		return <p style={baseTextStyle}>{isEnglish ? "loading account..." : "chargement du compte..."}</p>;
	}

	if (error && !displayedProfile) {
		return (
			<p style={baseTextStyle}>
				{error && error.trim().length > 0
					? error
					: isEnglish
						? "account not available right now."
						: "compte introuvable pour le moment."}
			</p>
		);
	}

	if (!displayedProfile) {
		return <p style={baseTextStyle}>{isEnglish ? "account not available right now." : "compte introuvable pour le moment."}</p>;
	}

	return (
		<div style={{ textAlign: "left", marginTop: "14px" }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: "12px",
				}}
			>
				{isOwnDisplayedProfile ? (
					<p style={{ ...baseTextStyle, margin: 0 }}>{isEnglish ? "my account" : "mon compte"}</p>
				) : (
					<Link to={`${APP_V2_BASE_PATH}/contacts`} style={plainLinkStyle}>
						{isEnglish ? "← back to my contacts" : "← retour à mes contacts"}
					</Link>
				)}
				{isOwnDisplayedProfile ? (
					<div style={{ ...baseTextStyle, textAlign: "right" }}>
						<Link to={`${APP_V2_BASE_PATH}/contacts`} style={plainLinkStyle}>
							{isEnglish ? "my contacts" : "mes contacts"}
						</Link>
						{" • "}
						<Link to={`${APP_V2_BASE_PATH}/settings`} style={plainLinkStyle}>
							{isEnglish ? "settings" : "paramètres"}
						</Link>
						{" • "}
						<button
							type="button"
							onMouseEnter={() => {
								setIsSignOutHovered(true);
							}}
							onMouseLeave={() => {
								setIsSignOutHovered(false);
							}}
							onClick={onSignOut}
							style={{
								...baseTextStyle,
								color: "#000000",
								textDecoration: "underline",
								background: "none",
								border: 0,
								padding: 0,
								cursor: "pointer",
								opacity: isSignOutHovered ? 0.8 : 1,
							}}
						>
							{isEnglish ? "sign out" : "déconnexion"}
						</button>
					</div>
				) : null}
			</div>

			<div
				style={{
					marginTop: "10px",
					padding: "10px",
					backgroundColor: "#efefef",
					border: "1px solid #d6d6d6",
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "flex-start",
						gap: "6px",
					}}
				>
					{displayedProfile.avatar_url ? (
						<img
							src={displayedProfile.avatar_url}
							alt={displayName}
							style={{
								width: "88px",
								height: "88px",
								borderRadius: 0,
								objectFit: "cover",
							}}
						/>
					) : (
						<div
							aria-hidden="true"
							style={{
								width: "88px",
								height: "88px",
								borderRadius: 0,
								backgroundColor: "#d9d9d9",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								...baseTextStyle,
							}}
						>
							{displayName.slice(0, 1).toUpperCase()}
						</div>
					)}

					<div style={{ marginTop: "2px" }}>
						<p style={{ ...baseTextStyle, margin: 0, lineHeight: 1.15 }}>
							{displayName}
						</p>
						{usernameValue ? (
							<p style={{ ...baseTextStyle, margin: 0, lineHeight: 1.15 }}>
								@{usernameValue}
							</p>
						) : null}
						<p
							style={{
								...baseTextStyle,
								margin: "10px 0 0 0",
								lineHeight: 1.15,
							}}
						>
							{profileAudioRecordedLabel}
						</p>
						<p style={{ ...baseTextStyle, margin: 0, lineHeight: 1.15 }}>
							{isEnglish ? "last activity:" : "dernière activité :"}{" "}
							{profileLastActivityLabel}
						</p>
						{countryValue.length > 0 ? (
							<p style={{ ...baseTextStyle, margin: 0, lineHeight: 1.15 }}>
								{countryValue}
							</p>
						) : null}
					</div>
				</div>
			</div>

			<div
				style={{
					marginTop: "10px",
					padding: "10px",
					backgroundColor: "#efefef",
					border: "1px solid #d6d6d6",
				}}
			>
				<p style={{ ...baseTextStyle, marginBottom: 0 }}>{isEnglish ? "bio:" : "bio :"}</p>
				{isEditingBio ? (
					<div>
						<textarea
							ref={bioTextareaRef}
							value={bioInput}
							onChange={(event) => {
								setBioInput(event.target.value);
							}}
							rows={4}
							style={{
								...baseTextStyle,
								width: "100%",
								maxWidth: "520px",
								padding: "4px 6px",
								border: "1px solid #000000",
								backgroundColor: "#ffffff",
								lineHeight: `${APP_V2_PRETEXT_BODY_LINE_HEIGHT_PX}px`,
								resize: "vertical",
							}}
						/>
						<div style={{ marginTop: "8px" }}>
							<button
								type="button"
								onClick={() => {
									void handleSaveBio();
								}}
								disabled={isSaving}
								style={{
									...appV2ButtonBaseStyle,
									backgroundColor: "#efefef",
								}}
							>
								{isSaving
									? isEnglish
										? "saving..."
										: "enregistrement..."
									: isEnglish
										? "save"
										: "enregistrer"}
							</button>{" "}
							<button
								type="button"
								onClick={() => {
									setIsEditingBio(false);
									setBioInput(displayedProfile.bio ?? "");
								}}
								style={{
									...appV2ButtonBaseStyle,
									backgroundColor: "#efefef",
								}}
							>
								{isEnglish ? "cancel" : "annuler"}
							</button>
						</div>
					</div>
				) : (
					<>
						<p style={{ ...baseTextStyle, marginTop: 0 }}>
							{displayedProfileBio}
						</p>
						{isOwnDisplayedProfile ? (
							<p style={{ marginTop: "8px" }}>
								<button
									type="button"
									onMouseEnter={() => {
										setIsEditButtonHovered(true);
									}}
									onMouseLeave={() => {
										setIsEditButtonHovered(false);
									}}
									onClick={() => {
										setIsEditingBio(true);
									}}
									style={{
										...appV2ButtonBaseStyle,
										backgroundColor: isEditButtonHovered
											? "#e3e3e3"
											: "#efefef",
									}}
								>
								{isEnglish ? "edit my bio" : "modifier ma bio"}
								</button>
							</p>
						) : null}
					</>
				)}
				{bioInlineMessage ? (
					<p style={{ ...baseTextStyle, marginTop: "6px", marginBottom: 0 }}>
						{bioInlineMessage}
					</p>
				) : null}
			</div>

			{isOwnDisplayedProfile ? (
				<>
					<div
					style={{
						marginTop: "10px",
						marginBottom: "18px",
						padding: "10px 10px 12px 10px",
						backgroundColor: "#efefef",
						border: "1px solid #d6d6d6",
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "flex-end",
							gap: "6px",
							...baseTextStyle,
						}}
					>
						<span style={{ whiteSpace: "nowrap" }}>{isEnglish ? "Not mastered" : "Non maîtrisé"}</span>
						<div
							style={{
								width: "120px",
								height: "10px",
								background: APP_V2_ACCOUNT_BANK_LEGEND_GRADIENT,
							}}
						/>
						<span style={{ whiteSpace: "nowrap" }}>{isEnglish ? "Mastered" : "Maîtrisé"}</span>
					</div>

					<div style={{ marginTop: "8px", width: "100%" }}>
						{isBankGridLoading && !bankGridData ? (
							<p style={{ ...baseTextStyle, margin: "0 0 6px 0" }}>
								{isEnglish ? "loading vocabulary..." : "chargement du vocabulaire..."}
							</p>
						) : null}
						{isBankGridEmpty ? (
							<div style={{ textAlign: "center" }}>
								<p style={{ ...baseTextStyle, margin: "0 0 6px 0", color: "#7a7a7a" }}>
									{isEnglish ? (
										<>
											your bank of vocabulary is empty.
											<br />
											start reviewing cards to fill it.
										</>
									) : (
										"ta banque de vocabulaire est vide."
									)}
								</p>
							</div>
						) : null}
						<Suspense fallback={<AppV2SectionLoading />}>
							<LazyVocabGrid
								data={bankGridData}
								loading={false}
								error={bankGridError}
								groupings={[]}
								searchQuery=""
								categoryFilter={null}
								maxRows={4}
								gridOnly
								gridJustify="start"
							/>
						</Suspense>
					</div>
					</div>
					<div style={{ display: "flex", justifyContent: "flex-end", marginTop: "-10px", marginBottom: "18px" }}>
						<Link
							to="/feedback"
							style={{
								...baseTextStyle,
								fontSize: "13px",
								color: "#000000",
								textDecoration: "underline",
								display: "inline-block",
							}}
						>
							bug report/feedback
						</Link>
					</div>
				</>
			) : null}
		</div>
	);
}

function AppV2SettingsPage({ monComptePath }: { monComptePath: string }) {
	const isEnglish = useIsEnglishApp();
	const { locale, setLocale } = useAppLocale();
	const navigate = useNavigate();
	const { user, signOut } = useAuth();
	const { profile, loading, updateName, changeUsername, updateProfile } = useProfile(
		undefined,
		user?.id,
	);
	const [firstName, setFirstName] = useState("");
	const [usernameInput, setUsernameInput] = useState("");
	const [usernameInlineMessage, setUsernameInlineMessage] = useState<string | null>(
		null,
	);
	const [isUsernameInlineMessageError, setIsUsernameInlineMessageError] =
		useState(false);
	const [isChangingUsername, setIsChangingUsername] = useState(false);
	const [selectedCountry, setSelectedCountry] = useState("");
	const [selectedLocale, setSelectedLocale] = useState<"fr" | "en">(locale);
	const [newCardsPerDay, setNewCardsPerDay] = useState(
		PROFILE_NEW_CARDS_PER_DAY_DEFAULT,
	);
	const [pendingAvatarBlob, setPendingAvatarBlob] = useState<Blob | null>(null);
	const [pendingAvatarPreviewUrl, setPendingAvatarPreviewUrl] = useState<string | null>(
		null,
	);
	const [pendingAvatarFilename, setPendingAvatarFilename] = useState<string | null>(
		null,
	);
	const [avatarInlineMessage, setAvatarInlineMessage] = useState<string | null>(null);
	const [reviewReminderEmailEnabled, setReviewReminderEmailEnabled] =
		useState(false);
	const [isSavingProfile, setIsSavingProfile] = useState(false);
	const [isSaveButtonHovered, setIsSaveButtonHovered] = useState(false);
	const [isDeleteButtonHovered, setIsDeleteButtonHovered] = useState(false);
	const [isDeletingAccount, setIsDeletingAccount] = useState(false);
	const [deleteAccountInlineMessage, setDeleteAccountInlineMessage] = useState<string | null>(
		null,
	);
	const {
		message: profileInlineMessage,
		showMessage: showProfileInlineMessage,
	} = useAppV2InlineMessage();
	const reviewReminderEmailCacheKey = user?.id
		? `app:review-reminder-email-enabled:${user.id}`
		: null;

	useEffect(() => {
		if (!profile) {
			return;
		}

		const savedLocationValue =
			typeof profile.location === "string" ? profile.location.trim() : "";

		setFirstName(profile.first_name ?? "");
		setUsernameInput(profile.username ?? "");
		setSelectedCountry(
			isSupportedProfileCountry(savedLocationValue) ? savedLocationValue : "",
		);
		setNewCardsPerDay(
			clampProfileNewCardsPerDay(
				profile.new_cards_per_day ?? PROFILE_NEW_CARDS_PER_DAY_DEFAULT,
			),
		);
	}, [profile]);

	useEffect(() => {
		return () => {
			if (pendingAvatarPreviewUrl) {
				URL.revokeObjectURL(pendingAvatarPreviewUrl);
			}
		};
	}, [pendingAvatarPreviewUrl]);

	useEffect(() => {
		setSelectedLocale(locale);
	}, [locale]);

	useEffect(() => {
		if (!reviewReminderEmailCacheKey) {
			setReviewReminderEmailEnabled(Boolean(profile?.notifications_email));
			return;
		}

		try {
			const cachedValue = window.localStorage.getItem(
				reviewReminderEmailCacheKey,
			);
			setReviewReminderEmailEnabled(
				resolveReviewReminderEmailEnabled(
					cachedValue,
					profile?.notifications_email,
				),
			);
			return;
		} catch {
			// Ignore localStorage read errors and keep safe default (non).
		}

		setReviewReminderEmailEnabled(
			resolveReviewReminderEmailEnabled(null, profile?.notifications_email),
		);
	}, [profile?.notifications_email, reviewReminderEmailCacheKey]);

	const canChangeUsername = (profile?.username_change_count ?? 0) < 1;

	const handleAvatarFileSelected = useCallback(
		async (event: ChangeEvent<HTMLInputElement>) => {
			const selectedFile = event.target.files?.[0];
			event.target.value = "";

			if (!selectedFile) {
				return;
			}

			if (!selectedFile.type.startsWith("image/")) {
				setAvatarInlineMessage(
					isEnglish
						? "Select an image file (jpg, png, webp)."
						: "Sélectionne une image (jpg, png, webp).",
				);
				return;
			}

			try {
				const compressedBlob = await compressSettingsAvatarImage(selectedFile);

				if (pendingAvatarPreviewUrl) {
					URL.revokeObjectURL(pendingAvatarPreviewUrl);
				}

				const previewUrl = URL.createObjectURL(compressedBlob);
				setPendingAvatarBlob(compressedBlob);
				setPendingAvatarPreviewUrl(previewUrl);
				setPendingAvatarFilename(selectedFile.name);
				setAvatarInlineMessage(
					isEnglish
						? "Avatar ready. Save settings to apply it."
						: "Avatar prêt. Enregistre les paramètres pour l'appliquer.",
				);
			} catch (compressionError) {
				const message =
					compressionError instanceof Error ? compressionError.message : "avatar-error";
				if (message === "avatar-too-large") {
					setAvatarInlineMessage(
						isEnglish
							? "Avatar must be less than 1 MB."
							: "L'avatar doit faire moins de 1 Mo.",
					);
				} else {
					setAvatarInlineMessage(
						isEnglish
							? "Could not process this image. Try another one."
							: "Impossible de traiter cette image. Essaie-en une autre.",
					);
				}
			}
		},
		[isEnglish, pendingAvatarPreviewUrl],
	);

	const handleChangeUsername = useCallback(async () => {
		if (!canChangeUsername) {
			setIsUsernameInlineMessageError(true);
			setUsernameInlineMessage(
				isEnglish
					? "You can only change your username once."
					: "Tu peux changer ton username une seule fois.",
			);
			return;
		}

		const candidate = usernameInput.trim().toLowerCase();
		const currentUsername = profile?.username?.trim().toLowerCase() ?? "";

		if (candidate === currentUsername) {
			setIsUsernameInlineMessageError(true);
			setUsernameInlineMessage(
				isEnglish
					? "first make an actual change to your username"
					: "fais d'abord un vrai changement de username",
			);
			return;
		}

		if (!candidate) {
			setIsUsernameInlineMessageError(true);
			setUsernameInlineMessage(
				isEnglish
					? "Username is required."
					: "Le username est requis.",
			);
			return;
		}

		if (!/^[a-z0-9_](?:[a-z0-9_-]{1,30}[a-z0-9_])?$/.test(candidate)) {
			setIsUsernameInlineMessageError(true);
			setUsernameInlineMessage(
				isEnglish
					? "Use 3-32 chars: lowercase letters, numbers, dash or underscore."
					: "Utilise 3-32 caractères: minuscules, chiffres, tiret ou underscore.",
			);
			return;
		}

		const shouldProceed = window.confirm(
			isEnglish
				? "are you sure you want to change your username? this is definitive and you will not be able to change it later. you can do it only once."
				: "es-tu sûr de vouloir changer ton username ? c'est définitif et tu ne pourras plus le changer plus tard. tu ne peux le faire qu'une seule fois.",
		);

		if (!shouldProceed) {
			return;
		}

		setIsChangingUsername(true);
		setUsernameInlineMessage(null);
		try {
			await changeUsername(candidate);
			setIsUsernameInlineMessageError(false);
			setUsernameInlineMessage(
				isEnglish
					? "Username updated. It is now locked."
					: "Username mis à jour. Il est maintenant verrouillé.",
			);
		} catch (changeError) {
			const rawMessage =
				changeError instanceof Error ? changeError.message.toLowerCase() : "";
			if (rawMessage.includes("taken") || rawMessage.includes("duplicate")) {
				setIsUsernameInlineMessageError(true);
				setUsernameInlineMessage(
					isEnglish
						? "This username is already taken. Choose another one."
						: "Ce username est déjà pris. Choisis-en un autre.",
				);
			} else if (rawMessage.includes("only be changed once")) {
				setIsUsernameInlineMessageError(true);
				setUsernameInlineMessage(
					isEnglish
						? "You can only change your username once."
						: "Tu peux changer ton username une seule fois.",
				);
			} else {
				setIsUsernameInlineMessageError(true);
				setUsernameInlineMessage(
					isEnglish
						? "Unable to change username right now."
						: "Impossible de changer le username pour le moment.",
				);
			}
		} finally {
			setIsChangingUsername(false);
		}
	}, [canChangeUsername, changeUsername, isEnglish, profile?.username, usernameInput]);

	const handleSaveProfile = useCallback(async () => {
		if (!user?.id) {
			showProfileInlineMessage(
				isEnglish
					? "Sign in to save your settings."
					: "Connecte-toi pour enregistrer tes paramètres.",
			);
			return;
		}

		setIsSavingProfile(true);
		try {
			const { updateReviewReminderPreferences } = await import(
				"@/services/reviewRemindersService"
			);
			const reminderEmailEnabled = reviewReminderEmailEnabled;
			let reminderSyncFailed = false;
			let nextAvatarUrl: string | undefined;

			if (pendingAvatarBlob) {
				const avatarPath = `${user.id}/avatar-${Date.now()}.webp`;
				const { error: uploadError } = await supabase.storage
					.from("profile-avatars")
					.upload(avatarPath, pendingAvatarBlob, {
						contentType: "image/webp",
						upsert: true,
						cacheControl: "3600",
					});

				if (uploadError) {
					throw uploadError;
				}

				const { data: publicUrlData } = supabase.storage
					.from("profile-avatars")
					.getPublicUrl(avatarPath);

				nextAvatarUrl = publicUrlData.publicUrl;
			}

			const [nameResult, profileResult, reminderResult] = await Promise.all([
				updateName(firstName.trim(), ""),
				updateProfile({
					location: selectedCountry || undefined,
					new_cards_per_day: clampProfileNewCardsPerDay(newCardsPerDay),
					avatar_url: nextAvatarUrl,
				}),
				supabase.rpc("upsert_my_profile_v1", {
					p_email_notifications_enabled: reminderEmailEnabled,
				}),
			]);

			void nameResult;
			void profileResult;

			if (reminderResult.error) {
				throw reminderResult.error;
			}

			const reminderPreferencesResult = await updateReviewReminderPreferences(
				{
					enabled: reminderEmailEnabled,
					email_enabled: reminderEmailEnabled,
				},
				{ userId: user.id },
			);

			if (!reminderPreferencesResult.ok) {
				reminderSyncFailed = true;
				if (reminderPreferencesResult.error.code === "NOT_AUTHENTICATED") {
					console.warn(
						"Review reminder preferences were saved locally but edge sync requires a fresh session.",
					);
				} else {
					console.error(
						"Unable to sync review reminder preferences:",
						reminderPreferencesResult.error,
					);
				}
			}

			if (reviewReminderEmailCacheKey) {
				try {
					window.localStorage.setItem(
						reviewReminderEmailCacheKey,
						reminderEmailEnabled ? "1" : "0",
					);
				} catch {
					// Ignore localStorage write errors.
				}
			}

			setLocale(selectedLocale);

			if (pendingAvatarPreviewUrl) {
				URL.revokeObjectURL(pendingAvatarPreviewUrl);
			}
			setPendingAvatarBlob(null);
			setPendingAvatarPreviewUrl(null);
			setPendingAvatarFilename(null);
			setAvatarInlineMessage(null);

			showProfileInlineMessage(
				reminderSyncFailed
					? isEnglish
						? "Settings saved. Reminder sync will retry shortly."
						: "Paramètres enregistrés. La synchro des rappels va réessayer bientôt."
					: isEnglish
						? "Settings saved."
						: "Paramètres enregistrés.",
			);
		} catch (saveError) {
			console.error("Error saving app-v2 settings:", saveError);
			showProfileInlineMessage(
				isEnglish
					? "Unable to save settings."
					: "Impossible d'enregistrer les paramètres.",
			);
		} finally {
			setIsSavingProfile(false);
		}
	}, [
		firstName,
		isEnglish,
		newCardsPerDay,
		pendingAvatarBlob,
		pendingAvatarPreviewUrl,
		selectedLocale,
		selectedCountry,
		reviewReminderEmailCacheKey,
		reviewReminderEmailEnabled,
		setLocale,
		showProfileInlineMessage,
		updateName,
		updateProfile,
		user?.id,
	]);

	const handleDeleteAccount = useCallback(async () => {
		if (!user?.id || isDeletingAccount) {
			return;
		}

		const shouldDelete = window.confirm(
			isEnglish
				? "Are you sure you want to delete your account? This is definitive and permanent, and you will lose all your progression."
				: "Es-tu sûr de vouloir supprimer ton compte ? C'est définitif et permanent, et tu perdras toute ta progression.",
		);

		if (!shouldDelete) {
			return;
		}

		setIsDeletingAccount(true);
		setDeleteAccountInlineMessage(null);

		try {
			const { error: deleteError } = await supabase.rpc("delete_my_account_v1");
			if (deleteError) {
				throw deleteError;
			}

			try {
				await signOut();
			} catch (signOutError) {
				console.error("Account deleted but sign-out failed, retrying with Supabase:", signOutError);
				const { error: globalSignOutError } = await supabase.auth.signOut({
					scope: "global",
				});
				if (globalSignOutError) {
					console.error(
						"Account delete fallback global sign-out failed:",
						globalSignOutError,
					);
				}

				const { error: localSignOutError } = await supabase.auth.signOut({
					scope: "local",
				});
				if (localSignOutError) {
					console.error(
						"Account delete fallback local sign-out failed:",
						localSignOutError,
					);
				}
			}

			navigate(HOME_V2_PATH, { replace: true });
			window.setTimeout(() => {
				window.location.assign(HOME_V2_PATH);
			}, 0);
		} catch (deleteError) {
			console.error("Error deleting account:", deleteError);
			setDeleteAccountInlineMessage(
				isEnglish
					? "Unable to delete your account right now."
					: "Impossible de supprimer ton compte pour le moment.",
			);
			setIsDeletingAccount(false);
		}
	}, [isDeletingAccount, isEnglish, navigate, signOut, user?.id]);

	if (!user) {
		return (
			<p style={{ ...baseTextStyle, marginTop: "14px" }}>
				{isEnglish ? "sign in to access settings." : "connecte-toi pour accéder aux paramètres."}
			</p>
		);
	}

	if (loading) {
		return (
			<p style={{ ...baseTextStyle, marginTop: "14px" }}>
				{isEnglish ? "loading settings..." : "chargement des paramètres..."}
			</p>
		);
	}

	const settingsEmailValue =
		profile?.email?.trim() ||
		user.email?.trim() ||
		(isEnglish ? "email unavailable" : "email indisponible");
	const baseRadioStyle = {
		appearance: "none" as const,
		WebkitAppearance: "none" as const,
		MozAppearance: "none" as const,
		width: "12px",
		height: "12px",
		borderRadius: "50%",
		border: "1px solid #000000",
		backgroundColor: "#ffffff",
		verticalAlign: "middle" as const,
	};

	const resolveRadioStyle = (checked: boolean) => ({
		...baseRadioStyle,
		backgroundImage: checked
			? "radial-gradient(circle, #000000 0 3px, transparent 3px)"
			: "none",
		backgroundRepeat: "no-repeat",
		backgroundPosition: "center",
	});

	return (
		<div style={{ textAlign: "left", marginTop: "14px" }}>
			<p style={{ ...baseTextStyle, margin: 0 }}>
				<Link to={monComptePath} style={plainLinkStyle}>
					{isEnglish ? "← back to my account" : "← retour à mon compte"}
				</Link>
			</p>
			<style>{`
				#app-v2-settings-range,
				#app-v2-settings-number {
					appearance: auto;
					-webkit-appearance: auto;
					-moz-appearance: auto;
				}

				#app-v2-settings-number::-webkit-outer-spin-button,
				#app-v2-settings-number::-webkit-inner-spin-button {
					-webkit-appearance: auto;
					opacity: 1;
				}
			`}</style>

			<div
				style={{
					marginTop: "10px",
					padding: "10px",
					backgroundColor: "#efefef",
					border: "1px solid #d6d6d6",
				}}
			>
				<p style={{ ...baseTextStyle, marginTop: "6px" }}>
					{isEnglish ? "profile picture" : "photo de profil"}
					<br />
					<span
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: "10px",
							marginTop: "6px",
						}}
					>
						<img
							src={pendingAvatarPreviewUrl ?? profile?.avatar_url ?? undefined}
							alt={isEnglish ? "profile avatar" : "avatar du profil"}
							style={{
								width: "64px",
								height: "64px",
								objectFit: "cover",
								border: "1px solid #000000",
								backgroundColor: "#d9d9d9",
							}}
						/>
						<label style={{ ...baseTextStyle, textDecoration: "underline", cursor: "pointer" }}>
							{isEnglish ? "choose file" : "choisir un fichier"}
							<input
								type="file"
								accept="image/jpeg,image/png,image/webp"
								onChange={(event) => {
									void handleAvatarFileSelected(event);
								}}
								style={{ display: "none" }}
							/>
						</label>
					</span>
				</p>
				{pendingAvatarFilename ? (
					<p style={{ ...baseTextStyle, marginTop: "4px", marginBottom: 0 }}>
						{pendingAvatarFilename}
					</p>
				) : null}
				{avatarInlineMessage ? (
					<p style={{ ...baseTextStyle, marginTop: "4px", marginBottom: 0 }}>
						{avatarInlineMessage}
					</p>
				) : null}
				<p style={{ ...baseTextStyle, marginTop: "6px" }}>
					{isEnglish ? "first name" : "prénom"}
					<br />
					<input
						type="text"
						value={firstName}
						onChange={(event) => {
							setFirstName(event.target.value);
						}}
						style={{
							...baseTextStyle,
							width: "240px",
							padding: "2px 6px",
							border: "1px solid #000000",
							backgroundColor: "#ffffff",
						}}
					/>
				</p>
				<p style={{ ...baseTextStyle, marginTop: "8px" }}>
					{isEnglish ? "username" : "username"}
					<br />
					{canChangeUsername ? (
						<span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
							<span>@</span>
							<input
								type="text"
								value={usernameInput}
								onChange={(event) => {
									setUsernameInput(event.target.value.trim().toLowerCase());
									setUsernameInlineMessage(null);
								}}
								disabled={isChangingUsername || isSavingProfile}
								style={{
									...baseTextStyle,
									width: "200px",
									padding: "2px 6px",
									border: "1px solid #000000",
									backgroundColor: "#ffffff",
								}}
							/>
							<button
								type="button"
								onClick={() => {
									void handleChangeUsername();
								}}
								disabled={isChangingUsername || isSavingProfile}
								style={{
									...baseTextStyle,
									border: "1px solid #000000",
									backgroundColor: "#ffffff",
									padding: "2px 8px",
									cursor:
										isChangingUsername || isSavingProfile ? "not-allowed" : "pointer",
								}}
							>
								{isEnglish ? "change my username" : "changer mon username"}
							</button>
						</span>
					) : (
						<span style={baseTextStyle}>@{profile?.username ?? usernameInput}</span>
					)}
				</p>
				{usernameInlineMessage ? (
					<p
						style={{
							...baseTextStyle,
							marginTop: "4px",
							marginBottom: 0,
							color: isUsernameInlineMessageError ? "#c61b1b" : "#16753c",
						}}
					>
						{usernameInlineMessage}
					</p>
				) : null}
				<p style={{ ...baseTextStyle, marginTop: "8px" }}>
					{isEnglish ? "email address" : "adresse e-mail"}
					<br />
					<span style={baseTextStyle}>{settingsEmailValue}</span>
				</p>
				<p style={{ ...baseTextStyle, marginTop: "8px" }}>
					{isEnglish ? "country" : "pays"}
					<br />
					<select
						value={selectedCountry}
						onChange={(event) => {
							setSelectedCountry(event.target.value);
						}}
						disabled={isSavingProfile}
						style={{
							...baseTextStyle,
							width: "240px",
							padding: "2px 6px",
							border: "1px solid #000000",
							backgroundColor: "#ffffff",
						}}
					>
						<option value="">{isEnglish ? "choose a country" : "choisir un pays"}</option>
						{PROFILE_COUNTRY_OPTIONS.map((countryOption) => (
							<option key={countryOption.value} value={countryOption.value}>
								{countryOption.label}
							</option>
						))}
					</select>
				</p>
				<p style={{ ...baseTextStyle, marginTop: "8px" }}>
					{isEnglish ? "language" : "langue"}
					<br />
					<select
						value={selectedLocale}
						onChange={(event) => {
							setSelectedLocale(event.target.value === "fr" ? "fr" : "en");
						}}
						disabled={isSavingProfile}
						style={{
							...baseTextStyle,
							width: "240px",
							padding: "2px 6px",
							border: "1px solid #000000",
							backgroundColor: "#ffffff",
						}}
					>
						<option value="fr">French</option>
						<option value="en">English</option>
					</select>
				</p>
			</div>

			<div
				style={{
					marginTop: "10px",
					padding: "10px",
					backgroundColor: "#efefef",
					border: "1px solid #d6d6d6",
				}}
			>
				<p style={baseTextStyle}>{isEnglish ? "new cards / day" : "nouvelles cartes / jour"}</p>
				<div style={{ marginTop: "6px" }}>
					<input
						id="app-v2-settings-range"
						type="range"
						min={PROFILE_NEW_CARDS_PER_DAY_MIN}
						max={PROFILE_NEW_CARDS_PER_DAY_MAX}
						step={1}
						value={newCardsPerDay}
						onChange={(event) => {
							setNewCardsPerDay(
								clampProfileNewCardsPerDay(Number(event.target.value)),
							);
						}}
						style={{
							width: "260px",
							accentColor: "#000000",
							appearance: "auto",
						}}
					/>{" "}
					<input
						id="app-v2-settings-number"
						type="number"
						min={PROFILE_NEW_CARDS_PER_DAY_MIN}
						max={PROFILE_NEW_CARDS_PER_DAY_MAX}
						value={newCardsPerDay}
						onChange={(event) => {
							setNewCardsPerDay(
								clampProfileNewCardsPerDay(Number(event.target.value)),
							);
						}}
						style={{
							...baseTextStyle,
							width: "74px",
							padding: "2px 6px",
							border: "1px solid #000000",
							backgroundColor: "#ffffff",
							appearance: "auto",
						}}
					/>
				</div>

			</div>

			<div
				style={{
					marginTop: "10px",
					padding: "10px",
					backgroundColor: "#efefef",
					border: "1px solid #d6d6d6",
				}}
			>
				<p style={baseTextStyle}>{isEnglish ? "vocab cards reminders" : "rappels"}</p>
				<div style={{ marginTop: "8px" }}>
					<p style={{ ...baseTextStyle, margin: 0 }}>
						{isEnglish ? "email reminders" : "email de rappel de révision"}{" "}
						<label style={baseTextStyle}>
							<input
								type="radio"
								name="app-v2-review-reminder-email"
								checked={reviewReminderEmailEnabled}
								onChange={() => {
									setReviewReminderEmailEnabled(true);
								}}
								disabled={isSavingProfile}
								style={{
									...resolveRadioStyle(reviewReminderEmailEnabled),
								}}
							/>{" "}
							{isEnglish ? "yes" : "oui"}
						</label>
						<label style={{ ...baseTextStyle, marginLeft: "14px" }}>
							<input
								type="radio"
								name="app-v2-review-reminder-email"
								checked={!reviewReminderEmailEnabled}
								onChange={() => {
									setReviewReminderEmailEnabled(false);
								}}
								disabled={isSavingProfile}
								style={{
									...resolveRadioStyle(!reviewReminderEmailEnabled),
								}}
							/>{" "}
							{isEnglish ? "no" : "non"}
						</label>
					</p>
				</div>
			</div>

			<div style={{ marginTop: "10px" }}>
				<button
					type="button"
					onMouseEnter={() => {
						setIsSaveButtonHovered(true);
					}}
					onMouseLeave={() => {
						setIsSaveButtonHovered(false);
					}}
					onClick={() => {
						void handleSaveProfile();
					}}
					disabled={isSavingProfile || isDeletingAccount}
					style={{
						...appV2ButtonBaseStyle,
						backgroundColor: isSaveButtonHovered ? "#e3e3e3" : "#efefef",
					}}
				>
					{isSavingProfile
						? isEnglish
							? "saving..."
							: "enregistrement..."
						: isEnglish
							? "save"
							: "enregistrer"}
				</button>
				{profileInlineMessage ? (
					<p style={{ ...baseTextStyle, marginTop: "6px", marginBottom: 0 }}>
						{profileInlineMessage}
					</p>
				) : null}
			</div>

			<div
				style={{
					marginTop: "16px",
					padding: "10px",
					backgroundColor: "#f8ecec",
					border: "1px solid #e2bcbc",
				}}
			>
				<p style={{ ...baseTextStyle, marginTop: 0, marginBottom: "8px" }}>
					{isEnglish ? "delete my account" : "supprimer mon compte"}
				</p>
				<button
					type="button"
					onMouseEnter={() => {
						setIsDeleteButtonHovered(true);
					}}
					onMouseLeave={() => {
						setIsDeleteButtonHovered(false);
					}}
					onClick={() => {
						void handleDeleteAccount();
					}}
					disabled={isDeletingAccount || isSavingProfile}
					style={{
						...appV2ButtonBaseStyle,
						color: "#8a1212",
						border: "1px solid #8a1212",
						backgroundColor: isDeleteButtonHovered ? "#f0d0d0" : "#f5dbdb",
					}}
				>
					{isDeletingAccount
						? isEnglish
							? "deleting..."
							: "suppression..."
						: isEnglish
							? "delete"
							: "supprimer"}
				</button>
				{deleteAccountInlineMessage ? (
					<p style={{ ...baseTextStyle, marginTop: "6px", marginBottom: 0, color: "#8a1212" }}>
						{deleteAccountInlineMessage}
					</p>
				) : null}
			</div>
		</div>
	);
}

function AppV2ContactsPage({
	hasSession,
	monComptePath,
	onOpenContact,
}: {
	hasSession: boolean;
	monComptePath: string;
	onOpenContact: (friend: FriendListItem) => void;
}) {
	const isEnglish = useIsEnglishApp();
	const [contacts, setContacts] = useState<FriendListItem[]>([]);
	const [incomingRequests, setIncomingRequests] = useState<IncomingFriendRequest[]>(
		[],
	);
	const [outgoingRequests, setOutgoingRequests] = useState<OutgoingFriendRequest[]>(
		[],
	);
	const [isLoading, setIsLoading] = useState(hasSession);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [usernameInput, setUsernameInput] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [pendingActionRequestId, setPendingActionRequestId] = useState<
		string | null
	>(null);
	const [isAddButtonHovered, setIsAddButtonHovered] = useState(false);
	const {
		message: contactInlineMessage,
		showMessage: showContactInlineMessage,
	} = useAppV2InlineMessage();

	const refreshContacts = useCallback(async () => {
		if (!hasSession) {
			setContacts([]);
			setIncomingRequests([]);
			setOutgoingRequests([]);
			setIsLoading(false);
			setErrorMessage(null);
			return;
		}

		setIsLoading(true);
		setErrorMessage(null);

		try {
			const { loadPreviewConnectionRequests, loadPreviewConnections } = await import(
				"@/features/preview-new-concept/services"
			);
			const [connectionsResult, requestsResult] = await Promise.all([
				loadPreviewConnections(),
				loadPreviewConnectionRequests(),
			]);
			setContacts(connectionsResult);
			setIncomingRequests(requestsResult.incomingRequests);
			setOutgoingRequests(requestsResult.outgoingRequests);
		} catch (error) {
			console.error("Error loading app-v2 contacts:", error);
			setErrorMessage(
				isEnglish
					? "Unable to load contacts right now."
					: "Impossible de charger les contacts pour le moment.",
			);
		} finally {
			setIsLoading(false);
		}
	}, [hasSession, isEnglish]);

	useEffect(() => {
		void refreshContacts();
	}, [refreshContacts]);

	const handleAddContact = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			setIsSubmitting(true);

			try {
				const { sendPreviewConnectionRequest } = await import(
					"@/features/preview-new-concept/services"
				);
				const status = await sendPreviewConnectionRequest(usernameInput);

				switch (status) {
					case "sent":
						showContactInlineMessage(
							isEnglish ? "Contact request sent." : "Demande de contact envoyée.",
						);
						break;
					case "already_pending":
						showContactInlineMessage(
							isEnglish ? "A request is already pending." : "Une demande est déjà en attente.",
						);
						break;
					case "already_friends":
						showContactInlineMessage(
							isEnglish ? "You are already connected." : "Vous êtes déjà connectés.",
						);
						break;
					case "accepted_reverse_request":
						showContactInlineMessage(
							isEnglish
								? "Mutual request detected: you are now connected."
								: "Demande croisée détectée : vous êtes maintenant connectés.",
						);
						break;
				}

				setUsernameInput("");
				await refreshContacts();
			} catch (error) {
				const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
				switch (code) {
					case "USERNAME_REQUIRED":
						showContactInlineMessage(
							isEnglish
								? "Enter this contact's @username."
								: "Renseigne le @username de ce contact.",
						);
						break;
					case "USER_NOT_FOUND":
						showContactInlineMessage(
							isEnglish
								? "No user found with that username."
								: "Aucun utilisateur trouvé avec ce username.",
						);
						break;
					case "CANNOT_ADD_SELF":
						showContactInlineMessage(
							isEnglish
								? "You cannot add yourself."
								: "Tu ne peux pas t'ajouter toi-même.",
						);
						break;
					default:
						showContactInlineMessage(
							isEnglish
								? "Unable to send the contact request."
								: "Impossible d'envoyer la demande de contact.",
						);
				}
			} finally {
				setIsSubmitting(false);
			}
		},
		[isEnglish, refreshContacts, showContactInlineMessage, usernameInput],
	);

	const handleRespondToContactRequest = useCallback(
		async (requestId: string, action: "accept" | "decline") => {
			setPendingActionRequestId(requestId);

			try {
				const { respondToPreviewConnectionRequest } = await import(
					"@/features/preview-new-concept/services"
				);
				const status = await respondToPreviewConnectionRequest(requestId, action);
				if (status === "accepted") {
					showContactInlineMessage(
						isEnglish
							? "Contact request accepted."
							: "Demande de contact acceptée.",
					);
				} else {
					showContactInlineMessage(
						isEnglish
							? "Contact request declined."
							: "Demande de contact refusée.",
					);
				}
				await refreshContacts();
			} catch (error) {
				const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
				switch (code) {
					case "INVALID_FRIEND_REQUEST_ID":
					case "NOT_FOUND":
						showContactInlineMessage(
							isEnglish
								? "This request is no longer available."
								: "Cette demande n'est plus disponible.",
						);
						break;
					default:
						showContactInlineMessage(
							isEnglish
								? "Unable to process this contact request."
								: "Impossible de traiter cette demande de contact.",
						);
				}
			} finally {
				setPendingActionRequestId(null);
			}
		},
		[isEnglish, refreshContacts, showContactInlineMessage],
	);

	const renderContactAvatar = useCallback(
		(avatarUrl: string | null, fallbackLabel: string) => {
			const fallbackInitial = fallbackLabel
				.replace(/^@+/, "")
				.trim()
				.slice(0, 1)
				.toUpperCase();

			if (avatarUrl) {
				return (
					<img
						src={avatarUrl}
						alt={fallbackLabel}
						style={{
							width: "24px",
							height: "24px",
							borderRadius: 0,
							objectFit: "cover",
							flexShrink: 0,
						}}
					/>
				);
			}

			return (
				<div
					aria-hidden="true"
					style={{
						width: "24px",
						height: "24px",
						borderRadius: 0,
						backgroundColor: "#d9d9d9",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: "12px",
						lineHeight: 1,
						flexShrink: 0,
					}}
				>
					{fallbackInitial || "?"}
				</div>
			);
		},
		[],
	);

	const resolvePendingContactLabel = useCallback(
		(
			username: string | null,
			firstName: string | null,
			lastName: string | null,
		): string => {
			if (username?.trim()) {
				return `@${username.trim()}`;
			}

			const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
			if (fullName) {
				return fullName;
			}

			return isEnglish ? "contact" : "contact";
		},
		[isEnglish],
	);

	const hasAnyConnections =
		contacts.length > 0 ||
		incomingRequests.length > 0 ||
		outgoingRequests.length > 0;

	return (
		<div style={{ textAlign: "left", marginTop: "14px" }}>
			<p style={{ ...baseTextStyle, margin: 0 }}>
				<Link to={monComptePath} style={plainLinkStyle}>
					{isEnglish ? "← back to my account" : "← retour à mon compte"}
				</Link>
			</p>
			<form onSubmit={handleAddContact} style={{ marginTop: "10px" }}>
				<label htmlFor="app-v2-contact-username" style={baseTextStyle}>
					{isEnglish ? "add a contact (@username)" : "ajouter un contact (@username)"}
				</label>
				<div style={{ marginTop: "6px" }}>
					<input
						id="app-v2-contact-username"
						type="text"
						value={usernameInput}
						onChange={(event) => {
							setUsernameInput(event.target.value);
						}}
						disabled={!hasSession || isSubmitting}
						placeholder="@username"
						style={{
							...baseTextStyle,
							width: "260px",
							padding: "2px 6px",
							border: "1px solid #000000",
							backgroundColor: "#ffffff",
						}}
					/>{" "}
					<button
						type="submit"
						onMouseEnter={() => {
							setIsAddButtonHovered(true);
						}}
						onMouseLeave={() => {
							setIsAddButtonHovered(false);
						}}
						disabled={!hasSession || isSubmitting}
						style={{
							...appV2ButtonBaseStyle,
							backgroundColor: isAddButtonHovered ? "#e3e3e3" : "#efefef",
						}}
					>
						{isSubmitting
							? isEnglish
								? "sending..."
								: "envoi..."
							: isEnglish
								? "add"
								: "ajouter"}
					</button>
					{contactInlineMessage ? (
						<p style={{ ...baseTextStyle, marginTop: "6px", marginBottom: 0 }}>
							{contactInlineMessage}
						</p>
					) : null}
				</div>
			</form>

			<div style={{ marginTop: "14px" }}>
				{!hasSession ? (
					<p style={baseTextStyle}>{isEnglish ? "sign in to see your contacts." : "connecte-toi pour afficher tes contacts."}</p>
				) : isLoading ? (
					<p style={baseTextStyle}>{isEnglish ? "loading..." : "chargement..."}</p>
				) : errorMessage ? (
					<p style={baseTextStyle}>{errorMessage}</p>
				) : !hasAnyConnections ? (
					<p style={baseTextStyle}>{isEnglish ? "no contacts yet." : "aucun contact pour le moment."}</p>
				) : (
					<div>
						{outgoingRequests.length > 0 ? (
							<div style={{ marginBottom: "12px" }}>
								<p style={{ ...baseTextStyle, marginTop: 0, marginBottom: "6px" }}>
									{isEnglish ? "pending requests" : "demandes en attente"}
								</p>
								<ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
									{outgoingRequests.map((request) => {
										const displayName = resolvePendingContactLabel(
											request.username,
											request.firstName,
											request.lastName,
										);

										return (
											<li key={request.requestId} style={{ marginBottom: "6px" }}>
												<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
													{renderContactAvatar(request.avatarUrl, displayName)}
													<span style={baseTextStyle}>{displayName}</span>
													<span style={{ ...baseTextStyle, fontStyle: "italic" }}>
														{isEnglish ? "pending" : "en attente"}
													</span>
												</div>
											</li>
										);
									})}
								</ul>
							</div>
						) : null}

						{incomingRequests.length > 0 ? (
							<div style={{ marginBottom: "12px" }}>
								<p style={{ ...baseTextStyle, marginTop: 0, marginBottom: "6px" }}>
									{isEnglish ? "received requests" : "demandes reçues"}
								</p>
								<ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
									{incomingRequests.map((request) => {
										const displayName = resolvePendingContactLabel(
											request.username,
											request.firstName,
											request.lastName,
										);
										const isPendingAction =
											pendingActionRequestId === request.requestId;

										return (
											<li key={request.requestId} style={{ marginBottom: "6px" }}>
												<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
													{renderContactAvatar(request.avatarUrl, displayName)}
													{request.username ? (
														<Link
															to={buildAppV2AccountPath(request.username)}
															style={plainLinkStyle}
														>
															{displayName}
														</Link>
													) : (
														<span style={baseTextStyle}>{displayName}</span>
													)}
													<button
														type="button"
														disabled={isPendingAction}
														onClick={() => {
															void handleRespondToContactRequest(
																request.requestId,
																"decline",
															);
														}}
														style={{
															...appV2ButtonBaseStyle,
															padding: "1px 8px",
														}}
													>
														{isEnglish ? "decline" : "refuser"}
													</button>
													<button
														type="button"
														disabled={isPendingAction}
														onClick={() => {
															void handleRespondToContactRequest(
																request.requestId,
																"accept",
															);
														}}
														style={{
															...appV2ButtonBaseStyle,
															padding: "1px 8px",
														}}
													>
														{isEnglish ? "accept" : "accepter"}
													</button>
												</div>
											</li>
										);
									})}
								</ul>
							</div>
						) : null}

						{contacts.length > 0 ? (
							<div>
								<p style={{ ...baseTextStyle, marginTop: 0, marginBottom: "6px" }}>
									{isEnglish ? "contacts" : "contacts"}
								</p>
								<ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
									{contacts.map((friend) => {
										const displayName = resolveContactDisplayName(friend);
										const connectedLabel = formatLastActivityLabel(
											friend.lastActivityAt,
											isEnglish,
										);

										return (
											<li key={friend.userId} style={{ marginBottom: "6px" }}>
												<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
													{renderContactAvatar(friend.avatarUrl, displayName)}
													{friend.username ? (
														<Link
															to={buildAppV2AccountPath(friend.username)}
															style={plainLinkStyle}
															onClick={(event) => {
																event.preventDefault();
																onOpenContact(friend);
															}}
														>
															{displayName}
														</Link>
													) : (
														<span style={baseTextStyle}>{displayName}</span>
													)}
													<span style={baseTextStyle}>
														{isEnglish ? "last activity:" : "dernière activité :"}{" "}
														{connectedLabel ?? (isEnglish ? "unknown" : "inconnue")}
													</span>
												</div>
											</li>
										);
									})}
								</ul>
							</div>
						) : null}
					</div>
				)}
			</div>
		</div>
	);
}

export default function AppPage() {
	const { locale, setLocale } = useAppLocale();
	const isEnglish = locale === "en";
	const [isButtonHovered, setIsButtonHovered] = useState(false);
	const [contentRef, contentWidth] = usePretextContainerWidth<HTMLDivElement>();
	const location = useLocation();
	const navigate = useNavigate();
	const { user, signOut } = useAuth();
	const { wordsAcquiredCount, loading: wordsAcquiredCountLoading } =
		useAppV2WordsAcquiredCount(user?.id);
	const { isAdmin } = useIsAdmin();
	const { count: remainingCardsCount } = usePendingReviewsCount({
		authenticatedDeckScope: "personal_and_foundation",
	});
	const [weeklyRemainingCount, setWeeklyRemainingCount] = useState(0);
	const [averageReviewsPerDay, setAverageReviewsPerDay] = useState(0);
	const [finishInDays, setFinishInDays] = useState<number | null>(null);
	const [adminUniqueVisitorsTotal, setAdminUniqueVisitorsTotal] =
		useState<number>(() => readAppV2AdminOverviewCache()?.uniqueVisitorsTotal ?? 0);
	const [adminAccountsTotal, setAdminAccountsTotal] =
		useState<number>(() => readAppV2AdminOverviewCache()?.accountsTotal ?? 0);
	const [adminDeckDownloadsTotal, setAdminDeckDownloadsTotal] =
		useState<number>(() => readAppV2AdminOverviewCache()?.deckDownloadsTotal ?? 0);
	const [cachedFoundationRemainingCount, setCachedFoundationRemainingCount] =
		useState<number | null>(() =>
			readAppV2FoundationRemainingCache(user?.id ?? null),
		);

	const todayRemainingCount = user
		? Math.max(0, remainingCardsCount)
		: Math.max(remainingCardsCount, APP_V2_GUEST_REMAINING_CARDS);
	const totalFoundationRemainingCount = user
		? Math.max(0, APP_V2_TOTAL_DECK_CARDS - wordsAcquiredCount)
		: APP_V2_TOTAL_DECK_CARDS;
	const displayedTotalFoundationRemainingCount =
		user && wordsAcquiredCountLoading
			? (cachedFoundationRemainingCount ?? totalFoundationRemainingCount)
			: totalFoundationRemainingCount;
	const totalRemainingCardsLabel = String(
		displayedTotalFoundationRemainingCount,
	);
	const normalizedPathname = normalizePathname(location.pathname);
	const canonicalPathname = useMemo(
		() => resolveCanonicalAppV2Path(normalizedPathname),
		[normalizedPathname],
	);
	const profileRegex = new RegExp(
		`^${APP_V2_BASE_PATH}/(?:account|compte|profil|profile)(?:/(.+))?$`,
	);
	const profileMatch = normalizedPathname.match(profileRegex);
	const isHomePage = normalizedPathname === APP_V2_BASE_PATH;
	const isErrorPage = normalizedPathname === `${APP_V2_BASE_PATH}/error`;
	const isSessionPage = normalizedPathname === `${APP_V2_BASE_PATH}/session`;
	const isSettingsPage = normalizedPathname === `${APP_V2_BASE_PATH}/settings`;
	const isKeyboardPage =
		normalizedPathname === `${APP_V2_BASE_PATH}/${KEYBOARD_PATH_SEGMENT}` ||
		normalizedPathname === `${APP_V2_BASE_PATH}/${LEGACY_KEYBOARD_PATH_SEGMENT}`;
	const isImmersionVideoPage =
		normalizedPathname === `${APP_V2_BASE_PATH}/${IMMERSION_VIDEO_PATH_SEGMENT}` ||
		normalizedPathname === `${APP_V2_BASE_PATH}/${LEGACY_IMMERSION_VIDEO_PATH_SEGMENT}` ||
		normalizedPathname ===
			`${APP_V2_BASE_PATH}/${OLDER_LEGACY_IMMERSION_VIDEO_PATH_SEGMENT}` ||
		normalizedPathname === `${APP_V2_BASE_PATH}/end`;
	const isWhy2000ToGoPage =
		normalizedPathname === `${APP_V2_BASE_PATH}/${DOCS_PATH_SEGMENT}` ||
		normalizedPathname.startsWith(`${APP_V2_BASE_PATH}/${DOCS_PATH_SEGMENT}/`) ||
		normalizedPathname === `${APP_V2_BASE_PATH}/${LEGACY_DOCS_PATH_SEGMENT}` ||
		normalizedPathname.startsWith(`${APP_V2_BASE_PATH}/${LEGACY_DOCS_PATH_SEGMENT}/`);
	const isContactsPage =
		normalizedPathname === `${APP_V2_BASE_PATH}/contacts` ||
		normalizedPathname === `${APP_V2_BASE_PATH}/camarades`;
	const isProfilePage = Boolean(profileMatch);
	const isKnownRoute =
		isHomePage ||
		isErrorPage ||
		isSessionPage ||
		isSettingsPage ||
		isKeyboardPage ||
		isImmersionVideoPage ||
		isWhy2000ToGoPage ||
		isContactsPage ||
		isProfilePage;
	const activeProfileUsername = resolveAppV2ProfileUsername(profileMatch?.[1]);
	const isNarrowContentPage =
		isProfilePage || isSettingsPage || isContactsPage || isImmersionVideoPage;
	const [ownAccountUsername, setOwnAccountUsername] = useState<string>(() =>
		resolveAppV2ProfileUsername(
			user?.id
				? readAppV2ProfileCache(getAppV2ProfileCacheByUserIdKey(user.id))
						?.username
				: null,
		),
	);
	const monComptePath = useMemo(
		() => buildAppV2AccountPath(ownAccountUsername),
		[ownAccountUsername],
	);
	const shouldShowAdminUniqueVisitors = isHomePage && isAdmin === true;
	const appV2HomeTextMaxWidth = useMemo(() => {
		if (contentWidth <= 0) {
			return 700;
		}
		return Math.min(700, Math.max(220, contentWidth - 32));
	}, [contentWidth]);
	const totalRemainingTitleFontSizePx = useMemo(
		() =>
			findLargestSingleLineFontSize(
				totalRemainingCardsLabel,
				appV2HomeTextMaxWidth,
				APP_V2_PRETEXT_HOME_MAX_TITLE_FONT_PX,
				APP_V2_PRETEXT_HOME_MIN_TITLE_FONT_PX,
				"Arial, sans-serif",
				{
					pagePath: normalizedPathname,
					blockId: "app-v2-home:total-remaining-title",
				},
			),
		[appV2HomeTextMaxWidth, normalizedPathname, totalRemainingCardsLabel],
	);
	const [isSigningOut, setIsSigningOut] = useState(false);

	useEffect(() => {
		ensureAppRuntimeProfiler(normalizedPathname);
	}, [normalizedPathname]);

	const handleSignOut = useCallback(async () => {
		if (isSigningOut) {
			return;
		}

		setIsSigningOut(true);
		try {
			await signOut();
		} catch (error) {
			console.error("App sign-out failed, retrying with Supabase:", error);
			const { error: globalSignOutError } = await supabase.auth.signOut({
				scope: "global",
			});
			if (globalSignOutError) {
				console.error(
					"App fallback global sign-out failed:",
					globalSignOutError,
				);
			}

			const { error: localSignOutError } = await supabase.auth.signOut({
				scope: "local",
			});
			if (localSignOutError) {
				console.error(
					"App fallback local sign-out failed:",
					localSignOutError,
				);
			}
		} finally {
			navigate(HOME_V2_PATH, { replace: true });
			window.setTimeout(() => {
				window.location.assign(HOME_V2_PUBLIC_PATH);
			}, 0);
			setIsSigningOut(false);
		}
	}, [isSigningOut, navigate, signOut]);

	useEffect(() => {
		if (!user?.id) {
			setOwnAccountUsername(OWN_APP_V2_PROFILE_SEGMENT);
			return;
		}

		const cachedProfile = readAppV2ProfileCache(
			getAppV2ProfileCacheByUserIdKey(user.id),
		);
		setOwnAccountUsername(
			cachedProfile?.username?.trim() || OWN_APP_V2_PROFILE_SEGMENT,
		);
	}, [user?.id]);

	useEffect(() => {
		if (typeof window === "undefined" || !user?.id) {
			return;
		}

		const handleProfileUpdated = (event: Event) => {
			const detail = (event as CustomEvent<ProfileUpdatedDetail>).detail;
			if (!detail || detail.userId !== user.id) {
				return;
			}

			const cachedProfile = readAppV2ProfileCache(
				getAppV2ProfileCacheByUserIdKey(user.id),
			);
			const previousUsername = cachedProfile?.username?.trim().toLowerCase() ?? "";
			const eventUsername =
				typeof detail.patch?.username === "string"
					? detail.patch.username
					: detail.username;
			const nextUsername = eventUsername?.trim().toLowerCase() ?? "";

			if (nextUsername.length > 0) {
				setOwnAccountUsername(nextUsername);
			}

			if (cachedProfile) {
				const mergedProfile: UserProfile = {
					...cachedProfile,
					...detail.patch,
					username: nextUsername || cachedProfile.username,
				};

				writeAppV2ProfileCache(mergedProfile);
				if (
					previousUsername.length > 0 &&
					nextUsername.length > 0 &&
					previousUsername !== nextUsername
				) {
					removeAppV2ProfileCacheByUsername(previousUsername);
				}
			}
		};

		window.addEventListener(PROFILE_UPDATED_EVENT, handleProfileUpdated as EventListener);

		return () => {
			window.removeEventListener(
				PROFILE_UPDATED_EVENT,
				handleProfileUpdated as EventListener,
			);
		};
	}, [user?.id]);

	useEffect(() => {
		setCachedFoundationRemainingCount(
			readAppV2FoundationRemainingCache(user?.id ?? null),
		);
	}, [user?.id]);

	useEffect(() => {
		if (!user || wordsAcquiredCountLoading) {
			return;
		}

		setCachedFoundationRemainingCount(totalFoundationRemainingCount);
		writeAppV2FoundationRemainingCache(user.id, totalFoundationRemainingCount);
	}, [wordsAcquiredCountLoading, totalFoundationRemainingCount, user]);

	useEffect(() => {
		if (!user?.id) {
			return;
		}

		const cachedByUserId = readAppV2ProfileCache(
			getAppV2ProfileCacheByUserIdKey(user.id),
		);
		if (cachedByUserId) {
			setOwnAccountUsername(
				cachedByUserId.username?.trim() || OWN_APP_V2_PROFILE_SEGMENT,
			);
		}

		let cancelled = false;

		const warmAccountProfileCache = async () => {
			const [profileResult, profileFieldsResult] = await Promise.all([
				supabase.rpc("get_my_profile_v1"),
				supabase
					.from("profiles")
					.select("location,motto")
					.eq("user_id", user.id)
					.maybeSingle(),
			]);

			const { data, error } = profileResult;

			if (cancelled || error || !data) {
				return;
			}

			if (profileFieldsResult.error) {
				console.error("Error warming account profile fields cache:", profileFieldsResult.error);
			}

			const displayName = data.display_name?.trim() ?? "";
			const [firstName, ...rest] =
				displayName.length > 0 ? displayName.split(/\s+/) : [];
			const mappedProfile = {
				id: data.user_id,
				user_id: data.user_id,
				username: data.username,
				first_name: firstName ?? null,
				last_name: rest.join(" ").trim() || null,
				avatar_url: data.avatar_url,
				bio: data.bio,
				motto: profileFieldsResult.data?.motto ?? null,
				location: profileFieldsResult.data?.location ?? null,
				followers_count: 0,
				following_count: 0,
				is_public: true,
				notifications_email: data.email_notifications_enabled,
				email: null,
				fsrs_target_retention: 0.9,
				new_cards_per_day: 20,
				scheduler_timezone: data.timezone,
				scheduler_day_cutoff_hour: 0,
				plan: null,
				pro_status: null,
				admin_override_pro: null,
				admin_override_expires_at: null,
				created_at: data.created_at,
				updated_at: data.updated_at,
			} satisfies UserProfile;

			writeAppV2ProfileCache(mappedProfile);
			setOwnAccountUsername(data.username?.trim() || OWN_APP_V2_PROFILE_SEGMENT);
		};

		void warmAccountProfileCache();

		return () => {
			cancelled = true;
		};
	}, [user?.id]);

	useEffect(() => {
		if (!user?.id) {
			setWeeklyRemainingCount(APP_V2_DEFAULT_WEEKLY_REMAINING_CARDS);
			setAverageReviewsPerDay(PROFILE_NEW_CARDS_PER_DAY_DEFAULT);
			setFinishInDays(null);
			return;
		}

		const cachedSnapshot = readAppV2HomeMetricsCache(user.id);
		if (!cachedSnapshot) {
			return;
		}

		setWeeklyRemainingCount(cachedSnapshot.weeklyRemainingCount);
		setAverageReviewsPerDay(cachedSnapshot.averageReviewsPerDay);
		setFinishInDays(cachedSnapshot.finishInDays);
	}, [user?.id]);

	useEffect(() => {
		if (!user?.id) {
			return;
		}

		let cancelled = false;

		const refreshHomeMetrics = async () => {
			let nextWeeklyRemainingCount = todayRemainingCount;
			let nextAverageReviewsPerDay = PROFILE_NEW_CARDS_PER_DAY_DEFAULT;
			let schedulerWeeklyCount = todayRemainingCount;
			const { fetchDueCardsByReviewTypes } = await import(
				"@/services/deckPersoDueReviewService"
			);

			const [reviewAverageResult, weeklyDueResult] = await Promise.allSettled([
				supabase.rpc("get_my_review_daily_counts_v1", { p_days_back: 30 }),
				fetchDueCardsByReviewTypes(["foundation", "collected", "sent"], 320),
			]);

			if (reviewAverageResult.status === "fulfilled") {
				const { data, error } = reviewAverageResult.value;
				if (!error && Array.isArray(data)) {
					const activeRows = data.filter(
						(row) =>
							typeof row.review_count === "number" && row.review_count > 0,
					);
					if (activeRows.length > 0) {
						const totalReviews = activeRows.reduce(
							(sum, row) => sum + Math.max(0, row.review_count ?? 0),
							0,
						);
						nextAverageReviewsPerDay = Math.floor(
							totalReviews / activeRows.length,
						);
					}
				}
			} else {
				console.error(
					"Error loading app-v2 review average:",
					reviewAverageResult.reason,
				);
			}

			if (weeklyDueResult.status === "fulfilled") {
				const dueCardsResult = weeklyDueResult.value;
				if (dueCardsResult.ok) {
					const now = Date.now();
					const weekEndTs = now + 7 * 24 * 60 * 60 * 1000;
					schedulerWeeklyCount = dueCardsResult.data.reduce((count, card) => {
						if (!card.nextReviewAt) {
							return count + 1;
						}
						const nextReviewAtMs = Date.parse(card.nextReviewAt);
						if (Number.isNaN(nextReviewAtMs)) {
							return count;
						}
						return nextReviewAtMs <= weekEndTs ? count + 1 : count;
					}, 0);
				}
			} else {
				console.error(
					"Error loading app-v2 weekly remaining cards:",
					weeklyDueResult.reason,
				);
			}

			const projectionDailyPace =
				nextAverageReviewsPerDay > 0
					? nextAverageReviewsPerDay
					: Math.max(1, Math.floor(todayRemainingCount / 7));
			const projectedWeeklyFromPace = Math.max(
				todayRemainingCount,
				todayRemainingCount + Math.floor(projectionDailyPace * 6),
			);
			nextWeeklyRemainingCount = Math.max(
				todayRemainingCount,
				schedulerWeeklyCount,
				projectedWeeklyFromPace,
			);

			const totalCardsRemaining = Math.max(
				0,
				APP_V2_TOTAL_DECK_CARDS - wordsAcquiredCount,
			);
			const nextFinishInDays =
				nextAverageReviewsPerDay > 0
					? Math.floor(totalCardsRemaining / nextAverageReviewsPerDay)
					: null;

			if (cancelled) {
				return;
			}

			setWeeklyRemainingCount(nextWeeklyRemainingCount);
			setAverageReviewsPerDay(nextAverageReviewsPerDay);
			setFinishInDays(nextFinishInDays);

			writeAppV2HomeMetricsCache(user.id, {
				weeklyRemainingCount: nextWeeklyRemainingCount,
				averageReviewsPerDay: nextAverageReviewsPerDay,
				finishInDays: nextFinishInDays,
				updatedAt: Date.now(),
			});
		};

		void refreshHomeMetrics();

		return () => {
			cancelled = true;
		};
	}, [todayRemainingCount, user?.id, wordsAcquiredCount]);

	useEffect(() => {
		if (!user) {
			return;
		}

		if (averageReviewsPerDay <= 0) {
			setFinishInDays(null);
			return;
		}

		const totalCardsRemaining = Math.max(
			0,
			APP_V2_TOTAL_DECK_CARDS - wordsAcquiredCount,
		);
		setFinishInDays(Math.floor(totalCardsRemaining / averageReviewsPerDay));
	}, [averageReviewsPerDay, user, wordsAcquiredCount]);

	useEffect(() => {
		if (!canonicalPathname || canonicalPathname === normalizedPathname) {
			return;
		}

		navigate(canonicalPathname, { replace: true });
	}, [canonicalPathname, navigate, normalizedPathname]);

	useEffect(() => {
		if (isKnownRoute) {
			return;
		}

		navigate(`${APP_V2_BASE_PATH}/error`, { replace: true });
	}, [isKnownRoute, navigate]);

	useEffect(() => {
		if (!isSessionPage) {
			return;
		}

		const visitorId = getOrCreateAppSessionVisitorId();

		const trackUniqueVisitor = async () => {
			const { error } = await supabase.rpc(
				"track_app_v2_session_unique_visitor",
				{
					p_visitor_id: visitorId,
					p_user_id: user?.id ?? null,
				},
			);

			if (error) {
				console.error("Error tracking app-v2 session unique visitor:", error);
			}
		};

		void trackUniqueVisitor();
	}, [isSessionPage, user?.id]);

	const handleSessionLocaleChange = (nextLocale: "fr" | "en") => {
		if (nextLocale === locale) {
			return;
		}

		setLocale(nextLocale);
		window.location.reload();
	};

	const sessionFooter = isSessionPage ? (
		<div
			style={{
				alignSelf: "center",
				flexShrink: 0,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: "4px",
				marginTop: "8px",
				fontFamily: "Arial, sans-serif",
				fontSize: "13.3333px",
				lineHeight: 1.35,
				color: "#000000",
				backgroundColor: "#f7f6f2",
				padding: "2px 8px",
			}}
		>
			<label>
				language :{" "}
				<select
					value={locale}
					onChange={(event) => {
						handleSessionLocaleChange(
							event.target.value === "fr" ? "fr" : "en",
						);
					}}
					style={{
						font: "inherit",
						color: "inherit",
						backgroundColor: "#efefef",
						border: "1px solid #000000",
						borderRadius: "3px",
						padding: "1px 6px",
					}}
				>
					<option value="en">english</option>
					<option value="fr">french</option>
				</select>
			</label>
			<a
				href={`${APP_PUBLIC_BASE_PATH}${APP_V2_BASE_PATH}/why-2000-to-go`}
				target="_blank"
				rel="noreferrer"
				style={plainLinkStyle}
			>
				how do I do my reviews?
			</a>
			<a
				href={`${APP_PUBLIC_BASE_PATH}/feedback`}
				target="_blank"
				rel="noreferrer"
				style={plainLinkStyle}
			>
				bug report/feedback
			</a>
		</div>
	) : null;

	useEffect(() => {
		if (!user?.id) {
			setAdminUniqueVisitorsTotal(0);
			setAdminAccountsTotal(0);
			setAdminDeckDownloadsTotal(0);
			return;
		}

		if (isAdmin === false) {
			setAdminUniqueVisitorsTotal(0);
			setAdminAccountsTotal(0);
			setAdminDeckDownloadsTotal(0);
			return;
		}

		if (isAdmin !== true) {
			return;
		}

		const cachedSnapshot = readAppV2AdminOverviewCache();
		if (cachedSnapshot) {
			setAdminUniqueVisitorsTotal(cachedSnapshot.uniqueVisitorsTotal);
			setAdminAccountsTotal(cachedSnapshot.accountsTotal);
			setAdminDeckDownloadsTotal(cachedSnapshot.deckDownloadsTotal);
		}

		let cancelled = false;

		const loadAdminOverview = async () => {
			const adminOverviewResponse = await supabase.rpc(
				"get_app_admin_overview_v1",
			);

			if (adminOverviewResponse.error) {
				console.error(
					"Error loading app admin overview:",
					adminOverviewResponse.error,
				);
				return;
			}

			if (cancelled) {
				return;
			}

			const nextOverview =
				parseAppV2AdminOverviewResponse(adminOverviewResponse.data) ??
				(cachedSnapshot
					? {
						uniqueVisitorsTotal: cachedSnapshot.uniqueVisitorsTotal,
						accountsTotal: cachedSnapshot.accountsTotal,
						deckDownloadsTotal: cachedSnapshot.deckDownloadsTotal,
					}
					: {
						uniqueVisitorsTotal: 0,
						accountsTotal: 0,
						deckDownloadsTotal: 0,
					});

			setAdminUniqueVisitorsTotal(nextOverview.uniqueVisitorsTotal);
			setAdminAccountsTotal(nextOverview.accountsTotal);
			setAdminDeckDownloadsTotal(nextOverview.deckDownloadsTotal);
			writeAppV2AdminOverviewCache(nextOverview);
		};

		void loadAdminOverview();
		const intervalId = setInterval(() => {
			void loadAdminOverview();
		}, APP_V2_ADMIN_OVERVIEW_POLL_INTERVAL_MS);

		return () => {
			cancelled = true;
			clearInterval(intervalId);
		};
	}, [user?.id, isAdmin]);

	if (isSessionPage) {
		return (
			<main style={appV2MainStyle}>
				<AppV2ToastSuppressionStyle />
				<div
					style={{
						minHeight: "100dvh",
						display: "flex",
						flexDirection: "column",
						paddingBottom: "18px",
					}}
				>
					<div style={{ flex: "1 0 auto" }}>
						<Suspense fallback={<AppV2SectionLoading />}>
							<LazyCardsReview
								isPreviewMode
								forceLiveSubmission
								sessionChromeVariant="plain_html"
								onBackClick={() => {
									navigate(APP_V2_BASE_PATH);
								}}
							/>
						</Suspense>
					</div>
					{sessionFooter}
				</div>
			</main>
		);
	}

	if (isErrorPage || !isKnownRoute) {
		return <AppV2ErrorPage />;
	}

	return (
		<main style={appV2MainStyle}>
			<AppV2ToastSuppressionStyle />
			{isHomePage ? (
				<Link
					to="/?from=app"
					style={{
						position: "fixed",
						top: "0",
						left: "0",
						padding: "8px 10px",
						fontFamily: "Arial, sans-serif",
						fontSize: "13.333px",
						color: "#000000",
						textDecoration: "underline",
						zIndex: 2,
					}}
				>
					← {isEnglish ? "back to frontpage" : "retour à la page d'accueil"}
				</Link>
			) : null}
			<div
				ref={contentRef}
				style={{
					maxWidth: isNarrowContentPage ? "560px" : "1120px",
					margin: "0 auto",
					padding: "0 16px",
				}}
			>
				{user ? (
					<AppV2TopNav monComptePath={monComptePath} />
				) : (
					<p
						style={{ ...baseTextStyle, textAlign: "center", marginTop: "8px" }}
					>
						<Link
							to={LOGIN_V2_PATH}
							style={{ ...plainLinkStyle, textDecoration: "none" }}
						>
							<span style={{ textDecoration: "underline" }}>
								{isEnglish ? "sign in" : "se connecter"}
							</span>{" "}
							{isEnglish
								? "and save progress forever"
								: "et sauvegarder progression pour toujours"}
						</Link>
						{" • "}
						<Link to={`${APP_V2_BASE_PATH}/${DOCS_PATH_SEGMENT}`} style={plainLinkStyle}>
							{isEnglish ? "why 2000 to go?" : "pourquoi 2000 to go ?"}
						</Link>
					</p>
				)}

				{isSettingsPage ? (
					<AppV2SettingsPage monComptePath={monComptePath} />
				) : isKeyboardPage ? (
					<AppV2KeyboardPage />
				) : isImmersionVideoPage ? (
					<AppV2ImmersionVideoPage
						hasSession={Boolean(user)}
						userId={user?.id ?? null}
						wordsAcquiredCount={wordsAcquiredCount}
						wordsAcquiredCountLoading={wordsAcquiredCountLoading}
					/>
				) : isWhy2000ToGoPage ? (
					<Suspense fallback={<AppV2SectionLoading />}>
					<LazyWhy2000ToGoPage />
					</Suspense>
				) : isProfilePage ? (
					<AppV2ProfilePage
						username={activeProfileUsername}
						onSignOut={handleSignOut}
					/>
				) : isContactsPage ? (
					<AppV2ContactsPage
						hasSession={Boolean(user)}
						monComptePath={monComptePath}
						onOpenContact={(friend) => {
							const nextUsername =
								friend.username?.trim() || DEFAULT_APP_V2_PROFILE_USERNAME;
							navigate(buildAppV2AccountPath(nextUsername));
						}}
					/>
				) : (
					<div
						style={{
							width: "100%",
							maxWidth: "760px",
							margin: "0 auto",
							textAlign: "left",
						}}
					>
						<div style={{ textAlign: "center" }}>
							<br />
							<br />

							<h1
								style={{
									fontSize: `${totalRemainingTitleFontSizePx}px`,
									fontWeight: 400,
									lineHeight: 1,
									margin: 0,
								}}
							>
								{totalRemainingCardsLabel}
							</h1>
							<p
								style={{
									...baseTextStyle,
									marginTop: "0.16em",
									marginBottom: 0,
								}}
							>
								{isEnglish ? "vocab cards to go" : "cartes de vocabulaire restantes"}
							</p>

							<p style={{ ...baseTextStyle, marginTop: "12px" }}>
								<button
									type="button"
									onMouseEnter={() => {
										setIsButtonHovered(true);
									}}
									onMouseLeave={() => {
										setIsButtonHovered(false);
									}}
									onClick={() => {
										navigate(`${APP_V2_BASE_PATH}/session`);
									}}
									style={{
										...appV2ButtonBaseStyle,
										backgroundColor: isButtonHovered ? "#e3e3e3" : "#efefef",
									}}
								>
									{isEnglish ? "ready to go" : "commencer"}
								</button>
							</p>

							<br />
						</div>

						<div style={{ textAlign: "center" }}>
							<div
								style={{
									...baseTextStyle,
									display: "inline-block",
									textAlign: "left",
								}}
							>
								<span style={appV2HighlightNumberStyle}>
									{todayRemainingCount}
								</span>{" "}
								{isEnglish ? "cards remaining today" : "cartes restantes aujourd'hui"}
								<br />
								<span style={appV2HighlightNumberStyle}>
									{weeklyRemainingCount}
								</span>{" "}
								{isEnglish ? "cards remaining this week" : "cartes restantes cette semaine"}
								<br />
								<br />
								{isEnglish ? "you average" : "tu as une moyenne de"}{" "}
								<span style={appV2HighlightNumberStyle}>
									{averageReviewsPerDay}
								</span>{" "}
								{isEnglish ? "cards/day" : "cartes/jour"}
								<br />
								{isEnglish ? "at this pace, you will finish in" : "à ce rythme, tu auras tout fini dans"}{" "}
								<span style={appV2HighlightNumberStyle}>
									{finishInDays === null ? "--" : finishInDays}
								</span>{" "}
								{isEnglish ? "days" : "jours"}
								{shouldShowAdminUniqueVisitors ? (
									<>
										<br />
										<br />
										{isEnglish
											? "total unique users (reached /app/session):"
											: "nombre d'utilisateurs uniques total :"}{" "}
										{adminUniqueVisitorsTotal}
										<br />
									{isEnglish
										? "number of accounts:"
										: "nombre de comptes :"}{" "}
									{adminAccountsTotal}
									<br />
									total deck downloads: {adminDeckDownloadsTotal}
								</>
							) : null}
							</div>
						</div>
					</div>
				)}
			</div>
		</main>
	);
}
