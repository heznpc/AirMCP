// AirMCPKit — Foundation Models service shared between macOS bridge and iOS app.
// Wraps Apple's on-device language model for text generation, summarization,
// rewriting, proofreading, structured output, content tagging, and chat.

import Foundation

#if canImport(FoundationModels) && compiler(>=6.3)
import FoundationModels

// MARK: - Error types

/// Errors specific to the IntelligenceService.
@available(macOS 26, iOS 26, *)
public enum IntelligenceServiceError: Error, LocalizedError {
    case modelUnavailable(String)
    case generationFailed(String)
    case invalidOutput(String)

    public var errorDescription: String? {
        switch self {
        case .modelUnavailable(let msg): return msg
        case .generationFailed(let msg): return msg
        case .invalidOutput(let msg): return msg
        }
    }
}

// MARK: - Service

/// On-device AI service backed by Apple Foundation Models.
///
/// All operations run entirely on-device using `LanguageModelSession`.
/// This actor is safe to share across concurrency domains.
@available(macOS 26, iOS 26, *)
public actor IntelligenceService {

    public init() {}

    // MARK: - Availability

    /// Check whether the on-device model is ready to use.
    /// Returns a human-readable status message and a boolean flag.
    public func checkAvailability() -> (available: Bool, message: String) {
        let availability = SystemLanguageModel.default.availability
        switch availability {
        case .available:
            return (true, "Apple Foundation Models are available and ready to use.")
        case .unavailable:
            return (false, "Apple Foundation Models are not available on this device.")
        @unknown default:
            return (false, "Apple Foundation Models availability is unknown or the model is not yet ready.")
        }
    }

    // MARK: - Text operations

    /// Summarize text using the on-device model.
    ///
    /// - Parameters:
    ///   - text: The text to summarize.
    ///   - maxLength: Hint for the desired summary length in words (default 200). Encoded in the prompt.
    /// - Returns: The summarized text.
    public func summarize(_ text: String, maxLength: Int = 200) async throws -> String {
        let session = LanguageModelSession()
        let prompt = "Summarize the following text concisely in at most \(maxLength) words:\n\n\(text)"
        let response = try await session.respond(to: prompt)
        return response.content
    }

    /// Rewrite text in a given style or tone.
    ///
    /// - Parameters:
    ///   - text: The text to rewrite.
    ///   - style: The target tone/style (e.g. "professional", "casual", "formal").
    /// - Returns: The rewritten text.
    public func rewrite(_ text: String, style: String = "professional") async throws -> String {
        let session = LanguageModelSession()
        let prompt = "Rewrite the following text in a \(style) tone:\n\n\(text)"
        let response = try await session.respond(to: prompt)
        return response.content
    }

    /// Proofread text and return corrections.
    ///
    /// - Parameter text: The text to proofread.
    /// - Returns: The corrected text.
    public func proofread(_ text: String) async throws -> String {
        let session = LanguageModelSession()
        let prompt = "Proofread and correct any grammar or spelling errors in the following text. Return only the corrected text:\n\n\(text)"
        let response = try await session.respond(to: prompt)
        return response.content
    }

    // MARK: - Text generation

    /// Generate text from a prompt with an optional system instruction.
    ///
    /// - Parameters:
    ///   - prompt: The user prompt.
    ///   - systemInstruction: Optional system instruction for the session.
    /// - Returns: The generated text.
    public func generateText(_ prompt: String, systemInstruction: String? = nil) async throws -> String {
        let instruction = systemInstruction ?? "You are a helpful assistant."
        let session = LanguageModelSession(instructions: instruction)
        let response = try await session.respond(to: prompt)
        return response.content
    }

    // MARK: - Structured output

    /// Schema property descriptor for structured generation.
    public struct SchemaProperty: Sendable {
        public let type: String
        public let description: String?
        public init(type: String, description: String? = nil) {
            self.type = type; self.description = description
        }
    }

    /// Generate structured (JSON) output from a prompt.
    ///
    /// - Parameters:
    ///   - prompt: The user prompt.
    ///   - schema: Optional field-level schema hints (name -> type + description).
    ///   - systemInstruction: Optional system instruction for the session.
    /// - Returns: A tuple of the raw output string and whether it parsed as valid JSON.
    public func generateStructured(
        _ prompt: String,
        schema: [String: SchemaProperty]? = nil,
        systemInstruction: String? = nil
    ) async throws -> (output: String, validJSON: Bool) {
        let instruction = systemInstruction ?? "You are a helpful assistant. Respond with valid JSON only."
        let session = LanguageModelSession(instructions: instruction)

        let fullPrompt: String
        if let schema = schema {
            let schemaDesc = schema.map { "\($0.key): \($0.value.type)\($0.value.description.map { " — \($0)" } ?? "")" }
                .joined(separator: "\n")
            fullPrompt = "\(prompt)\n\nRespond with a JSON object matching this schema:\n\(schemaDesc)"
        } else {
            fullPrompt = "\(prompt)\n\nRespond with valid JSON only."
        }

        let response = try await session.respond(to: fullPrompt)
        let content = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
        let isValid = content.data(using: .utf8)
            .flatMap { try? JSONSerialization.jsonObject(with: $0) } != nil
        return (content, isValid)
    }

    /// Generate structured output using the `@Generable` protocol.
    ///
    /// - Parameters:
    ///   - prompt: The user prompt.
    ///   - type: The target `Generable` type.
    ///   - systemInstruction: Optional system instruction for the session.
    /// - Returns: An instance of the requested type.
    public func generateGenerable<T: Generable>(
        _ prompt: String,
        type: T.Type,
        systemInstruction: String? = nil
    ) async throws -> T {
        let instruction = systemInstruction ?? "You are a helpful assistant."
        let session = LanguageModelSession(instructions: instruction)
        let response = try await session.respond(to: prompt, generating: T.self)
        return response.content
    }

    // MARK: - Content tagging / classification

    /// Classify text into a set of tags with confidence scores.
    ///
    /// - Parameters:
    ///   - text: The text to classify.
    ///   - tags: The candidate tags/categories.
    /// - Returns: A dictionary mapping tags to confidence scores (0.0–1.0),
    ///   or nil if the model response could not be parsed as JSON.
    public func tagContent(_ text: String, tags: [String]) async throws -> [String: Double]? {
        let tagList = tags.joined(separator: ", ")
        let session = LanguageModelSession(
            instructions: "You are a content classification system. Classify text into the provided categories. Respond with ONLY a JSON object mapping each applicable tag to a confidence score between 0.0 and 1.0."
        )
        let prompt = "Classify this text into these categories: [\(tagList)]\n\nText: \(text)\n\nRespond with a JSON object like {\"tag\": confidence_score} for each applicable tag."
        let response = try await session.respond(to: prompt)
        let content = response.content.trimmingCharacters(in: .whitespacesAndNewlines)

        guard let data = content.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }

        // Coerce values to Double
        var result: [String: Double] = [:]
        for (key, value) in parsed {
            if let d = value as? Double { result[key] = d }
            else if let n = value as? NSNumber { result[key] = n.doubleValue }
        }
        return result
    }

    // MARK: - Chat (single turn)

    /// Single-turn chat with the on-device model.
    ///
    /// - Parameters:
    ///   - prompt: The user message.
    ///   - systemInstruction: Optional system instruction.
    /// - Returns: The model's response text.
    public func chat(_ prompt: String, systemInstruction: String? = nil) async throws -> String {
        let instruction = systemInstruction ?? "You are a helpful on-device AI assistant."
        let session = LanguageModelSession(instructions: instruction)
        let response = try await session.respond(to: prompt)
        return response.content
    }
}

