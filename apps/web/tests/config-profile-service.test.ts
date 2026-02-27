import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureConfigProfileServiceForTests,
  deleteConfigProfile,
  listConfigProfiles,
  resetConfigProfileServiceForTests,
  upsertConfigProfile,
} from "../lib/config-profile-service";

describe("config profile service", () => {
  afterEach(() => {
    resetConfigProfileServiceForTests();
  });

  it("persists deterministic profile records and hashes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "explain-md-web-profiles-"));
    const ledgerPath = path.join(tempDir, "profiles.json");
    configureConfigProfileServiceForTests({
      ledgerPath,
      now: () => new Date("2026-02-27T00:00:00.000Z"),
    });

    const saved = await upsertConfigProfile({
      projectId: "Seed-Verity",
      userId: "Local User",
      profileId: "Focused Mode",
      name: "Focused Mode",
      config: {
        abstractionLevel: 4,
        complexityLevel: 2,
        audienceLevel: "novice",
      },
    });

    const listed = await listConfigProfiles({
      projectId: "seed-verity",
      userId: "local user",
    });

    expect(saved.profile.storageKey).toBe("project:seed-verity:user:local_user:profile:focused_mode");
    expect(saved.profile.profileId).toBe("focused_mode");
    expect(saved.profile.configHash).toHaveLength(64);
    expect(saved.requestHash).toHaveLength(64);
    expect(saved.ledgerHash).toHaveLength(64);
    expect(listed.profiles).toHaveLength(1);
    expect(listed.profiles[0]?.profileId).toBe("focused_mode");
  });

  it("returns deterministic regeneration plan on profile update", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "explain-md-web-profiles-"));
    const ledgerPath = path.join(tempDir, "profiles.json");
    configureConfigProfileServiceForTests({
      ledgerPath,
      now: () => new Date("2026-02-27T00:00:00.000Z"),
    });

    await upsertConfigProfile({
      projectId: "seed-verity",
      userId: "local-user",
      profileId: "default",
      name: "Default",
      config: {
        abstractionLevel: 2,
        complexityLevel: 2,
      },
    });

    configureConfigProfileServiceForTests({
      ledgerPath,
      now: () => new Date("2026-02-27T00:00:05.000Z"),
    });

    const updated = await upsertConfigProfile({
      projectId: "seed-verity",
      userId: "local-user",
      profileId: "default",
      name: "Default",
      config: {
        abstractionLevel: 4,
        complexityLevel: 2,
      },
    });

    expect(updated.regenerationPlan.scope).toBe("full");
    expect(updated.regenerationPlan.changedFields).toContain("abstractionLevel");
    expect(updated.profile.createdAt).toBe("2026-02-27T00:00:00.000Z");
    expect(updated.profile.updatedAt).toBe("2026-02-27T00:00:05.000Z");
  });

  it("deletes profiles and reports delete status deterministically", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "explain-md-web-profiles-"));
    const ledgerPath = path.join(tempDir, "profiles.json");
    configureConfigProfileServiceForTests({
      ledgerPath,
      now: () => new Date("2026-02-27T00:00:00.000Z"),
    });

    await upsertConfigProfile({
      projectId: "seed-verity",
      userId: "local-user",
      profileId: "default",
      name: "Default",
      config: {
        abstractionLevel: 3,
      },
    });

    const removed = await deleteConfigProfile({
      projectId: "seed-verity",
      userId: "local-user",
      profileId: "default",
    });
    const removedMissing = await deleteConfigProfile({
      projectId: "seed-verity",
      userId: "local-user",
      profileId: "default",
    });

    expect(removed.deleted).toBe(true);
    expect(removedMissing.deleted).toBe(false);

    const listed = await listConfigProfiles({
      projectId: "seed-verity",
      userId: "local-user",
    });
    expect(listed.profiles).toEqual([]);
  });

  it("rejects invalid audience/reading-level combinations", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "explain-md-web-profiles-"));
    configureConfigProfileServiceForTests({
      ledgerPath: path.join(tempDir, "profiles.json"),
    });

    await expect(
      upsertConfigProfile({
        projectId: "seed-verity",
        userId: "local-user",
        profileId: "invalid",
        name: "Invalid",
        config: {
          audienceLevel: "expert",
          readingLevelTarget: "elementary",
        },
      }),
    ).rejects.toThrow("Invalid config profile");
  });
});
