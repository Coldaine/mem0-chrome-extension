type CaptureEventType =
  | 'thread_snapshot'
  | 'message_created'
  | 'message_completed'
  | 'message_edited'
  | 'message_regenerated'
  | 'branch_changed'
  | 'attachment_discovered'
  | 'tool_event_discovered';

type CaptureRole = 'user' | 'assistant' | 'system';

interface CaptureBasePayload {
  provider: 'chatgpt';
  event_type: CaptureEventType;
  account_id: string | null;
  workspace_id?: string | null;
  conversation_id: string;
  branch_id: string;
  source_url: string;
  captured_at: string;
  raw_provider_metadata: Record<string, unknown>;
}

interface ThreadMessageCapture {
  message_id: string;
  parent_message_id: string | null;
  revision_id: string | null;
  role: CaptureRole;
  content_parts: string[];
  attachments: Array<Record<string, unknown>>;
  tool_events: Array<Record<string, unknown>>;
  captured_at: string;
}

interface ThreadSnapshotPayload extends CaptureBasePayload {
  event_type: 'thread_snapshot';
  messages: ThreadMessageCapture[];
}

interface EventPayload extends CaptureBasePayload {
  message_id: string;
  revision_id?: string | null;
  parent_message_id?: string | null;
  role: CaptureRole;
  content_parts: string[];
  attachments: Array<Record<string, unknown>>;
  tool_events: Array<Record<string, unknown>>;
}

type AnyCapturePayload = ThreadSnapshotPayload | EventPayload;

const CHATGPT_PROVIDER: 'chatgpt' = 'chatgpt';
const THREAD_CAPTURE_ENDPOINT = '/v1/capture/thread-snapshot';
const EVENT_CAPTURE_ENDPOINT = '/v1/capture/event';
const CONTEXT_SUGGEST_ENDPOINT = '/v1/context/suggest';
const CONTEXT_CONFIRM_ENDPOINT = '/v1/context/confirm';
const LOCAL_DAEMON_URLS = ['http://127.0.0.1:8787', 'http://localhost:8787'];
const DEFAULT_BRANCH_ID = 'main';
const CONTEXT_BUTTON_ID = 'codex-context-button';
const CONTEXT_MODAL_ID = 'codex-context-modal';

let lastSnapshotFingerprint = '';
let lastConversationId = '';
const recentUserMessageFingerprints = new Map<string, number>();
const capturedAssistantMessages = new Set<string>();
const captureObserver = new MutationObserver(() => {
  void detectLatestAssistantMessage();
  ensureContextButton();
});

type DaemonContextSuggestion = {
  id: string;
  conversation_id: string;
  message_id: string;
  role: string;
  text: string;
  captured_at: string;
  score: number;
  metadata?: Record<string, unknown>;
};

type DaemonContextSuggestResponse = {
  provider: string;
  conversation_id?: string | null;
  suggestions: DaemonContextSuggestion[];
};

let contextModalOpen = false;
let contextModalLoading = false;
let contextSuggestions: DaemonContextSuggestion[] = [];

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash &= hash;
  }
  return Math.abs(hash >>> 0).toString(16);
}

function cleanupRecentMap(): void {
  const cutoff = Date.now() - 120000;
  const entries = Array.from(recentUserMessageFingerprints.entries());
  for (const [fingerprint, at] of entries) {
    if (at < cutoff) {
      recentUserMessageFingerprints.delete(fingerprint);
    }
  }
}

function trimCapturedSet(): void {
  if (capturedAssistantMessages.size <= 2000) {
    return;
  }
  const keep = Array.from(capturedAssistantMessages);
  const next = keep.slice(keep.length - 1000);
  capturedAssistantMessages.clear();
  for (const item of next) {
    capturedAssistantMessages.add(item);
  }
}

