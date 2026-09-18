import { BadRequestException } from "@nestjs/common";

export type QuestionnaireQuestionType =
  | "BOOLEAN"
  | "SINGLE_CHOICE"
  | "MULTI_CHOICE"
  | "NUMBER"
  | "TEXT"
  | "DATE";

export interface QuestionnaireLabels {
  en: string;
  ar?: string;
  fr?: string;
  es?: string;
}

export interface QuestionnaireOption {
  value: string;
  labels: QuestionnaireLabels;
}

export interface QuestionnaireQuestion {
  id: string;
  type: QuestionnaireQuestionType;
  labels: QuestionnaireLabels;
  required?: boolean;
  options?: QuestionnaireOption[];
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface QuestionnaireSchema {
  schemaVersion: 1;
  questions: QuestionnaireQuestion[];
}

export interface QuestionnaireActivationRules {
  dueIfNoResponse: boolean;
  repeatDays?: number;
  askHealthChanged: boolean;
}

export type QuestionnaireAnswers = Record<string, unknown>;

export interface QuestionnaireDiff {
  changedQuestionIds: string[];
  changes: Array<{ questionId: string; previousValue: unknown; currentValue: unknown }>;
}

const QUESTION_TYPES = new Set<QuestionnaireQuestionType>([
  "BOOLEAN",
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "NUMBER",
  "TEXT",
  "DATE",
]);
const QUESTION_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const OPTION_VALUE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const MAX_QUESTIONS = 100;
const MAX_OPTIONS = 30;

export function normalizeQuestionnaireSchema(input: unknown): QuestionnaireSchema {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("questionnaire schema must be an object.");
  }
  const raw = input as { schemaVersion?: unknown; questions?: unknown };
  if (raw.schemaVersion !== 1) throw new BadRequestException("questionnaire schemaVersion must be 1.");
  if (!Array.isArray(raw.questions) || raw.questions.length < 1 || raw.questions.length > MAX_QUESTIONS) {
    throw new BadRequestException(`questionnaire questions must contain between 1 and ${MAX_QUESTIONS} items.`);
  }

  const seen = new Set<string>();
  const questions = raw.questions.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new BadRequestException(`question ${index + 1} must be an object.`);
    }
    const value = item as Record<string, unknown>;
    const id = requiredToken(value.id, `question ${index + 1} id`, QUESTION_ID);
    if (seen.has(id)) throw new BadRequestException(`duplicate questionnaire question id '${id}'.`);
    seen.add(id);

    const type = String(value.type ?? "").trim().toUpperCase() as QuestionnaireQuestionType;
    if (!QUESTION_TYPES.has(type)) throw new BadRequestException(`question '${id}' has unsupported type.`);
    const labels = normalizeLabels(value.labels, `question '${id}' labels`);
    const required = value.required === true;
    const question: QuestionnaireQuestion = { id, type, labels, required };

    if (type === "SINGLE_CHOICE" || type === "MULTI_CHOICE") {
      if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > MAX_OPTIONS) {
        throw new BadRequestException(`question '${id}' requires between 2 and ${MAX_OPTIONS} options.`);
      }
      const optionSeen = new Set<string>();
      question.options = value.options.map((rawOption, optionIndex) => {
        if (!rawOption || typeof rawOption !== "object" || Array.isArray(rawOption)) {
          throw new BadRequestException(`question '${id}' option ${optionIndex + 1} must be an object.`);
        }
        const option = rawOption as Record<string, unknown>;
        const optionValue = requiredToken(option.value, `question '${id}' option value`, OPTION_VALUE);
        if (optionSeen.has(optionValue)) throw new BadRequestException(`question '${id}' has duplicate option '${optionValue}'.`);
        optionSeen.add(optionValue);
        return { value: optionValue, labels: normalizeLabels(option.labels, `question '${id}' option labels`) };
      });
    }

    if (type === "NUMBER") {
      if (value.min !== undefined) question.min = finiteNumber(value.min, `question '${id}' min`);
      if (value.max !== undefined) question.max = finiteNumber(value.max, `question '${id}' max`);
      if (question.min !== undefined && question.max !== undefined && question.max < question.min) {
        throw new BadRequestException(`question '${id}' max must be greater than or equal to min.`);
      }
    }

    if (type === "TEXT") {
      const maxLength = value.maxLength === undefined ? 2000 : integer(value.maxLength, `question '${id}' maxLength`);
      if (maxLength < 1 || maxLength > 10000) throw new BadRequestException(`question '${id}' maxLength is invalid.`);
      question.maxLength = maxLength;
    }

    return question;
  });

  return { schemaVersion: 1, questions };
}

