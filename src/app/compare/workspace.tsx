"use client";

import {
  AlertIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSwitchIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  DeviceDesktopIcon,
  DownloadIcon,
  EyeClosedIcon,
  EyeIcon,
  FileCodeIcon,
  FilterIcon,
  MoonIcon,
  QuestionIcon,
  SearchIcon,
  StopIcon,
  SunIcon,
  SyncIcon,
  UploadIcon,
  XCircleIcon,
  XIcon
} from "@primer/octicons-react";
import { useTheme } from "@primer/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type RefObject,
  type SetStateAction
} from "react";
import {
  AnalysisAlreadyRunningError,
  AnalyzerWorkerClient,
  createBrowserAnalysisConcurrencyCoordinator,
  loadSessionConfig,
  saveSessionConfig,
  type BrowserAnalysisProgress
} from "@/browser/analyzer";
import {
  parseLaunchDiffConfig,
  tokenizeSyntaxLine,
  type ComparisonResult,
  type DiffLine,
  type FunctionFold,
  type LaunchDiffConfig,
  type ResourceComparison,
  type ResourceType,
  type ResolvedFile,
  type SplitDiffRow,
  type SyntaxToken
} from "@/core/launch-analyzer";
import {
  buildSanitizedDiagnosticReport,
  comparisonCounts,
  comparisonDisplayName,
  comparisonResourceKey,
  completenessBanner,
  fileDisplayName,
  groupResourceComparisons,
  reviewProgress,
  resourceTypeLabel,
  statusLabel,
  type ResultTab,
  type StatusFilter,
  type TypeFilter
} from "./workspace-model";

type SetupMode = "direct" | "config";
type WorkspacePhase = "setup" | "running" | "ready";
type AnalysisAction = "analyze" | "retry" | "refresh";
type DiffViewMode = "changes" | "source";

interface AnalysisUrls {
  baseUrl: string;
  compareUrl: string;
}

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "modified", label: "Modified" },
  { value: "added", label: "Added" },
  { value: "removed", label: "Removed" },
  { value: "unknown", label: "Unknown" },
  { value: "unchanged", label: "Same" },
  { value: "impacted", label: "Impact" }
];

const TYPE_FILTERS: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "All resource types" },
  { value: "rule", label: "Rules" },
  { value: "data-element", label: "Data Elements" },
  { value: "extension", label: "Extensions" },
  { value: "runtime", label: "Runtime" },
  { value: "unmapped", label: "Unmapped" }
];

const RESULT_TABS: Array<{ id: ResultTab; label: string }> = [
  { id: "files", label: "Files Changed" },
  { id: "impacted", label: "Impacted" },
  { id: "resolved", label: "Resolved Files" },
  { id: "notes", label: "Release Notes" }
];

const PHASE_LABELS: Record<BrowserAnalysisProgress["phase"], string> = {
  "fetching-canonical": "Fetching canonical libraries",
  parsing: "Parsing Launch containers",
  "resolving-deferred": "Resolving deferred Launch resources",
  normalizing: "Normalizing deployed artifacts",
  matching: "Matching resources",
  "dependency-analysis": "Building dependency graph",
  comparing: "Comparing resources",
  "preparing-diffs": "Preparing detailed diffs",
  complete: "Complete"
};

function createWorkerClient(): AnalyzerWorkerClient {
  return new AnalyzerWorkerClient(
    new Worker(new URL("../../workers/analyzer.worker.ts", import.meta.url), {
      type: "module"
    })
  );
}

