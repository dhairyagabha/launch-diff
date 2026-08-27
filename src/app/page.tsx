import Image from "next/image";
import Link from "next/link";
import {
  AlertIcon,
  ArrowRightIcon,
  BookIcon,
  CodeReviewIcon,
  DatabaseIcon,
  DiffModifiedIcon,
  FileCodeIcon,
  FileDiffIcon,
  FileDirectoryIcon,
  GitCompareIcon,
  GlobeIcon,
  NoteIcon,
  PackageDependentsIcon,
  ShieldCheckIcon,
  WorkflowIcon
} from "@primer/octicons-react";

const repositoryUrl = process.env.NEXT_PUBLIC_GITHUB_REPOSITORY_URL;

const storySections = [
  {
    id: "changes",
    eyebrow: "Deployed changes",
    title: "See every deployed change.",
    body: "LaunchDiff treats the exact CDN artifact as authoritative, resolves parser-confirmed deferred and external custom-code resources, and keeps split diffs focused on the code that actually shipped.",
    badge: "Split diff",
    detail: "External code resolved",
    icon: FileDiffIcon,
    image: "/landing/workspace-split-diff.webp",
    alt: "Actual LaunchDiff comparison workspace showing a split diff with rule and data element resources."
  },
  {
    id: "impact",
    eyebrow: "Dependency impact",
    title: "Understand downstream impact.",
    body: "Data Element references from percent tokens and literal getVar calls are traced into direct and transitive paths, so unchanged resources can still be flagged as impacted without being mislabeled as modified.",
    badge: "Dependency graph",
    detail: "Direct and transitive",
    icon: PackageDependentsIcon,
    image: "/landing/workspace-impacted-resources.webp",
    alt: "Actual LaunchDiff impacted resources view showing a transitive Data Element dependency."
  },
  {
    id: "resolved",
    eyebrow: "Resolved library",
    title: "Validate the complete resource graph.",
    body: "Canonical and deferred resources end in explicit states: resolved, failed, skipped by a documented limit, or unsupported. Warnings and retry paths stay visible instead of disappearing into a clean-looking diff.",
    badge: "Fetch states",
    detail: "Resolved or explicit",
    icon: FileDirectoryIcon,
    image: "/landing/workspace-resolved-files.webp",
    alt: "Actual LaunchDiff resolved files view showing resolved and failed fetched resources."
  }
];

const workflowSteps = [
  {
    phase: "Input",
    title: "Add public library URLs.",
    body: "Use deployed Adobe Tags URLs or the sample config. Non-minified environment URLs help readability; deployed artifacts stay authoritative.",
    icon: GlobeIcon
  },
  {
    phase: "Resolve",
    title: "Resolve the resource graph.",
    body: "Only parser-confirmed Launch resources are followed. External custom code and fetch states stay visible.",
    icon: WorkflowIcon
  },
  {
    phase: "Compare",
    title: "Compare matched resources.",
    body: "Top-level resources match by Launch identity. Formatting improves readability without hiding executable changes.",
    icon: GitCompareIcon
  },
  {
    phase: "Review",
    title: "Review the evidence.",
    body: "Use split diffs, resolved files, dependency impact, and deterministic notes with uncertainty kept visible.",
    icon: CodeReviewIcon
  }
];

const trustBoundaries = [
  {
    label: "Fetch boundary",
    title: "Public-only fetches",
    summary:
      "LaunchDiff reads public deployed libraries and parser-confirmed Launch resources; it is not a generic crawler or Adobe API client.",
    items: [
      "No Adobe authentication",
      "No private crawling",
      "Only parser-confirmed Launch resources are followed"
    ],
    icon: GlobeIcon
  },
  {
    label: "Execution boundary",
    title: "Static source review",
    summary:
      "Downloaded JavaScript is parsed and formatted as data. Execution stays outside the analysis path.",
    items: [
      "No eval or VM execution",
      "No AI dependency",
      "No source-map interpretation"
    ],
    icon: ShieldCheckIcon
  },
  {
    label: "Storage boundary",
    title: "Session-scoped output",
    summary:
      "Review material stays ephemeral: source, URLs, diffs, and notes are not durably stored by the app.",
    items: [
      "No accounts or database",
      "No persistent source storage",
      "Only minimal aggregate usage measurement"
    ],
    icon: DatabaseIcon
  }
];

const trustFlow = [
  { label: "Public CDN files", icon: GlobeIcon },
  { label: "Static parser", icon: FileCodeIcon },
  { label: "Reviewer workspace", icon: CodeReviewIcon }
];

