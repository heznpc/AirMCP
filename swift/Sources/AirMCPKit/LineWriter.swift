import Foundation

/// Serializes newline-delimited writes to a byte sink so that concurrently
/// produced messages can never interleave on a shared stream.
///
/// The bridge speaks newline-delimited JSON-RPC over stdout. Its serial request
/// loop and the async `start-observer` events fire from *different* executors
/// (DispatchSource file watchers, EventKit / main-queue notifications, the
/// pasteboard timer). Writing a payload and its trailing newline as two separate,
/// unlocked `FileHandle.write` calls let an event's bytes land between a
/// response's payload and its newline, producing a merged/split line that breaks
/// the Node-side line parser and drops the in-flight response.
///
/// `LineWriter` closes both gaps: every `writeLine` (a) builds `payload + "\n"`
/// as ONE contiguous buffer and (b) writes it while holding a lock, so a message
/// can never be split across two writes and two producers can never interleave.
public final class LineWriter: @unchecked Sendable {
    private let lock = NSLock()
    private let sink: (Data) -> Void

    /// Create a writer backed by an arbitrary sink. Used in tests to capture
    /// the exact bytes handed to the underlying stream.
    public init(sink: @escaping (Data) -> Void) {
        self.sink = sink
    }

    /// Create a writer backed by a `FileHandle` (e.g. `.standardOutput`).
    public convenience init(_ handle: FileHandle) {
        self.init(sink: { handle.write($0) })
    }

    /// Write `payload` followed by a single `\n`, atomically with respect to
    /// every other `writeLine` call on this writer.
    public func writeLine(_ payload: Data) {
        var line = payload
        line.append(0x0A) // "\n"
        lock.lock()
        defer { lock.unlock() }
        sink(line)
    }
}
