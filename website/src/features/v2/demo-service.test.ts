import { describe, expect, it } from "vitest";

import type { StorageLike } from "./demo-service";
import {
  createDemoDatingService,
  createSeedState,
  DEMO_CONSENT_VERSION,
  DEMO_STORAGE_KEY,
  evaluateCandidateAgainstCriteria,
} from "./demo-service";

const FIXED_NOW = "2026-08-11T12:00:00.000Z";
const fixedNow = () => new Date(FIXED_NOW);

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("LocalDatingService", () => {
  it("persists profile updates across service instances", async () => {
    const storage = memoryStorage();
    const first = createDemoDatingService({ storage, now: fixedNow });

    await first.saveProfile({
      displayName: "小夏",
      details: { city: "Berkeley", occupation: "体验设计师" },
    });

    const second = createDemoDatingService({ storage, now: fixedNow });
    const restored = await second.getCurrentProfile();
    expect(restored.displayName).toBe("小夏");
    expect(restored.details.city).toBe("Berkeley");
    expect(restored.details.occupation).toBe("体验设计师");
  });

  it("freezes, runs and reveals an event idempotently without overwriting the round", async () => {
    const service = createDemoDatingService({ storage: memoryStorage(), now: fixedNow });

    const firstClose = await service.closePoolRegistration("pool-bay-walk");
    const secondClose = await service.closePoolRegistration("pool-bay-walk");
    expect(firstClose.status).toBe("registration_closed");
    expect(secondClose.status).toBe("registration_closed");

    const firstRun = await service.runPoolMatching("pool-bay-walk");
    const repeatedRun = await service.runPoolMatching("pool-bay-walk");
    expect(repeatedRun.id).toBe(firstRun.id);
    expect(repeatedRun.matchIds).toEqual(firstRun.matchIds);

    const firstReveal = await service.revealMatchRun(firstRun.id);
    const repeatedReveal = await service.revealMatchRun(firstRun.id);
    const runAfterReveal = await service.runPoolMatching("pool-bay-walk");
    const closeAfterReveal = await service.closePoolRegistration("pool-bay-walk");
    expect(firstReveal.status).toBe("revealed");
    expect(repeatedReveal.id).toBe(firstReveal.id);
    expect(repeatedReveal.revealedAt).toBe(firstReveal.revealedAt);
    expect(runAfterReveal.id).toBe(firstRun.id);
    expect(closeAfterReveal.latestRun?.id).toBe(firstRun.id);

    const report = await service.getOrganizerRunReport(firstRun.id);
    expect(report.matchedPairCount).toBe(firstRun.matchIds.length);
    expect(report.unmatchedCount).toBe(firstRun.unmatchedUserIds.length);
    expect(report.pairs).toBeUndefined();
    expect(report.run).not.toHaveProperty("participantIds");
    expect(report.run).not.toHaveProperty("unmatchedUserIds");
    expect(report.run).not.toHaveProperty("matchIds");
  });

  it("unlocks only the selected contact channels after mutual interest", async () => {
    const service = createDemoDatingService({ storage: memoryStorage(), now: fixedNow });
    const match = (await service.listMatches()).find((item) => item.id === "match-cal-1");
    expect(match).toBeDefined();
    expect(match?.contactsUnlocked).toBe(false);
    expect(match?.partner.contacts).toBeUndefined();

    const unlocked = await service.respondToMatch("match-cal-1", "interested");
    expect(unlocked.contactsUnlocked).toBe(true);
    expect(unlocked.partner.contacts).toEqual({
      email: "anran@example.com",
      wechat: "anran_walks",
    });

    const repeated = await service.respondToMatch("match-cal-1", "interested");
    expect(repeated.partner.contacts).toEqual(unlocked.partner.contacts);
  });

  it("rejects a candidate whose value is missing for an enabled hard filter", () => {
    const state = createSeedState(fixedNow());
    const viewer = state.profiles.find((profile) => profile.id === "user-lin-zhixia")!;
    const originalCandidate = state.profiles.find((profile) => profile.id === "user-zhou-anran")!;
    const candidate = {
      ...originalCandidate,
      details: { ...originalCandidate.details, city: undefined },
    };
    const criteria = state.criteriaByUserId[viewer.id];
    const candidateCriteria = state.criteriaByUserId[candidate.id];

    const result = evaluateCandidateAgainstCriteria(
      viewer,
      candidate,
      criteria,
      fixedNow(),
      candidateCriteria,
    );
    expect(result.accepted).toBe(false);
    expect(result.failedFields).toContain("city");
  });

  it("requires an organizer to opt in separately before joining the matching snapshot", async () => {
    const service = createDemoDatingService({ storage: memoryStorage(), now: fixedNow });
    const before = await service.getPool("pool-bay-walk");
    expect(before.myMembership?.role).toBe("organizer");
    expect(before.myMembership?.participatesInMatching).toBe(false);

    const draft = await service.joinPool("pool-bay-walk", {
      registrationAnswers: { "q-arrival": "on-time", "q-note": "", contactChannel: "email" },
    });
    expect(draft.role).toBe("organizer");
    expect(draft.participatesInMatching).toBe(true);
    expect(draft.status).toBe("draft");
    expect(draft.consentVersion).toBeUndefined();
    expect(draft.consentedAt).toBeUndefined();

    const confirmed = await service.confirmPoolParticipation("pool-bay-walk");
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.consentVersion).toBe(DEMO_CONSENT_VERSION);
    expect(confirmed.consentedAt).toBe(FIXED_NOW);
    expect((await service.getPool("pool-bay-walk")).participantCount).toBe(before.participantCount + 1);
  });

  it("keeps every seed run participant aligned with a frozen, currently consented membership", () => {
    const state = createSeedState(fixedNow());

    for (const run of state.runs) {
      const snapshot = state.runSnapshotsByRunId[run.id];
      expect(snapshot).toBeDefined();
      expect(Object.keys(snapshot.profilesByUserId).sort()).toEqual([...run.participantIds].sort());
      expect(Object.keys(snapshot.criteriaByUserId).sort()).toEqual([...run.participantIds].sort());
      expect(Object.keys(snapshot.membershipsByUserId).sort()).toEqual([...run.participantIds].sort());

      for (const userId of run.participantIds) {
        const membership = snapshot.membershipsByUserId[userId];
        expect(membership.participatesInMatching).toBe(true);
        expect(membership.status).toBe("confirmed");
        expect(membership.consentVersion).toBe(DEMO_CONSENT_VERSION);
        expect(membership.consentedAt).toBeTruthy();
      }
    }
  });

  it("excludes stale consent from a dynamic run and snapshots only eligible memberships", async () => {
    const storage = memoryStorage();
    const state = createSeedState(fixedNow());
    const staleMembership = state.memberships.find((membership) =>
      membership.poolId === "pool-bay-walk" && membership.userId === "user-zhou-anran");
    expect(staleMembership).toBeDefined();
    staleMembership!.consentVersion = "outdated-consent";
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    const service = createDemoDatingService({ storage, now: fixedNow });

    await service.closePoolRegistration("pool-bay-walk");
    const run = await service.runPoolMatching("pool-bay-walk");
    expect(run.participantIds).not.toContain("user-zhou-anran");

    const persisted = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!) as ReturnType<typeof createSeedState>;
    expect(Object.keys(persisted.runSnapshotsByRunId[run.id].membershipsByUserId).sort())
      .toEqual([...run.participantIds].sort());
    for (const membership of Object.values(persisted.runSnapshotsByRunId[run.id].membershipsByUserId)) {
      expect(membership.consentVersion).toBe(DEMO_CONSENT_VERSION);
      expect(membership.consentedAt).toBeTruthy();
    }
  });

  it("releases contacts from the frozen membership, never a later live-membership edit", async () => {
    const storage = memoryStorage();
    const state = createSeedState(fixedNow());
    const livePartnerMembership = state.memberships.find((membership) =>
      membership.poolId === "pool-cal-alumni" && membership.userId === "user-zhou-anran");
    expect(livePartnerMembership).toBeDefined();
    livePartnerMembership!.sharedContactTypes = ["instagram"];
    livePartnerMembership!.consentVersion = undefined;
    livePartnerMembership!.consentedAt = undefined;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    const service = createDemoDatingService({ storage, now: fixedNow });

    const unlocked = await service.respondToMatch("match-cal-1", "interested");
    expect(unlocked.contactsUnlocked).toBe(true);
    expect(unlocked.partner.contacts).toEqual({
      email: "anran@example.com",
      wechat: "anran_walks",
    });
  });

  it("fails closed when the frozen contact-consent membership is missing", async () => {
    const storage = memoryStorage();
    const state = createSeedState(fixedNow());
    const pool = state.pools.find((item) => item.id === "pool-cal-alumni")!;
    pool.resultPolicy = { organizerCanViewPairs: false, contactReleasePolicy: "immediate" };
    delete state.runSnapshotsByRunId["run-cal-1"].membershipsByUserId["user-zhou-anran"];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    const service = createDemoDatingService({ storage, now: fixedNow });

    const match = (await service.listMatches()).find((item) => item.id === "match-cal-1")!;
    expect(match.contactsUnlocked).toBe(false);
    expect(match.partner.contacts).toBeUndefined();
  });

  it("revokes contact projection after a block even for a direct match lookup action", async () => {
    const service = createDemoDatingService({ storage: memoryStorage(), now: fixedNow });
    expect((await service.respondToMatch("match-cal-1", "interested")).contactsUnlocked).toBe(true);

    await service.blockUser("user-zhou-anran");
    const blocked = await service.respondToMatch("match-cal-1", "interested");
    expect(blocked.contactsUnlocked).toBe(false);
    expect(blocked.partner.contacts).toBeUndefined();
  });

  it("revokes immediate contact projection when either participant passes", async () => {
    const storage = memoryStorage();
    const state = createSeedState(fixedNow());
    state.pools.find((item) => item.id === "pool-cal-alumni")!.resultPolicy.contactReleasePolicy = "immediate";
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    const service = createDemoDatingService({ storage, now: fixedNow });

    expect((await service.listMatches()).find((item) => item.id === "match-cal-1")?.contactsUnlocked).toBe(true);
    const passed = await service.respondToMatch("match-cal-1", "passed");
    expect(passed.contactsUnlocked).toBe(false);
    expect(passed.partner.contacts).toBeUndefined();
  });

  it("does not expose a participant's custom hard criteria in organizer membership views", async () => {
    const storage = memoryStorage();
    const state = createSeedState(fixedNow());
    const membership = state.memberships.find((item) =>
      item.poolId === "pool-bay-walk" && item.userId === "user-zhou-anran")!;
    membership.criteriaMode = "custom";
    membership.criteriaOverride = state.criteriaByUserId[membership.userId];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    const service = createDemoDatingService({ storage, now: fixedNow });

    const organizerView = await service.getPool("pool-bay-walk");
    const projected = organizerView.members.find((item) => item.userId === membership.userId)!;
    expect(projected.criteriaMode).toBe("custom");
    expect(projected.criteriaOverride).toBeUndefined();
  });

  it("does not reveal a participant's match or unmatched outcome before reveal", async () => {
    const storage = memoryStorage();
    const organizerService = createDemoDatingService({ storage, now: fixedNow });
    await organizerService.closePoolRegistration("pool-bay-walk");
    const run = await organizerService.runPoolMatching("pool-bay-walk");
    expect(run.status).toBe("ready");

    const state = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!) as ReturnType<typeof createSeedState>;
    state.currentUserId = run.participantIds[0];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    const participantService = createDemoDatingService({ storage, now: fixedNow });
    const participantView = await participantService.getPool("pool-bay-walk");

    expect(participantView.latestRun?.status).toBe("ready");
    expect(participantView.latestRun?.matchIds).toEqual([]);
    expect(participantView.latestRun?.unmatchedUserIds).toEqual([]);
  });

  it("withholds organizer pair identities until the run is revealed", async () => {
    const storage = memoryStorage();
    const state = createSeedState(fixedNow());
    state.pools.find((item) => item.id === "pool-bay-walk")!.resultPolicy.organizerCanViewPairs = true;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    const service = createDemoDatingService({ storage, now: fixedNow });

    await service.closePoolRegistration("pool-bay-walk");
    const run = await service.runPoolMatching("pool-bay-walk");
    expect((await service.getOrganizerRunReport(run.id)).pairs).toBeUndefined();

    await service.revealMatchRun(run.id);
    expect((await service.getOrganizerRunReport(run.id)).pairs?.length).toBe(run.matchIds.length);
  });

  it("ships a participant-safe unmatched result scenario in the demo seed", async () => {
    const service = createDemoDatingService({ storage: memoryStorage(), now: fixedNow });
    const pool = await service.getPool("pool-bookstore-reading");
    expect(pool.status).toBe("revealed");
    expect(pool.latestRun?.unmatchedUserIds).toEqual(["user-lin-zhixia"]);
    expect(pool.latestRun?.matchIds).toEqual([]);
  });

  it.each([
    [false, "mutualInterest", false, false],
    [true, "mutualInterest", true, false],
    [false, "immediate", false, true],
    [true, "immediate", true, true],
  ] as const)(
    "keeps organizer pair visibility=%s independent from contact policy=%s",
    async (organizerCanViewPairs, contactReleasePolicy, expectsPairs, expectsContacts) => {
      const storage = memoryStorage();
      const state = createSeedState(fixedNow());
      const pool = state.pools.find(item => item.id === "pool-cal-alumni")!;
      pool.organizerId = state.currentUserId;
      pool.resultPolicy = { organizerCanViewPairs, contactReleasePolicy };
      storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
      const service = createDemoDatingService({ storage, now: fixedNow });

      const report = await service.getOrganizerRunReport("run-cal-1");
      const match = (await service.listMatches()).find(item => item.id === "match-cal-1")!;
      expect(Boolean(report.pairs)).toBe(expectsPairs);
      expect(match.contactsUnlocked).toBe(expectsContacts);
      expect(Boolean(match.partner.contacts)).toBe(expectsContacts);
    },
  );
});