export function normalizeActivationRules(input: unknown): QuestionnaireActivationRules {
  if (input === undefined || input === null) {
    return { dueIfNoResponse: true, askHealthChanged: true };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("activationRules must be an object.");
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set(["dueIfNoResponse", "repeatDays", "askHealthChanged"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new BadRequestException(`Unsupported activation rule '${key}'.`);
  }
  const dueIfNoResponse = value.dueIfNoResponse === undefined ? true : booleanValue(value.dueIfNoResponse, "dueIfNoResponse");
  const askHealthChanged = value.askHealthChanged === undefined ? true : booleanValue(value.askHealthChanged, "askHealthChanged");
  let repeatDays: number | undefined;
  if (value.repeatDays !== undefined && value.repeatDays !== null) {
    repeatDays = integer(value.repeatDays, "repeatDays");
    if (repeatDays < 1 || repeatDays > 3650) throw new BadRequestException("repeatDays must be between 1 and 3650.");
  }
  return { dueIfNoResponse, ...(repeatDays ? { repeatDays } : {}), askHealthChanged };
}

export function normalizeQuestionnaireAnswers(
  schema: QuestionnaireSchema,
  input: unknown,
): QuestionnaireAnswers {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("answers must be an object.");
  }
  const raw = input as Record<string, unknown>;
  const byId = new Map(schema.questions.map((question) => [question.id, question]));
  for (const key of Object.keys(raw)) {
    if (!byId.has(key)) throw new BadRequestException(`Unsupported questionnaire answer '${key}'.`);
  }

  const output: QuestionnaireAnswers = {};
  for (const question of schema.questions) {
    const supplied = Object.prototype.hasOwnProperty.call(raw, question.id);
    const value = raw[question.id];
    if (!supplied || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
      if (question.required) throw new BadRequestException(`Question '${question.id}' is required.`);
      continue;
    }

    switch (question.type) {
      case "BOOLEAN":
        if (typeof value !== "boolean") throw new BadRequestException(`Question '${question.id}' must be boolean.`);
        output[question.id] = value;
        break;
      case "SINGLE_CHOICE": {
        if (typeof value !== "string") throw new BadRequestException(`Question '${question.id}' must select one option.`);
        const allowed = new Set((question.options ?? []).map((option) => option.value));
        if (!allowed.has(value)) throw new BadRequestException(`Question '${question.id}' selected an invalid option.`);
        output[question.id] = value;
        break;
      }
      case "MULTI_CHOICE": {
        if (!Array.isArray(value)) throw new BadRequestException(`Question '${question.id}' must select an option list.`);
        const allowed = new Set((question.options ?? []).map((option) => option.value));
        const selected = value.map((item) => {
          if (typeof item !== "string" || !allowed.has(item)) {
            throw new BadRequestException(`Question '${question.id}' selected an invalid option.`);
          }
          return item;
        });
        if (new Set(selected).size !== selected.length) {
          throw new BadRequestException(`Question '${question.id}' contains duplicate options.`);
        }
        const order = new Map((question.options ?? []).map((option, index) => [option.value, index]));
        output[question.id] = [...selected].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
        break;
      }
      case "NUMBER": {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new BadRequestException(`Question '${question.id}' must be a finite number.`);
        }
        if (question.min !== undefined && value < question.min) throw new BadRequestException(`Question '${question.id}' is below its minimum.`);
        if (question.max !== undefined && value > question.max) throw new BadRequestException(`Question '${question.id}' is above its maximum.`);
        output[question.id] = value;
        break;
      }
      case "TEXT": {
        if (typeof value !== "string") throw new BadRequestException(`Question '${question.id}' must be text.`);
        const normalized = value.trim();
        if (!normalized && question.required) throw new BadRequestException(`Question '${question.id}' is required.`);
        if (normalized.length > (question.maxLength ?? 2000)) throw new BadRequestException(`Question '${question.id}' is too long.`);
        if (normalized) output[question.id] = normalized;
        break;
      }
      case "DATE": {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          throw new BadRequestException(`Question '${question.id}' must use YYYY-MM-DD.`);
        }
        const parsed = new Date(`${value}T00:00:00.000Z`);
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
          throw new BadRequestException(`Question '${question.id}' contains an invalid date.`);
        }
        output[question.id] = value;
        break;
      }
    }
  }
  return output;
}

