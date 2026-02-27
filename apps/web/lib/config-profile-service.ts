import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildProfileStorageKey,
  computeConfigHash,
  normalizeConfig,
  planRegeneration,
  validateConfig,
  type ExplanationConfig,
  type ExplanationConfigInput,
  type RegenerationPlan,
} from "../../../dist/config-contract";

const DEFAULT_LEDGER_PATH = path.resolve(process.cwd(), ".explain-md", "web-config-profiles.json");
const LEDGER_SCHEMA_VERSION = "1.0.0";

interface ConfigProfileServiceOverrides {
  ledgerPath?: string;
  now?: () => Date;
}

interface ConfigProfileLedger {
  schemaVersion: string;
  profiles: StoredConfigProfile[];
}

interface StoredConfigProfile {
  storageKey: string;
  profileId: string;
  projectId: string;
  userId: string;
  name: string;
  config: ExplanationConfig;
  configHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigProfileRecord {
  storageKey: string;
  profileId: string;
  projectId: string;
  userId: string;
  name: string;
  config: ExplanationConfig;
  configHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigProfileScopeInput {
  projectId?: string;
  userId?: string;
}

export interface ListConfigProfilesRequest extends ConfigProfileScopeInput {}

export interface ListConfigProfilesResponse {
  projectId: string;
  userId: string;
  requestHash: string;
  ledgerHash: string;
  profiles: ConfigProfileRecord[];
}

export interface UpsertConfigProfileRequest extends ConfigProfileScopeInput {
  profileId: string;
  name: string;
  config?: ExplanationConfigInput;
}

export interface UpsertConfigProfileResponse {
  projectId: string;
  userId: string;
  profileId: string;
  requestHash: string;
  ledgerHash: string;
  profile: ConfigProfileRecord;
  regenerationPlan: RegenerationPlan;
}

export interface DeleteConfigProfileRequest extends ConfigProfileScopeInput {
  profileId: string;
}

export interface DeleteConfigProfileResponse {
  projectId: string;
  userId: string;
  profileId: string;
  requestHash: string;
  ledgerHash: string;
  deleted: boolean;
}

let overrides: ConfigProfileServiceOverrides = {};

export function configureConfigProfileServiceForTests(next: ConfigProfileServiceOverrides): void {
  overrides = { ...next };
}

export function resetConfigProfileServiceForTests(): void {
  overrides = {};
}

export async function listConfigProfiles(request: ListConfigProfilesRequest = {}): Promise<ListConfigProfilesResponse> {
  const scope = normalizeScope(request);
  const ledger = await readLedger();
  const profiles = ledger.profiles
    .filter((profile) => profile.projectId === scope.projectId && profile.userId === scope.userId)
    .sort((left, right) => left.storageKey.localeCompare(right.storageKey))
    .map(toRecord);

  return {
    projectId: scope.projectId,
    userId: scope.userId,
    requestHash: computeHash({ op: "list", ...scope }),
    ledgerHash: computeLedgerHash(ledger),
    profiles,
  };
}

export async function upsertConfigProfile(request: UpsertConfigProfileRequest): Promise<UpsertConfigProfileResponse> {
  const scope = normalizeScope(request);
  const profileId = normalizeRequiredString(request.profileId, "profileId");
  const name = normalizeRequiredString(request.name, "name");
  const normalizedConfig = normalizeConfig(request.config ?? {});
  const validation = validateConfig(normalizedConfig);
  if (!validation.ok) {
    const message = validation.errors.map((entry) => `${entry.path}: ${entry.message}`).join("; ");
    throw new Error(`Invalid config profile: ${message}`);
  }

  const storageKey = buildProfileStorageKey(scope.projectId, scope.userId, profileId);
  const nowIso = getNow().toISOString();
  const ledger = await readLedger();
  const existingIndex = ledger.profiles.findIndex((profile) => profile.storageKey === storageKey);
  const existing = existingIndex >= 0 ? ledger.profiles[existingIndex] : undefined;

  const nextProfile: StoredConfigProfile = {
    storageKey,
    profileId: normalizeKeyComponent(profileId),
    projectId: normalizeKeyComponent(scope.projectId),
    userId: normalizeKeyComponent(scope.userId),
    name,
    config: normalizedConfig,
    configHash: computeConfigHash(normalizedConfig),
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };

  if (existingIndex >= 0) {
    ledger.profiles[existingIndex] = nextProfile;
  } else {
    ledger.profiles.push(nextProfile);
  }

  const normalizedLedger = normalizeLedger(ledger);
  await writeLedger(normalizedLedger);

  return {
    projectId: scope.projectId,
    userId: scope.userId,
    profileId: nextProfile.profileId,
    requestHash: computeHash({ op: "upsert", ...scope, profileId: nextProfile.profileId, configHash: nextProfile.configHash }),
    ledgerHash: computeLedgerHash(normalizedLedger),
    profile: toRecord(nextProfile),
    regenerationPlan:
      existing === undefined
        ? {
            scope: "full",
            changedFields: ["profile.create"],
            reason: "New profile has no baseline and requires full generation.",
          }
        : planRegeneration(existing.config, nextProfile.config),
  };
}

export async function deleteConfigProfile(request: DeleteConfigProfileRequest): Promise<DeleteConfigProfileResponse> {
  const scope = normalizeScope(request);
  const profileId = normalizeRequiredString(request.profileId, "profileId");
  const normalizedProfileId = normalizeKeyComponent(profileId);
  const storageKey = buildProfileStorageKey(scope.projectId, scope.userId, normalizedProfileId);

  const ledger = await readLedger();
  const nextProfiles = ledger.profiles.filter((profile) => profile.storageKey !== storageKey);
  const deleted = nextProfiles.length !== ledger.profiles.length;

  const normalizedLedger = normalizeLedger({
    schemaVersion: LEDGER_SCHEMA_VERSION,
    profiles: nextProfiles,
  });

  if (deleted) {
    await writeLedger(normalizedLedger);
  }

  return {
    projectId: scope.projectId,
    userId: scope.userId,
    profileId: normalizedProfileId,
    requestHash: computeHash({ op: "delete", ...scope, profileId: normalizedProfileId }),
    ledgerHash: computeLedgerHash(normalizedLedger),
    deleted,
  };
}

function normalizeScope(input: ConfigProfileScopeInput): { projectId: string; userId: string } {
  return {
    projectId: normalizeKeyComponent(input.projectId ?? "default-project"),
    userId: normalizeKeyComponent(input.userId ?? "anonymous"),
  };
}

function toRecord(input: StoredConfigProfile): ConfigProfileRecord {
  return {
    storageKey: input.storageKey,
    profileId: input.profileId,
    projectId: input.projectId,
    userId: input.userId,
    name: input.name,
    config: input.config,
    configHash: input.configHash,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

async function readLedger(): Promise<ConfigProfileLedger> {
  const ledgerPath = resolveLedgerPath();
  try {
    const raw = await fs.readFile(ledgerPath, "utf8");
    return normalizeLedger(JSON.parse(raw) as Partial<ConfigProfileLedger>);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return normalizeLedger({ schemaVersion: LEDGER_SCHEMA_VERSION, profiles: [] });
    }
    throw error;
  }
}

async function writeLedger(ledger: ConfigProfileLedger): Promise<void> {
  const ledgerPath = resolveLedgerPath();
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  await fs.writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function normalizeLedger(input: Partial<ConfigProfileLedger>): ConfigProfileLedger {
  const profiles = Array.isArray(input.profiles) ? input.profiles.map(normalizeStoredProfile) : [];
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    profiles: profiles.sort((left, right) => left.storageKey.localeCompare(right.storageKey)),
  };
}

function normalizeStoredProfile(input: StoredConfigProfile): StoredConfigProfile {
  const projectId = normalizeRequiredString(input.projectId, "projectId");
  const userId = normalizeRequiredString(input.userId, "userId");
  const profileId = normalizeRequiredString(input.profileId, "profileId");
  const config = normalizeConfig(input.config);
  const validation = validateConfig(config);
  if (!validation.ok) {
    const message = validation.errors.map((entry) => `${entry.path}: ${entry.message}`).join("; ");
    throw new Error(`Invalid profile config for '${profileId}': ${message}`);
  }

  return {
    storageKey: buildProfileStorageKey(projectId, userId, profileId),
    projectId: normalizeKeyComponent(projectId),
    userId: normalizeKeyComponent(userId),
    profileId: normalizeKeyComponent(profileId),
    name: normalizeRequiredString(input.name, "name"),
    config,
    configHash: computeConfigHash(config),
    createdAt: normalizeIsoDate(input.createdAt, "createdAt"),
    updatedAt: normalizeIsoDate(input.updatedAt, "updatedAt"),
  };
}

function computeLedgerHash(ledger: ConfigProfileLedger): string {
  return computeHash({ schemaVersion: ledger.schemaVersion, profiles: ledger.profiles });
}

function computeHash(input: Record<string, unknown>): string {
  const canonical = JSON.stringify(input, stableReplacer);
  return createHash("sha256").update(canonical).digest("hex");
}

function stableReplacer(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, unknown>>((accumulator, key) => {
      accumulator[key] = record[key];
      return accumulator;
    }, {});
}

function normalizeKeyComponent(value: string): string {
  return normalizeRequiredString(value, "key").toLowerCase().replace(/[^a-z0-9-_]/g, "_");
}

function normalizeRequiredString(value: string, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}

function normalizeIsoDate(value: string, field: string): string {
  const normalized = normalizeRequiredString(value, field);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${field} must be an ISO timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

function resolveLedgerPath(): string {
  return path.resolve(overrides.ledgerPath ?? process.env.EXPLAIN_MD_WEB_CONFIG_PROFILE_LEDGER ?? DEFAULT_LEDGER_PATH);
}

function getNow(): Date {
  return overrides.now ? overrides.now() : new Date();
}
