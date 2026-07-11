import SwiftUI

struct TrustCenterView: View {
    private enum Page: String, CaseIterable, Identifiable {
        case activity
        case safeguards
        case permissions

        var id: String { rawValue }
    }

    let serverManager: ServerManager
    let permissionManager: PermissionManager
    let configManager: ConfigManager
    let hitlManager: HitlManager

    @State private var store = TrustCenterStore()
    @State private var page: Page = .activity
    @State private var exposedToolCount: Int?
    @State private var emergencyStopActive = false
    @State private var emergencyStopError: String?
    @State private var confirmEmergencyStopClear = false
    @State private var auditRefreshInFlight = false
    @State private var runtimeStateRefreshInFlight = false

    private static let emergencyStopURL: URL = {
        if let override = ProcessInfo.processInfo.environment["AIRMCP_EMERGENCY_STOP_PATH"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".config/airmcp/emergency-stop")
    }()

    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(min: 290, ideal: 330, max: 420)
        } detail: {
            detail
        }
        .frame(minWidth: 760, minHeight: 600)
        .task { await refresh(userInitiatedAuditRead: false) }
        .toolbar {
            ToolbarItemGroup {
                if page == .activity {
                    Button {
                        store.exportRedactedReport(runs: persistedVisibleRuns)
                    } label: {
                        Label(L("trust.export"), systemImage: "square.and.arrow.up")
                    }
                    .disabled(persistedVisibleRuns.isEmpty || store.isLoading)
                }
                Button {
                    // Audit history is an Activity-only action. Refreshing
                    // Safeguards or Permissions must never create an audit_log
                    // approval that is hidden on another page.
                    let auditHistoryRequested = page == .activity
                    Task { await refresh(userInitiatedAuditRead: auditHistoryRequested) }
                } label: {
                    Label(L("trust.refresh"), systemImage: "arrow.clockwise")
                }
                .disabled(store.isLoading || auditRefreshInFlight || runtimeStateRefreshInFlight)
            }
        }
        .confirmationDialog(
            L("trust.emergencyClearTitle"),
            isPresented: $confirmEmergencyStopClear,
            titleVisibility: .visible
        ) {
            Button(L("trust.emergencyClear"), role: .destructive) {
                clearEmergencyStop()
            }
            Button(L("trust.cancel"), role: .cancel) {}
        } message: {
            Text(L("trust.emergencyClearMessage"))
        }
        .alert(
            L("trust.exportFailed"),
            isPresented: Binding(
                get: { store.exportError != nil },
                set: { if !$0 { store.exportError = nil } }
            )
        ) {
            Button(L("trust.ok")) { store.exportError = nil }
        } message: {
            Text(store.exportError ?? "")
        }
        .alert(
            L("trust.exportComplete"),
            isPresented: Binding(
                get: { store.lastExportedFilename != nil },
                set: { if !$0 { store.lastExportedFilename = nil } }
            )
        ) {
            Button(L("trust.ok")) { store.lastExportedFilename = nil }
        } message: {
            Text(L("trust.exportCompleteMessage", store.lastExportedFilename ?? ""))
        }
    }

    private var mergedRuns: [GovernedRun] {
        store.mergedRuns(
            pendingRequests: hitlManager.pendingRequests,
            recentRequests: hitlManager.recentRequests
        )
    }

    private var visibleRuns: [GovernedRun] {
        store.visibleRunsPreservingPending(from: mergedRuns)
    }

    /// Export never receives pending/recent in-memory state. Those rows are
    /// useful for interaction, but they are outside the HMAC snapshot verdict.
    private var persistedVisibleRuns: [GovernedRun] {
        store.filteredRuns(from: store.persistedRuns)
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            Picker(L("trust.section"), selection: $page) {
                Label(L("trust.activity"), systemImage: "clock.arrow.circlepath")
                    .tag(Page.activity)
                Label(L("trust.safeguardsSection"), systemImage: "lock.shield")
                    .tag(Page.safeguards)
                Label(L("trust.permissionsSection"), systemImage: "hand.raised")
                    .tag(Page.permissions)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(12)

            Divider()

            switch page {
            case .activity:
                activitySidebar
            case .safeguards:
                safeguardsSidebar
            case .permissions:
                permissionsSidebar
            }
        }
    }

    private var activitySidebar: some View {
        VStack(spacing: 0) {
            integrityBanner
                .padding(10)

            HStack(spacing: 8) {
                Picker(L("trust.range"), selection: $store.timeRange) {
                    Text(L("trust.rangeDay")).tag(TrustCenterStore.TimeRange.day)
                    Text(L("trust.rangeWeek")).tag(TrustCenterStore.TimeRange.week)
                    Text(L("trust.rangeMonth")).tag(TrustCenterStore.TimeRange.month)
                }
                .labelsHidden()

                Picker(L("trust.statusFilter"), selection: $store.statusFilter) {
                    Text(L("trust.filterAll")).tag(TrustCenterStore.StatusFilter.all)
                    Text(L("trust.filterAttention")).tag(TrustCenterStore.StatusFilter.needsAttention)
                    Text(L("trust.filterFailed")).tag(TrustCenterStore.StatusFilter.failed)
                    Text(L("trust.filterSucceeded")).tag(TrustCenterStore.StatusFilter.succeeded)
                }
                .labelsHidden()
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 8)
            .onChange(of: store.timeRange) {
                store.requireManualAuditRefresh()
            }

            if store.isLoading && visibleRuns.isEmpty {
                Spacer()
                ProgressView(L("trust.loadingActivity"))
                Spacer()
            } else if let loadError = store.loadError, visibleRuns.isEmpty {
                ContentUnavailableView {
                    Label(L("trust.activityUnavailable"), systemImage: "exclamationmark.triangle")
                } description: {
                    Text(loadError)
                } actions: {
                    Button(L("trust.refresh")) {
                        Task { await refresh(userInitiatedAuditRead: true) }
                    }
                    .disabled(auditRefreshInFlight || runtimeStateRefreshInFlight)
                }
            } else if store.response == nil && visibleRuns.isEmpty {
                ContentUnavailableView {
                    Label(L("trust.auditApprovalTitle"), systemImage: "hand.raised.fill")
                } description: {
                    Text(L("trust.auditApprovalMessage"))
                } actions: {
                    Button(L("trust.auditApprovalLoad")) {
                        Task { await refresh(userInitiatedAuditRead: true) }
                    }
                    .disabled(auditRefreshInFlight || runtimeStateRefreshInFlight)
                }
            } else if visibleRuns.isEmpty {
                ContentUnavailableView(
                    L("trust.noRuns"),
                    systemImage: "checkmark.shield",
                    description: Text(L("trust.noRunsMessage"))
                )
            } else {
                List(selection: $store.selectedRunID) {
                    ForEach(store.sections(for: visibleRuns)) { section in
                        Section(section.day.formatted(date: .abbreviated, time: .omitted)) {
                            ForEach(section.runs) { run in
                                runRow(run)
                                    .tag(run.id)
                            }
                        }
                    }
                }
                .searchable(text: $store.searchText, prompt: L("trust.searchRuns"))
            }

            if let response = store.response, response.returned < response.total {
                Text(L("trust.historyTruncated", response.returned, response.total))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(8)
            }
        }
    }

    private var safeguardsSidebar: some View {
        List {
            statusRow(
                L("trust.runtime"),
                value: serverManager.statusLabel,
                icon: serverManager.statusIcon,
                color: runtimeColor
            )
            statusRow(
                L("trust.auditIntegrity"),
                value: integrityLabel,
                icon: integrityIcon,
                color: integrityColor
            )
            statusRow(
                L("trust.pendingApprovals"),
                value: String(hitlManager.pendingRequests.count),
                icon: "person.crop.circle.badge.checkmark",
                color: hitlManager.pendingRequests.isEmpty ? .green : .orange
            )
            statusRow(
                L("trust.emergencyStop"),
                value: emergencyStopActive ? L("trust.engaged") : L("trust.ready"),
                icon: emergencyStopActive ? "stop.circle.fill" : "checkmark.circle.fill",
                color: emergencyStopActive ? .red : .green
            )
        }
        .listStyle(.sidebar)
    }

    private var permissionsSidebar: some View {
        List {
            if permissionManager.apps.isEmpty {
                Text(L("trust.permissionsNotChecked"))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(permissionManager.apps) { app in
                    let presentation = permissionPresentation(app.status)
                    statusRow(
                        app.name,
                        value: presentation.label,
                        icon: presentation.icon,
                        color: presentation.color
                    )
                }
            }
        }
        .listStyle(.sidebar)
    }

    @ViewBuilder
    private var detail: some View {
        switch page {
        case .activity:
            if let run = store.selectedRun(in: visibleRuns) {
                runDetail(run)
            } else {
                ContentUnavailableView(
                    L("trust.selectRun"),
                    systemImage: "clock.arrow.circlepath",
                    description: Text(L("trust.selectRunMessage"))
                )
            }
        case .safeguards:
            safeguardsDetail
        case .permissions:
            permissionsDetail
        }
    }

    private func runRow(_ run: GovernedRun) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: runStatusPresentation(run.status).icon)
                .foregroundStyle(runStatusPresentation(run.status).color)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 3) {
                Text(run.title)
                    .font(.body.weight(.medium))
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Text(run.startedAt, style: .time)
                    Text("•")
                    Text(runStatusPresentation(run.status).label)
                    if run.toolCount > 1 {
                        Text("•")
                        Text(L("trust.actionCount", run.toolCount))
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 3)
    }

    private func runDetail(_ run: GovernedRun) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Label(run.title, systemImage: runStatusPresentation(run.status).icon)
                            .font(.title2.weight(.semibold))
                            .foregroundStyle(runStatusPresentation(run.status).color)
                        Text(run.startedAt.formatted(date: .abbreviated, time: .standard))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(runStatusPresentation(run.status).label)
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(runStatusPresentation(run.status).color.opacity(0.12), in: Capsule())
                }

                ForEach(run.pendingApprovals) { pending in
                    pendingApprovalCard(pending)
                }

                GroupBox {
                    VStack(alignment: .leading, spacing: 8) {
                        detailRow(L("trust.approval"), approvalLabel(run.approvalStatus))
                        detailRow(L("trust.actor"), actorLabel(run.actorClass))
                        detailRow(L("trust.duration"), durationLabel(run.durationMs))
                        if let correlationId = run.correlationId {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(L("trust.runID"))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(correlationId)
                                    .font(.system(.caption, design: .monospaced))
                                    .textSelection(.enabled)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } label: {
                    Label(L("trust.runEvidence"), systemImage: "checkmark.seal")
                }

                VStack(alignment: .leading, spacing: 10) {
                    Label(L("trust.timeline"), systemImage: "list.bullet.rectangle")
                        .font(.headline)
                    if run.entries.isEmpty {
                        Text(L("trust.awaitingAudit"))
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(run.entries) { entry in
                            timelineRow(entry)
                        }
                    }
                }
            }
            .padding(22)
            .frame(maxWidth: 760, alignment: .leading)
        }
        .navigationTitle(L("trust.activity"))
    }

    private func pendingApprovalCard(_ pending: LivePendingApproval) -> some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                Text(pending.tool)
                    .font(.headline)
                HStack(spacing: 6) {
                    if pending.destructive { safetyBadge(L("trust.destructive"), color: .red) }
                    if pending.sensitive { safetyBadge(L("trust.sensitive"), color: .orange) }
                    if pending.openWorld { safetyBadge(L("trust.network"), color: .blue) }
                }
                if !pending.args.isEmpty {
                    DisclosureGroup(L("trust.localArguments")) {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(pending.args.keys.sorted(), id: \.self) { key in
                                Text("\(key): \(pending.args[key] ?? "")")
                                    .font(.system(.caption, design: .monospaced))
                                    .textSelection(.enabled)
                            }
                        }
                        .padding(.top, 4)
                    }
                }
                HStack {
                    if pending.destructive {
                        Button(L("hitl.approve"), role: .destructive) {
                            respond(to: pending, approved: true)
                        }
                    } else {
                        Button(L("hitl.approve")) {
                            respond(to: pending, approved: true)
                        }
                    }
                    Button(L("hitl.deny"), role: .cancel) {
                        respond(to: pending, approved: false)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } label: {
            Label(L("trust.approvalRequired"), systemImage: "person.crop.circle.badge.questionmark")
                .foregroundStyle(.orange)
        }
    }

    private func timelineRow(_ entry: AuditEntryRecord) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: eventPresentation(entry).icon)
                .foregroundStyle(eventPresentation(entry).color)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(eventTitle(entry))
                        .font(.body.weight(.medium))
                    Spacer()
                    if let date = entry.date {
                        Text(date, style: .time)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                HStack(spacing: 7) {
                    if let gate = entry.gate {
                        Text(gateLabel(gate))
                    }
                    if let category = entry.errorCategory {
                        Text(errorCategoryLabel(category))
                    }
                    if let duration = entry.durationMs {
                        Text(durationLabel(duration))
                    }
                    if entry.approvalChannel != .unknown {
                        Text(approvalChannelLabel(entry.approvalChannel))
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 9))
    }

    private var integrityBanner: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: integrityIcon)
                .foregroundStyle(integrityColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(integrityLabel)
                    .font(.caption.weight(.semibold))
                if let reason = store.integrity.breakReason {
                    Text(reason.replacingOccurrences(of: "_", with: " "))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Text(integrityDetail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(9)
        .background(integrityColor.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
    }

    private var safeguardsDetail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                sectionHeader(L("trust.safeguardsSection"), subtitle: L("trust.safeguardsSubtitle"), icon: "lock.shield")

                GroupBox {
                    VStack(spacing: 10) {
                        statusRow(L("trust.runtime"), value: serverManager.statusLabel, icon: serverManager.statusIcon, color: runtimeColor)
                        statusRow(
                            L("trust.exposedTools"),
                            value: exposedToolCount.map(String.init) ?? L("trust.unavailable"),
                            icon: "wrench.and.screwdriver",
                            color: exposedToolCount == nil ? .secondary : .green
                        )
                        statusRow(
                            L("trust.pendingApprovals"),
                            value: String(hitlManager.pendingRequests.count),
                            icon: "person.crop.circle.badge.checkmark",
                            color: hitlManager.pendingRequests.isEmpty ? .green : .orange
                        )
                    }
                } label: {
                    Label(L("trust.runtimeSection"), systemImage: "server.rack")
                }

                GroupBox {
                    VStack(alignment: .leading, spacing: 10) {
                        statusRow(L("trust.auditIntegrity"), value: integrityLabel, icon: integrityIcon, color: integrityColor)
                        if let response = store.response {
                            Text(L("trust.auditEntries", response.returned))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if let reason = store.integrity.breakReason {
                            Label(reason.replacingOccurrences(of: "_", with: " "), systemImage: "exclamationmark.triangle")
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }
                } label: {
                    Label(L("trust.auditIntegrity"), systemImage: "checkmark.shield")
                }

                GroupBox {
                    VStack(alignment: .leading, spacing: 10) {
                        statusRow(
                            L("trust.emergencyStop"),
                            value: emergencyStopActive ? L("trust.engaged") : L("trust.ready"),
                            icon: emergencyStopActive ? "stop.circle.fill" : "checkmark.circle.fill",
                            color: emergencyStopActive ? .red : .green
                        )
                        if emergencyStopActive {
                            Button(L("trust.emergencyClear")) {
                                confirmEmergencyStopClear = true
                            }
                        } else {
                            Button(L("trust.emergencyEngage"), role: .destructive) {
                                engageEmergencyStop()
                            }
                        }
                        if let emergencyStopError {
                            Text(emergencyStopError)
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }
                } label: {
                    Label(L("trust.emergencyStop"), systemImage: "stop.circle")
                }

                if let error = configManager.lastPersistenceError {
                    GroupBox {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    } label: {
                        Text(L("trust.configurationSection"))
                    }
                }
            }
            .padding(22)
            .frame(maxWidth: 760, alignment: .leading)
        }
    }

    private var permissionsDetail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                sectionHeader(L("trust.permissionsSection"), subtitle: L("trust.permissionsSubtitle"), icon: "hand.raised")
                GroupBox {
                    VStack(alignment: .leading, spacing: 10) {
                        if permissionManager.apps.isEmpty {
                            Text(L("trust.permissionsNotChecked"))
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(permissionManager.apps) { app in
                                let presentation = permissionPresentation(app.status)
                                statusRow(app.name, value: presentation.label, icon: presentation.icon, color: presentation.color)
                            }
                        }
                        Divider()
                        Button(L("trust.checkPermissions")) {
                            permissionManager.runSetup()
                        }
                        .disabled(permissionManager.isRunning)
                    }
                } label: {
                    Label(L("trust.permissionsSection"), systemImage: "checkmark.circle")
                }
            }
            .padding(22)
            .frame(maxWidth: 760, alignment: .leading)
        }
    }

    private func sectionHeader(_ title: String, subtitle: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(title, systemImage: icon)
                .font(.title2.weight(.semibold))
            Text(subtitle)
                .foregroundStyle(.secondary)
        }
    }

    private func safetyBadge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(color.opacity(0.12), in: Capsule())
            .foregroundStyle(color)
    }

    private func detailRow(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
        }
    }

    private func statusRow(_ title: String, value: String, icon: String, color: Color) -> some View {
        HStack {
            Label(title, systemImage: icon)
                .foregroundStyle(color)
            Spacer()
            Text(value)
                .foregroundStyle(.secondary)
        }
    }

    private func respond(to pending: LivePendingApproval, approved: Bool) {
        hitlManager.respond(id: pending.id, approved: approved, tool: pending.tool)
    }

    @MainActor
    private func refresh(userInitiatedAuditRead: Bool) async {
        guard !runtimeStateRefreshInFlight,
              !userInitiatedAuditRead || !auditRefreshInFlight
        else { return }
        runtimeStateRefreshInFlight = true
        if userInitiatedAuditRead { auditRefreshInFlight = true }
        defer {
            runtimeStateRefreshInFlight = false
            if userInitiatedAuditRead { auditRefreshInFlight = false }
        }
        emergencyStopActive = FileManager.default.fileExists(atPath: Self.emergencyStopURL.path)
        exposedToolCount = try? await AppRuntimeClient.listTools().count
        if TrustCenterRefreshPolicy.allowsAuditHistoryRead(
            userInitiated: userInitiatedAuditRead
        ) {
            await store.refresh()
        }
    }

    private func engageEmergencyStop() {
        do {
            try FileManager.default.createDirectory(
                at: Self.emergencyStopURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            guard FileManager.default.createFile(atPath: Self.emergencyStopURL.path, contents: Data()) else {
                throw CocoaError(.fileWriteUnknown)
            }
            emergencyStopActive = true
            emergencyStopError = nil
        } catch {
            emergencyStopError = error.localizedDescription
        }
    }

    private func clearEmergencyStop() {
        do {
            try FileManager.default.removeItem(at: Self.emergencyStopURL)
            emergencyStopActive = false
            emergencyStopError = nil
        } catch {
            emergencyStopError = error.localizedDescription
        }
    }

    private var runtimeColor: Color {
        switch serverManager.status {
        case .running: .green
        case .error: .red
        default: .secondary
        }
    }

    private var integrityLabel: String {
        switch store.integrity.state {
        case .verified: L("trust.verified")
        case .failed: L("trust.failed")
        case .disabled: L("trust.auditDisabled")
        case .unavailable: L("trust.unavailable")
        }
    }

    private var integrityDetail: String {
        switch store.integrity.state {
        case .verified: L("trust.integrityVerifiedDetail")
        case .failed: L("trust.integrityFailedDetail")
        case .disabled: L("trust.integrityDisabledDetail")
        case .unavailable: L("trust.integrityUnavailableDetail")
        }
    }

    private var integrityIcon: String {
        switch store.integrity.state {
        case .verified: "checkmark.shield.fill"
        case .failed, .disabled: "exclamationmark.shield.fill"
        case .unavailable: "questionmark.diamond"
        }
    }

    private var integrityColor: Color {
        switch store.integrity.state {
        case .verified: .green
        case .failed, .disabled: .red
        case .unavailable: .secondary
        }
    }

    private func runStatusPresentation(_ status: GovernedRunStatus) -> (label: String, icon: String, color: Color) {
        switch status {
        case .pending: (L("trust.statusPending"), "person.crop.circle.badge.questionmark", .orange)
        case .running: (L("trust.statusRunning"), "ellipsis.circle", .blue)
        case .succeeded: (L("trust.statusSucceeded"), "checkmark.circle.fill", .green)
        case .failed: (L("trust.statusFailed"), "xmark.circle.fill", .red)
        case .denied: (L("trust.statusDenied"), "hand.raised.fill", .orange)
        case .timedOut: (L("trust.statusTimedOut"), "clock.badge.exclamationmark.fill", .orange)
        case .blocked: (L("trust.statusBlocked"), "lock.fill", .red)
        }
    }

    private func eventPresentation(_ entry: AuditEntryRecord) -> (icon: String, color: Color) {
        if entry.kind == .approval {
            switch entry.approvalDecision {
            case .approved: return ("checkmark.circle", .green)
            case .denied, .timedOut: return ("hand.raised.circle", .orange)
            case .unavailable: return ("wifi.exclamationmark", .red)
            case .unknown: return ("person.crop.circle.badge.questionmark", .secondary)
            }
        }
        if entry.isGateFailure { return ("lock.fill", .red) }
        return entry.status == .ok ? ("checkmark.circle", .green) : ("xmark.circle", .red)
    }

    private func eventTitle(_ entry: AuditEntryRecord) -> String {
        if entry.kind == .approval {
            return L("trust.approvalEvent", approvalLabel(for: entry.approvalDecision), entry.tool)
        }
        if let gate = entry.gate {
            return L("trust.gateEvent", gateLabel(gate), entry.tool)
        }
        return entry.tool
    }

    private func approvalLabel(_ status: ApprovalStatus) -> String {
        switch status {
        case .notRequired: L("trust.approvalNotRequired")
        case .pending: L("trust.pending")
        case .approved: L("trust.approved")
        case .denied: L("trust.denied")
        case .timedOut: L("trust.timedOut")
        case .unavailable: L("trust.unavailable")
        }
    }

    private func approvalLabel(for decision: AuditEntryRecord.ApprovalDecision) -> String {
        switch decision {
        case .approved: L("trust.approved")
        case .denied: L("trust.denied")
        case .timedOut: L("trust.timedOut")
        case .unavailable: L("trust.unavailable")
        case .unknown: L("trust.unknown")
        }
    }

    private func approvalChannelLabel(_ channel: AuditEntryRecord.ApprovalChannel) -> String {
        switch channel {
        case .socket: L("trust.channelApp")
        case .elicitation: L("trust.channelClient")
        case .unavailable: L("trust.channelUnavailable")
        case .unknown: L("trust.unknown")
        }
    }

    private func gateLabel(_ gate: String) -> String {
        switch gate {
        case "oauth_scope": L("trust.gateOAuth")
        case "emergency_stop": L("trust.gateEmergency")
        case "rate_limit": L("trust.gateRateLimit")
        default: gate.replacingOccurrences(of: "_", with: " ")
        }
    }

    private func errorCategoryLabel(_ category: String) -> String {
        category.replacingOccurrences(of: "_", with: " ")
    }

    private func actorLabel(_ actorClass: String) -> String {
        switch actorClass {
        case "daemon": L("trust.actorDaemon")
        case "hitl-approved": L("trust.actorApprovedQueue")
        default: L("trust.actorUser")
        }
    }

    private func durationLabel(_ duration: Int) -> String {
        if duration < 1_000 { return L("trust.durationMs", duration) }
        return L("trust.durationSeconds", Double(duration) / 1_000.0)
    }

    private func permissionPresentation(
        _ status: PermissionManager.PermissionStatus
    ) -> (label: String, icon: String, color: Color) {
        switch status {
        case .pending: (L("trust.pending"), "clock", .secondary)
        case .granted: (L("trust.granted"), "checkmark.circle.fill", .green)
        case .failed: (L("trust.denied"), "xmark.circle.fill", .red)
        }
    }
}
