/**
 * Auto Memory — browser half.
 *
 * Registers a clickable icon in the left sidebar (`sidebar.panellist`) and the
 * central preview panel it selects (`main`, keyed by the same id). The panel
 * lists every project memory, previews one entry at a time, and can delete an
 * entry. All content comes from this package's authenticated Host routes.
 */
window.__ModuleLoader__.load({
  id: '@local/auto-memory',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'autoMemory.panel';
    const PANEL_ID = 'auto-memory';
    const ROUTE_PROJECTS = 'api/auto-memory.projects';
    const ROUTE_FILE = 'api/auto-memory.file';
    const ROUTE_DELETE = 'api/auto-memory.delete';
    const POLL_MS = 15000;

    const zh = {
      panel: '自动记忆',
      title: '自动记忆',
      subtitle: '智能体在工作时自动保存的项目事实，保存在本机项目目录中',
      project: '项目',
      refresh: '刷新',
      refreshing: '刷新中…',
      loading: '正在读取记忆…',
      loadFailed: '读取失败',
      retry: '重试',
      searchPlaceholder: '搜索记忆…',
      noProjects: '还没有项目记忆。',
      noProjectsHint: '开始一个会话后，智能体会把长期有效的偏好、约定和决策自动保存到这里。',
      emptyProject: '这个项目还没有记忆。',
      emptyProjectHint: '让智能体记住一条规则，或直接告诉它“记住……”。',
      selectMemory: '从左侧选择一条记忆查看内容。',
      indexTitle: '记忆索引',
      indexDescription: '由所有记忆生成的总览',
      generated: '自动生成',
      delete: '删除',
      deleteConfirm: '删除记忆“{name}”？此操作不可撤销。',
      deleted: '已删除“{name}”',
      updated: '更新于',
      updatedJustNow: '刚刚更新',
      updatedMinutes: '更新于 {minutes} 分钟前',
      updatedHours: '更新于 {hours} 小时前',
      updatedDays: '更新于 {days} 天前',
      updatedUnknown: '更新时间未知',
      root: '存储位置：{path}',
      memories: '{count} 条记忆',
      memory: '{count} 条记忆',
      autoCapture: '自动捕获已开启',
      type_user: '用户',
      type_feedback: '反馈',
      type_project: '项目',
      type_reference: '参考',
      type_index: '索引',
    };

    const en = {
      panel: 'Auto Memory',
      title: 'Auto Memory',
      subtitle: 'Project facts the agent saves automatically, stored locally with the project',
      project: 'Project',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      loading: 'Loading memories…',
      loadFailed: 'Failed to load',
      retry: 'Retry',
      searchPlaceholder: 'Search memories…',
      noProjects: 'No project memories yet.',
      noProjectsHint: 'Start a session and the agent will save durable preferences, conventions, and decisions here automatically.',
      emptyProject: 'This project has no memories yet.',
      emptyProjectHint: 'Ask the agent to remember a rule, or say “remember that…”.',
      selectMemory: 'Select a memory on the left to preview it.',
      indexTitle: 'Memory index',
      indexDescription: 'Generated overview of every memory',
      generated: 'Generated',
      delete: 'Delete',
      deleteConfirm: 'Delete the memory “{name}”? This cannot be undone.',
      deleted: 'Deleted “{name}”',
      updated: 'Updated',
      updatedJustNow: 'updated just now',
      updatedMinutes: 'updated {minutes} min ago',
      updatedHours: 'updated {hours} h ago',
      updatedDays: 'updated {days} d ago',
      updatedUnknown: 'update time unknown',
      root: 'Stored at: {path}',
      memories: '{count} memories',
      memory: '{count} memory',
      autoCapture: 'Auto-capture is on',
      type_user: 'user',
      type_feedback: 'feedback',
      type_project: 'project',
      type_reference: 'reference',
      type_index: 'index',
    };

    async function requestJson(url, options = {}) {
      const headers = {
        accept: 'application/json',
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      };
      const response = await fetch(url, { ...options, headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      return payload;
    }

    function relativeTime(value, t) {
      const time = Date.parse(value || '');
      if (!Number.isFinite(time)) return t('updatedUnknown');
      const minutes = Math.floor((Date.now() - time) / 60000);
      if (minutes < 1) return t('updatedJustNow');
      if (minutes < 60) return t('updatedMinutes', { minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t('updatedHours', { hours });
      const days = Math.floor(hours / 24);
      if (days < 30) return t('updatedDays', { days });
      try {
        return new Date(time).toLocaleDateString();
      } catch {
        return new Date(time).toISOString().slice(0, 10);
      }
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function inlineNodes(text, prefix) {
      const nodes = [];
      const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
      let last = 0;
      let match;
      let index = 0;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index));
        const token = match[0];
        const key = `${prefix}-${index}`;
        index += 1;
        if (token.startsWith('**') && token.endsWith('**')) {
          nodes.push(h('strong', { key }, token.slice(2, -2)));
        } else if (token.startsWith('`') && token.endsWith('`')) {
          nodes.push(h('code', { key }, token.slice(1, -1)));
        } else {
          const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
          if (link !== null) {
            nodes.push(
              h(
                'a',
                { key, href: link[2], target: '_blank', rel: 'noreferrer noopener' },
                link[1],
              ),
            );
          } else {
            nodes.push(token);
          }
        }
        last = pattern.lastIndex;
      }
      if (last < text.length) nodes.push(text.slice(last));
      return nodes;
    }

    function renderMarkdown(text) {
      const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
      const blocks = [];
      let paragraph = [];
      let list = [];
      let code = null;
      let key = 0;
      const flushParagraph = () => {
        if (paragraph.length === 0) return;
        const body = paragraph.join(' ').trim();
        paragraph = [];
        if (body !== '') {
          const blockKey = `p-${key}`;
          key += 1;
          blocks.push(h('p', { key: blockKey }, inlineNodes(body, blockKey)));
        }
      };
      const flushList = () => {
        if (list.length === 0) return;
        const items = list;
        list = [];
        const blockKey = `ul-${key}`;
        key += 1;
        blocks.push(
          h(
            'ul',
            { key: blockKey },
            items.map((item, itemIndex) =>
              h('li', { key: `${blockKey}-${itemIndex}` }, inlineNodes(item, `${blockKey}-${itemIndex}`)),
            ),
          ),
        );
      };
      for (const line of lines) {
        if (code !== null) {
          if (/^```/.test(line)) {
            const blockKey = `pre-${key}`;
            key += 1;
            blocks.push(h('pre', { key: blockKey }, h('code', null, code.join('\n'))));
            code = null;
          } else {
            code.push(line);
          }
          continue;
        }
        if (/^```/.test(line)) {
          flushParagraph();
          flushList();
          code = [];
          continue;
        }
        if (/^\s*$/.test(line)) {
          flushParagraph();
          flushList();
          continue;
        }
        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading !== null) {
          flushParagraph();
          flushList();
          const level = heading[1].length;
          const tag = `h${level}`;
          const blockKey = `h-${key}`;
          key += 1;
          blocks.push(h(tag, { key: blockKey }, inlineNodes(heading[2], blockKey)));
          continue;
        }
        if (/^\s*[-*+]\s+/.test(line)) {
          flushParagraph();
          list.push(line.replace(/^\s*[-*+]\s+/, ''));
          continue;
        }
        if (/^\s*\d+\.\s+/.test(line)) {
          flushParagraph();
          list.push(line.replace(/^\s*\d+\.\s+/, ''));
          continue;
        }
        if (/^>\s?/.test(line)) {
          flushParagraph();
          flushList();
          const blockKey = `q-${key}`;
          key += 1;
          blocks.push(h('blockquote', { key: blockKey }, inlineNodes(line.replace(/^>\s?/, ''), blockKey)));
          continue;
        }
        if (/^---+$/.test(line.trim())) {
          flushParagraph();
          flushList();
          const blockKey = `hr-${key}`;
          key += 1;
          blocks.push(h('hr', { key: blockKey }));
          continue;
        }
        paragraph.push(line.trim());
      }
      if (code !== null) {
        const blockKey = `pre-${key}`;
        key += 1;
        blocks.push(h('pre', { key: blockKey }, h('code', null, code.join('\n'))));
      }
      flushParagraph();
      flushList();
      if (blocks.length === 0) return h('p', { className: 'am-muted' }, '—');
      return blocks;
    }

    /** Sidebar rail icon: a memory card with a bookmark, following currentColor. */
    function PanelIcon({ size }) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          'aria-hidden': true,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('rect', { x: 4.2, y: 3.4, width: 15.6, height: 17.2, rx: 2.5 }),
        h('path', { d: 'M8 8.2h8M8 11.7h8M8 15.2h4.6' }),
        h('path', { d: 'M16.4 3.4v5.2l-2.1-1.5-2.1 1.5V3.4' }),
      );
    }

    function PanelStyles() {
      return h(
        'style',
        null,
        `
.am-page { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); overflow: hidden; }
.am-page, .am-page * { box-sizing: border-box; }
.am-header { flex: none; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 24px 28px 0; }
.am-title { margin: 0; font-size: 19px; font-weight: 650; }
.am-subtitle { margin: 6px 0 0; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.am-auto-badge { display: inline-block; margin-left: 8px; padding: 1px 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; font-size: 10.5px; color: var(--dsw-alias-state-success-primary); }
.am-toolbar { flex: none; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 16px 28px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.am-label { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.am-select, .am-search { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 7px 10px; font-size: 13px; font-family: inherit; }
.am-select { max-width: 420px; }
.am-search { flex: 1; min-width: 160px; max-width: 320px; }
.am-select:focus, .am-search:focus, .am-button:focus-visible, .am-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.am-button { flex: none; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 6px 14px; font-size: 13px; font-family: inherit; cursor: pointer; }
.am-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.am-button:disabled { opacity: 0.6; cursor: default; }
.am-danger { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.am-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(220px, 320px) minmax(0, 1fr); }
.am-list { min-height: 0; overflow-y: auto; padding: 10px 10px 24px; border-right: 1px solid var(--dsw-alias-border-l1); }
.am-list-heading { margin: 8px 10px 6px; font-size: 11px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
.am-row { width: 100%; display: flex; align-items: flex-start; gap: 8px; text-align: left; background: transparent; border: 0; border-radius: 8px; padding: 9px 10px; cursor: pointer; color: inherit; font-family: inherit; }
.am-row:hover { background: var(--dsw-alias-bg-layer-2); }
.am-row.is-active { background: var(--dsw-alias-bg-layer-2); }
.am-row-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.am-row-title { font-size: 13px; line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.am-row-sub { font-size: 11.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.am-badge { flex: none; margin-top: 1px; font-size: 10px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.am-badge-user { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.am-badge-feedback { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.am-badge-project { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.am-badge-reference { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.am-badge-index { color: var(--dsw-alias-label-secondary); }
.am-divider { height: 1px; margin: 10px 10px; background: var(--dsw-alias-border-l1); }
.am-preview { min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.am-preview-head { flex: none; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 20px 24px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.am-preview-titles { min-width: 0; }
.am-preview-title { margin: 0; font-size: 16px; font-weight: 650; line-height: 1.35; overflow-wrap: anywhere; }
.am-preview-meta { margin-top: 8px; display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.am-preview-body { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 24px 40px; font-size: 13.5px; line-height: 1.65; }
.am-preview-body h1, .am-preview-body h2, .am-preview-body h3, .am-preview-body h4 { margin: 1.2em 0 0.5em; line-height: 1.3; }
.am-preview-body h1 { font-size: 18px; } .am-preview-body h2 { font-size: 16px; } .am-preview-body h3 { font-size: 14.5px; } .am-preview-body h4 { font-size: 13.5px; }
.am-preview-body p { margin: 0 0 0.9em; }
.am-preview-body ul { margin: 0 0 0.9em; padding-left: 1.4em; }
.am-preview-body li { margin: 0.2em 0; }
.am-preview-body code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; background: var(--dsw-alias-bg-layer-2); border-radius: 4px; padding: 1px 4px; }
.am-preview-body pre { margin: 0 0 1em; padding: 12px 14px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow-x: auto; }
.am-preview-body pre code { background: transparent; padding: 0; font-size: 12.5px; }
.am-preview-body blockquote { margin: 0 0 1em; padding: 2px 0 2px 12px; border-left: 3px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.am-preview-body a { color: var(--dsw-alias-brand-primary); }
.am-preview-body hr { border: 0; border-top: 1px solid var(--dsw-alias-border-l1); margin: 1.2em 0; }
.am-preview-foot { flex: none; padding: 8px 24px 12px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 11.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.am-note { padding: 22px 16px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.6; }
.am-note-title { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; margin-bottom: 6px; }
.am-muted { color: var(--dsw-alias-label-secondary); }
.am-error, .am-notice { margin: 12px 28px 0; padding: 10px 14px; border-radius: 8px; font-size: 12.5px; }
.am-error { border: 1px solid var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.am-notice { border: 1px solid var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
.am-loading { display: flex; align-items: center; gap: 8px; }
@media (max-width: 760px) {
  .am-body { grid-template-columns: 1fr; grid-template-rows: minmax(140px, 34vh) minmax(0, 1fr); }
  .am-list { border-right: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
  .am-header, .am-toolbar { padding-left: 16px; padding-right: 16px; }
  .am-error, .am-notice { margin-left: 16px; margin-right: 16px; }
}
`,
      );
    }

    function Panel({ t }) {
      const [projects, setProjects] = React.useState(null);
      const [root, setRoot] = React.useState('');
      const [autoCapture, setAutoCapture] = React.useState(false);
      const [projectKey, setProjectKey] = React.useState(null);
      const [selected, setSelected] = React.useState(null);
      const [file, setFile] = React.useState(null);
      const [query, setQuery] = React.useState('');
      const [loading, setLoading] = React.useState(true);
      const [fileLoading, setFileLoading] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [tick, setTick] = React.useState(0);
      const requestId = React.useRef(0);
      const selectedRef = React.useRef(null);
      const fileRef = React.useRef(null);
      const projectsRef = React.useRef(null);
      selectedRef.current = selected;
      fileRef.current = file;
      projectsRef.current = projects;

      const refresh = React.useCallback(() => setTick((value) => value + 1), []);

      React.useEffect(() => {
        let cancelled = false;
        if (projectsRef.current === null) setLoading(true);
        requestJson(`${ROUTE_PROJECTS}?t=${Date.now()}`)
          .then((payload) => {
            if (cancelled) return;
            const nextProjects = Array.isArray(payload.projects) ? payload.projects : [];
            setProjects(nextProjects);
            setRoot(payload.root ?? '');
            setAutoCapture(payload.autoCapture === true);
            setError(null);
            setProjectKey((previous) => {
              if (previous !== null && nextProjects.some((entry) => entry.key === previous)) return previous;
              return nextProjects[0]?.key ?? null;
            });
          })
          .catch((reason) => {
            if (!cancelled) setError(reason.message);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
        return () => {
          cancelled = true;
        };
      }, [tick]);

      React.useEffect(() => {
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') setTick((value) => value + 1);
        }, POLL_MS);
        return () => clearInterval(timer);
      }, []);

      React.useEffect(() => {
        if (notice === null) return;
        const timer = setTimeout(() => setNotice(null), 4000);
        return () => clearTimeout(timer);
      }, [notice]);

      const project = React.useMemo(
        () => (projects === null ? null : projects.find((entry) => entry.key === projectKey) ?? null),
        [projects, projectKey],
      );

      React.useEffect(() => {
        if (project === null) {
          setSelected(null);
          setFile(null);
          return;
        }
        const files = Array.isArray(project.files) ? project.files : [];
        const current = selectedRef.current;
        if (
          current !== null &&
          current.projectKey === project.key &&
          files.some((entry) => entry.fileName === current.fileName)
        ) {
          return;
        }
        const preferred = files.find((entry) => entry.generated !== true) ?? files[0];
        if (preferred !== undefined) {
          setFile(null);
          setSelected({ projectKey: project.key, fileName: preferred.fileName });
        } else {
          setSelected(null);
          setFile(null);
        }
      }, [project]);

      React.useEffect(() => {
        if (selected === null || project === null) {
          setFile(null);
          return;
        }
        const meta = (project.files ?? []).find((entry) => entry.fileName === selected.fileName);
        if (meta === undefined) {
          setFile(null);
          return;
        }
        const loaded = fileRef.current;
        if (
          loaded !== null &&
          loaded.projectKey === selected.projectKey &&
          loaded.fileName === selected.fileName
        ) {
          if (selected.fileName === 'MEMORY.md' ? loaded.loadedAt === tick : loaded.updated === meta.updated) return;
        }
        const id = requestId.current + 1;
        requestId.current = id;
        setFileLoading(true);
        requestJson(
          `${ROUTE_FILE}?project=${encodeURIComponent(selected.projectKey)}&name=${encodeURIComponent(selected.fileName)}&t=${Date.now()}`,
        )
          .then((payload) => {
            if (requestId.current !== id) return;
            setFile({ ...payload.file, projectKey: selected.projectKey, loadedAt: tick });
            setError(null);
          })
          .catch((reason) => {
            if (requestId.current === id) setError(reason.message);
          })
          .finally(() => {
            if (requestId.current === id) setFileLoading(false);
          });
      }, [selected, project, tick]);

      const selectFile = (nextProjectKey, fileName) => {
        setFile(null);
        setSelected({ projectKey: nextProjectKey, fileName });
      };

      const removeSelected = async () => {
        if (file === null || project === null || file.generated) return;
        const label = file.description || file.name;
        if (!window.confirm(t('deleteConfirm', { name: label }))) return;
        try {
          await requestJson(ROUTE_DELETE, {
            method: 'POST',
            body: JSON.stringify({ project: project.key, name: file.fileName }),
          });
          setNotice(t('deleted', { name: label }));
          setFile(null);
          setSelected(null);
          refresh();
        } catch (reason) {
          setError(reason.message);
        }
      };

      const files = project === null ? [] : Array.isArray(project.files) ? project.files : [];
      const needle = query.trim().toLowerCase();
      const topics = files.filter((entry) => entry.generated !== true);
      const indexFile = files.find((entry) => entry.generated === true);
      const visibleTopics =
        needle === ''
          ? topics
          : topics.filter((entry) =>
              `${entry.name} ${entry.description} ${entry.type}`.toLowerCase().includes(needle),
            );

      const typeLabel = (type) => t(`type_${type}`) || type;
      const countLabel = (value) => t(value === 1 ? 'memory' : 'memories', { count: value });

      const renderRow = (entry) =>
        h(
          'button',
          {
            key: entry.fileName,
            type: 'button',
            className: `am-row${selected !== null && selected.projectKey === project.key && selected.fileName === entry.fileName ? ' is-active' : ''}`,
            'aria-current': selected !== null && selected.projectKey === project.key && selected.fileName === entry.fileName ? 'true' : undefined,
            onClick: () => selectFile(project.key, entry.fileName),
          },
          h('span', { className: `am-badge am-badge-${entry.type}` }, typeLabel(entry.type)),
          h(
            'span',
            { className: 'am-row-main' },
            h('span', { className: 'am-row-title' }, entry.description || entry.name),
            h(
              'span',
              { className: 'am-row-sub' },
              `${entry.name} · ${relativeTime(entry.updated || entry.mtime, t)}`,
            ),
          ),
        );

      const renderPreview = () => {
        if (fileLoading && file === null) {
          return h('div', { className: 'am-note' }, h('div', { className: 'am-loading' }, t('loading')));
        }
        if (file === null) {
          return h(
            'div',
            { className: 'am-note' },
            h('div', { className: 'am-note-title' }, project === null ? t('noProjects') : t('selectMemory')),
            project === null ? h('div', null, t('noProjectsHint')) : null,
          );
        }
        const title = file.generated ? t('indexTitle') : file.description || file.name;
        const subtitle = file.generated ? t('indexDescription') : file.name;
        return h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'am-preview-head' },
            h(
              'div',
              { className: 'am-preview-titles' },
              h('h2', { className: 'am-preview-title' }, title),
              h(
                'div',
                { className: 'am-preview-meta' },
                h('span', { className: `am-badge am-badge-${file.type}` }, typeLabel(file.type)),
                h('span', null, subtitle),
                file.updated !== '' ? h('span', null, `${t('updated')} ${relativeTime(file.updated, t)}`) : null,
                file.generated ? h('span', null, t('generated')) : null,
                file.bytes > 0 ? h('span', null, formatBytes(file.bytes)) : null,
              ),
            ),
            file.generated
              ? null
              : h(
                  'button',
                  { type: 'button', className: 'am-button am-danger', onClick: removeSelected },
                  t('delete'),
                ),
          ),
          h('div', { className: 'am-preview-body' }, renderMarkdown(file.body)),
          h(
            'div',
            { className: 'am-preview-foot' },
            `${project?.path || project?.key || ''} · ${file.fileName}`,
          ),
        );
      };

      const body =
        loading && projects === null
          ? h('div', { className: 'am-note' }, h('div', { className: 'am-loading' }, t('loading')))
          : projects !== null && projects.length === 0
            ? h(
                'div',
                { className: 'am-note' },
                h('div', { className: 'am-note-title' }, t('noProjects')),
                h('div', null, t('noProjectsHint')),
                root !== '' ? h('div', { style: { marginTop: '8px' } }, t('root', { path: root })) : null,
              )
            : project !== null && topics.length === 0
              ? h(
                  'div',
                  { className: 'am-note' },
                  h('div', { className: 'am-note-title' }, t('emptyProject')),
                  h('div', null, t('emptyProjectHint')),
                )
              : null;

      return h(
        'div',
        { className: 'am-page' },
        h(PanelStyles),
        h(
          'div',
          { className: 'am-header' },
          h(
            'div',
            null,
            h('h1', { className: 'am-title' }, t('title')),
            h('p', { className: 'am-subtitle' },
              t('subtitle'),
              autoCapture ? h('span', { className: 'am-auto-badge' }, t('autoCapture')) : null,
            ),
          ),
          h(
            'button',
            { type: 'button', className: 'am-button', onClick: refresh, disabled: loading },
            loading ? t('refreshing') : t('refresh'),
          ),
        ),
        h(
          'div',
          { className: 'am-toolbar' },
          h(
            'label',
            { className: 'am-label' },
            t('project'),
            h(
              'select',
              {
                className: 'am-select',
                value: projectKey ?? '',
                disabled: projects === null || projects.length === 0,
                onChange: (event) => {
                  setFile(null);
                  setSelected(null);
                  setProjectKey(event.target.value);
                },
              },
              (projects ?? []).map((entry) =>
                h(
                  'option',
                  { key: entry.key, value: entry.key },
                  `${entry.name} — ${entry.path || entry.key} (${countLabel(entry.memoryCount)})`,
                ),
              ),
            ),
          ),
          h('input', {
            className: 'am-search',
            type: 'search',
            value: query,
            placeholder: t('searchPlaceholder'),
            onChange: (event) => setQuery(event.target.value),
          }),
        ),
        error !== null
          ? h(
              'div',
              { className: 'am-error' },
              `${t('loadFailed')}: ${error}`,
              h(
                'button',
                {
                  type: 'button',
                  className: 'am-button',
                  style: { marginLeft: '12px' },
                  onClick: refresh,
                },
                t('retry'),
              ),
            )
          : null,
        notice !== null ? h('div', { className: 'am-notice' }, notice) : null,
        body !== null
          ? body
          : h(
              'div',
              { className: 'am-body' },
              h(
                'div',
                { className: 'am-list', role: 'list' },
                h('div', { className: 'am-list-heading' }, countLabel(topics.length)),
                visibleTopics.map(renderRow),
                visibleTopics.length === 0 && needle !== ''
                  ? h('div', { className: 'am-note' }, t('selectMemory'))
                  : null,
                indexFile !== undefined
                  ? h(
                      React.Fragment,
                      null,
                      h('div', { className: 'am-divider' }),
                      renderRow(indexFile),
                    )
                  : null,
              ),
              h('div', { className: 'am-preview' }, renderPreview()),
            ),
      );
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'auto-memory: dictionaries');
      const t = ctx.locale.bind(NS);
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            inject: () => ({ t }),
          },
          Panel,
        ),
      );
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 20,
            locale: NS,
            label: () => t('panel'),
          },
          PanelIcon,
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    };
  },
});
