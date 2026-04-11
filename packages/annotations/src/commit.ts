export function isKnownCommitSha(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return normalized !== "unknown";
}
