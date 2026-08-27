import Image from "next/image";
import Link from "next/link";

const repositoryUrl = process.env.NEXT_PUBLIC_GITHUB_REPOSITORY_URL;

const storySections = [
  {
    id: "changes",
    eyebrow: "Deployed changes",
    title: "See every deployed change.",
    body: "LaunchDiff treats the exact CDN artifact as authoritative, resolves parser-confirmed deferred Launch resources, and keeps GitHub-style split diffs focused on the code that actually shipped.",
    image: "/landing/workspace-split-diff.webp",
    alt: "Actual LaunchDiff comparison workspace showing a split diff with rule and data element resources."
  },
  {
    id: "impact",
    eyebrow: "Dependency impact",
    title: "Understand downstream impact.",
    body: "Data Element references from percent tokens and literal getVar calls are traced into direct and transitive paths, so unchanged resources can still be flagged as impacted without being mislabeled as modified.",
    image: "/landing/workspace-impacted-resources.webp",
    alt: "Actual LaunchDiff impacted resources view showing a transitive Data Element dependency."
  },
  {
    id: "resolved",
    eyebrow: "Resolved library",
    title: "Validate the complete resource graph.",
    body: "Canonical and deferred resources end in explicit states: resolved, failed, skipped by a documented limit, or unsupported. Warnings and retry paths stay visible instead of disappearing into a clean-looking diff.",
    image: "/landing/workspace-resolved-files.webp",
    alt: "Actual LaunchDiff resolved files view showing resolved and failed fetched resources."
  }
];

const trustItems = [
  "No Adobe authentication",
  "No accounts or database",
  "No AI dependency",
  "No downloaded JavaScript execution",
  "No persistent source storage",
  "Only minimal aggregate usage measurement"
];

export default function HomePage() {
  return (
    <main className="landing-page">
      <header className="landing-header" aria-label="LaunchDiff">
        <Link className="landing-brand" href="/" aria-label="LaunchDiff home">
          <LaunchDiffMark decorative />
          <span>LaunchDiff</span>
        </Link>
        <nav className="landing-nav" aria-label="Landing page sections">
          <a href="#how-it-works">How it works</a>
          <a href="#features">Features</a>
          <a href="#privacy">Privacy</a>
          {repositoryUrl ? (
            <a href={repositoryUrl}>GitHub</a>
          ) : (
            <span aria-disabled="true">GitHub soon</span>
          )}
        </nav>
        <Link className="landing-header__cta" href="/compare" aria-label="Compare libraries">
          <span className="landing-copy-desktop">Compare</span>
          <span className="landing-copy-mobile">Use desktop</span>
        </Link>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero__content">
          <p className="landing-eyebrow">Conservative Adobe Tags comparison</p>
          <h1 id="landing-title">Compare Adobe Launch libraries with confidence.</h1>
          <p>
            See exactly what changed between two deployed Adobe Launch libraries, including Rules,
            Data Elements, Extensions, deferred resources, custom code, and downstream dependency
            impact.
          </p>
          <div className="landing-hero__actions">
            <Link className="landing-primary-cta" href="/compare" aria-label="Compare libraries">
              <span className="landing-copy-desktop">Compare</span>
              <span className="landing-copy-mobile">Use desktop</span>
            </Link>
            <a className="landing-secondary-cta" href="#how-it-works">
              Details
            </a>
          </div>
          <p className="landing-hero__note">
            The detailed comparison workspace opens at 1024 CSS pixels and wider for accurate
            side-by-side review.
          </p>
        </div>
      </section>

      <section id="how-it-works" className="landing-intro" aria-labelledby="intro-title">
        <div>
          <p className="landing-eyebrow">How it works</p>
          <h2 id="intro-title">LaunchDiff favors explicit evidence over tidy guesses.</h2>
        </div>
        <p>
          Top-level Launch resources match by resource ID and type. When certainty is insufficient,
          LaunchDiff exposes the potential difference rather than hiding a plausible deployed change.
        </p>
      </section>

      <section id="features" className="landing-stories" aria-label="Product capabilities">
        {storySections.map((section, index) => (
          <article
            key={section.id}
            className="landing-story"
            data-reverse={index % 2 === 1 ? "true" : "false"}
          >
            <div className="landing-story__copy">
              <p className="landing-eyebrow">{section.eyebrow}</p>
              <h2>{section.title}</h2>
              <p>{section.body}</p>
            </div>
            <Image
              className="landing-story__visual"
              src={section.image}
              alt={section.alt}
              width={1280}
              height={720}
              sizes="(max-width: 980px) calc(100vw - 36px), 58vw"
              loading="lazy"
            />
          </article>
        ))}
      </section>

      <section className="landing-notes" aria-labelledby="notes-title">
        <div>
          <p className="landing-eyebrow">Release notes</p>
          <h2 id="notes-title">Release-ready technical notes, generated deterministically.</h2>
        </div>
        <p>
          LaunchDiff summarizes direct changes, dependency impact, and analysis warnings in Markdown
          without AI, unsupported business claims, or source-map interpretation.
        </p>
      </section>

      <section id="privacy" className="landing-trust" aria-labelledby="trust-title">
        <div className="landing-trust__heading">
          <p className="landing-eyebrow">Trust model</p>
          <h2 id="trust-title">Built for public deployed artifacts, not private storage.</h2>
        </div>
        <ul>
          {trustItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="landing-final" aria-labelledby="final-title">
        <LaunchDiffMark decorative />
        <h2 id="final-title">Know exactly what changed before you publish.</h2>
        <Link className="landing-primary-cta" href="/compare" aria-label="Compare libraries">
          <span className="landing-copy-desktop">Compare</span>
          <span className="landing-copy-mobile">Use desktop</span>
        </Link>
      </section>
    </main>
  );
}

function LaunchDiffMark({ decorative }: { decorative?: boolean }) {
  return (
    <svg
      className="landing-mark"
      viewBox="0 0 56 32"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "LaunchDiff mark"}
      aria-hidden={decorative ? "true" : undefined}
      focusable="false"
    >
      <rect x="1" y="1" width="54" height="30" rx="6" />
      <path d="M11 9 L5 16 L11 23" />
      <path d="M45 9 L51 16 L45 23" />
      <text x="14" y="21">
        LD/
      </text>
    </svg>
  );
}
