import { AnalysisCancelledError, BrowserAnalysisOrchestrator } from "@/browser/analyzer/orchestrator";
import { ApiAnalysisTransport } from "@/browser/analyzer/transport";
import type { AnalyzerWorkerCommand, AnalyzerWorkerMessage } from "@/browser/analyzer/worker-protocol";

interface AnalyzerWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<AnalyzerWorkerCommand>) => void
  ): void;
  postMessage(message: AnalyzerWorkerMessage): void;
}

const workerScope = self as unknown as AnalyzerWorkerScope;
const transport = new ApiAnalysisTransport();
const orchestrator = new BrowserAnalysisOrchestrator(transport, undefined, (progress) => {
  if (activeCommandId) {
    post({
      id: activeCommandId,
      type: "progress",
      progress
    });
  }
});
let activeCommandId: string | undefined;

workerScope.addEventListener("message", (event: MessageEvent<AnalyzerWorkerCommand>) => {
  void handleCommand(event.data);
});

async function handleCommand(command: AnalyzerWorkerCommand): Promise<void> {
  if (command.type === "cancel") {
    orchestrator.cancel();
    return;
  }

  activeCommandId = command.id;

  try {
    const result =
      command.type === "refresh"
        ? await orchestrator.refreshLibraries(command.input)
        : command.type === "retry-failed"
          ? await orchestrator.retryFailedResources(command.input)
          : await orchestrator.analyze(command.input);

    post({
      id: command.id,
      type: "result",
      comparison: result.comparison
    });
  } catch (error) {
    if (error instanceof AnalysisCancelledError) {
      post({
        id: command.id,
        type: "cancelled"
      });
      return;
    }

    post({
      id: command.id,
      type: "error",
      message: error instanceof Error ? error.message : "Analysis failed."
    });
  } finally {
    if (activeCommandId === command.id) {
      activeCommandId = undefined;
    }
  }
}

function post(message: AnalyzerWorkerMessage): void {
  workerScope.postMessage(message);
}
