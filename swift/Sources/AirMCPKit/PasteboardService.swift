import Foundation
#if canImport(AppKit)
import AppKit
#endif

/// Observes macOS pasteboard for changes and provides structured clipboard data.
public actor PasteboardService {

    public init() {}

    #if canImport(AppKit)
    /// Get current pasteboard content with type information.
    public func getContent() -> PasteboardContent {
        let pb = NSPasteboard.general
        let types = pb.types?.map { $0.rawValue } ?? []
        let text = pb.string(forType: .string)
        let hasImage = pb.canReadItem(withDataConformingToTypes: [NSPasteboard.PasteboardType.png.rawValue, NSPasteboard.PasteboardType.tiff.rawValue])
        let hasURL = pb.canReadItem(withDataConformingToTypes: [NSPasteboard.PasteboardType.URL.rawValue])
        let urlString = pb.string(forType: .URL) ?? pb.propertyList(forType: .URL) as? String

        return PasteboardContent(
            text: text,
            hasImage: hasImage,
            hasURL: hasURL,
            url: urlString,
            types: types,
            changeCount: pb.changeCount
        )
    }

    /// Get current change count (for polling comparison).
    public func getChangeCount() -> Int {
        return NSPasteboard.general.changeCount
    }

    /// Detect what kind of content was just copied (for smart context).
    public func detectContentType() -> PasteboardContentType {
        let pb = NSPasteboard.general
        let text = pb.string(forType: .string) ?? ""

        // URL pattern
        if text.hasPrefix("http://") || text.hasPrefix("https://") {
            return .url
        }

        // Email pattern
        let emailRegex = try? NSRegularExpression(pattern: "^[\\w.+-]+@[\\w.-]+\\.[a-zA-Z]{2,}$")
        if emailRegex?.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil {
            return .email
        }

        // Phone pattern (simple)
        let phoneRegex = try? NSRegularExpression(pattern: "^[+]?[\\d\\s\\-().]{7,}$")
        if phoneRegex?.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil {
            return .phone
        }

        // Date pattern (ISO, common formats)
        let dateFormatters = [
            "yyyy-MM-dd", "MM/dd/yyyy", "dd.MM.yyyy",
            "yyyy-MM-dd'T'HH:mm:ss"
        ]
        for fmt in dateFormatters {
            let df = DateFormatter()
            df.dateFormat = fmt
            if df.date(from: text.trimmingCharacters(in: .whitespaces)) != nil {
                return .date
            }
        }

        // File path
        if text.hasPrefix("/") || text.hasPrefix("~") {
            if FileManager.default.fileExists(atPath: (text as NSString).expandingTildeInPath) {
                return .filePath
            }
        }

        // Image in pasteboard
        if pb.canReadItem(withDataConformingToTypes: [NSPasteboard.PasteboardType.png.rawValue, NSPasteboard.PasteboardType.tiff.rawValue]) {
            return .image
        }

        if text.isEmpty { return .empty }
        return .text
    }
    #else
    public func getContent() -> PasteboardContent {
        return PasteboardContent(text: nil, hasImage: false, hasURL: false, url: nil, types: [], changeCount: 0)
    }
    public func getChangeCount() -> Int { return 0 }
    public func detectContentType() -> PasteboardContentType { return .empty }
    #endif
}

public struct PasteboardContent: Codable, Sendable {
    public let text: String?
    public let hasImage: Bool
    public let hasURL: Bool
    public let url: String?
    public let types: [String]
    public let changeCount: Int
}

public enum PasteboardContentType: String, Codable, Sendable {
    case text, url, email, phone, date, filePath, image, empty
}
