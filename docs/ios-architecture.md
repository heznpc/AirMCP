# AirMCP iOS Architecture Design

> macOS의 "모든 앱 제어"에서 iOS의 "PIM 데이터 통합 접근 + Apple Intelligence"로 재포지셔닝

---

## Current Status (2026-04-23)

- [x] Architecture document (이 문서)
- [x] Swift bridge with 19+ iOS-compatible commands (`swift/Sources/AirMcpBridge/main.swift`)
- [x] App Intents sample (4 intents in `app/Sources/AirMCPApp/AppIntents.swift`)
- [x] macOS menubar app
- [x] AirMCPKit shared Swift package (`swift/Package.swift` — platforms: `macOS(.v14)`, iOS target via `ios/Package.swift`)
- [x] Swift MCP server (Hummingbird) — `ios/Sources/AirMCPServer/HTTPServer.swift`
- [x] Package.swift iOS targets (`ios/Package.swift` — `iOS(.v17), macOS(.v14)`)
- [x] **outputSchema Wave 1/2/3** coverage for high-traffic read tools (60/270+ tools, Dec '25 → Apr '26, PR #95)
- [x] **Script ↔ outputSchema contract tests** — JXA + Swift-bridge-health both have strict drift guards (PR #97, #98)
- [x] **MCP smoke boot test** in CI — `scripts/smoke-mcp.mjs` (PR #98)
- [x] RFC 0005 Draft — OAuth 2.1 + Resource Indicators (MCP 2025-06-18 spec)
- [x] RFC 0006 Draft — Swift `--dump-example-output` for true schema contract
- [ ] **RFC 0007 Draft — MCP Tool ↔ App Intent auto-bridge** (next, see §15.2)
- [ ] iOS SwiftUI app (shell exists, UI in progress)
- [ ] HealthKit module + legal guardrails
- [ ] Interactive Snippets renderer (iOS 26+) — outputSchema → SwiftUI view
- [ ] FoundationModels host mode (iOS 26 on-device LLM) — offline agent
- [ ] Liquid Glass UI pass (iOS 26+, likely mandatory iOS 27)

---

## 1. Executive Summary

AirMCP iOS는 macOS 버전의 포트가 아니라 **iOS 제약에 최적화된 별도 제품**이다. 그리고 **2026-Q2 시점** 포지션은 아래 세 가지 동시 흐름 덕에 크게 바뀌었다 (§15 참조).

1. **Apple이 iOS 26.1 beta부터 MCP를 App Intents 기반으로 시스템에 내장 중** — AirMCP가 먼저 움직여 있으면 AppStore에서 "유일하게 호환되는 네이티브 MCP 앱"이 된다.
2. **FoundationModels 프레임워크(iOS 26)** 가 ~3B 온디바이스 LLM을 Swift API로 노출 — **AirMCP iOS 앱이 자체 호스트로 전환하면 Claude 없이도 완전 오프라인 AI-PIM 허브** 가 된다.
3. **MCP Apps spec(2026-01-26)** 으로 툴이 샌드박스 iframe UI를 반환 — AirMCP는 이미 `@modelcontextprotocol/ext-apps@1.5.0`에 의존 중, **현재 Claude·ChatGPT·VS Code 등에서 가동 중**이고 기술 부채 0.

|               | macOS (현재)                                        | iOS (2026-Q2 목표)                                         |
| ------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| 핵심 가치     | 모든 앱을 AI로 제어                                 | PIM 데이터 통합 + **오프라인 on-device AI** 허브           |
| 자동화 방식   | JXA (osascript)                                     | 네이티브 프레임워크 직접 호출                              |
| MCP 서버      | Node.js (TypeScript)                                | Swift (embedded in app)                                    |
| 트랜스포트    | stdio + HTTP (`with-token`/`with-oauth` — RFC 0005) | HTTP + App Intents + (시스템 MCP, iOS 26.1+)               |
| UI 표면       | MCP Apps iframes (Claude 등)                        | **MCP Apps iframes + iOS Interactive Snippets SwiftUI 뷰** |
| 자체 에이전트 | 외부 클라이언트(Claude/ChatGPT) 의존                | **FoundationModels 호스트 모드** 로 오프라인 자율          |
| 도구 수       | 270+ (run-time 등록 ~125; smoke 기준)               | ~80–100 (Phase 1: ~40, Health 확장 후 ~60)                 |
| 배포          | npm (`npx airmcp`)                                  | App Store                                                  |

**핵심 전략**: 공유 Swift Package(`AirMCPKit`)를 extract하여 macOS/iOS 양쪽에서 사용. **Phase 2부터는 MCP 툴을 App Intent로 자동 노출** (RFC 0007) → iOS 26.1의 시스템 MCP GA 시점에 AirMCP는 이미 준비 완료. Phase 3에서 **FoundationModels 로 자체 에이전트 루프** 내장.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    AirMCP iOS App (SwiftUI)                  │
│                                                             │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ Dashboard  │  │  Settings    │  │  MCP Session Monitor│ │
│  │ (Widgets)  │  │  (Modules)   │  │  (Live Activity)    │ │
│  └────────────┘  └──────────────┘  └─────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              App Intents Layer                        │   │
│  │  (Siri / Shortcuts / iOS 26.1 MCP Bridge 대비)       │   │
│  └──────────────────────────────────────────────────────┘   │
│                         │                                   │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │           AirMCPKit (Shared Swift Package)           │   │
│  │                                                      │   │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────────┐   │   │
│  │  │ Calendar │ │ Contacts │ │ Apple Intelligence  │   │   │
│  │  │(EventKit)│ │(Contacts)│ │(FoundationModels)  │   │   │
│  │  └──────────┘ └──────────┘ └────────────────────┘   │   │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────────┐   │   │
│  │  │Reminders │ │  Photos  │ │  Semantic Search   │   │   │
│  │  │(EventKit)│ │(PhotoKit)│ │(NLEmbedding+Store) │   │   │
│  │  └──────────┘ └──────────┘ └────────────────────┘   │   │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────────┐   │   │
│  │  │ Location │ │Bluetooth │ │  Document Scanner  │   │   │
│  │  │(CoreLoc) │ │(CoreBT)  │ │  (Vision)          │   │   │
│  │  └──────────┘ └──────────┘ └────────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│                         │                                   │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │        Swift MCP Server (Hummingbird HTTP)           │   │
│  │        localhost:3847 — JSON-RPC 2.0 / SSE           │   │
│  └──────────────────────────────────────────────────────┘   │
│                         │                                   │
└─────────────────────────│───────────────────────────────────┘
                          │
              ┌───────────▼───────────┐
              │  MCP Client           │
              │  (Claude Code Mobile, │
              │   Shortcuts, Siri)    │
              └───────────────────────┘
```

---

## 3. Repository Structure

기존 모노레포에 iOS 타겟을 추가하는 구조:

```
airmcp/
├── swift/                          # 기존 macOS Swift bridge
│   ├── Package.swift
│   └── Sources/AirMcpBridge/
│       └── main.swift              # macOS CLI (변경 없음)
│
├── AirMCPKit/                      # ★ 신규: 공유 Swift Package
│   ├── Package.swift
│   └── Sources/
│       ├── AirMCPKit/              # 공통 인터페이스
│       │   ├── ToolProtocol.swift
│       │   ├── ToolResult.swift
│       │   ├── ModuleRegistry.swift
│       │   └── Config.swift
│       ├── CalendarModule/
│       │   ├── CalendarService.swift      # EventKit 래퍼
│       │   ├── CalendarTools.swift        # MCP 도구 정의
│       │   └── CalendarIntents.swift      # App Intents
│       ├── RemindersModule/
│       │   ├── RemindersService.swift
│       │   ├── RemindersTools.swift
│       │   └── RemindersIntents.swift
│       ├── ContactsModule/
│       │   ├── ContactsService.swift
│       │   ├── ContactsTools.swift
│       │   └── ContactsIntents.swift
│       ├── PhotosModule/
│       │   ├── PhotosService.swift
│       │   ├── PhotosTools.swift
│       │   └── PhotosIntents.swift
│       ├── IntelligenceModule/
│       │   ├── IntelligenceService.swift  # FoundationModels
│       │   ├── IntelligenceTools.swift
│       │   └── IntelligenceIntents.swift
│       ├── LocationModule/
│       │   ├── LocationService.swift
│       │   ├── LocationTools.swift
│       │   └── LocationIntents.swift
│       ├── BluetoothModule/
│       │   ├── BluetoothService.swift
│       │   ├── BluetoothTools.swift
│       │   └── BluetoothIntents.swift
│       ├── SemanticModule/
│       │   ├── EmbeddingService.swift     # NLContextualEmbedding
│       │   ├── VectorStore.swift          # 로컬 벡터 DB
│       │   ├── SemanticTools.swift
│       │   └── SemanticIntents.swift
│       ├── VisionModule/
│       │   ├── DocumentScanner.swift
│       │   ├── VisionTools.swift
│       │   └── VisionIntents.swift
│       └── WeatherModule/
│           ├── WeatherService.swift       # Open-Meteo API
│           ├── WeatherTools.swift
│           └── WeatherIntents.swift
│
├── AirMCPServer/                   # ★ 신규: Swift MCP Server
│   ├── Package.swift
│   └── Sources/
│       ├── MCPCore/                # MCP 프로토콜 구현
│       │   ├── MCPServer.swift
│       │   ├── JSONRPCHandler.swift
│       │   ├── ToolRegistry.swift
│       │   ├── ResourceProvider.swift
│       │   └── SSETransport.swift
│       └── MCPHTTPServer/          # HTTP 트랜스포트
│           ├── HTTPServer.swift    # Hummingbird 기반
│           └── SessionManager.swift
│
├── ios/                            # ★ 신규: iOS 앱
│   ├── AirMCP.xcodeproj
│   └── AirMCP/
│       ├── AirMCPApp.swift         # @main, Scene
│       ├── ContentView.swift       # 메인 대시보드
│       ├── ServerManager.swift     # MCP 서버 생명주기
│       ├── Views/
│       │   ├── DashboardView.swift
│       │   ├── ModuleSettingsView.swift
│       │   ├── SessionMonitorView.swift
│       │   ├── PermissionGuideView.swift
│       │   └── OnboardingView.swift
│       ├── Widgets/
│       │   ├── BriefingWidget.swift
│       │   └── QuickActionWidget.swift
│       ├── LiveActivity/
│       │   └── MCPSessionActivity.swift
│       ├── AppIntents/
│       │   └── AirMCPShortcuts.swift    # Siri 프레이즈
│       └── Info.plist
│
├── app/                            # 기존 macOS menubar 앱 (변경 없음)
├── src/                            # 기존 Node.js MCP 서버 (변경 없음)
└── docs/
    └── ios-architecture.md         # 이 문서
```

---

## 4. AirMCPKit — 공유 Swift Package

### 4.1 설계 원칙

1. **플랫폼 독립**: `#if os(iOS)` / `#if os(macOS)`로 분기, 핵심 로직은 공유
2. **프로토콜 기반**: 모든 모듈이 `AirMCPModule` 프로토콜 준수
3. **async/await 네이티브**: Swift Concurrency 전면 사용
4. **의존성 최소화**: Apple 프레임워크만, 서드파티 없음

### 4.2 핵심 프로토콜

```swift
// AirMCPKit/Sources/AirMCPKit/ToolProtocol.swift

/// MCP 도구 하나를 정의하는 프로토콜
public protocol AirMCPTool: Sendable {
    /// MCP tool name (e.g., "list_calendars")
    static var name: String { get }
    /// 사람이 읽을 수 있는 설명
    static var description: String { get }
    /// JSON Schema for input parameters
    static var inputSchema: [String: Any] { get }
    /// 읽기 전용 여부
    static var readOnly: Bool { get }
    /// 파괴적 작업 여부
    static var destructive: Bool { get }

    /// 도구 실행
    func execute(arguments: [String: Any]) async throws -> ToolResult
}

/// MCP 모듈 (도구 묶음)
public protocol AirMCPModule: Sendable {
    /// 모듈 이름 (e.g., "calendar")
    static var name: String { get }
    /// 이 모듈이 현재 플랫폼에서 사용 가능한지
    static var isAvailable: Bool { get }
    /// 모듈이 제공하는 도구 목록
    var tools: [any AirMCPTool] { get }
    /// 필요한 시스템 권한
    var requiredPermissions: [SystemPermission] { get }
}

/// 도구 실행 결과
public struct ToolResult: Sendable, Encodable {
    public let content: [ContentItem]
    public let isError: Bool

    public static func ok<T: Encodable>(_ data: T) -> ToolResult { ... }
    public static func err(_ message: String) -> ToolResult { ... }
}

/// 시스템 권한 종류
public enum SystemPermission: String, Sendable, CaseIterable {
    case calendar       // EventKit - 캘린더
    case reminders      // EventKit - 리마인더
    case contacts       // Contacts framework
    case photos         // PhotoKit
    case location       // CoreLocation
    case bluetooth      // CoreBluetooth
    case camera         // AVCaptureDevice (문서 스캔)
    case health         // HealthKit (iOS only)
}
```

### 4.3 모듈 구현 예시: Calendar

```swift
// AirMCPKit/Sources/CalendarModule/CalendarService.swift

import EventKit

/// EventKit 기반 캘린더 접근 — macOS와 iOS에서 동일하게 동작
public actor CalendarService {
    private let store = EKEventStore()

    public init() {}

    public func requestAccess() async throws -> Bool {
        try await store.requestFullAccessToEvents()
    }

    public func listCalendars() async -> [CalendarInfo] {
        store.calendars(for: .event).map { CalendarInfo(from: $0) }
    }

    public func todayEvents() async throws -> [CalendarEvent] {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        let end = calendar.date(byAdding: .day, value: 1, to: start)!
        let predicate = store.predicateForEvents(
            withStart: start, end: end, calendars: nil
        )
        return store.events(matching: predicate).map { CalendarEvent(from: $0) }
    }

    public func searchEvents(query: String, from: Date, to: Date) async throws -> [CalendarEvent] {
        let predicate = store.predicateForEvents(
            withStart: from, end: to, calendars: nil
        )
        return store.events(matching: predicate)
            .filter { $0.title.localizedCaseInsensitiveContains(query) }
            .map { CalendarEvent(from: $0) }
    }

    public func createEvent(_ input: CreateEventInput) async throws -> CalendarEvent {
        let event = EKEvent(eventStore: store)
        event.title = input.title
        event.startDate = input.startDate
        event.endDate = input.endDate
        event.location = input.location
        event.notes = input.notes
        event.calendar = input.calendarId.flatMap { id in
            store.calendars(for: .event).first { $0.calendarIdentifier == id }
        } ?? store.defaultCalendarForNewEvents

        if let recurrence = input.recurrence {
            event.addRecurrenceRule(recurrence.toEKRecurrenceRule())
        }

        try store.save(event, span: .thisEvent)
        return CalendarEvent(from: event)
    }

    public func updateEvent(id: String, _ input: UpdateEventInput) async throws -> CalendarEvent {
        guard let event = store.event(withIdentifier: id) else {
            throw AirMCPError.notFound("Event \(id)")
        }
        if let title = input.title { event.title = title }
        if let location = input.location { event.location = location }
        if let notes = input.notes { event.notes = notes }
        try store.save(event, span: .thisEvent)
        return CalendarEvent(from: event)
    }

    public func deleteEvent(id: String) async throws {
        guard let event = store.event(withIdentifier: id) else {
            throw AirMCPError.notFound("Event \(id)")
        }
        try store.remove(event, span: .thisEvent)
    }
}
```

```swift
// AirMCPKit/Sources/CalendarModule/CalendarTools.swift

/// MCP 도구로 CalendarService를 노출
public struct ListCalendarsTool: AirMCPTool {
    public static let name = "list_calendars"
    public static let description = "List all calendars with their names and IDs"
    public static let inputSchema: [String: Any] = [:]
    public static let readOnly = true
    public static let destructive = false

    private let service: CalendarService

    public init(service: CalendarService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> ToolResult {
        let calendars = await service.listCalendars()
        return .ok(calendars)
    }
}

public struct TodayEventsTool: AirMCPTool {
    public static let name = "today_events"
    public static let description = "List today's calendar events"
    public static let inputSchema: [String: Any] = [:]
    public static let readOnly = true
    public static let destructive = false

    private let service: CalendarService

    public init(service: CalendarService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> ToolResult {
        let events = try await service.todayEvents()
        return .ok(events)
    }
}

public struct CreateEventTool: AirMCPTool {
    public static let name = "create_event"
    public static let description = "Create a new calendar event"
    public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "title": ["type": "string", "description": "Event title"],
            "startDate": ["type": "string", "format": "date-time"],
            "endDate": ["type": "string", "format": "date-time"],
            "location": ["type": "string"],
            "notes": ["type": "string"],
            "calendarId": ["type": "string"],
            "recurrence": [
                "type": "object",
                "properties": [
                    "frequency": ["type": "string", "enum": ["daily", "weekly", "monthly", "yearly"]],
                    "interval": ["type": "integer", "minimum": 1],
                    "daysOfWeek": ["type": "array", "items": ["type": "integer"]],
                ]
            ]
        ],
        "required": ["title", "startDate", "endDate"]
    ]
    public static let readOnly = false
    public static let destructive = false

    private let service: CalendarService

    public init(service: CalendarService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> ToolResult {
        let input = try CreateEventInput(from: arguments)
        let event = try await service.createEvent(input)
        return .ok(event)
    }
}

public struct DeleteEventTool: AirMCPTool {
    public static let name = "delete_event"
    public static let description = "Delete a calendar event"
    public static let inputSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "eventId": ["type": "string", "description": "Event identifier"]
        ],
        "required": ["eventId"]
    ]
    public static let readOnly = false
    public static let destructive = true  // ← 파괴적

    private let service: CalendarService

    public init(service: CalendarService) { self.service = service }

    public func execute(arguments: [String: Any]) async throws -> ToolResult {
        guard let id = arguments["eventId"] as? String else {
            return .err("Missing eventId")
        }
        try await service.deleteEvent(id: id)
        return .ok(["deleted": id])
    }
}
```

```swift
// AirMCPKit/Sources/CalendarModule/CalendarIntents.swift

import AppIntents

/// App Intent — Siri / Shortcuts / iOS 26.1 MCP Bridge
struct CheckCalendarIntent: AppIntent {
    static var title: LocalizedStringResource = "Check Calendar"
    static var description = IntentDescription("List today's calendar events")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let service = CalendarService()
        let events = try await service.todayEvents()
        let data = try JSONEncoder().encode(events)
        return .result(value: String(data: data, encoding: .utf8) ?? "[]")
    }
}

struct SearchCalendarIntent: AppIntent {
    static var title: LocalizedStringResource = "Search Calendar"
    static var description = IntentDescription("Search calendar events by keyword")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Query")
    var query: String

    @Parameter(title: "Days", default: 30)
    var days: Int

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let service = CalendarService()
        let from = Date()
        let to = Calendar.current.date(byAdding: .day, value: days, to: from)!
        let events = try await service.searchEvents(query: query, from: from, to: to)
        let data = try JSONEncoder().encode(events)
        return .result(value: String(data: data, encoding: .utf8) ?? "[]")
    }
}

struct CreateEventIntent: AppIntent {
    static var title: LocalizedStringResource = "Create Calendar Event"
    static var description = IntentDescription("Create a new calendar event")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Title")
    var eventTitle: String

    @Parameter(title: "Start Date")
    var startDate: Date

    @Parameter(title: "End Date")
    var endDate: Date

    @Parameter(title: "Location")
    var location: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Create event \(\.$eventTitle) from \(\.$startDate) to \(\.$endDate)") {
            \.$location
        }
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let service = CalendarService()
        let input = CreateEventInput(
            title: eventTitle, startDate: startDate,
            endDate: endDate, location: location
        )
        let event = try await service.createEvent(input)
        return .result(value: "Created: \(event.title)")
    }
}
```

### 4.4 Package.swift

```swift
// AirMCPKit/Package.swift

// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "AirMCPKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "AirMCPKit", targets: ["AirMCPKit"]),
        .library(name: "CalendarModule", targets: ["CalendarModule"]),
        .library(name: "RemindersModule", targets: ["RemindersModule"]),
        .library(name: "ContactsModule", targets: ["ContactsModule"]),
        .library(name: "PhotosModule", targets: ["PhotosModule"]),
        .library(name: "IntelligenceModule", targets: ["IntelligenceModule"]),
        .library(name: "LocationModule", targets: ["LocationModule"]),
        .library(name: "BluetoothModule", targets: ["BluetoothModule"]),
        .library(name: "SemanticModule", targets: ["SemanticModule"]),
        .library(name: "VisionModule", targets: ["VisionModule"]),
        .library(name: "WeatherModule", targets: ["WeatherModule"]),
    ],
    targets: [
        .target(name: "AirMCPKit"),
        .target(name: "CalendarModule", dependencies: ["AirMCPKit"]),
        .target(name: "RemindersModule", dependencies: ["AirMCPKit"]),
        .target(name: "ContactsModule", dependencies: ["AirMCPKit"]),
        .target(name: "PhotosModule", dependencies: ["AirMCPKit"]),
        .target(
            name: "IntelligenceModule",
            dependencies: ["AirMCPKit"],
            swiftSettings: [
                .define("FOUNDATION_MODELS", .when(platforms: [.iOS, .macOS]))
            ]
        ),
        .target(name: "LocationModule", dependencies: ["AirMCPKit"]),
        .target(name: "BluetoothModule", dependencies: ["AirMCPKit"]),
        .target(name: "SemanticModule", dependencies: ["AirMCPKit"]),
        .target(name: "VisionModule", dependencies: ["AirMCPKit"]),
        .target(name: "WeatherModule", dependencies: ["AirMCPKit"]),

        // Tests
        .testTarget(name: "CalendarModuleTests", dependencies: ["CalendarModule"]),
        .testTarget(name: "RemindersModuleTests", dependencies: ["RemindersModule"]),
        .testTarget(name: "ContactsModuleTests", dependencies: ["ContactsModule"]),
        .testTarget(name: "PhotosModuleTests", dependencies: ["PhotosModule"]),
    ]
)
```

---

## 5. iOS App Architecture

### 5.1 앱 생명주기

```
앱 시작
  │
  ├── 최초 실행? ──→ OnboardingView (권한 요청 가이드)
  │
  ├── 모듈별 권한 확인
  │   ├── 캘린더  ──→ EKEventStore.requestFullAccessToEvents()
  │   ├── 리마인더 ──→ EKEventStore.requestFullAccessToReminders()
  │   ├── 연락처  ──→ CNContactStore.requestAccess(for: .contacts)
  │   ├── 사진    ──→ PHPhotoLibrary.requestAuthorization(for: .readWrite)
  │   ├── 위치    ──→ CLLocationManager.requestWhenInUseAuthorization()
  │   └── 블루투스 ──→ CBCentralManager 초기화 시 자동 요청
  │
  ├── AirMCPKit 모듈 초기화
  │   └── ModuleRegistry.shared.loadEnabled(from: config)
  │
  ├── MCP HTTP 서버 시작 (localhost:3847)
  │   └── Live Activity 시작 ("AirMCP 서버 활성")
  │
  └── 대시보드 표시
```

### 5.2 서버 매니저

```swift
// ios/AirMCP/ServerManager.swift

import AirMCPKit
import AirMCPServer
import ActivityKit

@Observable
final class ServerManager {
    private(set) var isRunning = false
    private(set) var activeSessions: Int = 0
    private(set) var toolCallCount: Int = 0
    private var server: MCPHTTPServer?
    private var activity: Activity<MCPSessionAttributes>?

    let port: UInt16 = 3847

    func start() async throws {
        let registry = ModuleRegistry.shared
        let config = try AirMCPConfig.load()

        // 활성화된 모듈만 로드
        let modules = registry.enabledModules(for: config)

        server = MCPHTTPServer(port: port)

        // 각 모듈의 도구를 서버에 등록
        for module in modules {
            for tool in module.tools {
                server?.registerTool(tool)
            }
        }

        // 리소스 등록
        server?.registerResource("calendar://today") { [registry] in
            let cal = registry.module(CalendarModule.self)
            return try await cal?.service.todayEvents()
        }

        try await server?.start()
        isRunning = true

        // Live Activity로 서버 상태 표시
        await startLiveActivity()
    }

    func stop() async {
        await server?.stop()
        isRunning = false
        await endLiveActivity()
    }

    private func startLiveActivity() async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attributes = MCPSessionAttributes()
        let state = MCPSessionAttributes.ContentState(
            activeConnections: 0, toolCallCount: 0, lastToolName: nil
        )
        activity = try? Activity.request(
            attributes: attributes, content: .init(state: state, staleDate: nil)
        )
    }

    private func endLiveActivity() async {
        await activity?.end(nil, dismissalPolicy: .immediate)
        activity = nil
    }
}
```

### 5.3 MCP 연결 방식 (2-track)

**Track A: HTTP Server (즉시 사용 가능)**

```
Claude Code Mobile ─── HTTP ───→ localhost:3847 ───→ AirMCP iOS App
                    JSON-RPC 2.0 + SSE
```

- iOS 앱이 `Hummingbird` 기반 HTTP 서버를 로컬에서 실행
- MCP 클라이언트가 `http://localhost:3847/mcp` 로 연결
- SSE(Server-Sent Events)로 progress notification 전송
- 앱이 포그라운드에 있어야 동작 (Live Activity로 사용자에게 알림)

**Track B: App Intents → MCP Bridge (iOS 26.1+ 자동 전환)**

```
Siri / Shortcuts / 시스템 MCP
         │
         ▼
  App Intents Framework
         │
         ▼
  AirMCPKit 모듈 직접 호출
```

- Apple이 iOS 26.1에서 MCP↔App Intents 브릿지를 내장할 예정
- AirMCPKit의 모든 도구가 이미 App Intent로 구현되어 있으므로 **코드 변경 없이 자동 활성화**
- HTTP 서버 불필요, 시스템이 MCP 프로토콜 처리
- 이 시점에서 앱은 "도구 제공자" 역할만 하면 됨

---

## 6. Swift MCP Server

iOS에서는 Node.js를 실행할 수 없으므로 Swift로 경량 MCP 서버를 구현한다.

### 6.1 의존성

```swift
// AirMCPServer/Package.swift

// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "AirMCPServer",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "MCPCore", targets: ["MCPCore"]),
        .library(name: "MCPHTTPServer", targets: ["MCPHTTPServer"]),
    ],
    dependencies: [
        .package(url: "https://github.com/hummingbird-project/hummingbird.git", from: "2.0.0"),
        .package(path: "../AirMCPKit"),
    ],
    targets: [
        .target(name: "MCPCore", dependencies: [
            .product(name: "AirMCPKit", package: "AirMCPKit"),
        ]),
        .target(name: "MCPHTTPServer", dependencies: [
            "MCPCore",
            .product(name: "Hummingbird", package: "hummingbird"),
        ]),
    ]
)
```

### 6.2 MCP 프로토콜 핸들러

```swift
// AirMCPServer/Sources/MCPCore/MCPServer.swift

import AirMCPKit

/// 경량 MCP 서버 — JSON-RPC 2.0
public actor MCPServer {
    private var tools: [String: any AirMCPTool] = [:]
    private var resources: [String: ResourceHandler] = [:]
    private let serverInfo: ServerInfo

    public init(name: String = "airmcp-ios", version: String = "1.0.0") {
        self.serverInfo = ServerInfo(name: name, version: version)
    }

    public func registerTool(_ tool: any AirMCPTool) {
        tools[type(of: tool).name] = tool
    }

    public func registerResource(_ uri: String, handler: @escaping ResourceHandler) {
        resources[uri] = handler
    }

    /// JSON-RPC 요청 처리
    public func handle(_ request: JSONRPCRequest) async -> JSONRPCResponse {
        switch request.method {
        case "initialize":
            return .success(id: request.id, result: [
                "protocolVersion": "2025-03-26",
                "capabilities": [
                    "tools": ["listChanged": false],
                    "resources": ["subscribe": false],
                ],
                "serverInfo": serverInfo.toDict()
            ])

        case "tools/list":
            let toolList = tools.values.map { tool -> [String: Any] in
                [
                    "name": type(of: tool).name,
                    "description": type(of: tool).description,
                    "inputSchema": type(of: tool).inputSchema,
                ]
            }
            return .success(id: request.id, result: ["tools": toolList])

        case "tools/call":
            return await handleToolCall(request)

        case "resources/list":
            let resourceList = resources.keys.map { uri -> [String: Any] in
                ["uri": uri, "mimeType": "application/json"]
            }
            return .success(id: request.id, result: ["resources": resourceList])

        case "resources/read":
            return await handleResourceRead(request)

        default:
            return .error(id: request.id, code: -32601, message: "Method not found")
        }
    }

    private func handleToolCall(_ request: JSONRPCRequest) async -> JSONRPCResponse {
        guard let params = request.params,
              let name = params["name"] as? String,
              let tool = tools[name] else {
            return .error(id: request.id, code: -32602, message: "Unknown tool")
        }

        let args = params["arguments"] as? [String: Any] ?? [:]

        // HITL: 파괴적 작업이면 확인 필요 (앱 내 UI로 위임)
        if type(of: tool).destructive {
            let approved = await HITLManager.shared.requestApproval(
                tool: name, args: args
            )
            guard approved else {
                return .error(id: request.id, code: -32000, message: "User denied")
            }
        }

        do {
            let result = try await tool.execute(arguments: args)
            return .success(id: request.id, result: result.toDict())
        } catch {
            return .error(id: request.id, code: -32000, message: error.localizedDescription)
        }
    }
}
```

### 6.3 HTTP Transport (Hummingbird)

```swift
// AirMCPServer/Sources/MCPHTTPServer/HTTPServer.swift

import Hummingbird
import MCPCore

public final class MCPHTTPServer: Sendable {
    private let mcp: MCPServer
    private let host: String
    private let port: UInt16

    public init(host: String = "127.0.0.1", port: UInt16 = 3847) {
        self.mcp = MCPServer()
        self.host = host
        self.port = port
    }

    public func registerTool(_ tool: any AirMCPTool) async {
        await mcp.registerTool(tool)
    }

    public func registerResource(_ uri: String, handler: @escaping ResourceHandler) async {
        await mcp.registerResource(uri, handler: handler)
    }

    public func start() async throws {
        let mcp = self.mcp

        let router = Router()

        // MCP endpoint (Streamable HTTP)
        router.post("/mcp") { request, context -> Response in
            let body = try await request.body.collect(upTo: 1_048_576)
            let jsonRPC = try JSONDecoder().decode(JSONRPCRequest.self, from: body)
            let response = await mcp.handle(jsonRPC)
            let responseData = try JSONEncoder().encode(response)
            return Response(
                status: .ok,
                headers: [.contentType: "application/json"],
                body: .init(byteBuffer: .init(data: responseData))
            )
        }

        // Discovery endpoint
        router.get("/.well-known/mcp.json") { _, _ -> Response in
            let info: [String: Any] = [
                "name": "airmcp-ios",
                "version": "1.0.0",
                "url": "http://localhost:\(self.port)/mcp"
            ]
            let data = try JSONSerialization.data(withJSONObject: info)
            return Response(
                status: .ok,
                headers: [.contentType: "application/json"],
                body: .init(byteBuffer: .init(data: data))
            )
        }

        // Health check
        router.get("/health") { _, _ -> Response in
            Response(status: .ok, body: .init(byteBuffer: .init(string: "ok")))
        }

        let app = Application(
            router: router,
            configuration: .init(address: .hostname(host, port: Int(port)))
        )
        try await app.run()
    }
}
```

---

## 7. Tool Module Mapping

### 7.1 iOS에서 사용 가능한 모듈

| 모듈             | iOS 프레임워크            | 도구 수 | Phase | 비고                    |
| ---------------- | ------------------------- | ------- | ----- | ----------------------- |
| **Calendar**     | EventKit                  | 10      | 1     | macOS와 거의 동일       |
| **Reminders**    | EventKit                  | 11      | 1     | macOS와 거의 동일       |
| **Contacts**     | Contacts.framework        | 10      | 1     | macOS와 거의 동일       |
| **Photos**       | PhotoKit                  | 10      | 1     | macOS와 거의 동일       |
| **Weather**      | Open-Meteo API            | 6       | 1     | HTTP API, 플랫폼 무관   |
| **Location**     | CoreLocation              | 4       | 1     | iOS에서 더 자연스러움   |
| **Intelligence** | FoundationModels          | 10      | 2     | iOS 18.1+ Apple Silicon |
| **Bluetooth**    | CoreBluetooth             | 5       | 2     | iOS에서 동일            |
| **Vision**       | Vision framework          | 3       | 2     | 문서 스캔/OCR           |
| **Semantic**     | NLEmbedding + VectorStore | 4       | 2     | on-device 임베딩        |
| **Health**       | HealthKit                 | 8+      | 3     | ★ iOS 전용 신규 모듈    |
| **Fitness**      | HealthKit + WorkoutKit    | 5+      | 3     | ★ iOS 전용 신규 모듈    |
| **Focus**        | ManagedSettings           | 3       | 3     | 집중 모드 제어          |

**Phase 1 합계: ~51개 도구** / **전체 합계: ~92개 이상**

### 7.2 iOS 전용 신규 모듈: Health

macOS에는 HealthKit이 없으므로 **iOS의 가장 큰 차별화 포인트**:

```swift
// AirMCPKit/Sources/HealthModule/HealthService.swift

import HealthKit

public actor HealthService {
    private let store = HKHealthStore()

    public func requestAccess() async throws {
        let readTypes: Set<HKObjectType> = [
            HKQuantityType(.stepCount),
            HKQuantityType(.heartRate),
            HKCategoryType(.sleepAnalysis),
            HKQuantityType(.activeEnergyBurned),
            HKQuantityType(.bodyMass),
            HKQuantityType(.height),
            HKWorkoutType.workoutType(),
        ]
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    public func todaySteps() async throws -> Int {
        let type = HKQuantityType(.stepCount)
        let predicate = HKQuery.predicateForSamples(
            withStart: Calendar.current.startOfDay(for: Date()),
            end: Date()
        )
        let descriptor = HKStatisticsQueryDescriptor(
            predicate: .init(type: type, predicate: predicate),
            options: .cumulativeSum
        )
        let result = try await descriptor.result(for: store)
        return Int(result?.sumQuantity()?.doubleValue(for: .count()) ?? 0)
    }

    public func recentHeartRate() async throws -> Double? {
        let type = HKQuantityType(.heartRate)
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.sample(type: type)],
            sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)],
            limit: 1
        )
        let samples = try await descriptor.result(for: store)
        return samples.first?.quantity.doubleValue(
            for: HKUnit.count().unitDivided(by: .minute())
        )
    }

    public func sleepAnalysis(date: Date) async throws -> SleepSummary { ... }
    public func recentWorkouts(limit: Int) async throws -> [WorkoutSummary] { ... }
    public func healthSummary() async throws -> HealthDashboard { ... }
}
```

### 7.3 macOS 전용 (iOS에서 제외)

| 모듈                  | 이유                                                             |
| --------------------- | ---------------------------------------------------------------- |
| Notes                 | 프로그래밍 API 없음 (JXA 전용). CloudKit 직접 접근은 private API |
| Mail                  | 앱 샌드박싱, `MessageUI`는 compose만 가능                        |
| Messages              | 앱 샌드박싱, 보안 제한                                           |
| Safari                | 웹 확장만 가능, 스크립팅 불가                                    |
| Finder                | 개념 자체 없음                                                   |
| Music                 | MusicKit 있지만 JXA보다 훨씬 제한적                              |
| System                | 볼륨/밝기/다크모드 직접 제어 불가                                |
| UI Automation         | Accessibility API 서드파티 접근 불가                             |
| TV / Podcasts         | 제어 API 없음                                                    |
| Pages/Numbers/Keynote | Document-based API 제한적                                        |
| Screen Capture        | 스크린샷 API 없음                                                |

---

## 8. App Intents 전략

### 8.1 왜 App Intents가 핵심인가

```
현재 (2026 Q1)                    미래 (iOS 26.1+)
──────────────                    ─────────────────
App Intents                       App Intents
    │                                 │
    ├── Siri 호출                     ├── Siri 호출
    ├── Shortcuts 자동화              ├── Shortcuts 자동화
    └── Spotlight 제안                ├── Spotlight 제안
                                     └── ★ MCP Tool로 자동 노출
                                         → 모든 MCP 클라이언트에서 사용 가능
```

Apple이 iOS 26.1에서 MCP↔App Intents 브릿지를 출시하면, 우리가 등록한 **모든 App Intent가 자동으로 MCP 도구가 됨**. HTTP 서버 없이도 시스템 레벨에서 MCP 프로토콜 처리. **따라서 모든 도구를 App Intent로 구현하는 것이 최우선 전략.**

### 8.2 App Shortcuts (Siri 트리거)

```swift
struct AirMCPShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: DailyBriefingIntent(),
            phrases: [
                "오늘 일정 알려줘 \(.applicationName)",
                "Daily briefing in \(.applicationName)",
                "브리핑 \(.applicationName)",
            ],
            shortTitle: "Daily Briefing",
            systemImageName: "calendar.badge.clock"
        )

        AppShortcut(
            intent: HealthSummaryIntent(),
            phrases: [
                "오늘 건강 요약 \(.applicationName)",
                "Health summary in \(.applicationName)",
            ],
            shortTitle: "Health Summary",
            systemImageName: "heart.fill"
        )

        AppShortcut(
            intent: CreateReminderIntent(),
            phrases: [
                "리마인더 만들어줘 \(.applicationName)",
                "Remind me in \(.applicationName)",
            ],
            shortTitle: "Quick Reminder",
            systemImageName: "checklist"
        )

        AppShortcut(
            intent: SearchPhotosIntent(),
            phrases: [
                "사진 찾아줘 \(.applicationName)",
                "Find photos in \(.applicationName)",
            ],
            shortTitle: "Search Photos",
            systemImageName: "photo.on.rectangle"
        )
    }
}
```

---

## 9. Background Execution & Lifecycle

### 9.1 iOS 백그라운드 제약

iOS는 앱이 백그라운드로 가면 ~30초 후 중단된다. MCP 서버 전략:

```
Track A: HTTP Server
├── 포그라운드: 정상 동작
├── 백그라운드 진입: Live Activity 표시
│   "AirMCP 서버가 활성 상태입니다. 탭하여 돌아가기"
├── 30초 후: beginBackgroundTask로 연장 요청
├── ~3분 후: 서버 일시정지, Local Notification 전송
│   "MCP 서버가 중단되었습니다. 앱을 열어주세요"
└── 앱 복귀: 서버 자동 재시작

Track B: App Intents (iOS 26.1+)
├── 앱이 실행 중이 아니어도 동작
├── 시스템이 intent 실행을 관리
└── 백그라운드 제약 없음 ← ★ 최종 목표

보조: BGAppRefreshTask
├── 주기적 시맨틱 인덱싱 (백그라운드 30초 이내)
└── 벡터 스토어 갱신
```

### 9.2 Live Activity

```swift
// ios/AirMCP/LiveActivity/MCPSessionActivity.swift

import ActivityKit

struct MCPSessionAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var activeConnections: Int
        var toolCallCount: Int
        var lastToolName: String?
    }
}

// Dynamic Island compact: "AirMCP ● 3 calls"
// Dynamic Island expanded: connection count + last tool + stop button
// Lock screen: full server status
```

---

## 10. Security & Permissions

### 10.1 Info.plist 권한 선언

```xml
<!-- EventKit -->
<key>NSCalendarsFullAccessUsageDescription</key>
<string>AirMCP needs calendar access to manage events via AI assistants.</string>
<key>NSRemindersFullAccessUsageDescription</key>
<string>AirMCP needs reminder access to manage reminders via AI assistants.</string>

<!-- Contacts -->
<key>NSContactsUsageDescription</key>
<string>AirMCP needs contacts access to search and manage contacts via AI assistants.</string>

<!-- Photos -->
<key>NSPhotoLibraryUsageDescription</key>
<string>AirMCP needs photo library access to search and manage photos via AI assistants.</string>

<!-- Location -->
<key>NSLocationWhenInUseUsageDescription</key>
<string>AirMCP needs location for weather and location-based tools.</string>

<!-- Bluetooth -->
<key>NSBluetoothAlwaysUsageDescription</key>
<string>AirMCP needs Bluetooth to scan and connect to nearby devices.</string>

<!-- Camera -->
<key>NSCameraUsageDescription</key>
<string>AirMCP needs camera access for document scanning.</string>

<!-- HealthKit -->
<key>NSHealthShareUsageDescription</key>
<string>AirMCP needs health data to provide health summaries via AI assistants.</string>

<!-- Local Network -->
<key>NSLocalNetworkUsageDescription</key>
<string>AirMCP runs a local MCP server for AI assistant connections.</string>
```

### 10.2 HITL on iOS

macOS의 소켓 기반 HITL 대신 iOS 네이티브 메커니즘:

|           | macOS              | iOS                                       |
| --------- | ------------------ | ----------------------------------------- |
| 읽기 전용 | 통과               | 통과                                      |
| 쓰기      | HITL 설정에 따라   | App Intent `parameterSummary`로 요약 표시 |
| 파괴적    | 소켓으로 승인 요청 | `requestConfirmation()` 시스템 다이얼로그 |
| 타임아웃  | 30초 → 거부        | 시스템 관리                               |

### 10.3 localhost 전용 보안

```swift
// HTTP 서버: 127.0.0.1에서만 바인딩 (외부 접근 차단)
let server = MCPHTTPServer(host: "127.0.0.1", port: 3847)

// 세션 토큰: 앱 시작 시 랜덤 생성, 클라이언트에 전달
// 모든 요청에 Authorization: Bearer <token> 필요
```

---

## 11. UI Design

### 11.1 메인 대시보드

```
┌──────────────────────────────┐
│  AirMCP              ⚙️      │
│                              │
│  ┌──── MCP Server ─────────┐ │
│  │  ● Running on :3847     │ │
│  │  Sessions: 1  Calls: 47 │ │
│  │  [Stop Server]          │ │
│  └──────────────────────────┘ │
│                              │
│  ── Active Modules ────────  │
│                              │
│  📅 Calendar        ✅ 10    │
│  ☑️ Reminders       ✅ 11    │
│  👤 Contacts        ✅ 10    │
│  🖼 Photos          ✅ 10    │
│  🌤 Weather         ✅  6    │
│  📍 Location        ✅  4    │
│  🧠 Intelligence    ⚠️ 18.1+ │
│  ❤️ Health          ✅  8    │
│                              │
│  ── Recent Activity ───────  │
│                              │
│  14:32 today_events     ✓   │
│  14:33 create_reminder  ✓   │
│  14:35 health_summary   ✓   │
│                              │
│     [📋 Copy MCP Config]    │
└──────────────────────────────┘
```

### 11.2 온보딩 (4 Steps)

```
1. 환영 → 2. 모듈 선택 → 3. 권한 부여 (모듈별) → 4. Claude Code 연결 가이드
```

Step 4에서 MCP 클라이언트 설정 JSON을 클립보드에 복사:

```json
{
  "mcpServers": {
    "airmcp-ios": {
      "url": "http://localhost:3847/mcp",
      "transport": "streamable-http"
    }
  }
}
```

---

## 12. macOS Migration Path

### Phase별 마이그레이션

```
Phase 1 (iOS 출시):
  macOS: 변경 없음 (Node.js + Swift Bridge CLI 유지)
  iOS:   AirMCPKit → 네이티브 프레임워크 직접 호출

Phase 2 (코드 공유):
  macOS Swift Bridge에서 EventKit/PhotoKit 등의 코드를
  AirMCPKit로 이동. Bridge는 AirMCPKit을 라이브러리로 import.
  → swift/Sources/AirMcpBridge/main.swift가 얇아짐

Phase 3 (macOS 앱도 전환):
  app/Sources/AirMCPApp/AppIntents.swift에서
  runAirMCPTool() (subprocess 방식) 대신 AirMCPKit 직접 호출
```

### 코드 이동 매핑

| 현재 (swift/.../main.swift)               | → AirMCPKit                                  |
| ----------------------------------------- | -------------------------------------------- |
| EventKit 섹션 (create-recurring-event 등) | CalendarModule/CalendarService.swift         |
| Photos 섹션 (import-photo, delete-photos) | PhotosModule/PhotosService.swift             |
| CoreLocation 섹션                         | LocationModule/LocationService.swift         |
| CoreBluetooth 섹션                        | BluetoothModule/BluetoothService.swift       |
| FoundationModels 섹션                     | IntelligenceModule/IntelligenceService.swift |
| NLEmbedding 섹션                          | SemanticModule/EmbeddingService.swift        |
| Vision 섹션                               | VisionModule/DocumentScanner.swift           |

---

## 13. Phase Plan

### Phase 1: Foundation (8–10주)

**목표**: AirMCPKit + iOS 앱 MVP (6 모듈, 51개 도구)

| 주차 | 작업                                                                     |
| ---- | ------------------------------------------------------------------------ |
| 1–2  | AirMCPKit 기반 (프로토콜, ToolResult) + CalendarModule + RemindersModule |
| 3–4  | ContactsModule + PhotosModule + LocationModule + WeatherModule           |
| 5–6  | AirMCPServer (MCPCore + Hummingbird HTTP) + 도구 연결                    |
| 7–8  | iOS 앱 UI (온보딩, 대시보드, 서버 매니저, Live Activity)                 |
| 9–10 | App Intents 전체 구현 + E2E 테스트 + TestFlight                          |

**Deliverable**: TestFlight 빌드

### Phase 2: Intelligence + Search (4–6주)

- IntelligenceModule (FoundationModels, iOS 18.1+)
- SemanticModule (NLEmbedding + VectorStore in Swift)
- VisionModule (문서 스캔/OCR)
- BluetoothModule
- Widget (Daily Briefing)
- macOS Swift Bridge → AirMCPKit 마이그레이션 시작

**Deliverable**: ~75개 도구, on-device AI, 시맨틱 검색

### Phase 3: iOS-Only + App Store (4–6주)

- HealthModule (HealthKit) ← iOS 최대 차별화
- FocusModule (ManagedSettings)
- Cross-module 워크플로우
- App Store 제출
- iOS 26.1 MCP↔App Intents 브릿지 대응 (**RFC 0007** 구현, §15.1)
- **Interactive Snippets 렌더러** (outputSchema → SwiftUI 뷰, §15.5)
- **FoundationModels 호스트 모드** (오프라인 에이전트 루프, §15.3)

**Deliverable**: App Store 출시, ~92개 도구, **시스템 MCP 등록 + 오프라인 에이전트**

> Phase 3 범위는 2026-04 리서치 이후 확대되었다. §15 참조. 각 축은 순차적(A→B→C→…)으로 별 PR로 진행한다 — 한 PR에 여러 축을 묶지 않는다.

---

## 14. Decision Log

| 결정                            | 선택                                                                                                           | 대안                                           | 이유                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| HTTP 서버                       | Hummingbird 2.x                                                                                                | Vapor, Swifter, GCDWebServer                   | async/await 네이티브, 경량, iOS 정식 지원                          |
| MCP 구현                        | 자체 경량 구현                                                                                                 | swift-sdk (Tier 3)                             | swift-sdk가 아직 실험적, JSON-RPC가 단순                           |
| 벡터 스토어                     | Swift 재구현 (JSON)                                                                                            | SQLite/GRDB                                    | 외부 의존성 최소화, 기존 포맷 호환                                 |
| UI                              | SwiftUI only                                                                                                   | UIKit 혼합                                     | iOS 17+ 타겟이면 SwiftUI 충분                                      |
| 배포                            | App Store                                                                                                      | Ad Hoc / TestFlight only                       | 일반 사용자 접근, 자동 업데이트                                    |
| 최소 iOS                        | 17.0                                                                                                           | 16.0 / 18.0                                    | App Intents v2 필요, 18.1이면 Intelligence                         |
| 공유 패키지                     | SPM (AirMCPKit)                                                                                                | CocoaPods, 별도 repo                           | 모노레포 유지, 빌드 단순화                                         |
| 모노레포                        | 기존 airmcp/ 내                                                                                                | 별도 repo                                      | 코드 공유 용이, 버전 동기화                                        |
| **outputSchema 소스** (2026-04) | zod SSOT + `z.infer`로 TS 타입 도출 + 타입드 `*_EXAMPLE` fixture (hand-maintained mirror of Swift `Encodable`) | Swift side에 JSON Schema 문서 유지             | 한 곳만 수정; drift가 tsc + contract test로 잡힘 (PR #97, #98)     |
| **App Intent 전략** (2026-04)   | **자동 브릿지**: MCP 툴 메타데이터 → `AppIntent` 프로토콜 어댑터 (RFC 0007 예정)                               | 툴마다 수동 App Intent 복제                    | 270+ 툴을 수동 포팅 불가; 메타데이터 하나로 양쪽 채널 유지         |
| **자체 LLM 호스트** (2026-04)   | **FoundationModels (iOS 26+)** 로 오프라인 에이전트 — 옵션, 기본은 외부 Claude/ChatGPT                         | 항상 외부 클라이언트 필요 / 자체 MLX 모델 번들 | 무료, HealthKit privacy compliant, 3B 파라미터로 tool-calling 적격 |

---

## 15. 2026-Q2 Ecosystem Update (2026-04-23)

이 섹션은 2026-01–04월에 AirMCP iOS 포지션을 의미 있게 바꾼 외부 이벤트 5개와, 각각에 대한 AirMCP의 응수를 정리한다. 원본 링크는 아래 각 항목 아래 달았다.

### 15.1 Apple이 iOS 26.1 beta부터 MCP를 App Intents 기반으로 시스템에 내장 중

[9to5Mac 2025-09-22](https://9to5mac.com/2025/09/22/macos-tahoe-26-1-beta-1-mcp-integration/) · [AppleInsider 2025-09-22](https://appleinsider.com/articles/25/09/22/ios-26-could-get-a-major-ai-boost-with-the-model-context-protocol) — iOS 26.1·iPadOS 26.1·macOS Tahoe 26.1 개발자 베타에 MCP 통합 코드가 있으며, 베이스는 **App Intents 프레임워크 위에** 구축되었다. 현재 사용자에게는 보이지 않지만 2026년 초 Siri LLM 업그레이드와 함께 GA 전망.

**AirMCP 응수** → **RFC 0007 (다음 작업)**: MCP 툴 메타데이터를 `AppIntent` 프로토콜로 자동 매핑하는 어댑터를 `AirMCPKit`에 추가. iOS 26.1 시스템 MCP가 GA되는 날 AirMCP는 이미 "Shortcuts → Siri → 시스템 MCP" 세 경로 모두에 등장한다. 기존 4개 App Intent 샘플(`app/Sources/AirMCPApp/AppIntents.swift`)은 어댑터 검증용으로 유지.

### 15.2 MCP Apps spec (2026-01-26) — UI 반환 표준

[MCP Blog 2026-01-26](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) — 툴이 `ui://` 스킴으로 **샌드박스 iframe** HTML/JS를 반환, `postMessage`로 호스트와 양방향 통신. 지원 클라이언트: Claude · ChatGPT · Goose · VS Code · JetBrains · AWS Kiro · Google Antigravity.

**AirMCP 응수** → **이미 가동 중**. [`package.json`](../package.json)에서 `@modelcontextprotocol/ext-apps@1.5.0` 의존, `src/apps/`에 MCP App 툴 모듈이 이미 등록되어 있다. iOS 쪽으로는 **Interactive Snippets 렌더러**가 자연스러운 후속 축이다 (§15.5).

### 15.3 FoundationModels 프레임워크 (iOS 26)

[Apple Developer](https://developer.apple.com/documentation/FoundationModels) · [Apple Newsroom 2025-09](https://www.apple.com/newsroom/2025/09/apples-foundation-models-framework-unlocks-new-intelligent-app-experiences/) — ~3B 파라미터 온디바이스 LLM, Swift API, **tool calling · guided generation · structured output 내장**. API 키/인터넷 불필요. Apple Silicon 필요.

**AirMCP 응수** → **Phase 3 축**: AirMCP iOS 앱이 자체적으로 FoundationModels를 호스트, AirMCP 툴을 Foundation Models의 `Tool` 프로토콜로 노출 → **완전 오프라인 에이전트 루프**. 외부 클라이언트 없이도 "내 캘린더 정리해서 오늘 일정 요약해줘"가 작동. HealthKit 법적 제약(§HealthKit Legal Constraints)과도 최적 궁합 — 건강 데이터를 외부 LLM에 보내지 않고 온디바이스에서만 처리.

### 15.4 iOS 26 Shortcuts — 25+ 새 액션 + "Use Model"

[Apple Support 125148](https://support.apple.com/en-us/125148) · [9to5Mac](https://9to5mac.com/2025/12/09/ios-26s-shortcuts-app-adds-25-new-actions-heres-everything-new/) — 핵심은 **"Use Model"** 액션 (Apple Intelligence 또는 ChatGPT를 호출해 결과를 다음 스텝으로 전달) · Visual Intelligence · Image Playground · 확장된 Writing Tools. macOS에서도 전체 personal automation 지원.

**AirMCP 응수** → 두 가지 변화:

1. **대칭적 차별화**: AirMCP의 Skills DSL은 이제 "Shortcuts + Apple Intelligence"와 직접 겹친다. 차별화 축: ① 플랫폼 독립 (Claude Desktop / ChatGPT / VS Code 전부 지원) ② audit 로그 · HITL · rate limit · emergency stop 같은 **운영 안전망** ③ `count-stats` 같은 개발자 도구.
2. **역방향 통합**: RFC 0007 App Intent 브릿지로 AirMCP 툴이 Shortcuts 앱에서 직접 호출 가능. "Use Model → AirMCP" 체인 또는 "AirMCP_list_notes → Use Model → AirMCP_create_reminder" 체인이 가능. **Skills DSL 유저가 Shortcuts 앱에서도 동일 도구 호출** 이 되면 "AirMCP 는 Shortcuts의 슈퍼셋" 포지션 확보.

### 15.5 App Intents Interactive Snippets (iOS 26)

[Superwall 블로그](https://superwall.com/blog/app-intents-interactive-snippets-in-ios-26/) · [WWDC25 Session 275](https://developer.apple.com/videos/play/wwdc2025/275/) — Intent 결과를 **커스텀 SwiftUI 뷰**로 반환, 체이닝 유지 + 재사용 가능. Spotlight/Siri/Shortcuts 안에서 상호작용 가능한 카드로 렌더링.

**AirMCP 응수** → **Phase 2 축**: 툴의 `outputSchema` (zod shape) + `structuredContent` 페이로드를 Interactive Snippet SwiftUI 뷰로 자동 생성. 예: `list_events`의 구조적 출력이 iOS에서 **탭 가능한 이벤트 카드 리스트**로, `memory_query`는 타임라인 뷰로, `timeline_today`는 6am-10pm 수직 축으로. MCP Apps iframe 경로와 **병행** 유지 — Claude Desktop 같은 데스크톱 호스트는 iframe, iOS 호스트는 네이티브 뷰.

### 15.6 Liquid Glass (iOS 26, iOS 27 mandatory 전망)

[Apple Design Gallery 2026](https://developer.apple.com/design/new-design-gallery-2026/) · [AppleInsider 2026-03-26](https://appleinsider.com/articles/26/03/26/stop-holding-out-hope-liquid-glass-will-be-mandatory-in-ios-27) — 위젯/앱 아이콘/Dock 전체 Liquid Glass 레이어. WWDC 2026(6월)에서 추가 커스터마이즈 API 예상.

**AirMCP 응수** → **별도 트랙(디자인 작업)**: `app/widget/` 위젯과 iOS App UI를 Liquid Glass 재작업. RFC 없이 디자인/구현 PR로 처리. WWDC 2026 이후 추가 API가 나오면 그때 한 번 더.

### 15.7 (Bonus) MCP 2026 Roadmap은 모바일을 **언급하지 않음**

[MCP 2026 Roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) — 전송 계층 확장성, 에이전트 통신(Tasks), 거버넌스, 엔터프라이즈가 핵심. 모바일은 커뮤니티 관심 영역으로만 언급. **즉 이 공백을 AirMCP가 레퍼런스 구현으로 채울 기회**.

---

## Appendix: Claude Code Mobile 연결 설정

**HTTP (Track A — 즉시)**:

```json
{
  "mcpServers": {
    "airmcp-ios": {
      "url": "http://localhost:3847/mcp",
      "transport": "streamable-http"
    }
  }
}
```

**App Intents (Track B — iOS 26.1+)**:

```json
{
  "mcpServers": {
    "airmcp-ios": {
      "type": "app-intents",
      "bundleId": "com.airmcp.ios"
    }
  }
}
```

---

## HealthKit Legal Constraints

Apple App Store Guideline 5.1.2 requires:

- HealthKit data must NOT be sent to cloud LLMs or external services
- Only aggregated/summarized data may be returned via MCP tools
- On-device processing (FoundationModels) is required for health data analysis
- Raw health records (timestamps, individual samples) must never appear in MCP responses

### Safe Pattern

`health_summary` → returns { steps_today: 8234, heart_rate_avg: 72, sleep_hours: 7.5 }

### Unsafe Pattern (REJECTED)

`get_raw_health_data` → returns [{ timestamp, heartRate, bloodOxygen, location, ... }]

For macOS npm distribution: comment + opt-in + disclaimer is sufficient (no App Store review).
For iOS App Store: architectural enforcement is mandatory.