export function CompareWorkspace() {
  const [phase, setPhase] = useState<WorkspacePhase>("setup");
  const [setupMode, setSetupMode] = useState<SetupMode>("direct");
  const [baseUrl, setBaseUrl] = useState("");
  const [compareUrl, setCompareUrl] = useState("");
  const [config, setConfig] = useState<LaunchDiffConfig>();
  const [selectedSiteName, setSelectedSiteName] = useState("");
  const [baseEnvironmentName, setBaseEnvironmentName] = useState("");
  const [compareEnvironmentName, setCompareEnvironmentName] = useState("");
  const [comparison, setComparison] = useState<ComparisonResult>();
  const [progress, setProgress] = useState<BrowserAnalysisProgress>();
  const [error, setError] = useState<string>();
  const [activeTab, setActiveTab] = useState<ResultTab>("files");
  const [selectedResourceKey, setSelectedResourceKey] = useState<string>();
  const [viewedResourceKeys, setViewedResourceKeys] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>("changes");
  const [wrapDiffLines, setWrapDiffLines] = useState(true);
  const [expandedHunkIds, setExpandedHunkIds] = useState<Set<string>>(() => new Set());
  const [collapsedFoldIds, setCollapsedFoldIds] = useState<Set<string>>(() => new Set());
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [diagnosticCopyState, setDiagnosticCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );
  const workerClientRef = useRef<AnalyzerWorkerClient | undefined>(undefined);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedSite = config?.sites.find((site) => site.name === selectedSiteName);
  const counts = useMemo(
    () => (comparison ? comparisonCounts(comparison) : undefined),
    [comparison]
  );
  const progressCount = useMemo(
    () => (comparison ? reviewProgress(comparison, viewedResourceKeys) : { reviewed: 0, total: 0 }),
    [comparison, viewedResourceKeys]
  );
  const visibleGroups = useMemo(
    () =>
      comparison
        ? groupResourceComparisons(comparison.resources, {
            query,
            status: statusFilter,
            type: typeFilter,
            showUnchanged,
            viewedResourceKeys
          })
        : [],
    [comparison, query, showUnchanged, statusFilter, typeFilter, viewedResourceKeys]
  );
  const visibleResourceKeys = useMemo(
    () => visibleGroups.flatMap((group) => group.resources.map(comparisonResourceKey)),
    [visibleGroups]
  );
  const changedResourceKeys = useMemo(
    () =>
      comparison?.resources
        .filter((resource) => isReviewableStatus(resource.status))
        .map(comparisonResourceKey) ?? [],
    [comparison]
  );
  const selectedComparison = useMemo(
    () =>
      comparison?.resources.find(
        (resource) => comparisonResourceKey(resource) === selectedResourceKey
      ) ?? visibleGroups[0]?.resources[0],
    [comparison, selectedResourceKey, visibleGroups]
  );
  const selectedDiff = selectedComparison?.detailedDiff;

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const storedConfig = loadSessionConfig();

        if (!storedConfig) {
          return;
        }

        setConfig(storedConfig);
        setSetupMode("config");
        applyDefaultConfigSelection(storedConfig, {
          setSelectedSiteName,
          setBaseEnvironmentName,
          setCompareEnvironmentName
        });
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "Saved config could not be loaded."
        );
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      workerClientRef.current?.terminate();
    };
  }, []);

  useEffect(() => {
    if (!comparison) {
      return;
    }

    queueMicrotask(() => {
      if (!selectedResourceKey || !visibleResourceKeys.includes(selectedResourceKey)) {
        setSelectedResourceKey(
          visibleResourceKeys[0] ??
            (comparison.resources[0] ? comparisonResourceKey(comparison.resources[0]) : undefined)
        );
      }
    });
  }, [comparison, selectedResourceKey, visibleResourceKeys]);

  useEffect(() => {
    queueMicrotask(() => {
      if (!selectedDiff) {
        setCollapsedFoldIds(new Set());
        return;
      }

      setCollapsedFoldIds(
        new Set(
          flattenFunctionFolds(selectedDiff.functionFolds)
            .filter((fold) => fold.collapsedByDefault)
            .map((fold) => fold.id)
        )
      );
      setExpandedHunkIds(new Set());
    });
  }, [selectedDiff]);

  const navigateResource = useCallback(
    (direction: "next" | "previous") => {
      const keys = visibleResourceKeys.length > 0 ? visibleResourceKeys : changedResourceKeys;

      if (keys.length === 0) {
        return;
      }

      const currentIndex = Math.max(0, keys.indexOf(selectedResourceKey ?? keys[0]!));
      const nextIndex =
        direction === "next"
          ? Math.min(keys.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
      setSelectedResourceKey(keys[nextIndex]);
    },
    [changedResourceKeys, selectedResourceKey, visibleResourceKeys]
  );

  const navigateTab = useCallback(
    (direction: "next" | "previous") => {
      const currentIndex = RESULT_TABS.findIndex((tab) => tab.id === activeTab);
      const nextIndex =
        direction === "next"
          ? Math.min(RESULT_TABS.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
      setActiveTab(RESULT_TABS[nextIndex]!.id);
    },
    [activeTab]
  );

  const toggleSelectedViewed = useCallback(() => {
    if (!selectedComparison) {
      return;
    }

    const key = comparisonResourceKey(selectedComparison);
    setViewedResourceKeys((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }, [selectedComparison]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;

      if (isTyping && event.key !== "Escape") {
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setShowKeyboardHelp((current) => !current);
        return;
      }

      if (event.key === "Escape") {
        if (showKeyboardHelp) {
          setShowKeyboardHelp(false);
        } else {
          setQuery("");
        }
        return;
      }

      if (!comparison) {
        return;
      }

      if (event.key === "j" || event.key === "n") {
        event.preventDefault();
        navigateResource("next");
        return;
      }

      if (event.key === "k" || event.key === "p") {
        event.preventDefault();
        navigateResource("previous");
        return;
      }

      if (event.key === "v") {
        event.preventDefault();
        toggleSelectedViewed();
        return;
      }

      if (event.key === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === "]") {
        event.preventDefault();
        navigateTab("next");
        return;
      }

      if (event.key === "[") {
        event.preventDefault();
        navigateTab("previous");
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [comparison, navigateResource, navigateTab, showKeyboardHelp, toggleSelectedViewed]);

  function resolveUrls(): { ok: true; urls: AnalysisUrls } | { ok: false; message: string } {
    if (setupMode === "config") {
      const site = config?.sites.find((candidate) => candidate.name === selectedSiteName);
      const baseEnvironment = site?.environments.find(
        (environment) => environment.name === baseEnvironmentName
      );
      const compareEnvironment = site?.environments.find(
        (environment) => environment.name === compareEnvironmentName
      );

      if (!site || !baseEnvironment || !compareEnvironment) {
        return { ok: false, message: "Choose a site and two environments before comparing." };
      }

      return validateAnalysisUrls(baseEnvironment.url, compareEnvironment.url);
    }

    return validateAnalysisUrls(baseUrl, compareUrl);
  }

  async function runAnalysis(action: AnalysisAction = "analyze") {
    const resolvedUrls = resolveUrls();

    if (!resolvedUrls.ok) {
      setError(resolvedUrls.message);
      return;
    }

    setError(undefined);
    setProgress(undefined);
    setCopyState("idle");
    setDiagnosticCopyState("idle");
    setPhase("running");

    const client = workerClientRef.current ?? createWorkerClient();
    workerClientRef.current = client;
    const coordinator = createBrowserAnalysisConcurrencyCoordinator();

    try {
      const result = await coordinator.runExclusive(() => {
        const input = {
          ...resolvedUrls.urls,
          selectedResourceKey
        };

        if (action === "retry") {
          return client.retryFailedResources(input, setProgress);
        }

        if (action === "refresh") {
          return client.refreshLibraries(input, setProgress);
        }

        return client.analyze(input, setProgress);
      });

      const initialResource = pickInitialResource(result);
      setComparison(result);
      setViewedResourceKeys(new Set());
      setSelectedResourceKey(initialResource ? comparisonResourceKey(initialResource) : undefined);
      setActiveTab("files");
      setPhase("ready");
    } catch (analysisError) {
      if (analysisError instanceof AnalysisAlreadyRunningError) {
        setError(
          "Another comparison is already running in this browser. Wait for it to finish, then retry."
        );
      } else {
        setError(analysisError instanceof Error ? analysisError.message : "Analysis failed.");
      }

      setPhase(comparison ? "ready" : "setup");
    } finally {
      coordinator.close();
      setProgress(undefined);
    }
  }

  function cancelAnalysis() {
    workerClientRef.current?.cancel();
  }

  async function handleConfigFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (!file) {
      return;
    }

    try {
      const parsed = parseLaunchDiffConfig(JSON.parse(await file.text()));
      saveSessionConfig(parsed);
      setConfig(parsed);
      setSetupMode("config");
      applyDefaultConfigSelection(parsed, {
        setSelectedSiteName,
        setBaseEnvironmentName,
        setCompareEnvironmentName
      });
      setError(undefined);
    } catch (configError) {
      setError(
        configError instanceof Error ? configError.message : "Config file could not be parsed."
      );
    } finally {
      event.currentTarget.value = "";
    }
  }

  async function copyReleaseNotes() {
    if (!comparison) {
      return;
    }

    try {
      await navigator.clipboard.writeText(comparison.releaseNotes);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  async function copyDiagnosticReport() {
    if (!comparison) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        buildSanitizedDiagnosticReport({
          comparison,
          inputMode: setupMode === "config" ? "saved-config" : "direct-url",
          workspacePhase: phase,
          activeTab,
          reviewProgress: progressCount,
          browser: browserDiagnostic()
        })
      );
      setDiagnosticCopyState("copied");
    } catch {
      setDiagnosticCopyState("failed");
    }
  }

  function downloadReleaseNotes() {
    if (!comparison) {
      return;
    }

    const blob = new Blob([comparison.releaseNotes], { type: "text/markdown;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "launchdiff-release-notes.md";
    link.click();
    URL.revokeObjectURL(objectUrl);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runAnalysis("analyze");
  }

  const banner = comparison
    ? completenessBanner(comparison.base.completeness, comparison.compare.completeness)
    : undefined;
  const currentUrls = resolveUrls();

  return (
    <>
      <DesktopRequiredMessage />
      <main className="compare-workspace" aria-label="LaunchDiff comparison workspace">
        {phase === "setup" && (
          <SetupPanel
            setupMode={setupMode}
            setSetupMode={setSetupMode}
            baseUrl={baseUrl}
            compareUrl={compareUrl}
            setBaseUrl={setBaseUrl}
            setCompareUrl={setCompareUrl}
            config={config}
            selectedSite={selectedSite}
            selectedSiteName={selectedSiteName}
            baseEnvironmentName={baseEnvironmentName}
            compareEnvironmentName={compareEnvironmentName}
            setSelectedSiteName={setSelectedSiteName}
            setBaseEnvironmentName={setBaseEnvironmentName}
            setCompareEnvironmentName={setCompareEnvironmentName}
            onConfigFile={handleConfigFile}
            onSubmit={handleSubmit}
            onSwap={() => {
              if (setupMode === "config") {
                setBaseEnvironmentName(compareEnvironmentName);
                setCompareEnvironmentName(baseEnvironmentName);
              } else {
                setBaseUrl(compareUrl);
                setCompareUrl(baseUrl);
              }
            }}
            error={error}
          />
        )}

        {phase !== "setup" && (
          <>
            <WorkspaceHeader
              baseUrl={currentUrls.ok ? currentUrls.urls.baseUrl : baseUrl}
              compareUrl={currentUrls.ok ? currentUrls.urls.compareUrl : compareUrl}
              phase={phase}
              progress={progress}
              counts={counts}
              reviewProgress={progressCount}
              onEdit={() => setPhase("setup")}
              onRefresh={() => void runAnalysis("refresh")}
              onRetry={() => void runAnalysis("retry")}
              onCancel={cancelAnalysis}
              diagnosticCopyState={diagnosticCopyState}
              onCopyDiagnostics={() => void copyDiagnosticReport()}
            />
            {error && <InlineBanner tone="danger" title="Analysis failed" description={error} />}
            {banner && (
              <InlineBanner
                tone={banner.tone}
                title={banner.title}
                description={banner.description}
              />
            )}
            <ResultTabs activeTab={activeTab} setActiveTab={setActiveTab} comparison={comparison} />
            {comparison && activeTab === "files" && (
              <FilesChangedView
                selectedComparison={selectedComparison}
                allComparisons={comparison.resources}
                viewedResourceKeys={viewedResourceKeys}
                visibleGroups={visibleGroups}
                searchInputRef={searchInputRef}
                query={query}
                statusFilter={statusFilter}
                typeFilter={typeFilter}
                showUnchanged={showUnchanged}
                diffViewMode={diffViewMode}
                wrapDiffLines={wrapDiffLines}
                expandedHunkIds={expandedHunkIds}
                collapsedFoldIds={collapsedFoldIds}
                setQuery={setQuery}
                setStatusFilter={setStatusFilter}
                setTypeFilter={setTypeFilter}
                setShowUnchanged={setShowUnchanged}
                setDiffViewMode={setDiffViewMode}
                setWrapDiffLines={setWrapDiffLines}
                setSelectedResourceKey={setSelectedResourceKey}
                setViewedResourceKeys={setViewedResourceKeys}
                setExpandedHunkIds={setExpandedHunkIds}
                setCollapsedFoldIds={setCollapsedFoldIds}
                onPrevious={() => navigateResource("previous")}
                onNext={() => navigateResource("next")}
              />
            )}
            {comparison && activeTab === "impacted" && <ImpactedView comparison={comparison} />}
            {comparison && activeTab === "resolved" && (
              <ResolvedFilesView comparison={comparison} />
            )}
            {comparison && activeTab === "notes" && (
              <ReleaseNotesView
                releaseNotes={comparison.releaseNotes}
                copyState={copyState}
                onCopy={() => void copyReleaseNotes()}
                onDownload={downloadReleaseNotes}
              />
            )}
          </>
        )}
        <button
          className="compare-help-button"
          type="button"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          onClick={() => setShowKeyboardHelp(true)}
        >
          <QuestionIcon size={16} />
        </button>
        {showKeyboardHelp && <KeyboardHelpDialog onClose={() => setShowKeyboardHelp(false)} />}
      </main>
    </>
  );
}

function DesktopRequiredMessage() {
  return (
    <main className="compare-desktop-required" aria-label="Desktop viewport required">
      <section className="compare-desktop-required__panel">
        <FileCodeIcon size={28} />
        <h1>Desktop workspace required</h1>
        <p>
          LaunchDiff keeps the comparison view at 1024 CSS pixels or wider so split diffs, resource
          navigation, and review controls remain accurate.
        </p>
      </section>
    </main>
  );
}

function SetupPanel(props: {
  setupMode: SetupMode;
  setSetupMode: (mode: SetupMode) => void;
  baseUrl: string;
  compareUrl: string;
  setBaseUrl: (value: string) => void;
  setCompareUrl: (value: string) => void;
  config?: LaunchDiffConfig;
  selectedSite?: LaunchDiffConfig["sites"][number];
  selectedSiteName: string;
  baseEnvironmentName: string;
  compareEnvironmentName: string;
  setSelectedSiteName: (value: string) => void;
  setBaseEnvironmentName: (value: string) => void;
  setCompareEnvironmentName: (value: string) => void;
  onConfigFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSwap: () => void;
  error?: string;
}) {
  return (
    <form className="compare-setup" onSubmit={props.onSubmit}>
      <div className="compare-setup__header">
        <div>
          <p className="compare-eyebrow">LaunchDiff</p>
          <h1>Compare deployed Adobe Tags libraries</h1>
          <p>
            Choose two current Launch library URLs. Analysis happens in a browser Worker after a
            thin server fetch handshake.
          </p>
          <p className="compare-form-note" id="compare-readable-url-note">
            Prefer a non-minified Adobe Tags environment URL when one is available. Minified URLs
            still work, but readable URLs make review easier.
          </p>
        </div>
        <div className="compare-setup__controls">
          <ThemeModeControl />
          <div className="compare-mode-toggle" role="tablist" aria-label="Input mode">
            <button
              type="button"
              role="tab"
              aria-selected={props.setupMode === "direct"}
              className={props.setupMode === "direct" ? "is-selected" : undefined}
              onClick={() => props.setSetupMode("direct")}
            >
              Direct URLs
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={props.setupMode === "config"}
              className={props.setupMode === "config" ? "is-selected" : undefined}
              onClick={() => props.setSetupMode("config")}
            >
              Saved Config
            </button>
          </div>
        </div>
      </div>

      {props.error && (
        <InlineBanner tone="danger" title="Setup needs attention" description={props.error} />
      )}

      {props.setupMode === "direct" ? (
        <div className="compare-url-grid">
          <label className="compare-field">
            <span>Base library URL</span>
            <input
              type="url"
              inputMode="url"
              required
              aria-describedby="compare-readable-url-note"
              placeholder="https://assets.example.com/.../launch-abc.min.js"
              value={props.baseUrl}
              onChange={(event) => props.setBaseUrl(event.currentTarget.value)}
            />
          </label>
          <button
            className="compare-icon-button compare-swap-button"
            type="button"
            aria-label="Swap base and compare"
            title="Swap base and compare"
            onClick={props.onSwap}
          >
            <ArrowSwitchIcon size={16} />
          </button>
          <label className="compare-field">
            <span>Compare library URL</span>
            <input
              type="url"
              inputMode="url"
              required
              aria-describedby="compare-readable-url-note"
              placeholder="https://assets.example.com/.../launch-def.min.js"
              value={props.compareUrl}
              onChange={(event) => props.setCompareUrl(event.currentTarget.value)}
            />
          </label>
        </div>
      ) : (
        <div className="compare-config-grid">
          <label className="compare-upload">
            <UploadIcon size={16} />
            <span>Load config JSON</span>
            <input type="file" accept="application/json,.json" onChange={props.onConfigFile} />
          </label>
          <label className="compare-field">
            <span>Site</span>
            <select
              value={props.selectedSiteName}
              onChange={(event) => {
                const siteName = event.currentTarget.value;
                const site = props.config?.sites.find((candidate) => candidate.name === siteName);
                props.setSelectedSiteName(siteName);

                if (site) {
                  props.setBaseEnvironmentName(site.environments[0]?.name ?? "");
                  props.setCompareEnvironmentName(
                    site.environments[1]?.name ?? site.environments[0]?.name ?? ""
                  );
                }
              }}
            >
              <option value="">Choose site</option>
              {props.config?.sites.map((site) => (
                <option key={site.name} value={site.name}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label className="compare-field">
            <span>Base environment</span>
            <select
              value={props.baseEnvironmentName}
              onChange={(event) => props.setBaseEnvironmentName(event.currentTarget.value)}
            >
              <option value="">Choose base</option>
              {props.selectedSite?.environments.map((environment) => (
                <option key={environment.name} value={environment.name}>
                  {environment.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="compare-icon-button compare-swap-button"
            type="button"
            aria-label="Swap environments"
            title="Swap environments"
            onClick={props.onSwap}
          >
            <ArrowSwitchIcon size={16} />
          </button>
          <label className="compare-field">
            <span>Compare environment</span>
            <select
              value={props.compareEnvironmentName}
              onChange={(event) => props.setCompareEnvironmentName(event.currentTarget.value)}
            >
              <option value="">Choose compare</option>
              {props.selectedSite?.environments.map((environment) => (
                <option key={environment.name} value={environment.name}>
                  {environment.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="compare-setup__footer">
        <p>
          The comparator is intentionally conservative: plausible mismatches stay visible instead of
          being forced into tidy matches.
        </p>
        <button className="compare-primary-button" type="submit" aria-label="Compare libraries">
          <FileCodeIcon size={16} />
          Compare
        </button>
      </div>
    </form>
  );
}

function WorkspaceHeader(props: {
  baseUrl: string;
  compareUrl: string;
  phase: WorkspacePhase;
  progress?: BrowserAnalysisProgress;
  counts?: ReturnType<typeof comparisonCounts>;
  reviewProgress: { reviewed: number; total: number };
  onEdit: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onCancel: () => void;
  diagnosticCopyState: "idle" | "copied" | "failed";
  onCopyDiagnostics: () => void;
}) {
  return (
    <header className="compare-header">
      <div className="compare-header__main">
        <div
          className="compare-header__direction"
          title={`${props.baseUrl} -> ${props.compareUrl}`}
        >
          <span>{shortenUrl(props.baseUrl)}</span>
          <ArrowRightIcon size={14} />
          <span>{shortenUrl(props.compareUrl)}</span>
        </div>
        <div className="compare-header__summary" aria-live="polite">
          {props.phase === "running" && props.progress ? (
            <span>{formatProgress(props.progress)}</span>
          ) : props.counts ? (
            <>
              <strong>{props.counts.changed}</strong>
              <span>changed</span>
              <strong>{props.counts.impacted}</strong>
              <span>impacted</span>
              <strong>
                {props.reviewProgress.reviewed}/{props.reviewProgress.total}
              </strong>
              <span>viewed</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="compare-header__actions">
        <ThemeModeControl />
        <button className="compare-button" type="button" onClick={props.onEdit}>
          Edit
        </button>
        {props.phase === "running" ? (
          <button
            className="compare-button compare-button--danger"
            type="button"
            onClick={props.onCancel}
          >
            <StopIcon size={14} />
            Cancel
          </button>
        ) : (
          <>
            <button
              className="compare-button"
              type="button"
              aria-label="Retry failed resources"
              title="Retry failed resources"
              onClick={props.onRetry}
            >
              <SyncIcon size={14} />
              Retry
            </button>
            <button className="compare-button" type="button" onClick={props.onRefresh}>
              <SyncIcon size={14} />
              Refresh
            </button>
            <button
              className="compare-button"
              type="button"
              aria-label={diagnosticButtonLabel(props.diagnosticCopyState)}
              title="Copy sanitized diagnostic report"
              onClick={props.onCopyDiagnostics}
            >
              <CopyIcon size={14} />
              {props.diagnosticCopyState === "copied"
                ? "Copied"
                : props.diagnosticCopyState === "failed"
                  ? "Failed"
                  : "Diagnostics"}
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function ThemeModeControl() {
  const { colorMode, setColorMode } = useTheme();
  const mode = colorMode ?? "auto";

  return (
    <div className="compare-theme-control" role="group" aria-label="Theme mode">
      <button
        type="button"
        aria-label="Use system theme"
        aria-pressed={mode === "auto"}
        className={mode === "auto" ? "is-selected" : undefined}
        title="Use system theme"
        onClick={() => setColorMode("auto")}
      >
        <DeviceDesktopIcon size={14} />
      </button>
      <button
        type="button"
        aria-label="Use light theme"
        aria-pressed={mode === "day" || mode === "light"}
        className={mode === "day" || mode === "light" ? "is-selected" : undefined}
        title="Use light theme"
        onClick={() => setColorMode("day")}
      >
        <SunIcon size={14} />
      </button>
      <button
        type="button"
        aria-label="Use dark theme"
        aria-pressed={mode === "night" || mode === "dark"}
        className={mode === "night" || mode === "dark" ? "is-selected" : undefined}
        title="Use dark theme"
        onClick={() => setColorMode("night")}
      >
        <MoonIcon size={14} />
      </button>
    </div>
  );
}

function diagnosticButtonLabel(state: "idle" | "copied" | "failed"): string {
  if (state === "copied") {
    return "Sanitized diagnostic report copied";
  }

  if (state === "failed") {
    return "Sanitized diagnostic report copy failed";
  }

  return "Copy sanitized diagnostic report";
}

function InlineBanner(props: {
  tone: "success" | "warning" | "danger";
  title: string;
  description: string;
}) {
  const Icon =
    props.tone === "success" ? CheckCircleIcon : props.tone === "danger" ? XCircleIcon : AlertIcon;

  return (
    <section className={`compare-banner compare-banner--${props.tone}`} role="status">
      <Icon size={16} />
      <div>
        <strong>{props.title}</strong>
        <p>{props.description}</p>
      </div>
    </section>
  );
}

function ResultTabs(props: {
  activeTab: ResultTab;
  setActiveTab: (tab: ResultTab) => void;
  comparison?: ComparisonResult;
}) {
  const counts = props.comparison ? comparisonCounts(props.comparison) : undefined;

  return (
    <nav className="compare-tabs" aria-label="Comparison result tabs">
      {RESULT_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={props.activeTab === tab.id ? "is-active" : undefined}
          aria-current={props.activeTab === tab.id ? "page" : undefined}
          onClick={() => props.setActiveTab(tab.id)}
        >
          {tab.label}
          {tab.id === "files" && counts ? <span>{counts.changed}</span> : null}
          {tab.id === "impacted" && counts ? <span>{counts.impacted}</span> : null}
        </button>
      ))}
    </nav>
  );
}

function FilesChangedView({
  selectedComparison,
  allComparisons,
  viewedResourceKeys,
  visibleGroups,
  searchInputRef,
  query,
  statusFilter,
  typeFilter,
  showUnchanged,
  diffViewMode,
  wrapDiffLines,
  expandedHunkIds,
  collapsedFoldIds,
  setQuery,
  setStatusFilter,
  setTypeFilter,
  setShowUnchanged,
  setDiffViewMode,
  setWrapDiffLines,
  setSelectedResourceKey,
  setViewedResourceKeys,
  setExpandedHunkIds,
  setCollapsedFoldIds,
  onPrevious,
  onNext
}: {
  selectedComparison?: ResourceComparison;
  allComparisons: ResourceComparison[];
  viewedResourceKeys: Set<string>;
  visibleGroups: ReturnType<typeof groupResourceComparisons>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  query: string;
  statusFilter: StatusFilter;
  typeFilter: TypeFilter;
  showUnchanged: boolean;
  diffViewMode: DiffViewMode;
  wrapDiffLines: boolean;
  expandedHunkIds: Set<string>;
  collapsedFoldIds: Set<string>;
  setQuery: (value: string) => void;
  setStatusFilter: (value: StatusFilter) => void;
  setTypeFilter: (value: TypeFilter) => void;
  setShowUnchanged: (value: boolean) => void;
  setDiffViewMode: (value: DiffViewMode) => void;
  setWrapDiffLines: (value: boolean) => void;
  setSelectedResourceKey: (value: string) => void;
  setViewedResourceKeys: Dispatch<SetStateAction<Set<string>>>;
  setExpandedHunkIds: Dispatch<SetStateAction<Set<string>>>;
  setCollapsedFoldIds: Dispatch<SetStateAction<Set<string>>>;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const visibleResourceCount = visibleGroups.reduce(
    (total, group) => total + group.resources.length,
    0
  );
  const filterCounts = useMemo(
    () =>
      resourceFilterCounts(allComparisons, {
        query,
        type: typeFilter,
        showUnchanged
      }),
    [allComparisons, query, showUnchanged, typeFilter]
  );

  return (
    <section className="compare-files-view">
      <aside className="compare-resource-pane" aria-label="Changed resources">
        <div className="compare-filter-bar">
          <div className="compare-filter-summary" aria-live="polite">
            <strong>{visibleResourceCount}</strong>
            <span>shown</span>
            <span>{filterCounts.matching} matching</span>
          </div>
          <label className="compare-search">
            <SearchIcon size={14} />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              placeholder="Search resources"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <div className="compare-filter-scope" role="group" aria-label="Resource scope">
            <button
              type="button"
              aria-pressed={!showUnchanged}
              className={!showUnchanged ? "is-selected" : undefined}
              title="Show changed and impacted resources"
              onClick={() => setShowUnchanged(false)}
            >
              Review
            </button>
            <button
              type="button"
              aria-pressed={showUnchanged}
              className={showUnchanged ? "is-selected" : undefined}
              title="Show every mapped resource"
              onClick={() => setShowUnchanged(true)}
            >
              All
            </button>
          </div>
          <div className="compare-filter-chips" role="group" aria-label="Status filter">
            {STATUS_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={statusFilter === option.value}
                className={statusFilter === option.value ? "is-selected" : undefined}
                onClick={() => setStatusFilter(option.value)}
              >
                {option.value !== "all" && option.value !== "impacted" ? (
                  <StatusDot status={option.value} impacted={false} />
                ) : (
                  <FilterIcon size={12} />
                )}
                <span>{option.label}</span>
                <strong>{filterCounts[option.value]}</strong>
              </button>
            ))}
          </div>
          <label className="compare-filter-select">
            <FileCodeIcon size={14} />
            <select
              aria-label="Resource type filter"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.currentTarget.value as TypeFilter)}
            >
              {TYPE_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ResourceTree
          groups={visibleGroups}
          selectedKey={selectedComparison ? comparisonResourceKey(selectedComparison) : undefined}
          viewedResourceKeys={viewedResourceKeys}
          setSelectedResourceKey={setSelectedResourceKey}
        />
      </aside>
      <DiffPanel
        comparison={selectedComparison}
        viewedResourceKeys={viewedResourceKeys}
        diffViewMode={diffViewMode}
        wrapDiffLines={wrapDiffLines}
        expandedHunkIds={expandedHunkIds}
        collapsedFoldIds={collapsedFoldIds}
        setViewedResourceKeys={setViewedResourceKeys}
        setDiffViewMode={setDiffViewMode}
        setWrapDiffLines={setWrapDiffLines}
        setExpandedHunkIds={setExpandedHunkIds}
        setCollapsedFoldIds={setCollapsedFoldIds}
        onPrevious={onPrevious}
        onNext={onNext}
      />
    </section>
  );
}

function ResourceTree(props: {
  groups: ReturnType<typeof groupResourceComparisons>;
  selectedKey?: string;
  viewedResourceKeys: Set<string>;
  setSelectedResourceKey: (key: string) => void;
}) {
  if (props.groups.length === 0) {
    return <p className="compare-empty-state">No resources match the current filters.</p>;
  }

  return (
    <div className="compare-resource-tree">
      {props.groups.map((group) => (
        <section key={group.type} className="compare-resource-group">
          <h2>
            {group.label}
            <span>{group.resources.length}</span>
          </h2>
          <ul>
            {group.resources.map((comparison) => {
              const key = comparisonResourceKey(comparison);
              const viewed = props.viewedResourceKeys.has(key);

              return (
                <li key={key}>
                  <button
                    type="button"
                    className={props.selectedKey === key ? "is-selected" : undefined}
                    onClick={() => props.setSelectedResourceKey(key)}
                  >
                    <StatusDot
                      status={comparison.status}
                      impacted={comparison.impact?.impacted ?? false}
                    />
                    <span className="compare-resource-tree__name">
                      {comparisonDisplayName(comparison)}
                    </span>
                    <span className="compare-resource-tree__status">
                      <span>{compactStatusLabel(comparison.status)}</span>
                      {comparison.impact?.impacted && <strong>Impact</strong>}
                    </span>
                    {viewed ? (
                      <EyeIcon aria-label="Viewed" size={14} />
                    ) : (
                      <EyeClosedIcon aria-label="Not viewed" size={14} />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DiffPanel(props: {
  comparison?: ResourceComparison;
  viewedResourceKeys: Set<string>;
  diffViewMode: DiffViewMode;
  wrapDiffLines: boolean;
  expandedHunkIds: Set<string>;
  collapsedFoldIds: Set<string>;
  setViewedResourceKeys: Dispatch<SetStateAction<Set<string>>>;
  setDiffViewMode: (value: DiffViewMode) => void;
  setWrapDiffLines: (value: boolean) => void;
  setExpandedHunkIds: Dispatch<SetStateAction<Set<string>>>;
  setCollapsedFoldIds: Dispatch<SetStateAction<Set<string>>>;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (!props.comparison) {
    return (
      <section className="compare-diff-pane">
        <p className="compare-empty-state">Choose a resource to review.</p>
      </section>
    );
  }

  const key = comparisonResourceKey(props.comparison);
  const viewed = props.viewedResourceKeys.has(key);
  const diff = props.comparison.detailedDiff;

  function toggleViewed() {
    props.setViewedResourceKeys((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  return (
    <section
      className="compare-diff-pane"
      aria-label="Resource diff"
      data-wrap-lines={props.wrapDiffLines}
    >
      <header className="compare-diff-header">
        <div>
          <p>{resourceTypeLabel(resourceTypeForComparison(props.comparison) as ResourceType)}</p>
          <h2>{comparisonDisplayName(props.comparison)}</h2>
          <div className="compare-diff-header__meta">
            <StatusPill
              status={props.comparison.status}
              impacted={props.comparison.impact?.impacted ?? false}
            />
          </div>
        </div>
        <div className="compare-diff-header__actions">
          <div
            className="compare-mode-toggle compare-mode-toggle--compact"
            role="tablist"
            aria-label="Diff view mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={props.diffViewMode === "changes"}
              className={props.diffViewMode === "changes" ? "is-selected" : undefined}
              onClick={() => props.setDiffViewMode("changes")}
            >
              Changes
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={props.diffViewMode === "source"}
              className={props.diffViewMode === "source" ? "is-selected" : undefined}
              onClick={() => props.setDiffViewMode("source")}
            >
              Source
            </button>
          </div>
          <div
            className="compare-mode-toggle compare-mode-toggle--compact"
            role="group"
            aria-label="Line layout"
          >
            <button
              type="button"
              aria-pressed={props.wrapDiffLines}
              className={props.wrapDiffLines ? "is-selected" : undefined}
              onClick={() => props.setWrapDiffLines(true)}
            >
              Wrap
            </button>
            <button
              type="button"
              aria-pressed={!props.wrapDiffLines}
              className={!props.wrapDiffLines ? "is-selected" : undefined}
              onClick={() => props.setWrapDiffLines(false)}
            >
              Scroll
            </button>
          </div>
          <button
            className="compare-icon-button"
            type="button"
            aria-label="Previous resource"
            title="Previous resource"
            onClick={props.onPrevious}
          >
            <ArrowLeftIcon size={16} />
          </button>
          <button
            className="compare-icon-button"
            type="button"
            aria-label="Next resource"
            title="Next resource"
            onClick={props.onNext}
          >
            <ArrowRightIcon size={16} />
          </button>
          <button className="compare-button" type="button" onClick={toggleViewed}>
            {viewed ? <EyeIcon size={14} /> : <EyeClosedIcon size={14} />}
            {viewed ? "Viewed" : "Mark viewed"}
          </button>
        </div>
      </header>

      {diff ? (
        <>
          {props.diffViewMode === "source" ? (
            <ReadableSourceView diff={diff} wrapLines={props.wrapDiffLines} />
          ) : diff.binaryChanged ? (
            <p className="compare-empty-state">Binary content changed.</p>
          ) : diff.hunks.length > 0 ? (
            <div className="compare-diff-table-wrap">
              <table className="compare-diff-table">
                <thead>
                  <tr>
                    <th scope="col">Base</th>
                    <th scope="col">Source</th>
                    <th scope="col">Compare</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.hunks.map((hunk) => (
                    <DiffHunkRows
                      key={hunk.id}
                      hunk={hunk}
                      language={diff.language}
                      expanded={props.expandedHunkIds.has(hunk.id)}
                      collapsedFoldIds={props.collapsedFoldIds}
                      folds={diff.functionFolds}
                      onToggleExpanded={() =>
                        props.setExpandedHunkIds((current) => toggleSetValue(current, hunk.id))
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="compare-empty-state">No line-level differences were generated.</p>
          )}
          <DiffSupplement
            comparison={props.comparison}
            diff={diff}
            collapsedFoldIds={props.collapsedFoldIds}
            setCollapsedFoldIds={props.setCollapsedFoldIds}
          />
        </>
      ) : (
        <>
          <p className="compare-empty-state">
            Detailed diff state: {props.comparison.detailedDiffState}.
          </p>
          <DiffSupplement comparison={props.comparison} />
        </>
      )}
    </section>
  );
}

function ReadableSourceView(props: {
  diff: NonNullable<ResourceComparison["detailedDiff"]>;
  wrapLines: boolean;
}) {
  return (
    <div className="compare-source-view" data-wrap-lines={props.wrapLines}>
      <SourcePane
        title="Base"
        source={props.diff.baseDisplaySource}
        language={props.diff.language}
      />
      <SourcePane
        title="Compare"
        source={props.diff.compareDisplaySource}
        language={props.diff.language}
      />
    </div>
  );
}

function SourcePane(props: {
  title: "Base" | "Compare";
  source?: string;
  language: NonNullable<ResourceComparison["detailedDiff"]>["language"];
}) {
  const lines = splitDisplaySource(props.source);

  return (
    <section className="compare-source-pane" aria-label={`${props.title} resource source`}>
      <header>
        <strong>{props.title}</strong>
        <span>{lines.length === 1 ? "1 line" : `${lines.length} lines`}</span>
      </header>
      {lines.length > 0 ? (
        <ol className="compare-source-lines">
          {lines.map((line, index) => (
            <li key={`${index}:${line}`}>
              <code>
                <SourceFragments line={line} language={props.language} />
              </code>
            </li>
          ))}
        </ol>
      ) : (
        <p className="compare-empty-state">
          No {props.title.toLowerCase()} source for this resource.
        </p>
      )}
    </section>
  );
}

function SourceFragments(props: {
  line: string;
  language: NonNullable<ResourceComparison["detailedDiff"]>["language"];
}) {
  return (
    <>
      {tokenizeSyntaxLine(props.line, props.language).map((token, index) => (
        <span key={`${index}:${token.value}`} className={`syntax-${token.kind}`}>
          {token.value}
        </span>
      ))}
    </>
  );
}

function DiffSupplement(props: {
  comparison: ResourceComparison;
  diff?: NonNullable<ResourceComparison["detailedDiff"]>;
  collapsedFoldIds?: Set<string>;
  setCollapsedFoldIds?: Dispatch<SetStateAction<Set<string>>>;
}) {
  const folds = props.diff ? flattenFunctionFolds(props.diff.functionFolds) : [];

  return (
    <section className="compare-diff-supplement" aria-label="Resource review details">
      {props.diff && folds.length > 0 && props.collapsedFoldIds && props.setCollapsedFoldIds && (
        <details className="compare-code-outline" open>
          <summary>Code outline ({folds.length})</summary>
          <FunctionFoldList
            folds={props.diff.functionFolds}
            collapsedFoldIds={props.collapsedFoldIds}
            setCollapsedFoldIds={props.setCollapsedFoldIds}
          />
        </details>
      )}
      {props.comparison.structuredChanges.length > 0 && (
        <details className="compare-structured-changes">
          <summary>Structured changes ({props.comparison.structuredChanges.length})</summary>
          <ul>
            {props.comparison.structuredChanges.map((change) => (
              <li key={change.id}>
                <strong>{change.kind}</strong>
                <span>{change.path.join(".") || "resource"}</span>
                <p>{change.description}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      <ResourceDetails comparison={props.comparison} diff={props.diff} />
    </section>
  );
}

function ResourceDetails({
  comparison,
  diff
}: {
  comparison: ResourceComparison;
  diff?: NonNullable<ResourceComparison["detailedDiff"]>;
}) {
  const resource = comparison.compare ?? comparison.base;
  const identity = resource?.identity;

  return (
    <details className="compare-resource-details">
      <summary>Details</summary>
      <dl>
        <div>
          <dt>Launch ID</dt>
          <dd>{identity?.launchResourceId ?? "unidentified"}</dd>
        </div>
        <div>
          <dt>Resource type</dt>
          <dd>{identity?.resourceType ?? "unmapped"}</dd>
        </div>
        <div>
          <dt>File provenance</dt>
          <dd>{resource?.fileIds.join(", ") || "not mapped"}</dd>
        </div>
        <div>
          <dt>Match</dt>
          <dd>
            {comparison.match
              ? `${comparison.match.method} / ${comparison.match.confidence}`
              : "unmatched"}
          </dd>
        </div>
        <div>
          <dt>Diff language</dt>
          <dd>{diff?.language ?? "not generated"}</dd>
        </div>
      </dl>
    </details>
  );
}

function DiffHunkRows(props: {
  hunk: NonNullable<ResourceComparison["detailedDiff"]>["hunks"][number];
  language: NonNullable<ResourceComparison["detailedDiff"]>["language"];
  expanded: boolean;
  collapsedFoldIds: Set<string>;
  folds: FunctionFold[];
  onToggleExpanded: () => void;
}) {
  const rows = props.hunk.collapsed
    ? props.expanded
      ? (props.hunk.hiddenRows ?? [])
      : []
    : props.hunk.rows;
  const visibleRows = rows.filter(
    (row) => !isRowHiddenByFold(row, props.collapsedFoldIds, props.folds)
  );

  return (
    <>
      {props.hunk.collapsed && (
        <tr className="compare-diff-expander">
          <td colSpan={4}>
            <button type="button" onClick={props.onToggleExpanded}>
              {props.expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
              {props.hunk.oldLines || props.hunk.newLines} unchanged lines
            </button>
          </td>
        </tr>
      )}
      {visibleRows.map((row) => (
        <DiffRow key={row.id} row={row} language={props.language} />
      ))}
    </>
  );
}

function DiffRow({
  row,
  language
}: {
  row: SplitDiffRow;
  language: NonNullable<ResourceComparison["detailedDiff"]>["language"];
}) {
  return (
    <tr className={row.changed ? "is-changed" : undefined}>
      <DiffSideCells line={row.base} side="base" changed={row.changed} language={language} />
      <DiffSideCells line={row.compare} side="compare" changed={row.changed} language={language} />
    </tr>
  );
}

function DiffSideCells(props: {
  line?: DiffLine;
  side: "base" | "compare";
  changed: boolean;
  language: NonNullable<ResourceComparison["detailedDiff"]>["language"];
}) {
  const lineNumber = props.side === "base" ? props.line?.oldLineNumber : props.line?.newLineNumber;
  const statusClass = props.line ? `is-${props.line.type}` : "is-empty";

  return (
    <>
      <td className={`compare-line-number ${statusClass}`}>
        <span className="compare-line-number__content">
          <span className="compare-line-marker" aria-hidden="true">
            {lineMarker(props.line)}
          </span>
          <span className="compare-line-number__value">{lineNumber ?? ""}</span>
        </span>
      </td>
      <td className={`compare-code-cell ${statusClass}`}>
        {props.line ? (
          <code>
            <CodeFragments line={props.line} language={props.language} />
          </code>
        ) : null}
      </td>
    </>
  );
}

function lineMarker(line: DiffLine | undefined): string {
  if (line?.type === "added") {
    return "+";
  }

  if (line?.type === "removed") {
    return "-";
  }

  return "";
}

function CodeFragments({
  line,
  language
}: {
  line: DiffLine;
  language: NonNullable<ResourceComparison["detailedDiff"]>["language"];
}) {
  if (line.tokens?.length) {
    return (
      <>
        {line.tokens.map((token, index) => (
          <span
            key={`${index}:${token.value}`}
            className={token.changed ? "compare-token is-changed" : undefined}
          >
            <SyntaxFragments tokens={tokenizeSyntaxLine(token.value, language)} />
          </span>
        ))}
      </>
    );
  }

  return (
    <SyntaxFragments tokens={line.syntaxTokens ?? tokenizeSyntaxLine(line.content, language)} />
  );
}

function SyntaxFragments({ tokens }: { tokens: SyntaxToken[] }) {
  return (
    <>
      {tokens.map((token, index) => (
        <span key={`${index}:${token.value}`} className={`syntax-${token.kind}`}>
          {token.value}
        </span>
      ))}
    </>
  );
}

function FunctionFoldList(props: {
  folds: FunctionFold[];
  collapsedFoldIds: Set<string>;
  setCollapsedFoldIds: Dispatch<SetStateAction<Set<string>>>;
}) {
  const folds = flattenFunctionFolds(props.folds);

  return (
    <div className="compare-fold-list" aria-label="Function folds">
      {folds.map((fold) => {
        const collapsed = props.collapsedFoldIds.has(fold.id);

        return (
          <button
            key={fold.id}
            type="button"
            className={fold.containsChanges ? "has-changes" : undefined}
            onClick={() => props.setCollapsedFoldIds((current) => toggleSetValue(current, fold.id))}
          >
            {collapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
            <span>{fold.name ?? fold.kind}</span>
            {fold.containsChanges && <strong>changed</strong>}
          </button>
        );
      })}
    </div>
  );
}

function ImpactedView({ comparison }: { comparison: ComparisonResult }) {
  const impacted = comparison.resources.filter((resource) => resource.impact?.impacted);

  return (
    <section className="compare-panel-view" aria-label="Impacted resources">
      <header>
        <h2>Impacted Resources</h2>
        <p>{impacted.length} resources have direct or transitive dependency impact.</p>
      </header>
      {impacted.length === 0 ? (
        <p className="compare-empty-state">No dependency impact was detected.</p>
      ) : (
        <div className="compare-impact-list">
          {impacted.map((resource) => (
            <article key={comparisonResourceKey(resource)} className="compare-impact-row">
              <div>
                <StatusPill status={resource.status} impacted />
                <h3>{comparisonDisplayName(resource)}</h3>
              </div>
              <ul>
                {resource.impact?.paths.map((path, index) => (
                  <li key={`${path.changedResourceId}:${index}`}>
                    <strong>{path.direct ? "Direct" : "Transitive"}</strong>
                    <span>{path.resourceNames.join(" -> ") || path.resourceIds.join(" -> ")}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ResolvedFilesView({ comparison }: { comparison: ComparisonResult }) {
  return (
    <section className="compare-panel-view" aria-label="Resolved files">
      <header>
        <h2>Resolved Files</h2>
        <p>
          Base: {fileStateSummary(comparison.base.files)} / Compare:{" "}
          {fileStateSummary(comparison.compare.files)}
        </p>
      </header>
      <div className="compare-files-grid">
        <ResolvedFileTable title="Base" files={comparison.base.files} />
        <ResolvedFileTable title="Compare" files={comparison.compare.files} />
      </div>
    </section>
  );
}

function ResolvedFileTable(props: { title: string; files: ResolvedFile[] }) {
  return (
    <section className="compare-resolved-table-wrap">
      <h3>{props.title}</h3>
      <table className="compare-resolved-table">
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col">File</th>
            <th scope="col">Type</th>
            <th scope="col">Bytes</th>
            <th scope="col">Attempts</th>
          </tr>
        </thead>
        <tbody>
          {props.files.map((file) => (
            <tr key={file.id}>
              <td>
                <span className={`compare-file-state compare-file-state--${file.state}`}>
                  {file.state}
                </span>
              </td>
              <td title={file.authoritativeUrl}>{fileDisplayName(file)}</td>
              <td>{file.fetch.contentType ?? "unknown"}</td>
              <td>{file.fetch.byteLength ?? "-"}</td>
              <td>{file.fetch.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ReleaseNotesView(props: {
  releaseNotes: string;
  copyState: "idle" | "copied" | "failed";
  onCopy: () => void;
  onDownload: () => void;
}) {
  const [mode, setMode] = useState<"preview" | "raw">("preview");

  return (
    <section className="compare-panel-view" aria-label="Release notes">
      <header className="compare-release-header">
        <div>
          <h2>Release Notes</h2>
          <p>Deterministic notes generated from deployed-artifact differences only.</p>
        </div>
        <div className="compare-release-actions">
          <div className="compare-mode-toggle" role="tablist" aria-label="Release notes mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "preview"}
              className={mode === "preview" ? "is-selected" : undefined}
              onClick={() => setMode("preview")}
            >
              Preview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "raw"}
              className={mode === "raw" ? "is-selected" : undefined}
              onClick={() => setMode("raw")}
            >
              Raw
            </button>
          </div>
          <button className="compare-button" type="button" onClick={props.onCopy}>
            <CopyIcon size={14} />
            {props.copyState === "copied"
              ? "Copied"
              : props.copyState === "failed"
                ? "Copy failed"
                : "Copy"}
          </button>
          <button className="compare-button" type="button" onClick={props.onDownload}>
            <DownloadIcon size={14} />
            Download
          </button>
        </div>
      </header>
      {mode === "preview" ? (
        <MarkdownPreview markdown={props.releaseNotes} />
      ) : (
        <pre className="compare-release-raw">{props.releaseNotes}</pre>
      )}
    </section>
  );
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  const blocks = markdown.split(/\n{2,}/);

  return (
    <div className="compare-release-preview">
      {blocks.map((block, index) => {
        if (block.startsWith("## ")) {
          return <h3 key={index}>{block.slice(3)}</h3>;
        }

        if (block.startsWith("# ")) {
          return <h2 key={index}>{block.slice(2)}</h2>;
        }

        if (block.startsWith("- ")) {
          return (
            <ul key={index}>
              {block.split("\n").map((line) => (
                <li key={line}>{line.replace(/^- /, "")}</li>
              ))}
            </ul>
          );
        }

        return <p key={index}>{block}</p>;
      })}
    </div>
  );
}

function KeyboardHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="compare-dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="compare-keyboard-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-help-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="keyboard-help-title">Keyboard Shortcuts</h2>
          <button
            className="compare-icon-button"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            <XIcon size={16} />
          </button>
        </header>
        <dl>
          <div>
            <dt>j / n</dt>
            <dd>Next resource</dd>
          </div>
          <div>
            <dt>k / p</dt>
            <dd>Previous resource</dd>
          </div>
          <div>
            <dt>v</dt>
            <dd>Toggle viewed</dd>
          </div>
          <div>
            <dt>f</dt>
            <dd>Focus search</dd>
          </div>
          <div>
            <dt>[ / ]</dt>
            <dd>Switch tabs</dd>
          </div>
          <div>
            <dt>Esc</dt>
            <dd>Close or clear search</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function StatusDot(props: { status: ResourceComparison["status"]; impacted: boolean }) {
  return (
    <span
      className={`compare-status-dot compare-status-dot--${props.status}`}
      data-impacted={props.impacted}
      aria-hidden="true"
    />
  );
}

function StatusPill(props: { status: ResourceComparison["status"]; impacted: boolean }) {
  return (
    <span className={`compare-status-pill compare-status-pill--${props.status}`}>
      {statusLabel(props.status)}
      {props.impacted && <strong>Impacted</strong>}
    </span>
  );
}

function resourceFilterCounts(
  comparisons: ResourceComparison[],
  filters: Pick<Parameters<typeof groupResourceComparisons>[1], "query" | "type" | "showUnchanged">
): Record<StatusFilter | "matching" | "review", number> {
  const counts: Record<StatusFilter | "matching" | "review", number> = {
    all: 0,
    matching: 0,
    review: 0,
    modified: 0,
    added: 0,
    removed: 0,
    unknown: 0,
    unchanged: 0,
    impacted: 0
  };
  const query = filters.query.trim().toLowerCase();

  for (const comparison of comparisons) {
    const resource = comparison.compare ?? comparison.base;
    const resourceType = resource?.identity.resourceType;

    if (filters.type !== "all" && resourceType !== filters.type) {
      continue;
    }

    if (query && !resourceSearchText(comparison).includes(query)) {
      continue;
    }

    counts.matching += 1;
    counts[comparison.status] += 1;

    if (comparison.impact?.impacted) {
      counts.impacted += 1;
    }

    if (comparison.status !== "unchanged" || comparison.impact?.impacted) {
      counts.review += 1;
    }
  }

  counts.all = filters.showUnchanged ? counts.matching : counts.review;

  return counts;
}

function resourceSearchText(comparison: ResourceComparison): string {
  const resource = comparison.compare ?? comparison.base;

  return [
    comparisonDisplayName(comparison),
    comparisonResourceKey(comparison),
    resource?.identity.launchResourceId,
    resource?.identity.resourceType,
    ...(resource?.children.map((child) => child.name ?? child.moduleType ?? "") ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function compactStatusLabel(status: ResourceComparison["status"]): string {
  if (status === "unchanged") {
    return "Same";
  }

  return statusLabel(status);
}

function splitDisplaySource(source: string | undefined): string[] {
  if (!source) {
    return [];
  }

  const normalized = source.replace(/\r\n?/g, "\n").replace(/\n$/, "");

  return normalized ? normalized.split("\n") : [];
}

function validateAnalysisUrls(
  baseUrl: string,
  compareUrl: string
): { ok: true; urls: AnalysisUrls } | { ok: false; message: string } {
  const base = normalizeAnalysisUrl(baseUrl);
  const compare = normalizeAnalysisUrl(compareUrl);

  if (!base.ok) {
    return { ok: false, message: `Base URL: ${base.message}` };
  }

  if (!compare.ok) {
    return { ok: false, message: `Compare URL: ${compare.message}` };
  }

  if (base.url === compare.url) {
    return { ok: false, message: "Base and compare URLs must be different." };
  }

  return {
    ok: true,
    urls: {
      baseUrl: base.url,
      compareUrl: compare.url
    }
  };
}

function normalizeAnalysisUrl(
  value: string
): { ok: true; url: string } | { ok: false; message: string } {
  const trimmed = value.trim();

  if (!trimmed) {
    return { ok: false, message: "URL is required." };
  }

  try {
    const parsed = new URL(trimmed);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, message: "URL must use http:// or https://." };
    }

    return { ok: true, url: parsed.href };
  } catch {
    return { ok: false, message: "Enter a valid URL." };
  }
}

function applyDefaultConfigSelection(
  config: LaunchDiffConfig,
  setters: {
    setSelectedSiteName: (value: string) => void;
    setBaseEnvironmentName: (value: string) => void;
    setCompareEnvironmentName: (value: string) => void;
  }
) {
  const site = config.sites[0];

  setters.setSelectedSiteName(site?.name ?? "");
  setters.setBaseEnvironmentName(site?.environments[0]?.name ?? "");
  setters.setCompareEnvironmentName(
    site?.environments[1]?.name ?? site?.environments[0]?.name ?? ""
  );
}

function pickInitialResource(comparison: ComparisonResult): ResourceComparison | undefined {
  return (
    comparison.resources.find((resource) => resource.status === "modified") ??
    comparison.resources.find(
      (resource) => resource.status === "added" || resource.status === "removed"
    ) ??
    comparison.resources.find((resource) => resource.status === "unknown") ??
    comparison.resources[0]
  );
}

function isReviewableStatus(status: ResourceComparison["status"]): boolean {
  return status === "added" || status === "removed" || status === "modified";
}

function resourceTypeForComparison(comparison: ResourceComparison): string {
  return (comparison.compare ?? comparison.base)?.identity.resourceType ?? "unmapped";
}

function formatProgress(progress: BrowserAnalysisProgress): string {
  const label = PHASE_LABELS[progress.phase];
  const count = progress.detailedDiffs ?? progress.base ?? progress.compare;

  if (!count) {
    return progress.message ?? label;
  }

  return `${progress.message ?? label} ${count.completed}${count.total === undefined ? "" : `/${count.total}`}`;
}

function browserDiagnostic(): { family: string; majorVersion?: string } {
  const userAgent = navigator.userAgent;
  const candidates: Array<[string, RegExp]> = [
    ["Edge", /Edg\/(\d+)/],
    ["Chrome", /Chrome\/(\d+)/],
    ["Firefox", /Firefox\/(\d+)/],
    ["Safari", /Version\/(\d+).*Safari/]
  ];

  for (const [family, pattern] of candidates) {
    const match = pattern.exec(userAgent);

    if (match?.[1]) {
      return {
        family,
        majorVersion: match[1]
      };
    }
  }

  return {
    family: "Unknown"
  };
}

function shortenUrl(value: string): string {
  try {
    const url = new URL(value);
    const fileName = url.pathname.split("/").filter(Boolean).at(-1);

    return fileName ? `${url.hostname}/${fileName}` : url.hostname;
  } catch {
    return value;
  }
}

function toggleSetValue(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);

  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
}

function flattenFunctionFolds(folds: FunctionFold[]): FunctionFold[] {
  return folds.flatMap((fold) => [fold, ...flattenFunctionFolds(fold.children)]);
}

function isRowHiddenByFold(
  row: SplitDiffRow,
  collapsedFoldIds: Set<string>,
  folds: FunctionFold[]
): boolean {
  if (row.changed || collapsedFoldIds.size === 0) {
    return false;
  }

  const baseLine = row.base?.oldLineNumber;
  const compareLine = row.compare?.newLineNumber;

  return flattenFunctionFolds(folds)
    .filter((fold) => collapsedFoldIds.has(fold.id))
    .some((fold) => {
      const baseHidden =
        baseLine !== undefined &&
        fold.baseRange !== undefined &&
        baseLine >= fold.baseRange.startLine &&
        baseLine <= fold.baseRange.endLine;
      const compareHidden =
        compareLine !== undefined &&
        fold.compareRange !== undefined &&
        compareLine >= fold.compareRange.startLine &&
        compareLine <= fold.compareRange.endLine;

      return baseHidden || compareHidden;
    });
}

function fileStateSummary(files: ResolvedFile[]): string {
  const resolved = files.filter((file) => file.state === "resolved").length;
  const failed = files.filter((file) => file.state === "failed").length;
  const limited = files.filter((file) => file.state === "skipped-limit").length;
  const unsupported = files.filter((file) => file.state === "unsupported").length;

  return `${resolved} resolved, ${failed} failed, ${limited} limit skipped, ${unsupported} unsupported`;
}
