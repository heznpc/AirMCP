const ACTIONS = {
  bridge_missing: "Build the opt-in preview bridge with: npm run swift-build:fm",
  disabled_at_compile_time: "Rebuild the opt-in preview bridge with: npm run swift-build:fm",
  unsupported_architecture: "Use an Apple Silicon Mac (M1 or later).",
  unsupported_os: "Run the preview on macOS 26 or later.",
  model_unavailable: "Enable Apple Intelligence and wait for the on-device model download to finish.",
  status_probe_failed: "Rebuild the preview bridge with npm run swift-build:fm, then rerun npm run ai-status.",
};

export function classifyFoundationModelsStatus(status) {
  let classification = status?.classification;
  if (!classification) {
    if (!status?.foundationModelsSupported) classification = "disabled_at_compile_time";
    else if (!status?.hasAppleSilicon) classification = "unsupported_architecture";
    else if (Number.parseInt(status?.macOSVersion ?? "0", 10) < 26) classification = "unsupported_os";
    else classification = status?.available ? "ready" : "model_unavailable";
  }

  return {
    ready: classification === "ready" && status?.available === true,
    classification,
    message: status?.message ?? "Foundation Models status did not include a message.",
    action: classification === "ready" ? null : (ACTIONS[classification] ?? ACTIONS.status_probe_failed),
    status: status ?? null,
  };
}

export async function inspectFoundationModels({ checkSwiftBridge, runSwift }) {
  const bridgeError = await checkSwiftBridge();
  if (bridgeError) {
    return {
      ready: false,
      classification: "bridge_missing",
      message: bridgeError,
      action: ACTIONS.bridge_missing,
      status: null,
    };
  }

  try {
    const status = await runSwift("ai-status", "{}");
    return classifyFoundationModelsStatus(status);
  } catch (error) {
    return {
      ready: false,
      classification: "status_probe_failed",
      message: error instanceof Error ? error.message : String(error),
      action: ACTIONS.status_probe_failed,
      status: null,
    };
  }
}