#else

// MARK: - Stub for platforms without FoundationModels

/// Placeholder service for platforms where FoundationModels is not available.
/// Every method throws `AirMCPKitError.unsupported` with a clear message.
public actor IntelligenceService {

    public init() {}

    private static let unavailableMessage = "Foundation Models require macOS 26+ / iOS 26+ with Apple Silicon."

    public func checkAvailability() -> (available: Bool, message: String) {
        (false, Self.unavailableMessage)
    }

    public func summarize(_ text: String, maxLength: Int = 200) async throws -> String {
        throw AirMCPKitError.unsupported(Self.unavailableMessage)
    }

    public func rewrite(_ text: String, style: String = "professional") async throws -> String {
        throw AirMCPKitError.unsupported(Self.unavailableMessage)
    }

    public func proofread(_ text: String) async throws -> String {
        throw AirMCPKitError.unsupported(Self.unavailableMessage)
    }

    public func generateText(_ prompt: String, systemInstruction: String? = nil) async throws -> String {
        throw AirMCPKitError.unsupported(Self.unavailableMessage)
    }

    public func generateStructured(
        _ prompt: String,
        schema: [String: (type: String, description: String?)]? = nil,
        systemInstruction: String? = nil
    ) async throws -> (output: String, validJSON: Bool) {
        throw AirMCPKitError.unsupported(Self.unavailableMessage)
    }

    public func tagContent(_ text: String, tags: [String]) async throws -> [String: Double]? {
        throw AirMCPKitError.unsupported(Self.unavailableMessage)
    }

    public func chat(_ prompt: String, systemInstruction: String? = nil) async throws -> String {
        throw AirMCPKitError.unsupported(Self.unavailableMessage)
    }
}

#endif
