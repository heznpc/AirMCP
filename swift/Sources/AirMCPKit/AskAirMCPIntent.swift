// AirMCPKit — Ask AirMCP AppIntent (RFC 0007 axis 6).
//
// Natural-language entry point that wires Apple's on-device Foundation
// Models LLM to AirMCP's EventKit/Contacts/Reminders/Notes/HealthKit
// tools (see FoundationModelsBridge.swift). The whole loop — prompt,
// model inference, tool calls, final response — runs on-device. No
// data leaves the phone/Mac and no cloud account is required.
//
// Why a separate hand-written intent instead of codegen
// - Codegen emits one AppIntent per MCP tool. This intent is different:
//   it takes arbitrary prose and lets the model pick which tools to call.
//   There's no JSON-Schema for it.
// - It depends on FoundationModels + the #available(macOS 26, iOS 26, *)
//   gate the codegen doesn't carry.
// - A.2b's MCPIntentRouter isn't involved; the Foundation Models Tool
//   conformances in FoundationModelsBridge.swift call AirMCPKit services
//   directly, which keeps the on-device guarantee simple to prove.
//
// Siri phrase registration happens in the AirMCPGeneratedShortcuts
// provider (gen-swift-intents.mjs pins this intent as the first entry).

#if canImport(AppIntents) && canImport(FoundationModels) && compiler(>=6.3)
import AppIntents
import Foundation
import FoundationModels

@available(macOS 26, iOS 26, *)
public struct AskAirMCPIntent: AppIntent {
    nonisolated(unsafe) public static var title: LocalizedStringResource = "Ask AirMCP"
    nonisolated(unsafe) public static var description = IntentDescription(
        "Ask a question in plain language. AirMCP's on-device AI agent answers using your Apple apps (Calendar, Reminders, Contacts, Notes). Runs fully on-device — no cloud calls."
    )
    nonisolated(unsafe) public static var openAppWhenRun: Bool = false

    public init() {}

    @Parameter(
        title: "Question",
        description: "e.g. 'What's on my calendar today?' or 'Create a reminder to call mom tomorrow at 5pm'"
    )
    public var prompt: String

    @Parameter(
        title: "Instruction override",
        description: "Optional system instruction that replaces the default assistant prompt"
    )
    public var instruction: String?

    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let bridge = FoundationModelsBridge()
        let answer = try await bridge.run(prompt: prompt, systemInstruction: instruction)
        return .result(value: answer)
    }
}

#endif
