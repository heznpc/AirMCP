import { AirMcpConfig, isModuleEnabled } from "../shared/config.js";
import { EmbeddingProvider, detectProvider, embedText, embedBatch } from "./embeddings.js";
import { VectorStore, VectorEntry, SearchResult } from "./store.js";
import { runJxa } from "../shared/jxa.js";
import { listRemindersScript } from "../reminders/scripts.js";

// -- Data collectors per source --

interface CollectedItem {
  id: string;
  source: string;
  title: string;
  text: string;
}

async function collectNotes(): Promise<CollectedItem[]> {
  return runJxa<CollectedItem[]>(`
    const Notes = Application('Notes');
    const names = Notes.notes.name();
    const ids = Notes.notes.id();
    const count = Math.min(names.length, 200);
    const indices = Array.from({length: names.length}, (_, i) => i);
    const modDates = Notes.notes.modificationDate();
    indices.sort((a, b) => modDates[b] - modDates[a]);
    const top = indices.slice(0, count);
    const result = top.map(i => {
      const preview = Notes.notes[i].plaintext().substring(0, 300);
      return {
        id: 'note:' + ids[i],
        source: 'notes',
        title: names[i],
        text: names[i] + ' ' + preview
      };
    });
    JSON.stringify(result);
  `);
}

async function collectCalendarEvents(): Promise<CollectedItem[]> {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 86400000).toISOString(); // past 30 days
  const end = new Date(now.getTime() + 30 * 86400000).toISOString();   // next 30 days
  return runJxa<CollectedItem[]>(`
    const Calendar = Application('Calendar');
    const start = new Date('${start}');
    const end = new Date('${end}');
    const cals = Calendar.calendars();
    const result = [];
    for (const cal of cals) {
      try {
        const events = cal.events.whose({
          _and: [
            { startDate: { _greaterThan: start } },
            { startDate: { _lessThan: end } }
          ]
        })();
        for (const ev of events) {
          try {
            const summary = ev.summary();
            const loc = ev.location() || '';
            const desc = (ev.description() || '').substring(0, 200);
            result.push({
              id: 'event:' + ev.uid(),
              source: 'calendar',
              title: summary,
              text: summary + ' ' + loc + ' ' + desc
            });
          } catch(e) {}
        }
      } catch(e) {}
    }
    JSON.stringify(result.slice(0, 200));
  `);
}

async function collectReminders(): Promise<CollectedItem[]> {
  const { reminders: raw } = await runJxa<{ reminders: Array<{ id: string; name: string; body: string | null }> }>(
    listRemindersScript(200, 0, undefined, false),
  );
  return raw.map((r) => ({
    id: "reminder:" + r.id,
    source: "reminders",
    title: r.name,
    text: r.name + (r.body ? " " + r.body : ""),
  }));
}

async function collectMail(): Promise<CollectedItem[]> {
  return runJxa<CollectedItem[]>(`
    const Mail = Application('Mail');
    const result = [];
    try {
      const inbox = Mail.inbox;
      const msgs = inbox.messages();
      const count = Math.min(msgs.length, 100);
      for (let i = 0; i < count; i++) {
        try {
          const m = msgs[i];
          const subject = m.subject();
          const sender = m.sender();
          const excerpt = (m.content() || '').substring(0, 200);
          result.push({
            id: 'mail:' + m.id(),
            source: 'mail',
            title: subject,
            text: subject + ' ' + sender + ' ' + excerpt
          });
        } catch(e) {}
      }
    } catch(e) {}
    JSON.stringify(result);
  `);
}

async function collectItems(source: string): Promise<VectorEntry[]> {
  const now = new Date().toISOString();
  let items: CollectedItem[];

  switch (source) {
    case "notes":
      items = await collectNotes();
      break;
    case "calendar":
      items = await collectCalendarEvents();
      break;
    case "reminders":
      items = await collectReminders();
      break;
    case "mail":
      items = await collectMail();
      break;
    default:
      return [];
  }

  return items.map((item) => ({
    ...item,
    vector: [], // filled later by batch embed
    updatedAt: now,
  }));
}

/**
 * Encapsulates all semantic search state: embedding provider cache,
 * the vector store, and the in-flight indexing lock.
 */
export class SemanticSearchService {
  private provider: EmbeddingProvider | null = null;
  private indexing: Promise<void> | null = null;
  private store: VectorStore;

  constructor(private config: AirMcpConfig) {
    this.store = new VectorStore();
  }

  /** Resolve the embedding provider, caching the result. */
  async getProvider(): Promise<EmbeddingProvider> {
    if (this.provider === null) {
      this.provider = await detectProvider();
    }
    return this.provider;
  }

  /** Check if any embedding backend is available. */
  async isEmbeddingAvailable(): Promise<boolean> {
    return (await this.getProvider()) !== "none";
  }

