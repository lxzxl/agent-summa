import { createContext, useContext } from "react";

export type Locale = "en" | "zh";
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "zh", label: "中文" },
];

interface Entry {
  en: string;
  zh: string;
}

// All user-facing UI strings. English is the default/canonical; zh is the translation.
// Use {name}-style placeholders, filled via t(key, { name }).
const DICT: Record<string, Entry> = {
  // nav / sidebar
  "nav.sessions": { en: "Sessions", zh: "会话" },
  "nav.skills": { en: "Skills", zh: "Skills" },
  "nav.agents": { en: "Agents", zh: "智能体" },
  "agents.count": { en: "{n} agents", zh: "{n} 个 agent" },
  "agents.selectPrompt": { en: "Select an agent", zh: "选一个 agent" },
  "side.all": { en: "All", zh: "全部" },
  "source.cli": { en: "CLI", zh: "CLI" },
  "source.desktop": { en: "Desktop", zh: "桌面" },
  "source.vm": { en: "VM locked", zh: "VM 锁定" },
  "titlebar.rescan": { en: "Rescan", zh: "重新扫描" },

  // settings
  "settings.title": { en: "Settings", zh: "设置" },
  "settings.language": { en: "Language", zh: "语言" },
  "settings.theme": { en: "Theme", zh: "主题" },
  "settings.close": { en: "Close", zh: "关闭" },
  "settings.updates": { en: "Updates", zh: "更新" },

  // sessions list
  "sessions.search": { en: "Search conversations…", zh: "搜索会话内容…" },
  "sessions.group.time": { en: "Time", zh: "时间" },
  "sessions.group.project": { en: "Project", zh: "项目" },
  "sessions.collapseAll": { en: "⊟ Collapse all", zh: "⊟ 全部收起" },
  "sessions.expandAll": { en: "⊞ Expand all", zh: "⊞ 全部展开" },
  "sessions.foldAll.title": { en: "Collapse / expand all project groups", zh: "折叠 / 展开所有项目组" },
  "sessions.hits": { en: "{n} hits", zh: "{n} 命中" },
  "search.via.title": { en: "title", zh: "标题" },
  "search.via.project": { en: "project", zh: "项目" },
  "search.via.prompt": { en: "prompt", zh: "提问" },
  "search.via.content": { en: "message", zh: "消息" },
  "sessions.count": { en: "{n} sessions", zh: "{n} 会话" },
  "sessions.selectPrompt": { en: "Select a session", zh: "选一个会话" },
  "sessions.noProject": { en: "(no project)", zh: "(无项目)" },
  "sessions.untitled": { en: "(untitled)", zh: "(无标题)" },

  // session detail
  "detail.back": { en: "Back", zh: "返回" },
  "detail.resume": { en: "▶ Resume", zh: "▶ 续接" },
  "detail.copyCmd": { en: "⧉ command", zh: "⧉ 命令" },
  "detail.copyCmd.title": {
    en: "Copy a paste-ready resume command (incl. cd workspace)",
    zh: "复制可粘贴运行的续接命令（含 cd 工作区）",
  },
  "detail.copyPath": { en: "⧉ path", zh: "⧉ 路径" },
  "detail.copyId": { en: "⧉ ID", zh: "⧉ ID" },
  "detail.fork": { en: "⑂ Fork→{target}", zh: "⑂ Fork→{target}" },
  "detail.fork.title": {
    en: "Fork this session (with context) into a resumable {agent} session. Tool calls collapse to text — a context-carry, not a byte-faithful copy.",
    zh: "把这个会话带上下文 fork 成可在 {agent} 续接的新会话（工具调用会折叠为文本，是带上下文重开、非字节级复刻）",
  },
  "tab.transcript": { en: "Transcript", zh: "转录" },
  "tab.subagents": { en: "Sub-agents {n}", zh: "子 agent {n}" },
  "tab.memory": { en: "Memory", zh: "记忆" },
  "label.you": { en: "you", zh: "你" },
  "label.assistant": { en: "assistant", zh: "助手" },

  // status pills/chips
  "status.live": { en: "● live", zh: "● 运行中" },
  "status.interrupted": { en: "⎋ interrupted", zh: "⎋ 中断" },
  "status.interrupted.chip": { en: "⎋ ended on interrupt", zh: "⎋ 中断结束" },
  "status.interrupted.title": { en: "Session ended on an interrupt (Ctrl-C)", zh: "会话以中断（Ctrl-C）结束" },
  "status.empty": { en: "empty", zh: "空" },
  "status.orphan": { en: "⌫ gone", zh: "⌫ 已失效" },
  "status.orphan.chip": { en: "⌫ project deleted", zh: "⌫ 项目已删除" },
  "status.orphan.title": { en: "Project directory no longer on disk", zh: "项目目录已不在磁盘" },
  "status.sub.title": { en: "Spawned {n} sub-agents{wf}", zh: "派生了 {n} 个子 agent{wf}" },
  "status.sub.wf": { en: ", {w} workflows", zh: "，{w} 个 workflow" },
  "rounds.title": {
    en: "{n} conversation turns (your prompts, excluding tool calls)",
    zh: "{n} 轮对话（你的提问次数，不含工具调用）",
  },

  // transcript
  "tx.empty": { en: "(empty session, no messages)", zh: "（空会话，无消息）" },
  "tx.truncated": { en: "Long session · showing first {n} of {total}", zh: "长会话 · 显示前 {n} 条，共 {total} 条" },
  "tx.loading": { en: "Loading transcript…", zh: "加载转录…" },
  "tx.vmLocked": { en: "🔒 VM sandbox session — transcript locked", zh: "🔒 VM 沙箱会话，转录已锁定" },
  "tx.unsupported": { en: "This agent's transcript isn't supported yet", zh: "该 agent 暂不支持转录解析" },
  "tx.notFound": { en: "Session record not found", zh: "未找到会话记录" },
  "tx.error": { en: "Can't read: {reason}", zh: "无法读取：{reason}" },
  "img.alt": { en: "image", zh: "图片" },

  // subagents
  "sub.loading": { en: "Loading sub-agents…", zh: "加载子 agent…" },
  "sub.taskGroup": { en: "Task sub-agents · {n}", zh: "Task 子 agent · {n}" },
  "sub.untitled": { en: "(untitled sub-agent)", zh: "(无标题子 agent)" },
  "sub.truncated": { en: "showing {n} of {total}", zh: "显示前 {n} 个 · 共 {total} 个" },
  "sub.child": { en: "(sub-agent)", zh: "(子 agent)" },
  "sub.taskChip": { en: "Task sub-agent", zh: "Task 子 agent" },

  // resume / copy / fork toasts
  "resume.launched": { en: "Launched in terminal: {cmd}", zh: "已在终端启动：{cmd}" },
  "resume.copyRun": { en: "Copy & run: {cmd}", zh: "复制运行：{cmd}" },
  "resume.notResumable": { en: "This session can't be resumed", zh: "该会话不可续接" },
  "copy.done": { en: "Copied {label}", zh: "已复制{label}" },
  "label.command": { en: "command", zh: "命令" },
  "label.path": { en: "path", zh: "路径" },
  "label.id": { en: "ID", zh: "ID" },
  "fork.running": { en: "Forking → {target}…", zh: "正在 fork → {target}…" },
  "fork.failed": { en: "Fork failed: {error}", zh: "fork 失败：{error}" },
  "fork.done": { en: "Forked → {target} ({turns} turns) · resume: {resume}", zh: "已 fork → {target}（{turns} 轮）· resume: {resume}" },

  // skills list
  "skills.filter": { en: "Filter skills…", zh: "筛选 skill…" },
  "skills.filterByAgent": { en: "Show only skills on {agent}", zh: "只看 {agent} 的 skill" },
  "skills.count": { en: "{n} skills", zh: "{n} skills" },
  "skills.uninstallLinks": { en: "Uninstall links", zh: "卸载分发链接" },
  "skills.uninstallLinks.title": {
    en: "Remove every distribution link agent-summa created (by manifest; your own skills are untouched)",
    zh: "移除 agent-summa 之前创建的所有分发链接（按 manifest，不动你自己装的 skill）",
  },
  "skills.selectPrompt": { en: "Select a skill", zh: "选一个 skill" },
  "skill.noDesc": { en: "(no description)", zh: "（无描述）" },
  "skill.conflict.title": { en: "Versions/descriptions differ across agents", zh: "各 agent 里的版本/描述不一致" },
  "skill.installed": { en: "installed", zh: "已装" },
  "skill.notInstalled": { en: "not installed", zh: "未装" },
  "skill.dot.title": { en: "{agent}: {state}", zh: "{agent}: {state}" },
  "skill.cell.installed.title": { en: "{agent}: installed — click to remove", zh: "{agent}：已装 — 点击移除" },
  "skill.cell.missing.title": { en: "{agent}: not installed — click to install", zh: "{agent}：未装 — 点击安装" },
  "skill.spread": { en: "⊕ Add to {n}", zh: "⊕ 分发到 {n} 个" },
  "skill.spread.title": { en: "Distribute to the {n} agents missing it: {agents}", zh: "铺到缺它的 {n} 个 agent：{agents}" },
  "skill.uninstallAll": { en: "🗑 Uninstall everywhere", zh: "🗑 完全卸载" },
  "skill.uninstallAll.title": {
    en: "Delete this skill from all agents (including real files)",
    zh: "从所有 agent 删除此 skill（含实际文件）",
  },
  "skill.installMethods": { en: "Install method / source", zh: "安装方式 / 来源" },
  "skill.type.link": { en: "🔗 link", zh: "🔗 链接" },
  "skill.type.dir": { en: "📁 real dir", zh: "📁 实际目录" },
  "skill.managed.title": { en: "Distributed by agent-summa (Uninstall links removes it)", zh: "由 agent-summa 分发（卸载链接会移除）" },
  "skill.source": { en: "Source (real copy):", zh: "来源（真实副本）：" },
  "common.loading": { en: "Loading…", zh: "加载…" },

  // skill toasts
  "spread.failed": { en: "Distribute failed: {error}", zh: "分发失败：{error}" },
  "spread.done": { en: "Distributed {name} → {n} agents", zh: "已分发 {name} → {n} 个 agent" },
  "spread.allHave": { en: "Already on every agent", zh: "已在全部 agent" },
  "install.failed": { en: "Install failed: {error}", zh: "安装失败：{error}" },
  "install.done": { en: "Installed {name} → {agent}", zh: "已装 {name} → {agent}" },
  "install.already": { en: "{name} already on {agent}", zh: "{name} 已在 {agent}" },
  "remove.confirm": {
    en: 'Remove skill "{name}" from {agent}?\n(agent-summa link = only the link is removed; real dir = files are deleted)',
    zh: "从 {agent} 移除 skill「{name}」？\n（agent-summa 链接=只删链接；实际目录=删除文件）",
  },
  "remove.failed": { en: "Remove failed: {error}", zh: "移除失败：{error}" },
  "remove.doneLink": { en: "Removed from {agent} (link)", zh: "已从 {agent} 移除（链接）" },
  "remove.doneFile": { en: "Removed from {agent} (files)", zh: "已从 {agent} 移除（文件）" },
  "remove.notFound": { en: "Not found", zh: "未找到" },
  "removeAll.confirm": {
    en: 'Completely uninstall skill "{name}"?\nDeletes it from every agent (including real files). Irreversible.',
    zh: "完全卸载 skill「{name}」？\n将从所有 agent 删除（含实际文件），不可恢复。",
  },
  "removeAll.done": { en: 'Fully uninstalled "{name}" ({n} places)', zh: "已完全卸载「{name}」（{n} 处）" },
  "uninstallLinks.done": { en: "Removed {n} agent-summa distribution links", zh: "已移除 {n} 处 agent-summa 分发链接" },

  // memory — context (instruction files) + learned (auto-fact stores)
  "mem.state.canon": { en: "source", zh: "源" },
  "mem.state.missing": { en: "missing", zh: "缺失" },
  "mem.state.link": { en: "linked", zh: "已链接" },
  "mem.state.empty": { en: "empty", zh: "空" },
  "mem.state.real": { en: "separate", zh: "独立" },
  "mem.state.foreign": { en: "your link", zh: "你的链接" },
  "mem.converge.title": {
    en: "Symlink the {n} other files to the source — edit once, every agent reads it",
    zh: "把另外 {n} 个文件软链到规范源 —— 改一处，所有 agent 都读到",
  },
  "mem.converge.confirm": {
    en: "Converge {n} file(s) to the source? Divergent originals are backed up (.summa-bak).",
    zh: "把 {n} 个文件收敛到规范源？有差异的原文件会被备份（.summa-bak）。",
  },
  "mem.converge.done": { en: "Converged {n} file(s) · {bak} backed up", zh: "已收敛 {n} 个文件 · 备份 {bak} 个" },
  "mem.converge.failed": { en: "Converge failed: {error}", zh: "收敛失败：{error}" },
  "mem.preview": { en: "Preview", zh: "预览" },
  "mem.noCanonical": { en: "No source file yet — create one of these instruction files first", zh: "还没有源文件 —— 先创建其中一个指令文件" },
  "mem.emptyFile": { en: "(empty file)", zh: "（空文件）" },
  "mem.unlink.confirm": { en: "Unlink this file? The backed-up original (if any) is restored.", zh: "解链此文件？若有备份的原文件会被恢复。" },
  "mem.unlink.done": { en: "Unlinked", zh: "已解链" },
  "mem.unlink.restored": { en: "Unlinked · original restored", zh: "已解链 · 原文件已恢复" },
  "mem.unlink.failed": { en: "Unlink failed: {error}", zh: "解链失败：{error}" },
  "mem.factsLabel": { en: "Facts ({n})", zh: "事实（{n}）" },
  "mem.learned.note": {
    en: "Read-only — learned memory is per-agent and not portable across agents.",
    zh: "只读 —— 学到的记忆是各 agent 私有的，无法跨 agent 移植。",
  },
  "mem.noProjectDir": { en: "No project directory for this session", zh: "该会话没有项目目录" },
  "mem.noLearned": { en: "No learned-memory store for this project's cwd.", zh: "该项目的工作目录没有学到的记忆库。" },

  // context-file rows (Memory tab) — plain-language state + explicit action verb
  "ctx.sourceOfTruth": { en: "Source of truth", zh: "规范源" },
  "ctx.st.source": { en: "the source — everyone reads this", zh: "源文件 —— 所有 agent 读它" },
  "ctx.st.missing": { en: "not created", zh: "未创建" },
  "ctx.st.empty": { en: "empty file", zh: "空文件" },
  "ctx.st.synced": { en: "✓ synced to source", zh: "✓ 已同步到源" },
  "ctx.st.syncedYours": { en: "✓ synced · your own link", zh: "✓ 已同步 · 你自己的链接" },
  "ctx.st.copy": { en: "✓ same content (separate copy)", zh: "✓ 内容相同（独立副本）" },
  "ctx.st.differs": { en: "⚠ differs from source", zh: "⚠ 与源不一致" },
  "ctx.st.elsewhere": { en: "⚠ links somewhere else", zh: "⚠ 链接指向别处" },
  "ctx.act.create": { en: "Create → link", zh: "创建并链接" },
  "ctx.act.link": { en: "Link to source", zh: "链接到源" },
  "ctx.act.unlink": { en: "Unlink", zh: "解除链接" },
  "ctx.act.converge": { en: "Sync (backs up)", zh: "同步（先备份）" },
  "ctx.syncAll": { en: "⇄ Sync {n} → {file}", zh: "⇄ 同步 {n} 个 → {file}" },

  // per-agent config (sidebar agent → detail)
  "agent.installed": { en: "installed", zh: "已安装" },
  "agent.notInstalled": { en: "not detected", zh: "未检测到" },
  "agent.sessions": { en: "{n} sessions", zh: "{n} 会话" },
  "agent.skills": { en: "{n} skills", zh: "{n} skills" },
  "agent.globalInstr": { en: "Global instructions", zh: "全局指令文件" },
  "agent.noGlobalSlot": { en: "No global instruction file for this agent", zh: "该 agent 无全局指令文件" },
  "agent.isSource": { en: "★ This is the shared source ({file})", zh: "★ 这就是共享规范源（{file}）" },
  "agent.linkSource": { en: "⇄ Use shared source ({file})", zh: "⇄ 用共享规范源（{file}）" },
  "agent.linkSource.title": {
    en: "Symlink this agent's global instructions to {file} — edit once, this agent reads it too",
    zh: "把该 agent 的全局指令软链到 {file} —— 改一处，它也读到",
  },
  "agent.unlink": { en: "Unlink from shared", zh: "从共享解链" },
  "agent.foreignNote": { en: "Linked by you (not managed by agent-summa)", zh: "你自己建的链接（非 agent-summa 管理）" },
  "agent.noSource": { en: "No shared source yet — create a global instruction file first", zh: "还没有共享源 —— 先建一个全局指令文件" },

  // statusbar
  "statusbar.scan": { en: "{count} sessions · {appCode} app-code · {vm} VM", zh: "{count} 会话 · {appCode} app-code · {vm} VM" },
  "statusbar.scanning": { en: "scanning…", zh: "扫描中…" },
  "statusbar.agents": { en: "{n} agents", zh: "{n} 个 agent" },
  "idx.progress": { en: "Indexing search… {done}/{total}", zh: "正在索引搜索… {done}/{total}" },
  "idx.done": { en: "✓ Search indexed (+{n})", zh: "✓ 搜索已索引（+{n}）" },

  // update check
  "update.check": { en: "Check for updates", zh: "检查更新" },
  "update.checking": { en: "Checking…", zh: "检查中…" },
  "update.upToDate": { en: "Up to date (v{v})", zh: "已是最新（v{v}）" },
  "update.available": { en: "v{v} available", zh: "有新版本 v{v}" },
  "update.download": { en: "Download v{v}", zh: "下载 v{v}" },
  "update.failed": { en: "Couldn't check", zh: "检查失败" },
};

export type TFn = (key: string, params?: Record<string, string | number>) => string;

export function makeT(locale: Locale): TFn {
  return (key, params) => {
    const e = DICT[key];
    let s = e ? e[locale] || e.en : key;
    if (params) for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(String(params[k]));
    return s;
  };
}

export const I18nContext = createContext<TFn>((k) => k);
export const useT = (): TFn => useContext(I18nContext);

export const LOCALE_KEY = "asum.locale";
export function loadLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    if (v === "zh" || v === "en") return v;
  } catch {
    /* ignore */
  }
  return "en";
}
