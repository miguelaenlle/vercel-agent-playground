export function reportError(stage: string, error: unknown) {
  // SDK error objects may carry request headers. Log messages, not whole objects.
  let detail =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (error instanceof Error && error.cause instanceof Error) {
    detail += `\nCaused by ${error.cause.name}: ${error.cause.message}`;
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (value && /KEY|TOKEN|SECRET|PASSWORD|(?:^|_)PAT$/i.test(name)) {
      detail = detail.replaceAll(value, '[redacted]');
    }
  }
  console.error(`${stage}: ${detail}`);
}
