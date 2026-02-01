/**
 * membrane-api request/response types
 * 
 * These define the JSON contract between clients and the API.
 * Designed to closely mirror membrane's NormalizedRequest/Response
 * while being HTTP-friendly.
 */

import { z } from 'zod';

// =============================================================================
// Content Blocks
// =============================================================================

export const TextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const ImageBlockSchema = z.object({
  type: z.literal('image'),
  source: z.object({
    type: z.enum(['base64', 'url']),
    mediaType: z.string().optional(),
    data: z.string().optional(),
    url: z.string().optional(),
  }),
});

export const ToolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()),
});

export const ToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  toolUseId: z.string(),
  content: z.union([z.string(), z.array(z.unknown())]),
  isError: z.boolean().optional(),
});

export const ThinkingBlockSchema = z.object({
  type: z.literal('thinking'),
  thinking: z.string(),
  signature: z.string().optional(),
});

export const DocumentBlockSchema = z.object({
  type: z.literal('document'),
  source: z.object({
    type: z.literal('base64'),
    mediaType: z.string(),
    data: z.string(),
  }),
  filename: z.string().optional(),
});

export const AudioBlockSchema = z.object({
  type: z.literal('audio'),
  source: z.object({
    type: z.literal('base64'),
    mediaType: z.string(),
    data: z.string(),
  }),
  duration: z.number().optional(),
});

export const VideoBlockSchema = z.object({
  type: z.literal('video'),
  source: z.object({
    type: z.literal('base64'),
    mediaType: z.string(),
    data: z.string(),
  }),
  duration: z.number().optional(),
});

export const GeneratedImageBlockSchema = z.object({
  type: z.literal('generated_image'),
  data: z.string(),
  mimeType: z.string(),
  isPreview: z.boolean().optional(),
});

export const RedactedThinkingBlockSchema = z.object({
  type: z.literal('redacted_thinking'),
});

export const ContentBlockSchema = z.discriminatedUnion('type', [
  TextBlockSchema,
  ImageBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema,
  ThinkingBlockSchema,
  DocumentBlockSchema,
  AudioBlockSchema,
  VideoBlockSchema,
  GeneratedImageBlockSchema,
  RedactedThinkingBlockSchema,
]);

export type ContentBlock = z.infer<typeof ContentBlockSchema>;

// =============================================================================
// Messages
// =============================================================================

export const MessageSchema = z.object({
  participant: z.string(),
  content: z.union([
    z.string(),
    z.array(ContentBlockSchema),
  ]),
});

export type Message = z.infer<typeof MessageSchema>;

// =============================================================================
// Tool Definitions
// =============================================================================

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.unknown()).optional(),
    required: z.array(z.string()).optional(),
  }).passthrough(),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

// =============================================================================
// Thinking Configuration
// =============================================================================

export const ThinkingConfigSchema = z.object({
  enabled: z.boolean(),
  budgetTokens: z.number().optional(),
  outputMode: z.enum(['parsed', 'tagged', 'hidden', 'interleaved']).optional(),
});

// =============================================================================
// Request Schemas
// =============================================================================

// =============================================================================
// Provider Configuration Schemas
// =============================================================================

/**
 * All supported providers
 */
export const ProviderSchema = z.enum([
  'anthropic',      // Direct Anthropic API
  'openrouter',     // OpenRouter (routes to many providers)
  'openai',         // Direct OpenAI API
  'openai-compatible', // Any OpenAI-compatible endpoint (Ollama, vLLM, etc.)
  'openai-completions', // OpenAI completions API (base models)
  'bedrock',        // AWS Bedrock
]);

export type Provider = z.infer<typeof ProviderSchema>;

/**
 * Provider-specific configuration passed with BYOK
 */