function getConversationId(): string {
  const pathMatch = window.location.pathname.match(/\/c\/([^/?#]+)/);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }
  const searchId = new URLSearchParams(window.location.search).get('id');
  if (searchId) {
    return searchId;
  }
  return `${window.location.origin}${window.location.pathname}`;
}

function getProviderMessageRole(node: Element): CaptureRole {
  const role = node.getAttribute('data-message-author-role');
  if (role === 'user') {
    return 'user';
  }
  if (role === 'assistant') {
    return 'assistant';
  }
  return 'system';
}

function resolveConversationMetadata(): Record<string, unknown> {
  return {
    title: document.title || '',
    pathname: window.location.pathname,
    query: window.location.search,
    host: window.location.host,
  };
}

function extractMessageText(node: Element): string {
  const visibleText = normalizeText(node.textContent || '');
  if (visibleText.length > 0) {
    return visibleText;
  }
  return '';
}

function buildMessageId(node: Element, index: number): string {
  const explicitId =
    node.getAttribute('data-message-id') ||
    node.getAttribute('id') ||
    node.getAttribute('data-id');
  if (explicitId) {
    return explicitId;
  }
  const role = getProviderMessageRole(node);
  const text = extractMessageText(node);
  return `${getConversationId()}:${role}:${index}:${simpleHash(role + '::' + text.slice(0, 96))}`;
}

function getMessageNodes(): Element[] {
  const firstPass = Array.from(document.querySelectorAll('[data-message-author-role]'));
  if (firstPass.length > 0) {
    return firstPass;
  }

  const secondPass = Array.from(document.querySelectorAll('[data-testid^="conversation-"]'));
  if (secondPass.length > 0) {
    return secondPass;
  }

  const fallback = Array.from(document.querySelectorAll('main article, main .group, [role="article"]'));
  return fallback;
}

function buildMessagesFromDom(): ThreadMessageCapture[] {
  const rawNodes = getMessageNodes();
  return rawNodes.map((node, index) => {
    const role = getProviderMessageRole(node);
    const text = extractMessageText(node);
    return {
      message_id: buildMessageId(node, index),
      parent_message_id: null,
      revision_id: null,
      role,
      content_parts: text.length > 0 ? [text] : [],
      attachments: [],
      tool_events: [],
      captured_at: nowIso(),
    };
  }).filter(msg => msg.content_parts.length > 0);
}

function isConversationSurface(): boolean {
  return window.location.pathname.startsWith('/c/');
}

function messageFingerprint(messages: ThreadMessageCapture[]): string {
  const signature = messages
    .map(message => `${message.message_id}|${message.role}|${message.content_parts.join('\n')}`)
    .join('||');
  return simpleHash(signature);
}

function buildBasePayload(): Omit<CaptureBasePayload, 'event_type'> & { account_id: string | null } {
  return {
    provider: CHATGPT_PROVIDER,
    account_id: null,
    conversation_id: getConversationId(),
    branch_id: DEFAULT_BRANCH_ID,
    source_url: window.location.href,
    captured_at: nowIso(),
    raw_provider_metadata: resolveConversationMetadata(),
  };
}

async function postCapture(endpoint: string, payload: AnyCapturePayload): Promise<boolean> {
  const body = JSON.stringify(payload);
  for (const base of LOCAL_DAEMON_URLS) {
    try {
      const response = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // daemon not available at this base URL
    }
  }
  return false;
}

async function postDaemon<T>(endpoint: string, payload: Record<string, unknown>): Promise<T | null> {
  const body = JSON.stringify(payload);
  for (const base of LOCAL_DAEMON_URLS) {
    try {
      const response = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      });
      if (!response.ok) {
        continue;
      }
      return await response.json();
    } catch {
      // daemon not available at this base URL
    }
  }
  return null;
}

async function sendThreadSnapshot(): Promise<void> {
  if (!isConversationSurface()) {
    return;
  }
  const messages = buildMessagesFromDom();
  if (messages.length === 0) {
    return;
  }
  const fingerprint = messageFingerprint(messages);
  if (fingerprint === lastSnapshotFingerprint && lastConversationId === getConversationId()) {
    return;
  }

  const payload: ThreadSnapshotPayload = {
    ...buildBasePayload(),
    event_type: 'thread_snapshot',
    messages,
  };
  const ok = await postCapture(THREAD_CAPTURE_ENDPOINT, payload);
  if (ok) {
    lastSnapshotFingerprint = fingerprint;
    lastConversationId = getConversationId();
  }
}

function getComposerText(): string {
  const candidates = [
    'textarea[data-testid="prompt-textarea"]',
    '[data-testid="composer-tray"] textarea',
    'form textarea',
    'textarea[placeholder]',
    'div[contenteditable="true"]',
  ];
  for (const selector of candidates) {
    const element = document.querySelector(selector);
    if (!element) {
      continue;
    }
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return element.value;
    }
    if (element instanceof HTMLDivElement && element.getAttribute('contenteditable') === 'true') {
      return element.textContent || '';
    }
  }
  return '';
}

