import type {
  HarnessV1SandboxProvider,
  HarnessV1NetworkSandboxSession,
  HarnessV1RequestTransformation,
} from '@ai-sdk/harness';

export function withGitAuth(
  provider: HarnessV1SandboxProvider,
  repoUrl: string,
  pat: string,
): HarnessV1SandboxProvider {
  const repo = new URL(repoUrl);
  // The repository URL is validated before sandbox creation.
  const path = repo.pathname;
  // Vercel adds the PAT outside the sandbox.
  const headers = {
    Authorization: `Basic ${Buffer.from(`x-access-token:${pat}`).toString('base64')}`,
  };
  // Clone, fetch, and pull use these two HTTPS requests.
  // Only this repository gets the PAT. Other internet traffic stays allowed.
  // Push uses GET info/refs?service=git-receive-pack + POST git-receive-pack.
  // Neither matches these rules, so pushes receive no PAT (traffic is not blocked).
  // Keep the PAT read-only too, so GitHub independently rejects writes.
  const rules: HarnessV1RequestTransformation[] = [
    // 1. GET: discover available branches and commits.
    {
      match: {
        host: repo.hostname,
        path: { exact: `${path}/info/refs` },
        method: ['GET'],
        // This endpoint also serves pushes; match only the read service.
        queryString: [
          { key: { exact: 'service' }, value: { exact: 'git-upload-pack' } },
        ],
      },
      transform: { headers },
    },
    // 2. POST: request and download missing commits/files (despite "upload" in the name).
    {
      match: {
        host: repo.hostname,
        path: { exact: `${path}/git-upload-pack` },
        method: ['POST'],
      },
      transform: { headers },
    },
  ];
  // Keep Git auth alongside the adapter's OpenAI auth.
  function attach(session: HarnessV1NetworkSandboxSession) {
    const add = session.addRequestTransformations!.bind(session);
    // On resume, redacted credentials must be supplied again.
    return Object.assign(session, {
      addRequestTransformations: (
        transformations: ReadonlyArray<HarnessV1RequestTransformation>,
      ) => add([...transformations, ...rules]),
    });
  }
  // Apply on both creation and resume.
  return {
    specificationVersion: provider.specificationVersion,
    providerId: provider.providerId,
    createSession: async (options) =>
      attach(await provider.createSession(options)),
    resumeSession: async (options) =>
      attach(await provider.resumeSession!(options)),
  };
}
