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
  if (
    repo.protocol !== 'https:' ||
    repo.hostname !== 'github.com' ||
    repo.username ||
    repo.password ||
    repo.search ||
    repo.hash ||
    !/^\/[^/]+\/[^/]+$/.test(repo.pathname)
  ) {
    throw new Error('COURSE_REPO_URL must be an HTTPS GitHub repository URL.');
  }
  const path = repo.pathname.replace(/\.git$/, '') + '.git';
  const headers = {
    Authorization: `Basic ${Buffer.from(`x-access-token:${pat}`).toString('base64')}`,
  };
  const rules: HarnessV1RequestTransformation[] = [
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
    {
      match: {
        host: repo.hostname,
        path: { exact: `${path}/git-upload-pack` },
        method: ['POST'],
      },
      transform: { headers },
    },
  ];
  function attach(session: HarnessV1NetworkSandboxSession) {
    const add = session.addRequestTransformations!.bind(session);
    // Supply both credentials together: Vercel redacts existing rules on resume.
    return Object.assign(session, {
      addRequestTransformations: (
        transformations: ReadonlyArray<HarnessV1RequestTransformation>,
      ) => add([...transformations, ...rules]),
    });
  }
  return {
    specificationVersion: provider.specificationVersion,
    providerId: provider.providerId,
    createSession: async (options) =>
      attach(await provider.createSession(options)),
    resumeSession: async (options) =>
      attach(await provider.resumeSession!(options)),
  };
}