function getComposerElement():
  | HTMLTextAreaElement
  | HTMLInputElement
  | HTMLDivElement
  | null {
  const candidates = [
    'textarea[data-testid="prompt-textarea"]',
    '[data-testid="composer-tray"] textarea',
    'form textarea',
    'textarea[placeholder]',
    'div[contenteditable="true"]',
  ];
  for (const selector of candidates) {
    const element = document.querySelector(selector);
    if (!element) {
      continue;
    }
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return element;
    }
    if (element instanceof HTMLDivElement && element.getAttribute('contenteditable') === 'true') {
      return element;
    }
  }
  return null;
}

function setComposerText(nextValue: string): void {
  const element = getComposerElement();
  if (!element) {
    return;
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    element.focus();
    element.value = nextValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  element.focus();
  element.textContent = nextValue;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function composeContextBlock(selected: DaemonContextSuggestion[]): string {
  const lines = selected.map((item, index) => `${index + 1}. [${item.role}] ${item.text}`);
  return `Relevant context:\n${lines.join('\n')}\n\n`;
}

function closeContextModal(): void {
  const modal = document.getElementById(CONTEXT_MODAL_ID);
  if (modal) {
    modal.remove();
  }
  contextModalOpen = false;
  contextModalLoading = false;
  contextSuggestions = [];
}

async function fetchContextSuggestions(query: string): Promise<DaemonContextSuggestion[]> {
  const response = await postDaemon<DaemonContextSuggestResponse>(CONTEXT_SUGGEST_ENDPOINT, {
    provider: CHATGPT_PROVIDER,
    conversation_id: getConversationId(),
    query,
    top_k: 6,
    threshold: 0,
  });
  if (!response || !Array.isArray(response.suggestions)) {
    return [];
  }
  return response.suggestions;
}

async function confirmContextSelection(
  selected: DaemonContextSuggestion[],
  approvedText: string,
  draftedPrompt: string
): Promise<void> {
  await postDaemon(CONTEXT_CONFIRM_ENDPOINT, {
    provider: CHATGPT_PROVIDER,
    conversation_id: getConversationId(),
    selected_suggestion_ids: selected.map(item => item.id),
    approved_text: approvedText,
    drafted_prompt: draftedPrompt,
  });
}

function truncateText(text: string, max = 220): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}

function renderContextModalBody(
  container: HTMLElement,
  suggestions: DaemonContextSuggestion[],
  originalPrompt: string
): void {
  container.innerHTML = '';

  const title = document.createElement('div');
  title.textContent = 'Suggested Context';
  title.style.cssText = `
    font-size: 14px;
    font-weight: 600;
    color: #ffffff;
    margin-bottom: 10px;
  `;
  container.appendChild(title);

  if (suggestions.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No context suggestions yet.';
    empty.style.cssText = `
      font-size: 13px;
      color: #a1a1aa;
      margin-bottom: 12px;
    `;
    container.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 240px;
      overflow-y: auto;
      margin-bottom: 12px;
    `;

    suggestions.forEach((suggestion, index) => {
      const row = document.createElement('label');
      row.style.cssText = `
        display: flex;
        align-items: flex-start;
        gap: 8px;
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 8px;
        padding: 8px;
        cursor: pointer;
      `;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = index < 2;
      checkbox.dataset['suggestionId'] = suggestion.id;
      checkbox.style.marginTop = '2px';

      const textWrap = document.createElement('div');
      textWrap.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 4px;
      `;

      const meta = document.createElement('div');
      meta.textContent = `${suggestion.role} • score ${suggestion.score.toFixed(3)}`;
      meta.style.cssText = `
        font-size: 11px;
        color: #9ca3af;
      `;

      const text = document.createElement('div');
      text.textContent = truncateText(suggestion.text);
      text.style.cssText = `
        font-size: 12px;
        color: #e5e7eb;
      `;

      textWrap.appendChild(meta);
      textWrap.appendChild(text);
      row.appendChild(checkbox);
      row.appendChild(textWrap);
      list.appendChild(row);
    });

    container.appendChild(list);
  }

  const actions = document.createElement('div');
  actions.style.cssText = `
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  `;

  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel';
  cancelButton.style.cssText = `
    padding: 6px 10px;
    border: 1px solid #4b5563;
    background: #111827;
    color: #e5e7eb;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  `;
  cancelButton.addEventListener('click', () => closeContextModal());

  const applyButton = document.createElement('button');
  applyButton.textContent = 'Apply to Prompt';
  applyButton.style.cssText = `
    padding: 6px 10px;
    border: none;
    background: #2563eb;
    color: #ffffff;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  `;
  applyButton.addEventListener('click', async () => {
    const selectedCheckboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-suggestion-id]:checked')
    );
    const selectedIds = new Set(selectedCheckboxes.map(item => item.dataset['suggestionId'] || ''));
    const selected = suggestions.filter(item => selectedIds.has(item.id));
    if (selected.length === 0) {
      closeContextModal();
      return;
    }
    const contextBlock = composeContextBlock(selected);
    setComposerText(`${contextBlock}${originalPrompt}`);
    await confirmContextSelection(selected, contextBlock, originalPrompt);
    closeContextModal();
  });

  actions.appendChild(cancelButton);
  actions.appendChild(applyButton);
  container.appendChild(actions);
}

