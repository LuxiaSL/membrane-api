# membrane-api

HTTP API wrapper for [@animalabs/membrane](../membrane) LLM middleware.

Exposes membrane's full functionality via REST/SSE endpoints, allowing any language to use the library's capabilities (retries, caching, tool execution, streaming, multi-provider support).

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Development
npm run dev

# Production
npm run build
npm start
```

## Supported Providers

| Provider | Description | Requires |
|----------|-------------|----------|
| `anthropic` | Direct Anthropic API | `apiKey` |
| `openrouter` | OpenRouter (routes to many models) | `apiKey` |
| `openai` | Direct OpenAI API | `apiKey` |
| `openai-compatible` | Any OpenAI-compatible endpoint (Ollama, vLLM, etc.) | `baseUrl` |
| `openai-completions` | OpenAI completions API (base models) | `baseUrl` |
| `bedrock` | AWS Bedrock | `accessKeyId`, `secretAccessKey` |

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `HOST` | `127.0.0.1` | Bind address (use 127.0.0.1 for local-only) |
| `API_TOKEN` | (none) | Bearer token for auth (optional) |
| **Provider Fallback Keys** | | |
| `ANTHROPIC_API_KEY` | (none) | Fallback Anthropic API key |
| `OPENROUTER_API_KEY` | (none) | Fallback OpenRouter API key |
| `OPENAI_API_KEY` | (none) | Fallback OpenAI API key |
| `OPENAI_BASE_URL` | (none) | Custom OpenAI base URL |
| `OPENAI_COMPATIBLE_BASE_URL` | (none) | Fallback OpenAI-compatible base URL |
| `OPENAI_COMPLETIONS_BASE_URL` | (none) | Fallback OpenAI completions base URL |
| `AWS_ACCESS_KEY_ID` | (none) | Fallback Bedrock access key |
| `AWS_SECRET_ACCESS_KEY` | (none) | Fallback Bedrock secret key |
| `AWS_REGION` | `us-west-2` | Bedrock region |
| **Defaults** | | |
| `DEFAULT_PROVIDER` | `anthropic` | Default provider if not specified |
| `DEFAULT_MODEL` | `claude-sonnet-4-20250514` | Default model if not specified |
| `MAX_TOKENS_LIMIT` | `32000` | Maximum tokens allowed per request |
| `REQUEST_TIMEOUT_MS` | `300000` | Request timeout (5 min) |
| `LOG_LEVEL` | `info` | Logging level |

### BYOK (Bring Your Own Key)

All providers support BYOK. Credentials are resolved in order:

1. **Per-request**: `apiKey` or `providerConfig` in request body
2. **Server fallback**: Environment variables (if configured)
3. **Error**: Clear message if neither is available

This allows:
- **Internal services** (blog, admin) to use server-configured keys
- **Public APIs** to require clients to bring their own keys
- **Local LLMs** via openai-compatible with custom baseUrl
- **Mixed mode** where some providers have fallbacks and others require BYOK

## API Endpoints

### Health Check

```
GET /health
```

Returns server health and provider status.

```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 123456,
  "providers": {
    "anthropic": { "configured": true, "healthy": true },
    "openrouter": { "configured": false, "healthy": false }
  }
}
```

### List Models

```
GET /v1/models
```

Returns available models for configured providers.

### Non-Streaming Completion

```
POST /v1/complete
Content-Type: application/json
Authorization: Bearer <token>

{
  "messages": [
    { "participant": "User", "content": "Hello!" }
  ],
  "model": "claude-sonnet-4-20250514",
  "maxTokens": 1024,
  "apiKey": "sk-ant-..."  // Optional: BYOK - omit to use server fallback
}
```

### Using Local LLMs (openai-compatible)

```json
{
  "messages": [{"participant": "User", "content": "Hello!"}],
  "provider": "openai-compatible",
  "model": "llama3",
  "providerConfig": {
    "baseUrl": "http://localhost:11434/v1"
  }
}
```

### Using AWS Bedrock

```json
{
  "messages": [{"participant": "User", "content": "Hello!"}],
  "provider": "bedrock",
  "model": "anthropic.claude-3-5-sonnet-20241022-v2:0",
  "providerConfig": {
    "accessKeyId": "AKIA...",
    "secretAccessKey": "...",
    "region": "us-west-2"
  }
}
```

Response:

```json
{
  "content": [{ "type": "text", "text": "Hello! How can I help?" }],
  "rawAssistantText": "Hello! How can I help?",
  "toolCalls": [],
  "toolResults": [],
  "stopReason": "end_turn",
  "usage": { "inputTokens": 10, "outputTokens": 8 },
  "model": "claude-sonnet-4-20250514",
  "provider": "anthropic",
  "durationMs": 1234
}
```

### Streaming Completion (SSE)

```
POST /v1/stream
Content-Type: application/json
Authorization: Bearer <token>