const documentationItems = [
  {
    label: "Setup",
    title: "Compare setup",
    body: "Use public Adobe Tags library URLs or a saved config. Non-minified environment URLs make review easier, but deployed artifacts still drive classification.",
    icon: GlobeIcon
  },
  {
    label: "Review",
    title: "Diff review",
    body: "Changed and needs-review resources open in a split diff with resolved external code, readable formatting, and explicit unresolved states.",
    icon: CodeReviewIcon
  },
  {
    label: "Output",
    title: "Release notes",
    body: "Deterministic summaries group direct changes, recreated-resource candidates, Data Element references, dependency impact, and analysis warnings.",
    icon: NoteIcon
  }
];

const releaseNoteHighlights = [
  {
    title: "Changed resources",
    body: "Rules, Data Elements, and Extensions are grouped by resource type with recreated-resource candidates called out for review.",
    icon: DiffModifiedIcon
  },
  {
    title: "Dependency impact",
    body: "Data Element reference changes list the resources they can affect instead of turning every dependency into a modified resource.",
    icon: PackageDependentsIcon
  },
  {
    title: "Analysis warnings",
    body: "Fetch failures, unsupported resources, and safety limits stay attached to the notes when the comparison is not fully complete.",
    icon: AlertIcon
  }
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
          <a href="#documentation">Documentation</a>
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
            Data Elements, Extensions, deferred resources, external custom code, and downstream
            dependency impact.
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
            For accurate split review, open the comparison workspace on a desktop viewport, 1024
            CSS pixels or wider.
          </p>
        </div>
      </section>

      <section id="how-it-works" className="landing-intro" aria-labelledby="intro-title">
        <div className="landing-intro__inner">
          <div className="landing-intro__copy">
            <div className="landing-section-heading">
              <p className="landing-eyebrow">How it works</p>
              <h2 id="intro-title">From public URLs to reviewable evidence.</h2>
            </div>
            <p>
              LaunchDiff turns two deployed library artifacts into a static review package: resolved
              resources, readable diffs, dependency impact, and release notes that explain what
              changed without guessing past the evidence.
            </p>
          </div>
          <ol className="landing-workflow">
            {workflowSteps.map((step) => {
              const StepIcon = step.icon;

              return (
                <li key={step.title}>
                  <div className="landing-workflow__meta">
                    <span>{step.phase}</span>
                    <StepIcon size={20} aria-hidden="true" />
                  </div>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section id="features" className="landing-stories" aria-labelledby="features-title">
        <div className="landing-stories__inner">
          <div className="landing-stories__heading">
            <div className="landing-section-heading">
              <p className="landing-eyebrow">Review surfaces</p>
              <h2 id="features-title">Everything important stays inspectable.</h2>
            </div>
            <p>
              The workspace keeps the real comparison artifacts close together: changed code,
              dependency impact, and fetch completeness are visible before anyone writes release
              notes or approves a publish.
            </p>
          </div>
          <div className="landing-feature-grid">
            {storySections.map((section) => {
              const SectionIcon = section.icon;

              return (
                <article key={section.id} className="landing-feature-card">
                  <div className="landing-feature-card__toolbar">
                    <span>
                      <SectionIcon size={18} aria-hidden="true" />
                      {section.badge}
                    </span>
                    <span>{section.detail}</span>
                  </div>
                  <Image
                    className="landing-feature-card__visual"
                    src={section.image}
                    alt={section.alt}
                    width={1280}
                    height={720}
                    sizes="(max-width: 720px) calc(100vw - 36px), (max-width: 1180px) 50vw, 360px"
                    loading="eager"
                  />
                  <div className="landing-feature-card__copy">
                    <p className="landing-eyebrow">{section.eyebrow}</p>
                    <h3>{section.title}</h3>
                    <p>{section.body}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="landing-notes" aria-labelledby="notes-title">
        <div className="landing-notes__inner">
          <div className="landing-notes__copy">
            <div className="landing-section-heading">
              <p className="landing-eyebrow">Release notes</p>
              <h2 id="notes-title">Readable summaries without invented meaning.</h2>
            </div>
            <p>
              Notes are deterministic and reviewer-focused. They summarize direct changes, Data
              Element reference updates, dependency impact, and analysis warnings without AI,
              source-map interpretation, or unsupported business claims.
            </p>
          </div>
          <div className="landing-notes__panel" aria-label="Release note structure">
            <div className="landing-panel-toolbar">
              <span>
                <NoteIcon size={18} aria-hidden="true" />
                Deterministic Markdown
              </span>
              <span>No AI summary</span>
            </div>
            <ol>
              {releaseNoteHighlights.map((item) => {
                const ItemIcon = item.icon;

                return (
                  <li key={item.title}>
                    <ItemIcon size={18} aria-hidden="true" />
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </section>

      <section id="documentation" className="landing-documentation" aria-labelledby="docs-title">
        <div className="landing-documentation__inner">
          <div className="landing-documentation__heading">
            <div className="landing-section-heading">
              <p className="landing-eyebrow">Documentation</p>
              <h2 id="docs-title">The review path is visible before analysis starts.</h2>
            </div>
            <p>
              A compact guide covers setup, review flow, and output semantics, so teams know what
              LaunchDiff will and will not infer before pasting a URL.
            </p>
          </div>
          <div className="landing-doc-shell">
            <div className="landing-doc-tabs" aria-label="Documentation topics">
              {documentationItems.map((item) => (
                <span key={item.label}>{item.label}</span>
              ))}
            </div>
            <ol className="landing-doc-list">
              {documentationItems.map((item) => {
                const ItemIcon = item.icon;

                return (
                  <li key={item.title}>
                    <div className="landing-doc-list__icon">
                      <ItemIcon size={18} aria-hidden="true" />
                    </div>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.body}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </section>

      <section id="privacy" className="landing-trust" aria-labelledby="trust-title">
        <div className="landing-trust__inner">
          <div className="landing-trust__heading">
            <div className="landing-section-heading">
              <p className="landing-eyebrow">Trust model</p>
              <h2 id="trust-title">Clear boundaries for public-library review.</h2>
            </div>
            <p>
              LaunchDiff keeps its responsibilities narrow: fetch public artifacts, analyze them
              statically, and hand the reviewer a transparent comparison without storing review
              material long term.
            </p>
          </div>
          <div className="landing-trust__visual">
            <div className="landing-trust__flow" aria-hidden="true">
              {trustFlow.map((step, index) => {
                const FlowIcon = step.icon;

                return (
                  <div className="landing-trust__flow-group" key={step.label}>
                    <span>
                      <FlowIcon size={18} />
                      {step.label}
                    </span>
                    {index < trustFlow.length - 1 ? (
                      <ArrowRightIcon className="landing-trust__arrow" size={18} />
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="landing-trust__matrix">
              {trustBoundaries.map((boundary) => {
                const BoundaryIcon = boundary.icon;

                return (
                  <article key={boundary.title}>
                    <div className="landing-trust__card-heading">
                      <BoundaryIcon size={20} aria-hidden="true" />
                      <span>{boundary.label}</span>
                    </div>
                    <h3>{boundary.title}</h3>
                    <p>{boundary.summary}</p>
                    <ul>
                      {boundary.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="landing-final" aria-labelledby="final-title">
        <div className="landing-final__inner">
          <div className="landing-final__copy">
            <LaunchDiffMark decorative />
            <div>
              <p className="landing-eyebrow">Ready for review</p>
              <h2 id="final-title">Know exactly what changed before you publish.</h2>
              <p>Bring the deployed artifact, the readable diff, and the impact trail into one review.</p>
            </div>
          </div>
          <div className="landing-final__actions">
            <Link className="landing-primary-cta" href="/compare" aria-label="Compare libraries">
              <span className="landing-copy-desktop">Compare</span>
              <span className="landing-copy-mobile">Use desktop</span>
              <ArrowRightIcon size={16} aria-hidden="true" />
            </Link>
            <a className="landing-secondary-cta" href="#documentation">
              <BookIcon size={16} aria-hidden="true" />
              Docs
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

function LaunchDiffMark({ decorative }: { decorative?: boolean }) {
  return (
    <svg
      className="landing-mark"
      viewBox="0 0 48 48"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "LaunchDiff mark"}
      aria-hidden={decorative ? "true" : undefined}
      focusable="false"
    >
      <rect className="landing-mark__frame" x="4" y="5" width="40" height="38" rx="9" />
      <path className="landing-mark__divider" d="M24 12 V36" />
      <path className="landing-mark__line landing-mark__line--base" d="M12 16 H19" />
      <path className="landing-mark__line landing-mark__line--base" d="M12 24 H20.5" />
      <path className="landing-mark__line landing-mark__line--base" d="M12 32 H18" />
      <path className="landing-mark__line landing-mark__line--compare" d="M29 24 H36" />
      <path className="landing-mark__line landing-mark__line--compare" d="M29 32 H38" />
      <path className="landing-mark__plus" d="M33.5 13.5 V20.5 M30 17 H37" />
    </svg>
  );
}
