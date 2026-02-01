/**
 * membrane-api server
 * 
 * Fastify server exposing membrane functionality via HTTP/SSE.
 */

import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import type {
  NormalizedRequest,
  ContentBlock as MembraneContentBlock,
  ToolCall,
  ToolResult,
  NormalizedResponse,
  AbortedResponse,
} from '@animalabs/membrane';
import { isAbortedResponse } from '@animalabs/membrane';

import type { Config } from './config.js';
import {
  CompletionRequestSchema,
  type CompletionRequest,
  type CompletionResponse,
  type StreamEvent,
  type HealthResponse,
  type ModelsResponse,
  type ErrorResponse,
  type ContentBlock,
} from './types.js';
import {
  createMembrane,
  getProviderHealth,
  getConfiguredProviders,
  getAvailableProviders,
  hasServerKey,
  updateProviderHealth,
  type ProviderName,
} from './providers.js';
import {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  getSessionCount,
} from './sessions.js';

// Package version (updated manually or via build)
const VERSION = '1.0.0';
const startTime = Date.now();

/**
 * Create and configure the Fastify server
 */
export async function createServer(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  // CORS for cross-origin requests
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  // Authentication middleware
  if (config.apiToken) {
    app.addHook('onRequest', async (request, reply) => {
      // Skip auth for health endpoint
      if (request.url === '/health') {
        return;
      }

      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.code(401).send({
          error: {
            code: 'unauthorized',
            message: 'Missing or invalid Authorization header',
            retryable: false,
          },
        } satisfies ErrorResponse);
        return;
      }

      const token = authHeader.slice(7);
      if (token !== config.apiToken) {
        reply.code(401).send({
          error: {
            code: 'unauthorized',
            message: 'Invalid API token',
            retryable: false,
          },
        } satisfies ErrorResponse);
        return;
      }
    });
  }

  // ==========================================================================
  // Health endpoint
  // ==========================================================================

  app.get('/health', async (): Promise<HealthResponse> => {
    const providers = {
      anthropic: getProviderHealth('anthropic'),
      openrouter: getProviderHealth('openrouter'),
      openai: getProviderHealth('openai'),
      'openai-compatible': getProviderHealth('openai-compatible'),
      'openai-completions': getProviderHealth('openai-completions'),
      bedrock: getProviderHealth('bedrock'),
    };

    const configuredCount = Object.values(providers).filter(p => p.configured).length;
    const healthyCount = Object.values(providers).filter(p => p.configured && p.healthy).length;

    // In BYOK mode (nothing configured), we're still healthy
    // Otherwise, check if any configured providers are healthy
    const status = configuredCount === 0 
      ? 'ok'  // Pure BYOK mode is healthy
      : healthyCount > 0 
        ? 'ok' 
        : 'degraded';

    return {
      status,
      version: VERSION,
      uptime: Date.now() - startTime,
      providers,
    };
  });

  // ==========================================================================
  // Models endpoint
  // ==========================================================================

  app.get('/v1/models', async (): Promise<ModelsResponse> => {
    const models = [];

    // Anthropic models (always available via BYOK, marked if server has key)
    // Show all models - clients can use any with their own key
    {
      models.push(
        {
          id: 'claude-sonnet-4-20250514',
          name: 'Claude Sonnet 4',
          provider: 'anthropic' as const,
          contextWindow: 200000,
          maxOutput: 64000,
          supportsTools: true,
          supportsThinking: true,
          supportsImages: true,
        },
        {
          id: 'claude-3-5-sonnet-20241022',
          name: 'Claude 3.5 Sonnet',
          provider: 'anthropic' as const,
          contextWindow: 200000,
          maxOutput: 8192,
          supportsTools: true,
          supportsThinking: false,
          supportsImages: true,
        },
        {
          id: 'claude-3-5-haiku-20241022',
          name: 'Claude 3.5 Haiku',
          provider: 'anthropic' as const,
          contextWindow: 200000,
          maxOutput: 8192,
          supportsTools: true,
          supportsThinking: false,
          supportsImages: true,
        },
        {
          id: 'claude-3-opus-20240229',
          name: 'Claude 3 Opus',
          provider: 'anthropic' as const,
          contextWindow: 200000,
          maxOutput: 4096,
          supportsTools: true,
          supportsThinking: false,
          supportsImages: true,
        }
      );
    }

    // OpenRouter models (subset - they have many more)
    {
      models.push(
        {
          id: 'anthropic/claude-sonnet-4',
          name: 'Claude Sonnet 4 (via OpenRouter)',
          provider: 'openrouter' as const,
          contextWindow: 200000,
          maxOutput: 64000,
          supportsTools: true,
          supportsThinking: true,
          supportsImages: true,
        },
        {
          id: 'anthropic/claude-3.5-sonnet',
          name: 'Claude 3.5 Sonnet (via OpenRouter)',
          provider: 'openrouter' as const,
          contextWindow: 200000,
          maxOutput: 8192,
          supportsTools: true,
          supportsThinking: false,
          supportsImages: true,
        },
        {
          id: 'google/gemini-2.0-flash-001',
          name: 'Gemini 2.0 Flash',
          provider: 'openrouter' as const,
          contextWindow: 1000000,
          maxOutput: 8192,
          supportsTools: true,
          supportsThinking: false,
          supportsImages: true,
        },
        {
          id: 'openai/gpt-4o',
          name: 'GPT-4o',
          provider: 'openrouter' as const,
          contextWindow: 128000,
          maxOutput: 16384,
          supportsTools: true,
          supportsThinking: false,
          supportsImages: true,
        }
      );
    }

    // OpenAI direct models
    {
      models.push(
        {
          id: 'gpt-4o',
          name: 'GPT-4o',
          provider: 'openai' as const,
          contextWindow: 128000,
          maxOutput: 16384,
          supportsTools: true,
          supportsThinking: false,
          supportsImages: true,
        },
        {
          id: 'gpt-4o-mini',
          name: 'GPT-4o Mini',
          provider: 'openai' as const,
          contextWindow: 128000,
          maxOutput: 16384,
          supportsTools: true,
          supportsThinking: false,
          supportsImages: true,
        },
        {
          id: 'o1',
          name: 'o1',
          provider: 'openai' as const,
          contextWindow: 200000,
          maxOutput: 100000,
          supportsTools: true,
          supportsThinking: true,
          supportsImages: true,
        },
        {
          id: 'o3-mini',
          name: 'o3 Mini',
          provider: 'openai' as const,
          contextWindow: 200000,
          maxOutput: 100000,
          supportsTools: true,
          supportsThinking: true,
          supportsImages: false,
        }
      );
    }

    // Bedrock models (Claude via AWS)
    {
      models.push(
        {
          id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          name: 'Claude 3.5 Sonnet v2 (Bedrock)',
          provider: 'bedrock' as const,
          contextWindow: 200000,
          maxOutput: 8192,
          supportsTools: true,
          supportsThinking: false,
          supportsImages: true,
        },
        {
          id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
          name: 'Claude 3.5 Haiku (Bedrock)',
          provider: 'bedrock' as const,
          contextWindow: 200000,
          maxOutput: 8192,
          supportsTools: true,
          supportsThinking: false,
          supportsImages: true,
        }
      );
    }

    // Note: openai-compatible and openai-completions providers support any model
    // The client specifies the model name when making requests with BYOK

    return {
      models,
      defaultModel: config.defaultModel,
    };
  });

  // ==========================================================================
  // Non-streaming completion
  // ==========================================================================

  app.post('/v1/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = CompletionRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'Invalid request body',
          retryable: false,
          details: parseResult.error.issues,
        },
      } satisfies ErrorResponse);
      return;
    }

    const req = parseResult.data;
    const provider = (req.provider ?? config.defaultProvider) as ProviderName;

    try {
      // Create membrane instance with BYOK or fallback key
      const membrane = createMembrane(provider, req.apiKey, req.providerConfig);
      const normalizedRequest = buildNormalizedRequest(req, config);

      const startMs = Date.now();
      const response = await membrane.complete(normalizedRequest, {
        timeoutMs: config.requestTimeoutMs,
      });

      updateProviderHealth(provider, true);

      const result = buildCompletionResponse(response, provider, Date.now() - startMs);
      reply.send(result);
    } catch (error) {
      updateProviderHealth(provider, false);
      handleError(error, reply);
    }
  });

  // ==========================================================================
  // Streaming completion (SSE)
  // ==========================================================================

  app.post('/v1/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = CompletionRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'Invalid request body',
          retryable: false,
          details: parseResult.error.issues,
        },
      } satisfies ErrorResponse);
      return;
    }

    const req = parseResult.data;
    const provider = (req.provider ?? config.defaultProvider) as ProviderName;

    // Set up SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    const sendEvent = (event: StreamEvent) => {
      reply.raw.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };

    try {
      // Create membrane instance with BYOK or fallback key
      const membrane = createMembrane(provider, req.apiKey, req.providerConfig);
      const normalizedRequest = buildNormalizedRequest(req, config);

      const startMs = Date.now();

      // Track state for potential session creation
      let rawAssistantText = '';
      const contentBlocks: MembraneContentBlock[] = [];
      let pendingToolCalls: ToolCall[] = [];
      const executedToolResults: ToolResult[] = [];
      let totalUsage = { inputTokens: 0, outputTokens: 0 };

      // If client tries to use continueFrom, redirect them to /v1/continue
      if (req.continueFrom) {
        sendEvent({
          event: 'error',
          data: {
            code: 'use_continue_endpoint',
            message: 'To continue with tool results, use POST /v1/continue with sessionId and toolResults',
            retryable: false,
          },
        });
        reply.raw.end();
        return;
      }

      const response = await membrane.stream(normalizedRequest, {
        timeoutMs: config.requestTimeoutMs,

        onChunk: (chunk, meta) => {
          rawAssistantText += chunk;
          sendEvent({
            event: 'chunk',
            data: {
              text: chunk,
              type: meta.type ?? 'text',
              visible: meta.visible ?? true,
              blockIndex: meta.blockIndex ?? 0,
            },
          });
        },

        onBlock: (blockEvent) => {
          if (blockEvent.event === 'block_start') {
            sendEvent({
              event: 'block_start',
              data: {
                index: blockEvent.index,
                type: blockEvent.block.type,
              },
            });
          } else if (blockEvent.event === 'block_complete') {
            sendEvent({
              event: 'block_complete',
              data: {
                index: blockEvent.index,
                type: blockEvent.block.type,
                content: 'content' in blockEvent.block ? blockEvent.block.content : undefined,
              },
            });
          }
        },

        onUsage: (usage) => {
          totalUsage = { ...usage };
          sendEvent({
            event: 'usage',
            data: usage,
          });
        },

        // For server-side tool execution, we'd implement onToolCalls here
        // For now, we let the client handle tools via the session flow
      });

      updateProviderHealth(provider, true);

      // Check if response needs tool execution
      if (!isAbortedResponse(response)) {
        const normalResponse = response as NormalizedResponse;

        // If there are tool calls and client should handle them
        if (normalResponse.toolCalls.length > 0 && normalResponse.stopReason === 'tool_use') {
          // Create session for continuation (store API key and config for BYOK)
          const session = createSession(provider, normalizedRequest, {
            rawAssistantText: normalResponse.rawAssistantText,
            contentBlocks: normalResponse.content,
            toolCalls: normalResponse.toolCalls,
            executedToolResults: [],
            usage: normalResponse.usage,
          }, { apiKey: req.apiKey, providerConfig: req.providerConfig });

          sendEvent({
            event: 'tool_calls',
            data: {
              calls: normalResponse.toolCalls,
              sessionId: session.id,
            },
          });
        }

        // Send final response
        const result = buildCompletionResponse(normalResponse, provider, Date.now() - startMs);
        sendEvent({ event: 'done', data: result });
      } else {
        // Aborted response
        const aborted = response as AbortedResponse;
        sendEvent({
          event: 'done',
          data: {
            content: aborted.partialContent ?? [],
            rawAssistantText: aborted.rawAssistantText ?? '',
            toolCalls: aborted.toolCalls ?? [],
            toolResults: [],
            stopReason: 'end_turn',
            usage: aborted.partialUsage ?? { inputTokens: 0, outputTokens: 0 },
            model: req.model ?? config.defaultModel,
            provider,
            durationMs: Date.now() - startMs,
          },
        });
      }
    } catch (error) {
      updateProviderHealth(provider, false);

      const errorInfo = parseError(error);
      sendEvent({
        event: 'error',
        data: errorInfo,
      });
    } finally {
      reply.raw.end();
    }
  });

  // ==========================================================================
  // Tool results continuation
  // ==========================================================================

  app.post('/v1/continue', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      sessionId: string;
      toolResults: Array<{
        toolUseId: string;
        content: string | unknown[];
        isError?: boolean;
      }>;
    };

    if (!body.sessionId || !Array.isArray(body.toolResults)) {
      reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'sessionId and toolResults are required',
          retryable: false,
        },
      } satisfies ErrorResponse);
      return;
    }

    const session = getSession(body.sessionId);
    if (!session) {
      reply.code(404).send({
        error: {
          code: 'session_not_found',
          message: 'Session not found or expired',
          retryable: false,
        },
      } satisfies ErrorResponse);
      return;
    }

    // Set up SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendEvent = (event: StreamEvent) => {
      reply.raw.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };

    try {
      // Recreate membrane with the stored API key and config (BYOK) or fallback
      const membrane = createMembrane(session.provider, session.apiKey, session.providerConfig);

      // Build continued request with tool results
      const toolResults = body.toolResults.map(r => ({
        toolUseId: r.toolUseId,
        content: r.content,
        isError: r.isError,
      })) as ToolResult[];

      // Add tool results to session
      session.executedToolResults.push(...toolResults);

      // Rebuild messages with assistant response + tool results
      const messages = [...session.request.messages];

      // Add assistant message with tool calls
      messages.push({
        participant: 'Claude',
        content: session.contentBlocks,
      });

      // Add user message with tool results
      messages.push({
        participant: 'User',
        content: toolResults.map(r => ({
          type: 'tool_result' as const,
          toolUseId: r.toolUseId,
          content: r.content,
          isError: r.isError,
        })),
      });

      const continuedRequest: NormalizedRequest = {
        ...session.request,
        messages,
      };

      const startMs = Date.now();

      const response = await membrane.stream(continuedRequest, {
        onChunk: (chunk, meta) => {
          sendEvent({
            event: 'chunk',
            data: {
              text: chunk,
              type: meta.type ?? 'text',
              visible: meta.visible ?? true,
              blockIndex: meta.blockIndex ?? 0,
            },
          });
        },

        onBlock: (blockEvent) => {
          if (blockEvent.event === 'block_start') {
            sendEvent({
              event: 'block_start',
              data: {
                index: blockEvent.index,
                type: blockEvent.block.type,
              },
            });
          } else if (blockEvent.event === 'block_complete') {
            sendEvent({
              event: 'block_complete',
              data: {
                index: blockEvent.index,
                type: blockEvent.block.type,
                content: 'content' in blockEvent.block ? blockEvent.block.content : undefined,
              },
            });
          }
        },

        onUsage: (usage) => {
          sendEvent({ event: 'usage', data: usage });
        },
      });

      updateProviderHealth(session.provider, true);

      if (!isAbortedResponse(response)) {
        const normalResponse = response as NormalizedResponse;

        // Check for more tool calls
        if (normalResponse.toolCalls.length > 0 && normalResponse.stopReason === 'tool_use') {
          // Update session for another round
          updateSession(body.sessionId, {
            rawAssistantText: session.rawAssistantText + normalResponse.rawAssistantText,
            contentBlocks: normalResponse.content,
            toolCalls: normalResponse.toolCalls,
            usage: {
              inputTokens: session.usage.inputTokens + normalResponse.usage.inputTokens,
              outputTokens: session.usage.outputTokens + normalResponse.usage.outputTokens,
            },
          });

          sendEvent({
            event: 'tool_calls',
            data: {
              calls: normalResponse.toolCalls,
              sessionId: body.sessionId,
            },
          });
        } else {
          // Done - clean up session
          deleteSession(body.sessionId);
        }

        const result = buildCompletionResponse(normalResponse, session.provider, Date.now() - startMs);
        sendEvent({ event: 'done', data: result });
      } else {
        // Handle aborted response - send partial content and clean up session
        const aborted = response as AbortedResponse;
        deleteSession(body.sessionId);
        
        sendEvent({
          event: 'done',
          data: {
            content: aborted.partialContent ?? [],
            rawAssistantText: aborted.rawAssistantText ?? '',
            toolCalls: aborted.toolCalls ?? [],
            toolResults: [],
            stopReason: 'end_turn',
            usage: aborted.partialUsage ?? { inputTokens: 0, outputTokens: 0 },
            model: session.request.config.model,
            provider: session.provider,
            durationMs: Date.now() - startMs,
          },
        });
      }
    } catch (error) {
      updateProviderHealth(session.provider, false);
      const errorInfo = parseError(error);
      sendEvent({ event: 'error', data: errorInfo });
    } finally {
      reply.raw.end();
    }
  });

  // ==========================================================================
  // Session cleanup
  // ==========================================================================

  app.delete('/v1/sessions/:sessionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };
    deleteSession(sessionId);
    reply.code(204).send();
  });

  // ==========================================================================
  // Stats endpoint (for monitoring)
  // ==========================================================================

  app.get('/v1/stats', async () => {
    return {
      uptime: Date.now() - startTime,
      activeSessions: getSessionCount(),
      providers: getConfiguredProviders(),
    };
  });

  return app;
}

