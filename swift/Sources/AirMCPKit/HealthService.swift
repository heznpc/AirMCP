// AirMCPKit — HealthKit service shared between macOS and iOS.
// Returns ONLY aggregated/summarized health data. Never raw samples or timestamps.
// All data stays on-device; no individual health records are exposed.

#if canImport(HealthKit)
import HealthKit
import Foundation

// MARK: - Output Types

public struct HealthSummary: Encodable, Sendable {
    public let stepsToday: Int
    public let heartRateAvg7d: Double?
    public let sleepHoursLastNight: Double
    public let activeEnergyToday: Double // kcal
    public let exerciseMinutesToday: Double
    public init(stepsToday: Int, heartRateAvg7d: Double?, sleepHoursLastNight: Double,
                activeEnergyToday: Double, exerciseMinutesToday: Double) {
        self.stepsToday = stepsToday; self.heartRateAvg7d = heartRateAvg7d
        self.sleepHoursLastNight = sleepHoursLastNight; self.activeEnergyToday = activeEnergyToday
        self.exerciseMinutesToday = exerciseMinutesToday
    }
}

public struct MedicationInfo: Encodable, Sendable {
    public let name: String
    public let isActive: Bool
}

public struct MedicationAdherence: Encodable, Sendable {
    public let totalScheduled: Int
    public let totalTaken: Int
    public let adherencePercent: Double
    public let periodDays: Int
}

// MARK: - Health Service

