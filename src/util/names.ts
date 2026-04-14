const normalize = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed;
};

export const extractFirstName = (rawValue: string | null | undefined): string => {
  const normalized = normalize(rawValue);
  if (!normalized) return "";
  const [firstChunk] = normalized.split(/\s+/);
  return firstChunk?.trim() ?? "";
};

export const extractEmailUsername = (rawEmail: string | null | undefined): string => {
  if (!rawEmail) return "";
  const trimmed = rawEmail.trim();
  if (!trimmed) return "";
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0) return "";
  return trimmed.slice(0, atIndex).trim();
};
