import Foundation

#if canImport(Speech)
import Speech
#endif

/// On-device speech-to-text via Apple's Speech framework.
/// Uses SFSpeechRecognizer for macOS 14+ and can be extended for SpeechAnalyzer on macOS 26+.
public actor SpeechService {

    public init() {}

    /// Transcribe an audio file at the given path.
    public func transcribeFile(path: String, language: String? = nil) async throws -> TranscriptionResult {
        #if canImport(Speech)
        let url = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: path) else {
            throw SpeechError.fileNotFound(path)
        }

        let locale = language.map { Locale(identifier: $0) } ?? Locale.current
        guard let recognizer = SFSpeechRecognizer(locale: locale) else {
            throw SpeechError.unsupportedLanguage(locale.identifier)
        }

        guard recognizer.isAvailable else {
            throw SpeechError.unavailable
        }

        // Request authorization
        let status = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { status in
                cont.resume(returning: status)
            }
        }
        guard status == .authorized else {
            throw SpeechError.notAuthorized
        }

        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false
        request.requiresOnDeviceRecognition = true

        let result = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<SFSpeechRecognitionResult, Error>) in
            // Guard against double-resume: recognitionTask callback may fire
            // with error after isFinal, or multiple times before settling.
            var resumed = false
            recognizer.recognitionTask(with: request) { result, error in
                guard !resumed else { return }
                if let error = error {
                    resumed = true
                    cont.resume(throwing: error)
                } else if let result = result, result.isFinal {
                    resumed = true
                    cont.resume(returning: result)
                }
            }
        }

        let segments = result.bestTranscription.segments.map { seg in
            TranscriptionSegment(
                text: seg.substring,
                timestamp: seg.timestamp,
                duration: seg.duration,
                confidence: Double(seg.confidence)
            )
        }

        return TranscriptionResult(
            text: result.bestTranscription.formattedString,
            segments: segments,
            language: locale.identifier,
            onDevice: true
        )
        #else
        throw SpeechError.unavailable
        #endif
    }

    /// Check if speech recognition is available.
    public func checkAvailability() -> SpeechAvailability {
        #if canImport(Speech)
        let recognizer = SFSpeechRecognizer()
        return SpeechAvailability(
            available: recognizer?.isAvailable ?? false,
            supportsOnDevice: recognizer?.supportsOnDeviceRecognition ?? false
        )
        #else
        return SpeechAvailability(available: false, supportsOnDevice: false)
        #endif
    }
}

public struct TranscriptionResult: Codable, Sendable {
    public let text: String
    public let segments: [TranscriptionSegment]
    public let language: String
    public let onDevice: Bool
}

public struct TranscriptionSegment: Codable, Sendable {
    public let text: String
    public let timestamp: Double
    public let duration: Double
    public let confidence: Double
}

public struct SpeechAvailability: Codable, Sendable {
    public let available: Bool
    public let supportsOnDevice: Bool
}

public enum SpeechError: LocalizedError {
    case fileNotFound(String)
    case unsupportedLanguage(String)
    case unavailable
    case notAuthorized

    public var errorDescription: String? {
        switch self {
        case .fileNotFound(let path): return "Audio file not found: \(path)"
        case .unsupportedLanguage(let lang): return "Unsupported language: \(lang)"
        case .unavailable: return "Speech recognition is not available on this device"
        case .notAuthorized: return "Speech recognition not authorized. Grant permission in System Settings > Privacy & Security > Speech Recognition"
        }
    }
}
