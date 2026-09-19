import { readBrainWorkspace, type BrainWorkspaceRequest } from "./brainWorkspace";
self.onmessage = async (event: MessageEvent<BrainWorkspaceRequest>) => {
  try { self.postMessage({ result: await readBrainWorkspace(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
