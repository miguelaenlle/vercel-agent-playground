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
  // Accept only a plain https://github.com/OWNER/REPO URL, with optional .git.
  const isGitHub = repo.origin === 'https://github.com';
  const isRepositoryPath = /^\/[^/]+\/[^/]+$/.test(repo.pathname);
  const hasExtras = repo.username || repo.password || repo.search || repo.hash;
  if (!isGitHub || !isRepositoryPath || hasExtras) {
    throw new Error('COURSE_REPO_URL must be an HTTPS GitHub repository URL.');
  }
  // Git uses the .git URL for both repository discovery and fetching objects.
  const path = repo.pathname.replace(/\.git$/, '') + '.git';
  // Vercel injects this header outside the VM; the agent never receives the PAT.
  const headers = {
    Authorization: `Basic ${Buffer.from(`x-access-token:${pat}`).toString('base64')}`,
  };
  // These rules add credentials to Git reads; they do not restrict other traffic.
  const rules: HarnessV1RequestTransformation[] = [
    // Discover refs for a fetch/pull, excluding the push (git-receive-pack) service.
    {
      match: {
        host: repo.hostname,
        path: { exact: `${path}/info/refs` },
        method: ['GET'],
        queryString: [
          { key: { exact: 'service' }, value: { exact: 'git-upload-pack' } },
        ],
      },
      transform: { headers },
    },
    // Download the Git objects needed by the fetch/pull.
    {
      match: {
        host: repo.hostname,
        path: { exact: `${path}/git-upload-pack` },
        method: ['POST'],
      },
      transform: { headers },
    },
  ];
  // Combine our rules with the OpenAI rules installed by the Codex adapter.
  function attach(session: HarnessV1NetworkSandboxSession) {
    const add = session.addRequestTransformations!.bind(session);
    // Supply both credentials together: Vercel redacts existing rules on resume.
    return Object.assign(session, {
      addRequestTransformations: (
        transformations: ReadonlyArray<HarnessV1RequestTransformation>,
      ) => add([...transformations, ...rules]),
    });
  }
  // Install the wrapper for fresh sessions and sessions restored from persistence.
  return {
    specificationVersion: provider.specificationVersion,
    providerId: provider.providerId,
    createSession: async (options) =>
      attach(await provider.createSession(options)),
    resumeSession: async (options) =>
      attach(await provider.resumeSession!(options)),
  };
}
