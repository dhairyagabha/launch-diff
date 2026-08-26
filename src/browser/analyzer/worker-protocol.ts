import type { BrowserAnalysisInput, BrowserAnalysisProgress } from "./types";
import type { ComparisonResult } from "@/core/launch-analyzer";

export type AnalyzerWorkerCommand =
  | {
      id: string;
      type: "analyze" | "retry-failed" | "refresh";
      input: BrowserAnalysisInput;
    }
  | {
      id: string;
      type: "cancel";
    };

export type AnalyzerWorkerMessage =
  | {
      id: string;
      type: "progress";
      progress: BrowserAnalysisProgress;
    }
  | {
      id: string;
      type: "result";
      comparison: ComparisonResult;
    }
  | {
      id: string;
      type: "error";
      message: string;
    }
  | {
      id: string;
      type: "cancelled";
    };