  /**
   * Build/rebuild the vector index from Apple app data.
   * Serialises concurrent calls -- if indexing is already running, the
   * second caller awaits the same promise instead of starting a duplicate.
   */
  async index(
    sources?: string[],
    onProgress?: (progress: number, total: number, message: string) => Promise<void>,
  ): Promise<{ indexed: number; errors: string[]; store: Awaited<ReturnType<VectorStore["getStats"]>> }> {
    if (!(await this.isEmbeddingAvailable())) {
      throw new Error("No embedding backend available. Set GEMINI_API_KEY or run 'npm run swift-build'.");
    }

    const enabledFilter = sources
      ? (mod: string) => sources.includes(mod) && this.isModuleEnabled(mod)
      : (mod: string) => this.isModuleEnabled(mod);

    const { indexed, errors } = await this.runIndex(enabledFilter, onProgress);
    const stats = await this.store.getStats();
    return { indexed, errors, store: stats };
  }

  /** Semantic search across indexed data. Auto-indexes if store is stale. */
  async search(
    query: string,
    opts?: { sources?: string[]; limit?: number; threshold?: number },
  ): Promise<{ query: string; results: SearchResult[]; total: number; autoIndexed: boolean }> {
    if (!(await this.isEmbeddingAvailable())) {
      throw new Error("No embedding backend available. Set GEMINI_API_KEY or run 'npm run swift-build'.");
    }

    // Auto-index if store is empty or stale
    await this.ensureIndex();

    const stats = await this.store.getStats();
    if (stats.total === 0) {
      throw new Error("No data to search. Ensure at least one Apple app module is enabled.");
    }

    const provider = await this.getProvider();
    const queryVector = await embedText(query, provider);

    const results = await this.store.search(queryVector, {
      topK: opts?.limit ?? 10,
      threshold: opts?.threshold ?? 0.5,
      sources: opts?.sources,
    });

    return { query, results, total: results.length, autoIndexed: stats.stale };
  }

  /** Find semantically related items given an item ID. */
  async findRelated(
    id: string,
    opts?: { limit?: number; threshold?: number },
  ): Promise<{
    item: { id: string; source: string; title: string };
    related: SearchResult[];
    total: number;
  }> {
    // Auto-index if stale
    await this.ensureIndex();

    const entry = await this.store.getEntry(id);
    if (!entry) {
      throw new Error(`Item not found in index: ${id}. Try running semantic_index.`);
    }

    const limit = opts?.limit ?? 10;
    const results = await this.store.search(entry.vector, {
      topK: limit + 1, // +1 to exclude self
      threshold: opts?.threshold ?? 0.6,
    });

    // Exclude the item itself
    const filtered = results.filter((r) => r.id !== id).slice(0, limit);

    return {
      item: { id: entry.id, source: entry.source, title: entry.title },
      related: filtered,
      total: filtered.length,
    };
  }

  /** Get status of the vector store and embedding provider. */
  async status(): Promise<{
    embeddingAvailable: boolean;
    provider: string;
    total: number;
    bySource: Record<string, number>;
    indexedAt: string | null;
    stale: boolean;
  }> {
    const available = await this.isEmbeddingAvailable();
    const provider = await this.getProvider();
    const stats = await this.store.getStats();
    return { embeddingAvailable: available, provider, ...stats };
  }

  async getStoreData(): Promise<Record<string, VectorEntry>> {
    return this.store.getAllEntries();
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }

  // -- Private helpers --

  private isModuleEnabled(mod: string): boolean {
    return isModuleEnabled(this.config, mod);
  }

  /**
   * Auto-index if store is empty or stale.
   * Serialises concurrent calls so only one indexing run happens at a time.
   */
  private async ensureIndex(): Promise<void> {
    if (!(await this.store.isIndexStale())) return;
    if (!(await this.isEmbeddingAvailable())) return;

    if (!this.indexing) {
      this.indexing = this.runIndex((mod) => this.isModuleEnabled(mod))
        .then(() => { this.indexing = null; })
        .catch(() => { this.indexing = null; });
    }
    await this.indexing;
  }

  private async runIndex(
    enabled: (mod: string) => boolean,
    onProgress?: (progress: number, total: number, message: string) => Promise<void>,
  ): Promise<{ indexed: number; errors: string[] }> {
    const sources = ["notes", "calendar", "reminders", "mail"].filter((m) => enabled(m));
    const entries: VectorEntry[] = [];
    const errors: string[] = [];
    const totalSteps = sources.length + 1; // +1 for embedding step
    let step = 0;

    for (const source of sources) {
      try {
        const items = await collectItems(source);
        entries.push(...items);
        step++;
        if (onProgress) await onProgress(step, totalSteps, `Collected ${source}: ${items.length} items`);
      } catch (e) {
        errors.push(`${source}: ${e instanceof Error ? e.message : String(e)}`);
        step++;
        if (onProgress) await onProgress(step, totalSteps, `Failed to collect ${source}`);
      }
    }

    if (entries.length > 0) {
      const provider = await this.getProvider();
      const texts = entries.map((e) => e.text);
      const vectors = await embedBatch(texts, provider);
      for (let i = 0; i < entries.length; i++) {
        entries[i].vector = vectors[i];
      }
      await this.store.upsertEntries(entries);
      if (onProgress) await onProgress(totalSteps, totalSteps, `Indexed ${entries.length} items`);
    }

    return { indexed: entries.length, errors };
  }
}
