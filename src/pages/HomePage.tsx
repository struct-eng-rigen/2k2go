import { useEffect, useState, type ComponentType } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAppLocale } from "@/contexts/AppLocaleContext";
import { getOrCreateAppSessionVisitorId } from "@/lib/appSessionVisitor";
import { readActiveUserId } from "@/lib/authPersistence";
import {
	createDeckDownloadClickId,
	recordDeckDownloadClick,
} from "@/services/deckDownloadTrackingService";
import foundationsDeckFile from "@/assets/deck-fondations-2k/2K2GO Arabic Foundations.apkg?url";

const LANDING_RAILS_MIN_VIEWPORT_WIDTH = 1025;

const hasPersistedAuthState = (): boolean => {
	return readActiveUserId().trim().length > 0;
};

const prefetchAppRuntime = (): void => {
	void import("@/AppRuntime");
};

const prefetchPrimaryAppRoute = (): void => {
	prefetchAppRuntime();
	void import("@/pages/AppShell");
};

export default function HomePage() {
	const navigate = useNavigate();
	const location = useLocation();
	const { locale, setLocale } = useAppLocale();
	const [RailsComponent, setRailsComponent] = useState<ComponentType | null>(null);
	const [isCtaHovered, setIsCtaHovered] = useState(false);
	const isEnglish = locale === "en";

	const handleDeckDownloadClick = () => {
		const userId = readActiveUserId().trim();
		const pagePath =
			typeof window === "undefined"
				? location.pathname
				: `${window.location.pathname}${window.location.search}`;

		void recordDeckDownloadClick({
			clickId: createDeckDownloadClickId(),
			deckKey: "enki_deck",
			sourceName: "landing_main_cta",
			pagePath,
			referrer:
				typeof document === "undefined" || document.referrer.trim().length === 0
					? null
					: document.referrer,
			locale,
			userId: userId.length > 0 ? userId : null,
			visitorId: getOrCreateAppSessionVisitorId(),
		}).catch((error) => {
			console.error("Error recording landing deck download click:", error);
		});
	};

	useEffect(() => {
		const searchParams = new URLSearchParams(location.search);
		const shouldStayOnLandingPage = searchParams.get("from") === "app";

		if (shouldStayOnLandingPage) {
			return;
		}

		if (!hasPersistedAuthState()) {
			return;
		}

		navigate("/app", { replace: true });
	}, [location.search, navigate]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		if (window.innerWidth < LANDING_RAILS_MIN_VIEWPORT_WIDTH) {
			return;
		}

		let cancelled = false;
		const frameHandle = window.requestAnimationFrame(() => {
			void import("./HomeRails").then((module) => {
				if (cancelled) {
					return;
				}
				setRailsComponent(() => module.default);
			});
		});

		return () => {
			cancelled = true;
			window.cancelAnimationFrame(frameHandle);
		};
	}, []);

	return (
		<main className="landing-frame">
			{RailsComponent ? <RailsComponent /> : null}

			<div className="landing-center-shell">
				<div className="landing-center-content">
					<p className="landing-pretitle">
						{isEnglish ? "free open source foundation deck" : "deck de fondation open source et gratuit"}
					</p>
					<h1 className="landing-title">2000</h1>
					<p className="landing-subtitle">
						{isEnglish ? "to go." : "restants."}
					</p>
					<p className="landing-copy-primary">
						{isEnglish
							? "learning Arabic based on the fact:"
							: "apprendre l'arabe à partir d'un fait simple :"}
						<br />
						<strong>
							{isEnglish
								? "2000 words = 80% comprehension."
								: "2000 mots = 80 % de compréhension."}
						</strong>
					</p>
					<p className="landing-copy-secondary">
						{isEnglish
							? "proven in 9 other languages, including Arabic."
							: "déjà prouvé dans 9 autres langues, dont l'arabe,"}
						<br />
						{isEnglish
							? "(English, French, Russian, Japanese, Greek, Spanish, Italian...)"
							: "(anglais, français, russe, japonais, grec, espagnol, italien...)"}
					</p>
					<p className="landing-cta-wrap">
						<Link
							to="/app"
							onMouseEnter={prefetchPrimaryAppRoute}
							onMouseOver={() => {
								setIsCtaHovered(true);
							}}
							onMouseOut={() => {
								setIsCtaHovered(false);
							}}
							onFocus={prefetchPrimaryAppRoute}
							onBlur={() => {
								setIsCtaHovered(false);
							}}
							onTouchStart={prefetchPrimaryAppRoute}
							style={{
								fontSize: "13.3333px",
								fontFamily: "Arial, sans-serif",
								color: "#000000",
								border: "1px solid #000000",
								borderRadius: "3px",
								padding: "1% 6px",
								paddingTop: "1px",
								paddingBottom: "1px",
								backgroundColor: isCtaHovered ? "#e3e3e3" : "#efefef",
								textDecoration: "none",
								display: "inline-block",
							}}
						>
							{isEnglish ? "start the deck" : "commencer"}
						</Link>
					</p>
				</div>
			</div>

			<div
				style={{
					position: "fixed",
					left: "50%",
					bottom: "20px",
					transform: "translateX(-50%)",
					zIndex: 10,
					fontSize: "13.3333px",
					fontFamily: "Arial, sans-serif",
					lineHeight: 1.35,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: "4px",
				}}
			>
				<div
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: "6px",
					}}
				>
					<label>
						language :{" "}
						<select
							value={locale}
							onChange={(event) => {
								const nextLocale = event.target.value === "fr" ? "fr" : "en";
								setLocale(nextLocale);
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
							<option value="fr">french</option>
							<option value="en">english</option>
						</select>
					</label>
					<span aria-hidden="true">&middot;</span>
					<a
						href={foundationsDeckFile}
						download="2K2GO Arabic Foundations.apkg"
						onClick={handleDeckDownloadClick}
						style={{
							font: "inherit",
							color: "#000000",
							border: "1px solid #000000",
							borderRadius: "3px",
							padding: "1px 6px",
							backgroundColor: "#efefef",
							textDecoration: "none",
							display: "inline-flex",
							alignItems: "center",
						}}
					>
						download anki deck
					</a>
					<span aria-hidden="true">&middot;</span>
					<a
						href="https://github.com/malabarbamba/2k2go"
						target="_blank"
						rel="noreferrer"
						aria-label="GitHub repository"
						style={{
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							color: "#000000",
							textDecoration: "none",
						}}
					>
						<svg
							viewBox="0 0 16 16"
							width="13"
							height="13"
							fill="currentColor"
						>
							<title>GitHub</title>
							<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49C3.78 14.2 3.31 12.65 3.31 12.65c-.36-.92-.88-1.16-.88-1.16-.72-.49.05-.48.05-.48.8.06 1.22.82 1.22.82.71 1.22 1.87.87 2.33.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.58.82-2.14-.08-.2-.36-1.01.08-2.1 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.87c.68 0 1.37.09 2.01.27 1.53-1.03 2.2-.82 2.2-.82.44 1.09.16 1.9.08 2.1.51.56.82 1.27.82 2.14 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.19 0 .21.14.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
						</svg>
					</a>
				</div>
				<Link
					to="/feedback"
					style={{
						fontFamily: "Arial, sans-serif",
						fontSize: "13px",
						color: "#000000",
						textDecoration: "underline",
						display: "inline-block",
					}}
				>
					bug report/feedback
				</Link>
			</div>
		</main>
	);
}