export function diffQuestionnaireAnswers(
  previous: QuestionnaireAnswers | null,
  current: QuestionnaireAnswers,
): QuestionnaireDiff {
  const ids = new Set([...Object.keys(previous ?? {}), ...Object.keys(current)]);
  const changedQuestionIds = [...ids].filter((id) => !sameValue(previous?.[id], current[id])).sort();
  return {
    changedQuestionIds,
    changes: changedQuestionIds.map((questionId) => ({
      questionId,
      previousValue: previous?.[questionId] ?? null,
      currentValue: current[questionId] ?? null,
    })),
  };
}

export function evaluateQuestionnaireActivation(
  rules: QuestionnaireActivationRules,
  lastCompletedAt: Date | null,
  now = new Date(),
) {
  if (!lastCompletedAt) {
    return {
      due: rules.dueIfNoResponse,
      reason: rules.dueIfNoResponse ? "NO_RESPONSE" as const : "NOT_DUE" as const,
      askHealthChanged: false,
    };
  }
  const askHealthChanged = rules.askHealthChanged;
  if (!rules.repeatDays) return { due: false, reason: "NOT_DUE" as const, askHealthChanged };
  const dueAt = new Date(lastCompletedAt.getTime() + rules.repeatDays * 24 * 60 * 60 * 1000);
  return {
    due: now.getTime() >= dueAt.getTime(),
    reason: now.getTime() >= dueAt.getTime() ? "PERIODIC_REVIEW" as const : "NOT_DUE" as const,
    askHealthChanged,
    dueAt,
  };
}

function normalizeLabels(input: unknown, label: string): QuestionnaireLabels {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException(`${label} must be an object.`);
  const value = input as Record<string, unknown>;
  const output: Record<string, string> = {};
  for (const locale of ["en", "ar", "fr", "es"] as const) {
    const raw = value[locale];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") throw new BadRequestException(`${label}.${locale} must be text.`);
    const normalized = raw.trim();
    if (!normalized || normalized.length > 300) throw new BadRequestException(`${label}.${locale} length is invalid.`);
    output[locale] = normalized;
  }
  if (!output.en) throw new BadRequestException(`${label}.en is required.`);
  return output as QuestionnaireLabels;
}

function requiredToken(input: unknown, label: string, pattern: RegExp): string {
  if (typeof input !== "string") throw new BadRequestException(`${label} is required.`);
  const value = input.trim();
  if (!pattern.test(value)) throw new BadRequestException(`${label} is invalid.`);
  return value;
}

function finiteNumber(input: unknown, label: string): number {
  if (typeof input !== "number" || !Number.isFinite(input)) throw new BadRequestException(`${label} must be a finite number.`);
  return input;
}

function integer(input: unknown, label: string): number {
  if (!Number.isInteger(input)) throw new BadRequestException(`${label} must be an integer.`);
  return Number(input);
}

function booleanValue(input: unknown, label: string): boolean {
  if (typeof input !== "boolean") throw new BadRequestException(`${label} must be boolean.`);
  return input;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