{
  "messages": [
    { "participant": "User", "content": "Tell me a story" }
  ]
}
```

Returns Server-Sent Events:

```
event: chunk
data: {"text":"Once","type":"text","visible":true,"blockIndex":0}

event: chunk
data: {"text":" upon","type":"text","visible":true,"blockIndex":0}

event: usage
data: {"inputTokens":10,"outputTokens":50}

event: done
data: {"content":[...],"stopReason":"end_turn",...}
```

### Tool Continuation

When streaming returns tool calls, use the session ID to continue:

```
POST /v1/continue
Content-Type: application/json

{
  "sessionId": "sess_abc123",
  "toolResults": [
    {
      "toolUseId": "tool_xyz",
      "content": "Result of tool execution",
      "isError": false
    }
  ]
}
```

### Request Options

Full request schema:

```typescript
{
  // Required
  messages: Array<{
    participant: string;      // "User", "Claude", or custom name
    content: string | ContentBlock[];
  }>;

  // Model configuration
  model?: string;             // Model ID
  provider?: "anthropic" | "openrouter" | "openai" | "openai-compatible" | "openai-completions" | "bedrock";
  maxTokens?: number;         // Max output tokens
  temperature?: number;       // 0.0 - 1.0

  // System prompt
  system?: string;

  // Tool configuration
  tools?: Array<{
    name: string;
    description: string;
    inputSchema: JSONSchema;
  }>;
  toolMode?: "auto" | "xml" | "native";

  // Thinking/reasoning
  thinking?: {
    enabled: boolean;
    budgetTokens?: number;
    outputMode?: "parsed" | "tagged" | "hidden" | "interleaved";
  };

  // Advanced
  stopSequences?: string[];
  promptCaching?: boolean;
  cacheTtl?: "5m" | "1h";
  maxParticipantsForStop?: number;
  providerParams?: Record<string, unknown>;

  // BYOK: API key for the provider (optional - falls back to server config)
  apiKey?: string;
  
  // Full provider config for complex providers
  providerConfig?: {
    apiKey?: string;
    baseUrl?: string;           // For openai-compatible, openai-completions
    organization?: string;      // For OpenAI
    httpReferer?: string;       // For OpenRouter
    xTitle?: string;            // For OpenRouter
    accessKeyId?: string;       // For Bedrock
    secretAccessKey?: string;   // For Bedrock
    sessionToken?: string;      // For Bedrock
    region?: string;            // For Bedrock
    eotToken?: string;          // For openai-completions
    stopSequences?: string[];   // For openai-completions
  };
}
```

## Deployment

### systemd Service

Create `/etc/systemd/system/membrane-api.service`:

```ini
[Unit]
Description=membrane-api LLM middleware
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/aethera-server/membrane-api
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

# Environment
Environment=NODE_ENV=production
EnvironmentFile=/opt/aethera-server/membrane-api/.env

# Security
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/aethera-server/membrane-api

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable membrane-api
sudo systemctl start membrane-api
```

### With Caddy (optional, if you want external access)

```caddyfile
llm.aetherawi.red {
    reverse_proxy localhost:3001
}
```

Usually you'd keep this internal-only (127.0.0.1).

## Python Client Example

The `aethera.utils.llm` module provides a full-featured async client:

```python
from aethera.utils.llm import complete, stream, simple_chat, LLMClient

# Simple one-shot (uses server fallback key)
response = await simple_chat("What is 2+2?")

# With BYOK (Bring Your Own Key)
response = await simple_chat(
    "Hello!",
    api_key="sk-ant-api03-...",
    provider="anthropic"
)

# Streaming
async for chunk in stream_chat("Tell me a story"):
    print(chunk, end="", flush=True)

# Full client for multiple requests with same key
async with LLMClient(provider_api_key="sk-ant-...") as client:
    r1 = await client.complete([{"participant": "User", "content": "Hi"}])
    r2 = await client.complete([{"participant": "User", "content": "Bye"}])
```

Or use raw httpx:

```python
import httpx
import json

MEMBRANE_URL = "http://127.0.0.1:3001"

async def complete(messages: list[dict], api_key: str = None, **kwargs) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{MEMBRANE_URL}/v1/complete",
            json={"messages": messages, "apiKey": api_key, **kwargs},
            timeout=300.0,
        )
        response.raise_for_status()
        return response.json()
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Python App     │────▶│                 │────▶│  Anthropic   │
│  (FastAPI)      │     │  membrane-api   │     │  API         │
├─────────────────┤     │  :3001          │     ├──────────────┤
│  Node.js App    │────▶│                 │────▶│  OpenRouter  │
│                 │     │  @animalabs/    │     │  API         │
├─────────────────┤     │  membrane       │     └──────────────┘
│  Any HTTP       │────▶│                 │
│  Client         │     └─────────────────┘
└─────────────────┘
```

Benefits:
- **Single source of truth** for LLM logic
- **Unified API key management**
- **Consistent behavior** (retries, caching, tools)
- **Language agnostic** - any HTTP client works
- **Stable interface** - membrane upgrades don't break clients

