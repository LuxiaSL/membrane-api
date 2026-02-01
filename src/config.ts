/**
 * membrane-api configuration
 * 
 * Loads from environment variables with sensible defaults.
 * All provider keys are optional - clients can BYOK (Bring Your Own Key).
 */

import type { ProviderName } from './providers.js';

export interface Config {
  // Server
  port: number;
  host: string;

  // Authentication
  apiToken: string | null;

  // Provider fallback keys (all optional with BYOK)
  anthropicApiKey: string | null;
  openrouterApiKey: string | null;
  openaiApiKey: string | null;
  openaiBaseUrl?: string;
  openaiCompatibleApiKey: string | null;
  openaiCompatibleBaseUrl?: string;
  openaiCompletionsApiKey: string | null;
  openaiCompletionsBaseUrl?: string;
  bedrockAccessKeyId: string | null;
  bedrockSecretAccessKey: string | null;
  bedrockRegion?: string;

  // Defaults
  defaultProvider: ProviderName;
  defaultModel: string;

  // Limits
  maxTokensLimit: number;
  requestTimeoutMs: number;

  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT ?? '3001', 10),
    host: process.env.HOST ?? '127.0.0.1',

    apiToken: process.env.API_TOKEN || null,

    // Provider API keys (all optional - BYOK supported)
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
    openrouterApiKey: process.env.OPENROUTER_API_KEY || null,
    openaiApiKey: process.env.OPENAI_API_KEY || null,
    openaiBaseUrl: process.env.OPENAI_BASE_URL || undefined,
    openaiCompatibleApiKey: process.env.OPENAI_COMPATIBLE_API_KEY || null,
    openaiCompatibleBaseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL || undefined,
    openaiCompletionsApiKey: process.env.OPENAI_COMPLETIONS_API_KEY || null,
    openaiCompletionsBaseUrl: process.env.OPENAI_COMPLETIONS_BASE_URL || undefined,
    bedrockAccessKeyId: process.env.AWS_ACCESS_KEY_ID || null,
    bedrockSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || null,
    bedrockRegion: process.env.AWS_REGION || undefined,

    defaultProvider: (process.env.DEFAULT_PROVIDER as ProviderName) ?? 'anthropic',
    defaultModel: process.env.DEFAULT_MODEL ?? 'claude-sonnet-4-20250514',

    maxTokensLimit: parseInt(process.env.MAX_TOKENS_LIMIT ?? '32000', 10),
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS ?? '300000', 10),

    logLevel: (process.env.LOG_LEVEL as Config['logLevel']) ?? 'info',
  };
}

export function validateConfig(config: Config): void {
  // API keys are now optional - clients can provide their own (BYOK)
  // Just log info about what's configured
  
  const configuredProviders: string[] = [];
  if (config.anthropicApiKey) configuredProviders.push('anthropic');
  if (config.openrouterApiKey) configuredProviders.push('openrouter');
  if (config.openaiApiKey) configuredProviders.push('openai');
  if (config.openaiCompatibleBaseUrl) configuredProviders.push('openai-compatible');
  if (config.openaiCompletionsBaseUrl) configuredProviders.push('openai-completions');
  if (config.bedrockAccessKeyId && config.bedrockSecretAccessKey) configuredProviders.push('bedrock');

  if (configuredProviders.length === 0) {
    console.log('NOTE: No fallback provider keys configured. Running in pure BYOK mode - clients must provide their own credentials.');
  } else {
    console.log(`Server fallback providers: ${configuredProviders.join(', ')}`);
  }

  // Warn if default provider has no fallback
  const providerHasFallback: Record<string, boolean> = {
    'anthropic': !!config.anthropicApiKey,
    'openrouter': !!config.openrouterApiKey,
    'openai': !!config.openaiApiKey,
    'openai-compatible': !!config.openaiCompatibleBaseUrl,
    'openai-completions': !!config.openaiCompletionsBaseUrl,
    'bedrock': !!(config.bedrockAccessKeyId && config.bedrockSecretAccessKey),
  };

  if (!providerHasFallback[config.defaultProvider]) {
    console.log(`NOTE: DEFAULT_PROVIDER is "${config.defaultProvider}" but no fallback credentials are set. Clients must provide credentials.`);
  }
}

