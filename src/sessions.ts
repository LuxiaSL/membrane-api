/**
 * Session management for tool continuation
 * 
 * When a streaming request encounters tool calls, we save the session state
 * so the client can execute tools and continue the conversation.
 */

import type { NormalizedRequest, ToolCall, ToolResult, ContentBlock } from '@animalabs/membrane';
import type { ProviderName, CreateMembraneOptions } from './providers.js';
import type { ProviderConfig } from './types.js';

export interface SessionState {
  id: string;
  createdAt: number;
  expiresAt: number;

  // Original request context
  provider: ProviderName;
  apiKey?: string; // BYOK: Store key for continuation requests
  providerConfig?: ProviderConfig; // BYOK: Store full provider config
  membraneOptions?: CreateMembraneOptions; // Formatter and retry config
  request: NormalizedRequest;

  // Accumulated state from streaming
  rawAssistantText: string;
  contentBlocks: ContentBlock[];
  toolCalls: ToolCall[];
  executedToolResults: ToolResult[];

  // Usage accumulation
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

// In-memory session store with TTL
const sessions = new Map<string, SessionState>();

// Clean up expired sessions every minute
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt < now) {
      sessions.delete(id);
    }
  }
}, 60_000);

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Create a new session for tool continuation
 */
export function createSession(
  provider: ProviderName,
  request: NormalizedRequest,
  state: {
    rawAssistantText: string;
    contentBlocks: ContentBlock[];
    toolCalls: ToolCall[];
    executedToolResults: ToolResult[];
    usage: { inputTokens: number; outputTokens: number };
  },
  options: {
    apiKey?: string; // BYOK: Store for continuation
    providerConfig?: ProviderConfig; // BYOK: Store full provider config
    membraneOptions?: CreateMembraneOptions; // Formatter and retry config
    ttlMs?: number;
  } = {}
): SessionState {
  const { apiKey, providerConfig, membraneOptions, ttlMs = 5 * 60 * 1000 } = options;
  const id = generateSessionId();
  const now = Date.now();

  const session: SessionState = {
    id,
    createdAt: now,
    expiresAt: now + ttlMs,
    provider,
    apiKey,
    providerConfig,
    membraneOptions,
    request,
    ...state,
  };

  sessions.set(id, session);
  return session;
}

/**
 * Get a session by ID
 */
export function getSession(id: string): SessionState | null {
  const session = sessions.get(id);
  if (!session) {
    return null;
  }

  // Check expiration
  if (session.expiresAt < Date.now()) {
    sessions.delete(id);
    return null;
  }

  return session;
}

/**
 * Update session state after tool results
 */
export function updateSession(
  id: string,
  updates: Partial<Pick<SessionState, 'rawAssistantText' | 'contentBlocks' | 'toolCalls' | 'executedToolResults' | 'usage'>>
): SessionState | null {
  const session = getSession(id);
  if (!session) {
    return null;
  }

  Object.assign(session, updates);

  // Extend expiration on update
  session.expiresAt = Date.now() + 5 * 60 * 1000;

  return session;
}

/**
 * Delete a session (after completion or explicit cleanup)
 */
export function deleteSession(id: string): void {
  sessions.delete(id);
}

/**
 * Get session count (for monitoring)
 */
export function getSessionCount(): number {
  return sessions.size;
}

