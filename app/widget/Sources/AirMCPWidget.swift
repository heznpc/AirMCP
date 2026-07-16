import SwiftUI
import WidgetKit

@main
struct AirMCPWidgetBundle: WidgetBundle {
    var body: some Widget {
        BriefingWidget()
        TrustStatusWidget()
    }
}

struct BriefingWidget: Widget {
    let kind = "com.heznpc.AirMCP.BriefingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BriefingProvider()) { entry in
            BriefingWidgetEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Daily Briefing")
        .description("Today's calendar events, reminders, and tomorrow's preview at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
