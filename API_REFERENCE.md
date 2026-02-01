# membrane-api — API Reference

Quick reference for all HTTP endpoints, parameters, and usage patterns.

---

## Table of Contents

- [Authentication](#authentication)
- [Endpoints at a Glance](#endpoints-at-a-glance)
- [Endpoint Details](#endpoint-details)
  - [GET /health](#get-health)
  - [GET /v1/models](#get-v1models)
  - [GET /v1/stats](#get-v1stats)
  - [POST /v1/complete](#post-v1complete)
  - [POST /v1/stream](#post-v1stream)
  - [POST /v1/continue](#post-v1continue)
  - [DELETE /v1/sessions/:sessionId](#delete-v1sessionssessionid)
- [Request Parameters Reference](#request-parameters-reference)
- [Provider Configuration](#provider-configuration)
- [Content Block Types](#content-block-types)
- [Streaming Events (SSE)](#streaming-events-sse)
- [Error Handling](#error-handling)
- [Usage Recommendations](#usage-recommendations)

---

## Authentication

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization: Bearer <token>` | **Conditional** | Required if `API_TOKEN` env var is set on server. Not required for `/health`. |

If the server has `API_TOKEN` configured, all endpoints except `/health` require the Bearer token.

```bash
curl -H "Authorization: Bearer your-token" http://127.0.0.1:3001/v1/complete ...
```

---

## Endpoints at a Glance

| Method | Endpoint | Purpose | Auth Required |
|--------|----------|---------|---------------|
| `GET` | `/health` | Server health + provider status | No |
| `GET` | `/v1/models` | List available models | Yes* |
| `GET` | `/v1/stats` | Server statistics | Yes* |
| `POST` | `/v1/complete` | Non-streaming completion | Yes* |
| `POST` | `/v1/stream` | Streaming completion (SSE) | Yes* |
| `POST` | `/v1/continue` | Continue after tool calls | Yes* |
| `POST` | `/v1/context/stream` | Streaming with context management | Yes* |
| `POST` | `/v1/abort/:streamId` | Abort an active stream | Yes* |
| `DELETE` | `/v1/sessions/:sessionId` | Clean up a session | Yes* |

*Only if `API_TOKEN` is configured.

---

## Endpoint Details

### GET /health

Check server health and provider availability.

**Request:**
```bash
curl http://127.0.0.1:3001/health
```

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 123456,
  "providers": {
    "anthropic": { "configured": true, "healthy": true },
    "openrouter": { "configured": false, "healthy": true },
    "openai": { "configured": false, "healthy": true },
    "openai-compatible": { "configured": false, "healthy": true },
    "openai-completions": { "configured": false, "healthy": true },
    "bedrock": { "configured": false, "healthy": true }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"ok" \| "degraded" \| "unhealthy"` | `"ok"` if any configured provider is healthy or in pure BYOK mode |
| `version` | `string` | API version |
| `uptime` | `number` | Milliseconds since server start |
| `providers[name].configured` | `boolean` | True if server has fallback key |
| `providers[name].healthy` | `boolean` | True if recent requests succeeded |

---

### GET /v1/models

List available models and their capabilities.

**Response:**
```json
{
  "models": [
    {
      "id": "claude-sonnet-4-20250514",
      "name": "Claude Sonnet 4",
      "provider": "anthropic",
      "contextWindow": 200000,
      "maxOutput": 64000,
      "supportsTools": true,
      "supportsThinking": true,
      "supportsImages": true
    }
  ],
  "defaultModel": "claude-sonnet-4-20250514"
}
```

> **Note:** For `openai-compatible` and `openai-completions`, any model name works—specify it in your request. The models list is informational for hosted providers.

---

### GET /v1/stats

Server monitoring statistics.

**Response:**
```json
{
  "uptime": 123456,
  "activeSessions": 2,
  "activeStreams": 5,
  "providers": ["anthropic", "openrouter"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `uptime` | `number` | Milliseconds since server start |
| `activeSessions` | `number` | Active tool continuation sessions |
| `activeStreams` | `number` | Active streaming requests (can be aborted) |
| `providers` | `string[]` | Providers with server-configured keys |

---

### POST /v1/complete

Non-streaming completion. Waits for full response before returning.

**Request Headers:**
```
Content-Type: application/json
Authorization: Bearer <token>  (if API_TOKEN configured)
```

**Minimal Request:**
```json
{
  "messages": [
    { "participant": "User", "content": "Hello!" }
  ]
}
```

**Full Request (all options):**
```json
{
  "messages": [
    { "participant": "User", "content": "Hello!" }
  ],
  "model": "claude-sonnet-4-20250514",
  "provider": "anthropic",
  "maxTokens": 4096,
  "temperature": 1.0,
  "system": "You are a helpful assistant.",
  "tools": [],
  "toolMode": "auto",
  "thinking": {
    "enabled": true,
    "budgetTokens": 10000,
    "outputMode": "parsed"
  },
  "stopSequences": [],
  "promptCaching": false,
  "cacheTtl": "5m",
  "maxParticipantsForStop": 2,
  "providerParams": {},
  "apiKey": "sk-ant-...",
  "providerConfig": {}
}
```

**Response:**
```json
{
  "content": [
    { "type": "text", "text": "Hello! How can I help you today?" }
  ],
  "rawAssistantText": "Hello! How can I help you today?",
  "toolCalls": [],
  "toolResults": [],
  "stopReason": "end_turn",
  "usage": {
    "inputTokens": 10,
    "outputTokens": 12
  },
  "model": "claude-sonnet-4-20250514",
  "provider": "anthropic",
  "durationMs": 892,
  "requiresToolResults": false
}
```

---

### POST /v1/stream

Streaming completion via Server-Sent Events (SSE).

**Request:** Same body as `/v1/complete`.

**Response:** `text/event-stream` with events:

```
event: chunk
data: {"text":"Hello","type":"text","visible":true,"blockIndex":0}

event: chunk
data: {"text":"!","type":"text","visible":true,"blockIndex":0}

event: usage
data: {"inputTokens":10,"outputTokens":2}

event: done
data: {"content":[...],"stopReason":"end_turn",...}
```

See [Streaming Events](#streaming-events-sse) for all event types.

---

### POST /v1/continue

Continue a conversation after client executes tool calls. Always streams (SSE).

**When to use:** After receiving a `tool_calls` event from `/v1/stream` where the response has `stopReason: "tool_use"`.

**Request:**
```json
{
  "sessionId": "sess_abc123",
  "toolResults": [
    {
      "toolUseId": "tool_xyz",
      "content": "Result of executing the tool",
      "isError": false
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | `string` | **Yes** | Session ID from the `tool_calls` event |
| `toolResults` | `array` | **Yes** | Results for each tool call |
| `toolResults[].toolUseId` | `string` | **Yes** | ID from the tool call |
| `toolResults[].content` | `string \| array` | **Yes** | Tool execution result |
| `toolResults[].isError` | `boolean` | No | True if tool execution failed |

**Response:** SSE stream (same format as `/v1/stream`).

> **Important:** Sessions expire after **5 minutes** of inactivity. The BYOK key is stored securely in the session for continuation.

---

### DELETE /v1/sessions/:sessionId

Explicitly clean up a session before expiration.

**Request:**
```bash
curl -X DELETE http://127.0.0.1:3001/v1/sessions/sess_abc123
```

**Response:** `204 No Content`

---

### POST /v1/abort/:streamId

Abort an active streaming request. The `streamId` is provided in the `stream_start` event.

**Request:**
```bash
curl -X POST http://127.0.0.1:3001/v1/abort/str_abc123
```

**Response:**
```json
{
  "aborted": true,
  "streamId": "str_abc123"
}
```

| HTTP Status | Description |
|-------------|-------------|
| `200` | Stream was successfully aborted |
| `404` | Stream not found or already completed |

---

### POST /v1/context/stream

Streaming completion with **automatic context management**. Handles rolling/truncation of long conversations, cache marker placement, and state management.

**When to use:** For long-running conversations where you want automatic handling of context window limits, rolling, and prompt caching optimization.

**Request:**
```json
{
  "messages": [
    { "participant": "User", "content": "Hello!" }
  ],
  "model": "claude-sonnet-4-20250514",
  "contextConfig": {
    "rolling": {
      "threshold": 50,
      "buffer": 20,
      "grace": 10,
      "unit": "messages"
    },
    "limits": {
      "maxCharacters": 500000,
      "maxTokens": 100000,
      "maxMessages": 200
    },
    "cache": {
      "enabled": true,
      "points": 2,
      "minTokens": 1024,
      "preferUserMessages": true
    }
  },
  "contextState": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `contextConfig` | `object` | **Yes** | Context management configuration |
| `contextConfig.rolling.threshold` | `number` | **Yes** | Messages/tokens before roll triggers |
| `contextConfig.rolling.buffer` | `number` | **Yes** | Buffer to leave uncached after roll |
| `contextConfig.rolling.grace` | `number` | No | Grace period before forced roll |
| `contextConfig.rolling.unit` | `"messages" \| "tokens"` | No | Unit for threshold/buffer (default: `"messages"`) |
| `contextConfig.limits.maxCharacters` | `number` | No | Hard limit on characters (default: 500000) |
| `contextConfig.limits.maxTokens` | `number` | No | Hard limit on tokens |
| `contextConfig.limits.maxMessages` | `number` | No | Hard limit on messages |
| `contextConfig.cache.enabled` | `boolean` | No | Enable caching (default: true) |
| `contextConfig.cache.points` | `1 \| 2 \| 3 \| 4` | No | Number of cache markers (default: 1) |
| `contextConfig.cache.minTokens` | `number` | No | Minimum tokens before caching (default: 1024) |
| `contextConfig.cache.preferUserMessages` | `boolean` | No | Prefer user messages for cache markers |
| `contextState` | `object \| null` | No | State from previous call (null for first call) |

**Response:** SSE stream with a `done` event containing:
```json
{
  "content": [...],
  "stopReason": "end_turn",
  "usage": {...},
  "context": {
    "state": {
      "cacheMarkers": [
        { "messageId": "msg_123", "messageIndex": 10, "tokenEstimate": 5000 }
      ],
      "windowMessageIds": ["msg_100", "msg_101", ...],
      "messagesSinceRoll": 5,
      "tokensSinceRoll": 2500,
      "inGracePeriod": false,
      "lastRollTime": "2025-01-31T12:00:00.000Z",
      "cachedStartMessageId": "msg_100"
    },
    "info": {
      "didRoll": false,
      "messagesDropped": 0,
      "messagesKept": 50,
      "cacheMarkers": [...],
      "cachedTokens": 5000,
      "uncachedTokens": 2500,
      "totalTokens": 7500,
      "hardLimitHit": false,
      "cachedStartMessageId": "msg_100"
    }
  }
}
```

**Client workflow:**
```javascript
let contextState = null;

async function chat(message) {
  const response = await fetch('/v1/context/stream', {
    method: 'POST',
    body: JSON.stringify({
      messages: [...conversationHistory, { participant: 'User', content: message }],
      contextConfig: {
        rolling: { threshold: 50, buffer: 20 }
      },
      contextState  // Pass state from previous call
    })
  });

  // Process SSE stream...
  // When done event received:
  // contextState = doneData.context.state;  // Save for next call
}
```

---

## Request Parameters Reference

### Messages (Required)

```typescript
messages: Array<{
  participant: string;      // "User", "Claude", or custom name
  content: string | ContentBlock[];
}>;
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `participant` | `string` | **Yes** | Role identifier. Use `"User"` for user, `"Claude"` for assistant. |
| `content` | `string \| ContentBlock[]` | **Yes** | Text string or array of content blocks |

### Model Configuration

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `model` | `string` | No | `claude-sonnet-4-20250514` | Model identifier |
| `provider` | `string` | No | `anthropic` | See [Provider Configuration](#provider-configuration) |
| `maxTokens` | `number` | No | `4096` | Max output tokens (capped at server's `MAX_TOKENS_LIMIT`) |
| `temperature` | `number` | No | `1.0` | Sampling temperature (0.0–1.0) |

### System Prompt

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `system` | `string` | No | System/instructions prompt prepended to conversation |

### Tools

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tools` | `ToolDefinition[]` | No | Tool definitions for function calling |
| `toolMode` | `"auto" \| "xml" \| "native"` | No | How tools are presented to the model |

**Tool Definition:**
```typescript
{
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}
```

### Thinking/Reasoning (Extended Thinking)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `thinking.enabled` | `boolean` | **Yes** (if using) | — | Enable extended thinking |
| `thinking.budgetTokens` | `number` | No | — | Token budget for thinking |
| `thinking.outputMode` | `string` | No | `"parsed"` | `"parsed"`, `"tagged"`, `"hidden"`, `"interleaved"` |

### Advanced Options

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `stopSequences` | `string[]` | No | `[]` | Custom stop sequences |
| `promptCaching` | `boolean` | No | `false` | Enable Anthropic prompt caching |
| `cacheTtl` | `"5m" \| "1h"` | No | — | Cache time-to-live |
| `maxParticipantsForStop` | `number` | No | — | Stop after N participant turns |
| `providerParams` | `object` | No | `{}` | Provider-specific passthrough params |
| `formatter` | `"xml" \| "native" \| "completions"` | No | `"xml"` | Message formatter mode |
| `retry` | `object` | No | — | Custom retry configuration |

### Formatter Selection

Controls how messages and tools are formatted for the provider:

| Value | Use Case |
|-------|----------|
| `xml` | Default. Uses XML-based prefill for tools (best for Anthropic) |
| `native` | Uses provider's native tool format (better for OpenAI, OpenRouter) |
| `completions` | For base/completion models (instruct format) |

```json
{
  "messages": [...],
  "provider": "openai-compatible",
  "formatter": "completions",
  "model": "codellama-instruct"
}
```

### Retry Configuration

Customize retry behavior per request:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `retry.maxRetries` | `number` | `3` | Maximum retry attempts |
| `retry.retryDelayMs` | `number` | `1000` | Initial delay before retry (ms) |
| `retry.backoffMultiplier` | `number` | `2` | Exponential backoff multiplier |
| `retry.maxRetryDelayMs` | `number` | `30000` | Maximum delay between retries (ms) |

```json
{
  "messages": [...],
  "retry": {
    "maxRetries": 5,
    "retryDelayMs": 500,
    "backoffMultiplier": 1.5,
    "maxRetryDelayMs": 10000
  }
}
```

### BYOK (Bring Your Own Key)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiKey` | `string` | No | Simple API key for provider |
| `providerConfig` | `object` | No | Full provider configuration (see below) |

**Key Resolution Order:**
1. `apiKey` or `providerConfig.apiKey` in request
2. Server fallback environment variable
3. Error if neither available

---

## Provider Configuration

### Overview

| Provider | Use Case | Required Fields |
|----------|----------|-----------------|
| `anthropic` | Direct Anthropic API | `apiKey` |
| `openrouter` | Multi-provider routing | `apiKey` |
| `openai` | Direct OpenAI API | `apiKey` |
| `openai-compatible` | Ollama, vLLM, local LLMs | `baseUrl` |
| `openai-completions` | Base models (completions API) | `baseUrl` |
| `bedrock` | AWS Bedrock | `accessKeyId`, `secretAccessKey` |

### Provider Config Schema

```typescript
providerConfig: {
  // All providers
  apiKey?: string;

  // OpenAI / OpenAI-Compatible / OpenAI-Completions
  baseUrl?: string;           // e.g., "http://localhost:11434/v1"
  organization?: string;      // OpenAI org ID

  // OpenRouter
  httpReferer?: string;       // For attribution
  xTitle?: string;            // App name for OpenRouter dashboard

  // Bedrock (AWS)
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;      // For temporary credentials
  region?: string;            // Default: "us-west-2"

  // OpenAI Completions
  eotToken?: string;          // End-of-turn token
  stopSequences?: string[];   // Extra stop sequences
}
```

### Provider Examples

**Anthropic (direct):**
```json
{
  "messages": [{"participant": "User", "content": "Hi"}],
  "provider": "anthropic",
  "apiKey": "sk-ant-api03-..."
}
```

**OpenRouter:**
```json
{
  "messages": [{"participant": "User", "content": "Hi"}],
  "provider": "openrouter",
  "model": "anthropic/claude-sonnet-4",
  "apiKey": "sk-or-...",
  "providerConfig": {
    "httpReferer": "https://myapp.com",
    "xTitle": "My App"
  }
}
```

**Ollama (local):**
```json
{
  "messages": [{"participant": "User", "content": "Hi"}],
  "provider": "openai-compatible",
  "model": "llama3",
  "providerConfig": {
    "baseUrl": "http://localhost:11434/v1"
  }
}
```

**AWS Bedrock:**
```json
{
  "messages": [{"participant": "User", "content": "Hi"}],
  "provider": "bedrock",
  "model": "anthropic.claude-3-5-sonnet-20241022-v2:0",
  "providerConfig": {
    "accessKeyId": "AKIA...",
    "secretAccessKey": "...",
    "region": "us-west-2"
  }
}
```

---

## Content Block Types

Content can be a simple string or an array of typed blocks:

| Type | Description | Fields |
|------|-------------|--------|
| `text` | Plain text | `text: string` |
| `image` | Image input | `source: { type, mediaType?, data?, url? }` |
| `tool_use` | Tool call from assistant | `id, name, input` |
| `tool_result` | Tool result from user | `toolUseId, content, isError?` |
| `thinking` | Extended thinking block | `thinking, signature?` |
| `document` | PDF or document | `source: { type, mediaType, data }, filename?` |
| `audio` | Audio input | `source: { type, mediaType, data }, duration?` |
| `video` | Video input | `source: { type, mediaType, data }, duration?` |
| `generated_image` | AI-generated image | `data, mimeType, isPreview?` |
| `redacted_thinking` | Hidden thinking block | (no fields) |

**Image Example:**
```json
{
  "messages": [
    {
      "participant": "User",
      "content": [
        { "type": "text", "text": "What's in this image?" },
        {
          "type": "image",
          "source": {
            "type": "base64",
            "mediaType": "image/png",
            "data": "iVBORw0KGgo..."
          }
        }
      ]
    }
  ]
}
```

---

## Streaming Events (SSE)

| Event | Data | Description |
|-------|------|-------------|
| `stream_start` | `{ streamId }` | Stream started (use `streamId` for abortion) |
| `chunk` | `{ text, type, visible, blockIndex }` | Incremental text chunk |
| `block_start` | `{ index, type }` | New content block started |
| `block_complete` | `{ index, type, content? }` | Content block completed |
| `pre_tool_content` | `{ text }` | Content that appeared before tool calls (for UI preview) |
| `tool_calls` | `{ calls, sessionId }` | Tool calls requiring execution |
| `usage` | `{ inputTokens, outputTokens, ... }` | Token usage update |
| `done` | `CompletionResponse` | Final response (same as `/v1/complete`) |
| `error` | `{ code, message, retryable }` | Error occurred |

### Stream Abortion

Streams can be aborted using the `streamId` from the `stream_start` event:

```javascript
let currentStreamId = null;

eventSource.addEventListener('stream_start', (e) => {
  currentStreamId = JSON.parse(e.data).streamId;
});

// Later, to abort:
if (currentStreamId) {
  await fetch(`/v1/abort/${currentStreamId}`, { method: 'POST' });
}
```

### Pre-Tool Content

The `pre_tool_content` event fires when the assistant writes text before making tool calls. This is useful for showing partial responses in the UI while tools execute:

```javascript
let currentResponse = '';

eventSource.addEventListener('chunk', (e) => {
  currentResponse += JSON.parse(e.data).text;
  updateUI(currentResponse);
});

eventSource.addEventListener('pre_tool_content', (e) => {
  // This contains the text before tool calls
  // Already included in chunks, but useful as a snapshot
  const preToolText = JSON.parse(e.data).text;
  showToolExecutionIndicator(preToolText);
});
```

**Handling Tool Calls:**
```javascript
eventSource.addEventListener('tool_calls', (e) => {
  const { calls, sessionId } = JSON.parse(e.data);
  
  // Execute each tool
  const results = await Promise.all(calls.map(async (call) => ({
    toolUseId: call.id,
    content: await executeTool(call.name, call.input),
    isError: false
  })));
  
  // Continue the conversation
  await fetch('/v1/continue', {
    method: 'POST',
    body: JSON.stringify({ sessionId, toolResults: results })
  });
});
```

---

## Error Handling

**Error Response Format:**
```json
{
  "error": {
    "code": "invalid_request",
    "message": "sessionId and toolResults are required",
    "retryable": false,
    "details": [...]
  }
}
```

| Code | HTTP Status | Retryable | Description |
|------|-------------|-----------|-------------|
| `unauthorized` | 401 | No | Invalid or missing API token |
| `invalid_request` | 400 | No | Malformed request body |
| `not_found` | 404 | No | Resource not found (e.g., session) |
| `session_not_found` | 404 | No | Session expired or invalid |
| `rate_limit` | 429 | **Yes** | Provider rate limited |
| `overloaded` | 500 | **Yes** | Provider overloaded |
| `timeout` | 500 | **Yes** | Request timed out |
| `internal_error` | 500 | No | Unexpected server error |

**Retry Strategy:**
```javascript
async function withRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!e.retryable || i === maxRetries - 1) throw e;
      await sleep(Math.pow(2, i) * 1000); // Exponential backoff
    }
  }
}
```

---

## Usage Recommendations

### When to Use Each Endpoint

| Use Case | Endpoint | Reason |
|----------|----------|--------|
| Quick single responses | `/v1/complete` | Simpler, returns full response |
| Real-time chat UI | `/v1/stream` | Progressive display |
| Long-running generation | `/v1/stream` | Avoid timeouts |
| Function/tool calling | `/v1/stream` + `/v1/continue` | Handle tool execution |

### Best Practices

1. **Use server fallback keys for internal services**
   ```bash
   # In .env on server
   ANTHROPIC_API_KEY=sk-ant-...
   ```
   Then omit `apiKey` in requests from trusted internal services.

2. **Use BYOK for public/untrusted clients**
   ```json
   { "apiKey": "user-provided-key", ... }
   ```

3. **Set reasonable `maxTokens`**
   - Default is 4096
   - Server caps at `MAX_TOKENS_LIMIT` (default 32000)
   - Higher values = longer latency + cost

4. **Use streaming for anything >10s expected**
   - Prevents HTTP timeout issues
   - Better UX with progressive display

5. **Handle tool continuation properly**
   ```
   /v1/stream → tool_calls event → execute tools → /v1/continue → repeat until done
   ```
   
6. **Clean up sessions when done early**
   ```bash
   curl -X DELETE /v1/sessions/sess_abc123
   ```
   Sessions auto-expire after 5 minutes, but explicit cleanup is polite.

7. **Enable prompt caching for repeated system prompts**
   ```json
   { "promptCaching": true, "cacheTtl": "1h", ... }
   ```

### Token Usage Tracking

```json
{
  "usage": {
    "inputTokens": 1500,
    "outputTokens": 500,
    "cacheCreationTokens": 1000,
    "cacheReadTokens": 500
  }
}
```

- `inputTokens`: Tokens sent to model
- `outputTokens`: Tokens generated
- `cacheCreationTokens`: Tokens cached (first request)
- `cacheReadTokens`: Tokens read from cache (subsequent)

### Local LLM Configuration

For Ollama or other local servers:

```json
{
  "provider": "openai-compatible",
  "model": "llama3",
  "providerConfig": {
    "baseUrl": "http://localhost:11434/v1"
  }
}
```

> **Note:** `apiKey` can be omitted or set to any string for servers that don't require auth.

---

## Quick Copy-Paste Examples

### Simple Chat (curl)
```bash
curl -X POST http://127.0.0.1:3001/v1/complete \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"participant": "User", "content": "What is 2+2?"}]
  }'
```

### With BYOK (curl)
```bash
curl -X POST http://127.0.0.1:3001/v1/complete \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"participant": "User", "content": "Hello!"}],
    "apiKey": "sk-ant-api03-..."
  }'
```

### Streaming (JavaScript)
```javascript
const response = await fetch('http://127.0.0.1:3001/v1/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ participant: 'User', content: 'Tell me a story' }]
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const text = decoder.decode(value);
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      if (data.text) process.stdout.write(data.text);
    }
  }
}
```

### Python (with aethera.utils.llm)
```python
from aethera.utils.llm import simple_chat, stream_chat, LLMClient

# One-shot
response = await simple_chat("What is 2+2?")
print(response)

# Streaming
async for chunk in stream_chat("Tell me a story"):
    print(chunk, end="", flush=True)

# Multi-request with same key
async with LLMClient(provider_api_key="sk-ant-...") as client:
    r1 = await client.complete([{"participant": "User", "content": "Hi"}])
    r2 = await client.complete([{"participant": "User", "content": "Bye"}])
```

### Python (raw httpx)
```python
import httpx

async def complete(messages, api_key=None, **kwargs):
    async with httpx.AsyncClient() as client:
        r = await client.post(
            "http://127.0.0.1:3001/v1/complete",
            json={"messages": messages, "apiKey": api_key, **kwargs},
            timeout=300.0
        )
        r.raise_for_status()
        return r.json()

result = await complete(
    [{"participant": "User", "content": "Hello!"}],
    model="claude-3-5-haiku-20241022"
)
```

