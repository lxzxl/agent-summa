import type { Api, FtsProgress, SessionQuery } from "@shared/ipc";
import { type IpcRendererEvent, contextBridge, ipcRenderer } from "electron";

const api: Api = {
  scan: () => ipcRenderer.invoke("scan"),
  agents: () => ipcRenderer.invoke("agents"),
  sessions: (opts?: SessionQuery) => ipcRenderer.invoke("sessions", opts ?? {}),
  search: (query: string, limit?: number) => ipcRenderer.invoke("search", query, limit),
  skills: () => ipcRenderer.invoke("skills"),
  resume: (s) => ipcRenderer.invoke("resume", s),
  transcript: (sessionPath: string) => ipcRenderer.invoke("transcript", sessionPath),
  subagents: (sessionPath: string) => ipcRenderer.invoke("subagents", sessionPath),
  resumeCommand: (s) => ipcRenderer.invoke("resumeCommand", s),
  copy: (text: string) => ipcRenderer.invoke("copy", text),
  fork: (s) => ipcRenderer.invoke("fork", s),
  skillTargets: () => ipcRenderer.invoke("skillTargets"),
  skillSpread: (name: string) => ipcRenderer.invoke("skillSpread", name),
  skillInstall: (name: string, agentSlug: string) => ipcRenderer.invoke("skillInstall", name, agentSlug),
  skillRemove: (name: string, agentSlug: string) => ipcRenderer.invoke("skillRemove", name, agentSlug),
  skillRemoveAll: (name: string) => ipcRenderer.invoke("skillRemoveAll", name),
  skillDetail: (name: string) => ipcRenderer.invoke("skillDetail", name),
  skillUninstall: () => ipcRenderer.invoke("skillUninstall"),
  contextRead: (path: string) => ipcRenderer.invoke("contextRead", path),
  contextConverge: (arg) => ipcRenderer.invoke("contextConverge", arg),
  contextUnlink: (path: string) => ipcRenderer.invoke("contextUnlink", path),
  memoryStoreRead: (path: string) => ipcRenderer.invoke("memoryStoreRead", path),
  projectMemory: (project: string | null, workspace: string | null) => ipcRenderer.invoke("projectMemory", project, workspace),
  agentConfig: (slug: string) => ipcRenderer.invoke("agentConfig", slug),
  checkForUpdate: () => ipcRenderer.invoke("checkForUpdate"),
  openExternal: (url: string) => ipcRenderer.invoke("openExternal", url),
  onFtsProgress: (cb: (p: FtsProgress) => void) => {
    const listener = (_e: IpcRendererEvent, p: FtsProgress): void => cb(p);
    ipcRenderer.on("fts:progress", listener);
    return () => ipcRenderer.removeListener("fts:progress", listener);
  },
};

contextBridge.exposeInMainWorld("api", api);