export const ProviderConfigSchema = z.object({
  // Common
  apiKey: z.string().optional(),

  // OpenAI / OpenAI-Compatible
  baseUrl: z.string().optional(), // Custom base URL (e.g., "http://localhost:11434/v1")
  organization: z.string().optional(), // OpenAI organization ID

  // OpenRouter specific
  httpReferer: z.string().optional(),
  xTitle: z.string().optional(),

  // Bedrock specific (AWS)
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  sessionToken: z.string().optional(),
  region: z.string().optional(), // e.g., "us-west-2"

  // OpenAI Completions specific
  eotToken: z.string().optional(), // End-of-turn token (default: '<|eot|>')
  stopSequences: z.array(z.string()).optional(), // Extra stop sequences
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// =============================================================================
// Request Schema
// =============================================================================

export const CompletionRequestSchema = z.object({
  // Required
  messages: z.array(MessageSchema),

  // Model configuration
  model: z.string().optional(),
  provider: ProviderSchema.optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),

  // System prompt
  system: z.string().optional(),

  // Tool configuration
  tools: z.array(ToolDefinitionSchema).optional(),
  toolMode: z.enum(['auto', 'xml', 'native']).optional(),

  // Thinking/reasoning
  thinking: ThinkingConfigSchema.optional(),

  // Advanced options
  stopSequences: z.array(z.string()).optional(),
  promptCaching: z.boolean().optional(),
  cacheTtl: z.enum(['5m', '1h']).optional(),
  maxParticipantsForStop: z.number().optional(),

  // Continuation (for multi-turn tool execution)
  continueFrom: z.object({
    sessionId: z.string(),
    toolResults: z.array(z.object({
      toolUseId: z.string(),
      content: z.union([z.string(), z.array(z.unknown())]),
      isError: z.boolean().optional(),
    })),
  }).optional(),

  // Provider-specific passthrough
  providerParams: z.record(z.unknown()).optional(),

  // BYOK: Provider configuration (API key and provider-specific settings)
  // For simple cases, just pass apiKey. For complex providers, use full config.
  apiKey: z.string().optional(),
  providerConfig: ProviderConfigSchema.optional(),
});

export type CompletionRequest = z.infer<typeof CompletionRequestSchema>;

// =============================================================================
// Response Types
// =============================================================================

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export interface CompletionResponse {
  // Core response
  content: ContentBlock[];
  rawAssistantText: string;

  // Tool execution
  toolCalls: ToolCall[];
  toolResults: Array<{
    toolUseId: string;
    content: string | unknown[];
    isError?: boolean;
  }>;

  // Completion info
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'refusal';
  usage: UsageInfo;

  // For tool continuation
  sessionId?: string;
  requiresToolResults?: boolean;

  // Metadata
  model: string;
  provider: string;
  durationMs: number;
}

// =============================================================================
// Streaming Events (SSE)
// =============================================================================

export type StreamEvent =
  | { event: 'chunk'; data: { text: string; type: string; visible: boolean; blockIndex: number } }
  | { event: 'block_start'; data: { index: number; type: string } }
  | { event: 'block_complete'; data: { index: number; type: string; content?: unknown } }
  | { event: 'tool_calls'; data: { calls: ToolCall[]; sessionId: string } }
  | { event: 'usage'; data: UsageInfo }
  | { event: 'done'; data: CompletionResponse }
  | { event: 'error'; data: { code: string; message: string; retryable: boolean } };

// =============================================================================
// Models Endpoint
// =============================================================================

export interface ModelInfo {
  id: string;
  name: string;
  provider: Provider;
  contextWindow: number;
  maxOutput: number;
  supportsTools: boolean;
  supportsThinking: boolean;
  supportsImages: boolean;
}

export interface ModelsResponse {
  models: ModelInfo[];
  defaultModel: string;
}

// =============================================================================
// Health Endpoint
// =============================================================================

export interface ProviderHealthStatus {
  configured: boolean;
  healthy: boolean;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  providers: {
    anthropic: ProviderHealthStatus;
    openrouter: ProviderHealthStatus;
    openai: ProviderHealthStatus;
    'openai-compatible': ProviderHealthStatus;
    'openai-completions': ProviderHealthStatus;
    bedrock: ProviderHealthStatus;
  };
}

// =============================================================================
// Error Response
// =============================================================================

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: unknown;
  };
}

