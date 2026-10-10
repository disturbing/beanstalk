/** The RunDO's Artifacts and runner ports, reporting what they use to the run's meter. */
import type { ArtifactsPort } from '../adapters/artifacts';
import type { RunnerStub } from '../runner/runner-client';
import type { RunnerCall } from './infra-meter';

/** Counts one Artifacts operation per binding call, whether it succeeds or not. */
export function meteredArtifacts(port: ArtifactsPort, countOp: () => void): ArtifactsPort {
  const counted =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => {
      countOp();
      return call(...args);
    };
  return {
    createRepo: counted(port.createRepo.bind(port)),
    mintToken: counted(port.mintToken.bind(port)),
    branchHead: counted(port.branchHead.bind(port)),
    readFile: counted(port.readFile.bind(port)),
    changedFiles: counted(port.changedFiles.bind(port)),
    changedPaths: counted(port.changedPaths.bind(port)),
    listRepos: counted(port.listRepos.bind(port)),
    deleteRepo: counted(port.deleteRepo.bind(port)),
    describeRepo: counted(port.describeRepo.bind(port)),
    commitMessage: counted(port.commitMessage.bind(port)),
    history: counted(port.history.bind(port)),
  };
}

/** Times every request to a runner instance. */
export function meteredRunner(
  instance: string,
  stub: RunnerStub,
  record: (call: RunnerCall) => void,
): RunnerStub {
  return {
    async fetch(request) {
      const startMs = Date.now();
      try {
        return await stub.fetch(request);
      } finally {
        record({ instance, startMs, endMs: Date.now() });
      }
    },
  };
}