public actor HealthService {
    private let store = HKHealthStore()

    private var isAuthorized = false

    public init() {}

    // MARK: - Authorization

    /// Request read-only authorization for the health data types we need.
    public func requestAuthorization() async throws -> Bool {
        if isAuthorized { return true }

        guard HKHealthStore.isHealthDataAvailable() else {
            throw AirMCPKitError.unsupported("HealthKit is not available on this device")
        }

        var readTypes: Set<HKObjectType> = [
            HKQuantityType.quantityType(forIdentifier: .stepCount)!,
            HKQuantityType.quantityType(forIdentifier: .heartRate)!,
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
            HKQuantityType.quantityType(forIdentifier: .appleExerciseTime)!,
            HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)!,
        ]

        // HKMedicationDoseType is announced but not yet in public SDK headers.
        // Uncomment when Apple ships the Medications API:
        // if #available(iOS 26, macOS 26, *) {
        //     readTypes.insert(HKMedicationDoseType.medicationRecord)
        // }

        // Request read-only access (nil for write types)
        try await store.requestAuthorization(toShare: [], read: readTypes)
        isAuthorized = true
        return true
    }

    // MARK: - Aggregated Queries

    /// Aggregated step count for today.
    public func todaySteps() async throws -> Int {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw AirMCPKitError.unsupported("HealthKit is not available on this device")
        }

        let stepsType = HKQuantityType.quantityType(forIdentifier: .stepCount)!
        let cal = Calendar.current
        let start = cal.startOfDay(for: Date())
        let end = cal.date(byAdding: .day, value: 1, to: start)!
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)

        let sum = try await cumulativeStatistics(for: stepsType, predicate: predicate)
        return Int(sum?.doubleValue(for: .count()) ?? 0)
    }

    /// Average resting heart rate over the last 7 days. Returns nil if no data.
    public func recentHeartRate() async throws -> Double? {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw AirMCPKitError.unsupported("HealthKit is not available on this device")
        }

        let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
        let cal = Calendar.current
        let end = Date()
        let start = cal.date(byAdding: .day, value: -7, to: end)!
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)

        let avgQuantity = try await discreteAverageStatistics(for: hrType, predicate: predicate)
        guard let avgQuantity else { return nil }

        let bpmUnit = HKUnit.count().unitDivided(by: .minute())
        return avgQuantity.doubleValue(for: bpmUnit)
    }

    /// Total sleep hours for a given date (the night ending on that date).
    public func sleepHours(for date: Date) async throws -> Double {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw AirMCPKitError.unsupported("HealthKit is not available on this device")
        }

        let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)!
        let cal = Calendar.current
        // Sleep window: previous day 6 PM to the given date end-of-day
        let dayStart = cal.startOfDay(for: date)
        let windowStart = cal.date(byAdding: .hour, value: -6, to: dayStart)!
        let windowEnd = cal.date(byAdding: .day, value: 1, to: dayStart)!
        let predicate = HKQuery.predicateForSamples(withStart: windowStart, end: windowEnd, options: .strictStartDate)

        let samples = try await sampleQuery(for: sleepType, predicate: predicate, limit: HKObjectQueryNoLimit)

        // Sum durations of asleep categories only (exclude inBed)
        var totalSeconds: Double = 0
        for sample in samples {
            guard let categorySample = sample as? HKCategorySample else { continue }
            let value = HKCategoryValueSleepAnalysis(rawValue: categorySample.value)
            // Count all asleep stages: asleepUnspecified, asleepCore, asleepDeep, asleepREM
            let isAsleep: Bool
            if #available(iOS 16.0, macOS 13.0, *) {
                isAsleep = value == .asleepUnspecified
                    || value == .asleepCore
                    || value == .asleepDeep
                    || value == .asleepREM
            } else {
                isAsleep = value == .asleep
            }
            if isAsleep {
                totalSeconds += categorySample.endDate.timeIntervalSince(categorySample.startDate)
            }
        }
        return totalSeconds / 3600.0
    }

    /// Combined health dashboard with aggregated data only.
    public func healthSummary() async throws -> HealthSummary {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw AirMCPKitError.unsupported("HealthKit is not available on this device")
        }

        let cal = Calendar.current
        let todayStart = cal.startOfDay(for: Date())
        let todayEnd = cal.date(byAdding: .day, value: 1, to: todayStart)!

        let stepsType = HKQuantityType.quantityType(forIdentifier: .stepCount)!
        let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
        let exerciseType = HKQuantityType.quantityType(forIdentifier: .appleExerciseTime)!

        // Each async let gets its own predicate copy to satisfy Sendable
        async let stepSum = cumulativeStatistics(
            for: stepsType,
            predicate: HKQuery.predicateForSamples(withStart: todayStart, end: todayEnd, options: .strictStartDate))
        async let energySum = cumulativeStatistics(
            for: energyType,
            predicate: HKQuery.predicateForSamples(withStart: todayStart, end: todayEnd, options: .strictStartDate))
        async let exerciseSum = cumulativeStatistics(
            for: exerciseType,
            predicate: HKQuery.predicateForSamples(withStart: todayStart, end: todayEnd, options: .strictStartDate))
        async let heartRate = recentHeartRate()
        async let sleep = sleepHours(for: Date())

        let steps = Int(try await stepSum?.doubleValue(for: .count()) ?? 0)
        let activeEnergy = try await energySum?.doubleValue(for: .kilocalorie()) ?? 0
        let exerciseMinutes = try await exerciseSum?.doubleValue(for: .minute()) ?? 0

        return HealthSummary(
            stepsToday: steps,
            heartRateAvg7d: try await heartRate,
            sleepHoursLastNight: try await sleep,
            activeEnergyToday: activeEnergy,
            exerciseMinutesToday: exerciseMinutes
        )
    }

    // MARK: - Medication Queries
    // HKMedicationDoseType is announced at WWDC 2025 but not yet in public SDK headers.
    // The implementation below compiles only when the API becomes available.
    // Until then, both methods throw .unsupported at runtime.

    /// List current medications (names only, no dosage details for privacy).
    public func currentMedications() async throws -> [MedicationInfo] {
        // TODO: Uncomment when HKMedicationDoseType ships in a public SDK.
        throw AirMCPKitError.unsupported("Medication data requires a future HealthKit SDK with HKMedicationDoseType")
    }

    /// Medication adherence percentage over the specified number of days.
    public func medicationAdherence(days: Int = 7) async throws -> MedicationAdherence {
        // TODO: Uncomment when HKMedicationDoseType ships in a public SDK.
        throw AirMCPKitError.unsupported("Medication data requires a future HealthKit SDK with HKMedicationDoseType")
    }

    // MARK: - Query Helpers

    /// Execute a cumulative HKStatisticsQuery and return the sum quantity.
    nonisolated private func cumulativeStatistics(
        for quantityType: HKQuantityType,
        predicate: NSPredicate
    ) async throws -> HKQuantity? {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(
                quantityType: quantityType,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, statistics, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: statistics?.sumQuantity())
                }
            }
            store.execute(query)
        }
    }

    /// Execute a discrete-average HKStatisticsQuery and return the average quantity.
    nonisolated private func discreteAverageStatistics(
        for quantityType: HKQuantityType,
        predicate: NSPredicate
    ) async throws -> HKQuantity? {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(
                quantityType: quantityType,
                quantitySamplePredicate: predicate,
                options: .discreteAverage
            ) { _, statistics, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: statistics?.averageQuantity())
                }
            }
            store.execute(query)
        }
    }

    /// Execute an HKSampleQuery and return matching samples.
    nonisolated private func sampleQuery(
        for sampleType: HKSampleType,
        predicate: NSPredicate,
        limit: Int
    ) async throws -> [HKSample] {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: sampleType,
                predicate: predicate,
                limit: limit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: samples ?? [])
                }
            }
            store.execute(query)
        }
    }
}
#endif
