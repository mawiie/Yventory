type ErrorDetails = {
  message?: unknown;
  name?: unknown;
  code?: unknown;
  status?: unknown;
  details?: unknown;
  hint?: unknown;
};

export function formatAppError(error: unknown, fallback: string) {
  const details = errorDetails(error);
  const message = typeof details.message === "string" ? details.message : "";

  if (message.toLowerCase() === "failed to fetch") {
    return [
      "Could not reach Supabase.",
      "Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local, confirm the Supabase project is active, and verify the app URL is allowed in Supabase Auth settings.",
      "Browser error: Failed to fetch.",
    ].join(" ");
  }

  const parts = [
    message || fallback,
    stringPart("code", details.code),
    stringPart("status", details.status),
    stringPart("details", details.details),
    stringPart("hint", details.hint),
  ].filter(Boolean);

  return parts.join(" ");
}

function errorDetails(error: unknown): ErrorDetails {
  if (error && typeof error === "object") {
    return error as ErrorDetails;
  }

  if (typeof error === "string") {
    return { message: error };
  }

  return {};
}

function stringPart(label: string, value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return `(${label}: ${value})`;
  }

  if (typeof value === "number") {
    return `(${label}: ${value})`;
  }

  return "";
}
