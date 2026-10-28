export type DbsControlLocalCommandStatus = "pending" | "sending" | "conflict" | "error";

export type DbsControlLocalChanges = Record<string, unknown[]>;

export interface DbsControlLocalSyncCommand {
  id: string;
  requestIds: string[];
  changes: DbsControlLocalChanges;
  status: DbsControlLocalCommandStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  nextAttemptAt: number;
  leaseUntil?: number | null;
  lastError?: string | null;
  conflicts?: unknown[];
}

export interface DbsControlLocalSyncSummary {
  pending: number;
  sending: number;
  conflict: number;
  error: number;
  total: number;
}

const DB_NAME = "dbs-control-local-sync";
const DB_VERSION = 1;
const STORE_NAME = "sync_commands";
const MAX_COMMANDS = 200;
const memoryFallback = new Map<string, DbsControlLocalSyncCommand>();

function canUseIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error("IndexedDB indisponível neste ambiente."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("nextAttemptAt", "nextAttemptAt", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Não foi possível abrir a fila local."));
    request.onblocked = () => reject(new Error("A fila local está bloqueada por outra aba."));
  });
}

function idbRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha na fila local."));
  });
}

async function idbRead<T>(operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Falha na leitura da fila local."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Leitura da fila local abortada."));
    });
    const value = await idbRequest(operation(transaction.objectStore(STORE_NAME)));
    await completed;
    return value;
  } finally {
    database.close();
  }
}

async function idbWrite<T>(operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Falha na gravação da fila local."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Gravação da fila local abortada."));
    });
    const value = await idbRequest(operation(transaction.objectStore(STORE_NAME)));
    await completed;
    return value;
  } finally {
    database.close();
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sortCommands(commands: DbsControlLocalSyncCommand[]) {
  return commands.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function fallbackCommands() {
  return sortCommands([...memoryFallback.values()].map((command) => clone(command)));
}

function mergeMemoryFallback(commands: DbsControlLocalSyncCommand[]) {
  const byId = new Map(commands.map((command) => [command.id, command]));
  for (const command of memoryFallback.values()) {
    if (!byId.has(command.id)) byId.set(command.id, clone(command));
  }
  return sortCommands([...byId.values()]);
}

export async function listDbsControlLocalSyncCommands() {
  try {
    const commands = await idbRead<DbsControlLocalSyncCommand[]>((store) => store.getAll());
    return mergeMemoryFallback((commands ?? []).map((command) => clone(command)));
  } catch {
    return fallbackCommands();
  }
}

export async function getDbsControlLocalSyncSummary(): Promise<DbsControlLocalSyncSummary> {
  const commands = await listDbsControlLocalSyncCommands();
  return commands.reduce<DbsControlLocalSyncSummary>(
    (summary, command) => {
      summary[command.status] += 1;
      summary.total += 1;
      return summary;
    },
    { pending: 0, sending: 0, conflict: 0, error: 0, total: 0 },
  );
}

export async function putDbsControlLocalSyncCommand(command: DbsControlLocalSyncCommand) {
  const safeCommand = clone(command);
  try {
    const commands = await listDbsControlLocalSyncCommands();
    const exists = commands.some((item) => item.id === safeCommand.id);
    if (!exists && commands.length >= MAX_COMMANDS) {
      const removable = commands.find(
        (item) => item.status === "error" || item.status === "conflict",
      );
      if (!removable)
        throw new Error(
          "A fila local atingiu o limite seguro; a sincronização precisa ser revisada.",
        );
      await deleteDbsControlLocalSyncCommand(removable.id);
    }
    await idbWrite((store) => store.put(safeCommand));
    memoryFallback.delete(safeCommand.id);
  } catch (error) {
    if (canUseIndexedDb()) {
      // A browser may reject IndexedDB in private mode or after a quota error.
      // Preserve the command in memory for this session instead of dropping it.
      console.warn("DBS CONTROL: IndexedDB indisponível; fila local em memória.", error);
    }
    memoryFallback.set(safeCommand.id, safeCommand);
  }
  return safeCommand;
}

export async function updateDbsControlLocalSyncCommand(
  id: string,
  patch: Partial<DbsControlLocalSyncCommand>,
) {
  const current = (await listDbsControlLocalSyncCommands()).find((command) => command.id === id);
  if (!current) return null;
  return putDbsControlLocalSyncCommand({ ...current, ...clone(patch), id, updatedAt: Date.now() });
}

export async function deleteDbsControlLocalSyncCommand(id: string) {
  memoryFallback.delete(id);
  try {
    await idbWrite((store) => store.delete(id));
  } catch {
    // The memory fallback was already removed. The next successful IndexedDB
    // write will compact stale entries without touching cloud data.
  }
}

/**
 * A page crash can leave a command in `sending`. Recover only leases that have
 * expired; a second tab must not duplicate a live request.
 */
export async function recoverExpiredDbsControlLocalSyncCommands(now = Date.now()) {
  const commands = await listDbsControlLocalSyncCommands();
  for (const command of commands) {
    if (command.status !== "sending" || Number(command.leaseUntil ?? 0) >= now) continue;
    await updateDbsControlLocalSyncCommand(command.id, {
      status: "pending",
      nextAttemptAt: now,
      leaseUntil: null,
      lastError: "Sessão anterior interrompida; a intenção foi retomada sem descarte.",
    });
  }
  return listDbsControlLocalSyncCommands();
}

export async function withDbsControlLocalSyncLock<T>(operation: () => Promise<T>) {
  const locks =
    typeof navigator !== "undefined"
      ? (
          navigator as Navigator & {
            locks?: {
              request: (
                name: string,
                options: { ifAvailable: boolean },
                callback: (lock: unknown) => Promise<T>,
              ) => Promise<T>;
            };
          }
        ).locks
      : undefined;
  if (locks?.request) {
    const result = await locks.request(
      "dbs-control-local-sync",
      { ifAvailable: true },
      async (lock) => {
        if (!lock)
          throw new Error("Outra aba está sincronizando; a intenção permanece na fila local.");
        return operation();
      },
    );
    return result;
  }
  return operation();
}
