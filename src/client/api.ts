export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error ?? 'The request failed.');
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
