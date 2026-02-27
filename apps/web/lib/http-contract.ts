import { NextResponse } from "next/server";

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function jsonSuccess<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

export function jsonError(code: string, message: string, status = 400, details?: unknown): NextResponse<ApiError> {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        details,
      },
    },
    { status },
  );
}

export function normalizeInteger(input: unknown, fallback: number, min: number, max: number): number {
  if (input === undefined || input === null || input === "") {
    return fallback;
  }

  const numeric = Number(input);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    throw new Error(`Expected integer in [${min}, ${max}] but received '${String(input)}'.`);
  }

  return numeric;
}

export function normalizeOptionalInteger(input: unknown, min: number, max: number): number | undefined {
  if (input === undefined || input === null || input === "") {
    return undefined;
  }

  const numeric = Number(input);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    throw new Error(`Expected integer in [${min}, ${max}] but received '${String(input)}'.`);
  }

  return numeric;
}

export function normalizeString(input: unknown, fallback: string): string {
  const value = String(input ?? fallback).trim();
  if (!value) {
    throw new Error("Expected non-empty string.");
  }
  return value;
}

export function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const values = input
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));

  const unique: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (index === 0 || values[index] !== values[index - 1]) {
      unique.push(values[index]);
    }
  }

  return unique;
}