async function openContextModal(): Promise<void> {
  if (contextModalOpen || contextModalLoading) {
    return;
  }

  const prompt = normalizeText(getComposerText());
  if (prompt.length < 3) {
    return;
  }

  contextModalLoading = true;
  contextModalOpen = true;

  const overlay = document.createElement('div');
  overlay.id = CONTEXT_MODAL_ID;
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 2147483645;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const shell = document.createElement('div');
  shell.style.cssText = `
    width: min(560px, calc(100vw - 24px));
    background: #111827;
    border: 1px solid #374151;
    border-radius: 10px;
    padding: 14px;
    box-shadow: 0 18px 42px rgba(0, 0, 0, 0.45);
  `;
  overlay.appendChild(shell);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closeContextModal();
    }
  });

  const loading = document.createElement('div');
  loading.textContent = 'Loading context suggestions...';
  loading.style.cssText = `
    font-size: 13px;
    color: #d1d5db;
  `;
  shell.appendChild(loading);

  try {
    contextSuggestions = await fetchContextSuggestions(prompt);
    contextModalLoading = false;
    renderContextModalBody(shell, contextSuggestions, prompt);
  } catch {
    contextModalLoading = false;
    shell.innerHTML = '';
    const failure = document.createElement('div');
    failure.textContent = 'Unable to load suggestions from local daemon.';
    failure.style.cssText = `
      font-size: 13px;
      color: #fca5a5;
    `;
    shell.appendChild(failure);
  }
}

function ensureContextButton(): void {
  if (!isConversationSurface()) {
    return;
  }
  if (document.getElementById(CONTEXT_BUTTON_ID)) {
    return;
  }
  const form = document.querySelector('form');
  if (!form) {
    return;
  }

  const button = document.createElement('button');
  button.id = CONTEXT_BUTTON_ID;
  button.type = 'button';
  button.textContent = 'Context';
  button.style.cssText = `
    position: absolute;
    right: 12px;
    bottom: 10px;
    z-index: 9999;
    border: 1px solid #4b5563;
    background: #111827;
    color: #e5e7eb;
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
  `;
  button.addEventListener('click', () => {
    void openContextModal();
  });

  if (getComputedStyle(form).position === 'static') {
    form.style.position = 'relative';
  }
  form.appendChild(button);
}