// =============================================================================
// Helper Functions
// =============================================================================

function buildNormalizedRequest(req: CompletionRequest, config: Config): NormalizedRequest {
  // Convert messages to membrane format
  const messages = req.messages.map(m => ({
    participant: m.participant,
    content: typeof m.content === 'string'
      ? [{ type: 'text' as const, text: m.content }]
      : m.content as MembraneContentBlock[],
  }));

  // Convert tools to membrane format (cast inputSchema to any for flexibility)
  const tools = req.tools?.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as any,
  }));

  return {
    messages,
    system: req.system,
    tools,
    toolMode: req.toolMode,
    config: {
      model: req.model ?? config.defaultModel,
      maxTokens: Math.min(req.maxTokens ?? 4096, config.maxTokensLimit),
      temperature: req.temperature ?? 1.0,
      thinking: req.thinking,
    },
    stopSequences: req.stopSequences,
    promptCaching: req.promptCaching,
    cacheTtl: req.cacheTtl,
    maxParticipantsForStop: req.maxParticipantsForStop,
    providerParams: req.providerParams,
  };
}

function buildCompletionResponse(
  response: NormalizedResponse,
  provider: string,
  durationMs: number
): CompletionResponse {
  return {
    // Cast membrane ContentBlock[] to our API ContentBlock[] - they're compatible
    content: response.content as unknown as ContentBlock[],
    rawAssistantText: response.rawAssistantText,
    toolCalls: response.toolCalls,
    toolResults: response.toolResults.map(r => ({
      toolUseId: r.toolUseId,
      content: r.content as string | unknown[],
      isError: r.isError,
    })),
    // Cast stop reason - our type is a superset
    stopReason: response.stopReason as CompletionResponse['stopReason'],
    usage: response.usage,
    model: response.details.model.actual,
    provider,
    durationMs,
    requiresToolResults: response.toolCalls.length > 0 && response.stopReason === 'tool_use',
  };
}

function parseError(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof Error) {
    // Check for membrane error types
    if ('code' in error) {
      const code = (error as any).code;
      return {
        code: typeof code === 'string' ? code : 'unknown_error',
        message: error.message,
        retryable: ['rate_limit', 'overloaded', 'timeout'].includes(code),
      };
    }

    return {
      code: 'internal_error',
      message: error.message,
      retryable: false,
    };
  }

  return {
    code: 'unknown_error',
    message: String(error),
    retryable: false,
  };
}

function handleError(error: unknown, reply: FastifyReply): void {
  const errorInfo = parseError(error);

  const statusCode =
    errorInfo.code === 'rate_limit' ? 429 :
    errorInfo.code === 'unauthorized' ? 401 :
    errorInfo.code === 'invalid_request' ? 400 :
    errorInfo.code === 'not_found' ? 404 :
    500;

  reply.code(statusCode).send({
    error: errorInfo,
  } satisfies ErrorResponse);
}

