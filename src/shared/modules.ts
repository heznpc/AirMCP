import type { ModuleRegistration } from "./registry.js";
import { registerNoteTools } from "../notes/tools.js";
import { registerNotePrompts } from "../notes/prompts.js";
import { registerReminderTools } from "../reminders/tools.js";
import { registerReminderPrompts } from "../reminders/prompts.js";
import { registerCalendarTools } from "../calendar/tools.js";
import { registerCalendarPrompts } from "../calendar/prompts.js";
import { registerContactTools } from "../contacts/tools.js";
import { registerMailTools } from "../mail/tools.js";
import { registerMusicTools } from "../music/tools.js";
import { registerFinderTools } from "../finder/tools.js";
import { registerSafariTools } from "../safari/tools.js";
import { registerSystemTools } from "../system/tools.js";
import { registerPhotosTools } from "../photos/tools.js";
import { registerShortcutsTools } from "../shortcuts/tools.js";
import { registerShortcutPrompts } from "../shortcuts/prompts.js";
import { registerMessagesTools } from "../messages/tools.js";
import { registerIntelligenceTools } from "../intelligence/tools.js";
import { registerTvTools } from "../tv/tools.js";
import { registerUiTools } from "../ui/tools.js";
import { registerScreenTools } from "../screen/tools.js";
import { registerMapsTools } from "../maps/tools.js";
import { registerPodcastsTools } from "../podcasts/tools.js";
import { registerWeatherTools } from "../weather/tools.js";
import { registerPagesTools } from "../pages/tools.js";
import { registerNumbersTools } from "../numbers/tools.js";
import { registerKeynoteTools } from "../keynote/tools.js";

export const MODULE_REGISTRY: ModuleRegistration[] = [
  { name: "notes", tools: registerNoteTools, prompts: registerNotePrompts },
  { name: "reminders", tools: registerReminderTools, prompts: registerReminderPrompts },
  { name: "calendar", tools: registerCalendarTools, prompts: registerCalendarPrompts },
  { name: "contacts", tools: registerContactTools },
  { name: "mail", tools: registerMailTools },
  { name: "music", tools: registerMusicTools },
  { name: "finder", tools: registerFinderTools },
  { name: "safari", tools: registerSafariTools },
  { name: "system", tools: registerSystemTools },
  { name: "photos", tools: registerPhotosTools },
  { name: "shortcuts", tools: registerShortcutsTools, prompts: registerShortcutPrompts },
  { name: "messages", tools: registerMessagesTools },
  { name: "intelligence", tools: registerIntelligenceTools, minMacosVersion: 26 },
  { name: "tv", tools: registerTvTools },
  { name: "ui", tools: registerUiTools },
  { name: "screen", tools: registerScreenTools },
  { name: "maps", tools: registerMapsTools },
  { name: "podcasts", tools: registerPodcastsTools },
  { name: "weather", tools: registerWeatherTools },
  { name: "pages", tools: registerPagesTools },
  { name: "numbers", tools: registerNumbersTools },
  { name: "keynote", tools: registerKeynoteTools },
];