function buildEventPayloadFromText(text: string, eventType: 'message_created' | 'message_completed'): EventPayload {
  const base = buildBasePayload();
  const normalized = normalizeText(text);
  const signature = simpleHash(`${base.conversation_id}|${eventType}|${normalized}|${base.captured_at}`);
  const messageId = `msg-${signature}`;
  const payload: EventPayload = {
    ...base,
    event_type: eventType,
    message_id: messageId,
    role: eventType === 'message_created' ? 'user' : 'assistant',
    content_parts: normalized.length > 0 ? [normalized] : [],
    parent_message_id: null,
    revision_id: null,
    attachments: [],
    tool_events: [],
  };
  if (eventType === 'message_created') {
    const prior = recentUserMessageFingerprints.get(signature) || 0;
    if (Date.now() - prior < 1200) {
      throw new Error('duplicate send event suppressed');
    }
    recentUserMessageFingerprints.set(signature, Date.now());
    cleanupRecentMap();
  }
  return payload;
}

async function emitMessageCreated(): Promise<void> {
  const text = getComposerText();
  const normalized = normalizeText(text);
  if (!normalized) {
    return;
  }
  try {
    const payload = buildEventPayloadFromText(normalized, 'message_created');
    await postCapture(EVENT_CAPTURE_ENDPOINT, payload);
  } catch (error) {
    if (error instanceof Error && error.message === 'duplicate send event suppressed') {
      return;
    }
    throw error;
  }
}

async function emitMessageCompleted(message: ThreadMessageCapture): Promise<void> {
  if (!message.content_parts.length) {
    return;
  }
  const normalized = normalizeText(message.content_parts.join('\n'));
  const payload: EventPayload = {
    ...buildBasePayload(),
    event_type: 'message_completed',
    message_id: message.message_id,
    role: 'assistant',
    content_parts: normalized.length > 0 ? [normalized] : [],
    parent_message_id: message.parent_message_id,
    revision_id: null,
    attachments: [],
    tool_events: [],
  };
  await postCapture(EVENT_CAPTURE_ENDPOINT, payload);
}

async function detectLatestAssistantMessage(): Promise<void> {
  if (!isConversationSurface()) {
    return;
  }
  const assistantMessages = buildMessagesFromDom().filter(item => item.role === 'assistant');
  if (assistantMessages.length === 0) {
    return;
  }
  const latest = assistantMessages[assistantMessages.length - 1];
  const messageTextSignature = normalizeText(latest.content_parts.join('\n'));
  const messageKey = `${latest.message_id}:${simpleHash(messageTextSignature)}`;
  if (capturedAssistantMessages.has(messageKey)) {
    return;
  }
  capturedAssistantMessages.add(messageKey);
  trimCapturedSet();
  await emitMessageCompleted(latest);
}

function attachSendCaptureListeners(): void {
  document.addEventListener(
    'keydown',
    event => {
      if (event.defaultPrevented) {
        return;
      }

      if ((event.metaKey || event.ctrlKey || event.altKey) && event.key === 'Enter') {
        void emitMessageCreated();
        return;
      }
      if (event.key.toLowerCase() === 'm' && event.ctrlKey && event.shiftKey) {
        event.preventDefault();
        void openContextModal();
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        const active = document.activeElement;
        if (
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLInputElement ||
          (active instanceof HTMLDivElement && active.getAttribute('contenteditable') === 'true')
        ) {
          void emitMessageCreated();
        }
      }
    },
    true
  );
}

function installNavigationWatchers(): void {
  const refresh = () => {
    if (isConversationSurface()) {
      void sendThreadSnapshot();
    }
  };

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    originalPushState(...args);
    setTimeout(refresh, 150);
  };

  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    originalReplaceState(...args);
    setTimeout(refresh, 150);
  };

  window.addEventListener('popstate', () => {
    setTimeout(refresh, 150);
  });
}

function initObserver(): void {
  captureObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function bootstrapCaptureBridge(): void {
  if (window.top !== window.self) {
    return;
  }
  if (!isConversationSurface()) {
    return;
  }

  void sendThreadSnapshot();
  ensureContextButton();
  attachSendCaptureListeners();
  installNavigationWatchers();
  initObserver();
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  bootstrapCaptureBridge();
} else {
  window.addEventListener('DOMContentLoaded', () => {
    bootstrapCaptureBridge();
  });
}
