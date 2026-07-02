// AirMCPKit — LineWriter concurrency tests.
// Uses XCTest for broad toolchain compatibility (CommandLineTools + Xcode).
//
// Reproduction/guard for the persistent-mode stdout race: the bridge writes
// JSON-RPC responses on its serial request loop while `start-observer` events
// are emitted from other executors. With the pre-fix two-write pattern
// (payload, then "\n", unlocked) those producers could interleave on stdout,
// corrupting a line and dropping the in-flight response. LineWriter serializes
// writes and emits each line as one contiguous buffer; these tests pin that
// invariant down deterministically.

import XCTest
import Foundation
@testable import AirMCPKit

final class LineWriterTests: XCTestCase {

    /// Thread-safe sink that concatenates every raw write it receives.
    private final class ByteCollector: @unchecked Sendable {
        private let lock = NSLock()
        private var buffer = Data()
        func append(_ d: Data) {
            lock.lock(); defer { lock.unlock() }
            buffer.append(d)
        }
        func snapshot() -> Data {
            lock.lock(); defer { lock.unlock() }
            return buffer
        }
    }

    func testWriteLineAppendsExactlyOneTrailingNewline() {
        let collector = ByteCollector()
        let writer = LineWriter(sink: { collector.append($0) })
        writer.writeLine(Data("hello".utf8))
        XCTAssertEqual(collector.snapshot(), Data("hello\n".utf8))
    }

    func testConcurrentWritesStayWholeAndUninterleaved() {
        let collector = ByteCollector()
        let writer = LineWriter(sink: { collector.append($0) })

        let workers = 8
        let perWorker = 400
        // Hammer the writer from many threads at once — the scenario the race
        // needs (multiple producers writing to one stream concurrently).
        DispatchQueue.concurrentPerform(iterations: workers) { w in
            for i in 0..<perWorker {
                writer.writeLine(Data("worker-\(w)-msg-\(i)".utf8))
            }
        }

        let all = collector.snapshot()
        // Split on '\n'. Every writeLine contributes exactly one "payload\n", so
        // there is one trailing empty element after the final newline.
        let lines = all.split(separator: 0x0A, omittingEmptySubsequences: false)
        XCTAssertEqual(lines.count, workers * perWorker + 1,
                       "line count drifted — a message was split or two were merged")
        XCTAssertTrue(lines.last?.isEmpty ?? false, "output must end with a newline")

        // Every message must appear exactly once and intact. A split line would
        // not carry the full "worker-W-msg-I" text; a merged line would contain
        // two of them (and fail the unique-count check).
        var seen = Set<String>()
        for line in lines.dropLast() {
            let s = String(decoding: line, as: UTF8.self)
            XCTAssertTrue(s.hasPrefix("worker-"), "corrupted/interleaved line: \(s)")
            seen.insert(s)
        }
        XCTAssertEqual(seen.count, workers * perWorker,
                       "expected every message exactly once — none split or merged")
    }
}
