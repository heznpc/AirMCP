import Combine
import Foundation
import Observation

/// App-owned subscriptions must outlive the menu dropdown and settings windows.
@MainActor
final class HitlRuntimeController {
    struct Configuration: Equatable {
        let level: HitlLevel
        let timeoutSeconds: Int
    }

    private let readConfiguration: () -> Configuration
    private let applyConfiguration: (Configuration) -> Void
    private let respond: (String, Bool) -> Void
    private let notificationCenter: NotificationCenter
    private var notificationSubscription: AnyCancellable?
    private var lastConfiguration: Configuration?
    private var started = false

    init(
        readConfiguration: @escaping () -> Configuration,
        applyConfiguration: @escaping (Configuration) -> Void,
        respond: @escaping (String, Bool) -> Void,
        notificationCenter: NotificationCenter = .default
    ) {
        self.readConfiguration = readConfiguration
        self.applyConfiguration = applyConfiguration
        self.respond = respond
        self.notificationCenter = notificationCenter
    }

    func start() {
        guard !started else { return }
        started = true
        notificationSubscription = notificationCenter.publisher(for: .hitlNotificationResponse)
            .sink { [weak self] notification in
                guard let id = notification.userInfo?["id"] as? String,
                      let approved = notification.userInfo?["approved"] as? Bool
                else { return }
                Task { @MainActor [weak self] in
                    guard let self, self.started else { return }
                    self.respond(id, approved)
                }
            }
        observeConfiguration()
    }

    private func observeConfiguration() {
        let configuration = withObservationTracking {
            readConfiguration()
        } onChange: { [weak self] in
            // Observation fires before the setter finishes. Re-read on the
            // main actor after the update and re-arm for subsequent edits.
            Task { @MainActor [weak self] in
                self?.observeConfiguration()
            }
        }
        guard configuration != lastConfiguration else { return }
        lastConfiguration = configuration
        applyConfiguration(configuration)
    }
}
