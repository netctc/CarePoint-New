export type PreventiveTrigger = {
  triggerType: "AGE_WINDOW" | "IMMUNIZATION_INTERVAL";
  minAgeYears: number | null;
  maxAgeYears: number | null;
  vaccineCodeSystem: string | null;
  vaccineCode: string | null;
  intervalDays: number | null;
};

export type PreventiveImmunization = {
  occurredOn: string;
  vaccineCodeSystem: string | null;
  vaccineCode: string | null;
};

export type PreventiveEvaluation =
  | { due: false; reason: "AGE_OUTSIDE_WINDOW" | "AGE_UNAVAILABLE" | "IMMUNIZATION_NOT_DUE" }
  | { due: true; reason: "AGE_WINDOW_MATCH"; ageYears: number }
  | { due: true; reason: "IMMUNIZATION_NOT_RECORDED"; ageYears: number | null }
  | { due: true; reason: "IMMUNIZATION_INTERVAL_DUE"; ageYears: number | null; lastImmunizationOn: string; dueSince: string };

export function ageYears(dateOfBirth: string | null | undefined, now: Date): number | null {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(birth.getTime()) || birth.getTime() > now.getTime()) return null;
  let age = now.getUTCFullYear() - year;
  const beforeBirthday =
    now.getUTCMonth() + 1 < month ||
    (now.getUTCMonth() + 1 === month && now.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

export function evaluatePreventiveRule(
  rule: PreventiveTrigger,
  dateOfBirth: string | null | undefined,
  immunizations: PreventiveImmunization[],
  now: Date,
): PreventiveEvaluation {
  const age = ageYears(dateOfBirth, now);
  if ((rule.minAgeYears != null || rule.maxAgeYears != null) && age == null) {
    return { due: false, reason: "AGE_UNAVAILABLE" };
  }
  if (age != null && rule.minAgeYears != null && age < rule.minAgeYears) {
    return { due: false, reason: "AGE_OUTSIDE_WINDOW" };
  }
  if (age != null && rule.maxAgeYears != null && age > rule.maxAgeYears) {
    return { due: false, reason: "AGE_OUTSIDE_WINDOW" };
  }

  if (rule.triggerType === "AGE_WINDOW") {
    if (age == null) return { due: false, reason: "AGE_UNAVAILABLE" };
    return { due: true, reason: "AGE_WINDOW_MATCH", ageYears: age };
  }

  const system = rule.vaccineCodeSystem?.trim().toLowerCase() ?? "";
  const code = rule.vaccineCode?.trim().toLowerCase() ?? "";
  const matching = immunizations
    .filter((item) =>
      (item.vaccineCodeSystem?.trim().toLowerCase() ?? "") === system &&
      (item.vaccineCode?.trim().toLowerCase() ?? "") === code,
    )
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  if (matching.length === 0) {
    return { due: true, reason: "IMMUNIZATION_NOT_RECORDED", ageYears: age };
  }

  const last = matching[0].occurredOn;
  const lastDate = new Date(`${last}T00:00:00.000Z`);
  const intervalDays = rule.intervalDays ?? 0;
  const dueAt = new Date(lastDate.getTime() + intervalDays * 86_400_000);
  if (dueAt.getTime() > now.getTime()) return { due: false, reason: "IMMUNIZATION_NOT_DUE" };
  return {
    due: true,
    reason: "IMMUNIZATION_INTERVAL_DUE",
    ageYears: age,
    lastImmunizationOn: last,
    dueSince: dueAt.toISOString().slice(0, 10),
  };
}
