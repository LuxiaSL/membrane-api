/**
 * Provider management
 * 
 * Creates membrane adapters for all supported providers.
 * Supports both server-configured keys (fallback) and BYOK (Bring Your Own Key).
 * 
 * Supported providers:
 * - anthropic: Direct Anthropic API
 * - openrouter: OpenRouter (routes to many providers)
 * - openai: Direct OpenAI API
 * - openai-compatible: Any OpenAI-compatible endpoint (Ollama, vLLM, etc.)
 * - openai-completions: OpenAI completions API (base models)
 * - bedrock: AWS Bedrock
 */

import {
  Membrane,
  AnthropicAdapter,
  OpenRouterAdapter,
  OpenAIAdapter,
  OpenAICompatibleAdapter,
  OpenAICompletionsAdapter,
  BedrockAdapter,
} from '@animalabs/membrane';
import type { Config } from './config.js';
import type { ProviderConfig } from './types.js';

export type ProviderName = 
  | 'anthropic' 
  | 'openrouter' 
  | 'openai' 
  | 'openai-compatible' 
  | 'openai-completions' 
  | 'bedrock';

// Server-configured fallback keys (optional)
interface FallbackConfig {
  anthropic: { apiKey: string | null };
  openrouter: { apiKey: string | null };
  openai: { apiKey: string | null; baseUrl?: string };
  'openai-compatible': { apiKey: string | null; baseUrl?: string };
  'openai-completions': { apiKey: string | null; baseUrl?: string };
  bedrock: { 
    accessKeyId: string | null;
    secretAccessKey: string | null;
    region?: string;
  };
}

let fallbackConfig: FallbackConfig = {
  anthropic: { apiKey: null },
  openrouter: { apiKey: null },
  openai: { apiKey: null },
  'openai-compatible': { apiKey: null },
  'openai-completions': { apiKey: null },
  bedrock: { accessKeyId: null, secretAccessKey: null },
};

// Track health per provider (for monitoring)
const providerHealth: Map<ProviderName, { healthy: boolean; lastCheck: number }> = new Map();

/**
 * Initialize fallback API keys from server configuration.
 * These are used when a request doesn't provide its own key.
 */
export function initializeProviders(config: Config): void {
  fallbackConfig = {
    anthropic: { apiKey: config.anthropicApiKey },
    openrouter: { apiKey: config.openrouterApiKey },
    openai: { 
      apiKey: config.openaiApiKey ?? null,
      baseUrl: config.openaiBaseUrl,
    },
    'openai-compatible': { 
      apiKey: config.openaiCompatibleApiKey ?? null,
      baseUrl: config.openaiCompatibleBaseUrl,
    },
    'openai-completions': { 
      apiKey: config.openaiCompletionsApiKey ?? null,
      baseUrl: config.openaiCompletionsBaseUrl,
    },
    bedrock: {
      accessKeyId: config.bedrockAccessKeyId ?? null,
      secretAccessKey: config.bedrockSecretAccessKey ?? null,
      region: config.bedrockRegion,
    },
  };

  // Initialize health tracking for configured providers
  const providers: ProviderName[] = [
    'anthropic', 'openrouter', 'openai', 
    'openai-compatible', 'openai-completions', 'bedrock'
  ];
  
  for (const provider of providers) {
    if (hasServerKey(provider)) {
      providerHealth.set(provider, { healthy: true, lastCheck: Date.now() });
    }
  }
}

/**
 * Create a membrane instance for a request.
 * 
 * @param provider - Which provider to use
 * @param apiKey - Simple API key (BYOK), or null to use server fallback
 * @param providerConfig - Full provider config for complex providers (Bedrock, custom endpoints)
 * @returns Membrane instance configured with the appropriate adapter
 * @throws Error if no API key is available
 */
export function createMembrane(
  provider: ProviderName, 
  apiKey?: string | null,
  providerConfig?: ProviderConfig
): Membrane {
  const adapter = createAdapter(provider, apiKey, providerConfig);
  
  return new Membrane(adapter, {
    assistantParticipant: 'Claude',
  });
}

/**
 * Create an adapter for the specified provider
 */
function createAdapter(
  provider: ProviderName,
  apiKey?: string | null,
  config?: ProviderConfig
): AnthropicAdapter | OpenRouterAdapter | OpenAIAdapter | OpenAICompatibleAdapter | OpenAICompletionsAdapter | BedrockAdapter {
  
  switch (provider) {
    case 'anthropic': {
      const key = apiKey || config?.apiKey || fallbackConfig.anthropic.apiKey;
      if (!key) {
        throw new Error(
          'No API key for Anthropic. Provide apiKey in request or configure ANTHROPIC_API_KEY.'
        );
      }
      return new AnthropicAdapter({ apiKey: key });
    }

    case 'openrouter': {
      const key = apiKey || config?.apiKey || fallbackConfig.openrouter.apiKey;
      if (!key) {
        throw new Error(
          'No API key for OpenRouter. Provide apiKey in request or configure OPENROUTER_API_KEY.'
        );
      }
      return new OpenRouterAdapter({ 
        apiKey: key,
        httpReferer: config?.httpReferer,
        xTitle: config?.xTitle,
      });
    }

    case 'openai': {
      const key = apiKey || config?.apiKey || fallbackConfig.openai.apiKey;
      if (!key) {
        throw new Error(
          'No API key for OpenAI. Provide apiKey in request or configure OPENAI_API_KEY.'
        );
      }
      return new OpenAIAdapter({ 
        apiKey: key,
        baseURL: config?.baseUrl || fallbackConfig.openai.baseUrl,
        organization: config?.organization,
      });
    }

    case 'openai-compatible': {
      const key = apiKey || config?.apiKey || fallbackConfig['openai-compatible'].apiKey;
      const baseUrl = config?.baseUrl || fallbackConfig['openai-compatible'].baseUrl;
      
      if (!baseUrl) {
        throw new Error(
          'No baseUrl for OpenAI-Compatible. Provide providerConfig.baseUrl in request or configure OPENAI_COMPATIBLE_BASE_URL.'
        );
      }
      
      return new OpenAICompatibleAdapter({ 
        apiKey: key || 'not-needed', // Some local servers don't need auth
        baseURL: baseUrl,
      });
    }

    case 'openai-completions': {
      const key = apiKey || config?.apiKey || fallbackConfig['openai-completions'].apiKey;
      const baseUrl = config?.baseUrl || fallbackConfig['openai-completions'].baseUrl;
      
      if (!baseUrl) {
        throw new Error(
          'No baseUrl for OpenAI-Completions. Provide providerConfig.baseUrl in request or configure OPENAI_COMPLETIONS_BASE_URL.'
        );
      }
      
      return new OpenAICompletionsAdapter({ 
        apiKey: key || 'not-needed',
        baseURL: baseUrl,
        eotToken: config?.eotToken,
        extraStopSequences: config?.stopSequences,
      });
    }

    case 'bedrock': {
      const accessKeyId = config?.accessKeyId || fallbackConfig.bedrock.accessKeyId;
      const secretAccessKey = config?.secretAccessKey || fallbackConfig.bedrock.secretAccessKey;
      const region = config?.region || fallbackConfig.bedrock.region || 'us-west-2';
      
      if (!accessKeyId || !secretAccessKey) {
        throw new Error(
          'No AWS credentials for Bedrock. Provide providerConfig.accessKeyId and secretAccessKey, ' +
          'or configure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.'
        );
      }
      
      return new BedrockAdapter({
        accessKeyId,
        secretAccessKey,
        sessionToken: config?.sessionToken,
        region,
      });
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Check if a provider has a fallback key configured on the server.
 */
export function hasServerKey(provider: ProviderName): boolean {
  switch (provider) {
    case 'anthropic':
      return !!fallbackConfig.anthropic.apiKey;
    case 'openrouter':
      return !!fallbackConfig.openrouter.apiKey;
    case 'openai':
      return !!fallbackConfig.openai.apiKey;
    case 'openai-compatible':
      return !!fallbackConfig['openai-compatible'].baseUrl;
    case 'openai-completions':
      return !!fallbackConfig['openai-completions'].baseUrl;
    case 'bedrock':
      return !!fallbackConfig.bedrock.accessKeyId && !!fallbackConfig.bedrock.secretAccessKey;
    default:
      return false;
  }
}

/**
 * Get provider health status (for monitoring).
 */
export function getProviderHealth(provider: ProviderName): { configured: boolean; healthy: boolean } {
  const health = providerHealth.get(provider);
  if (!health) {
    return { configured: false, healthy: true }; // Assume healthy for BYOK
  }
  return { configured: true, healthy: health.healthy };
}

/**
 * Update provider health status
 */
export function updateProviderHealth(provider: ProviderName, healthy: boolean): void {
  const existing = providerHealth.get(provider);
  if (existing) {
    existing.healthy = healthy;
    existing.lastCheck = Date.now();
  } else {
    providerHealth.set(provider, { healthy, lastCheck: Date.now() });
  }
}

/**
 * Get all providers that have server-configured fallback keys
 */
export function getConfiguredProviders(): ProviderName[] {
  const providers: ProviderName[] = [
    'anthropic', 'openrouter', 'openai', 
    'openai-compatible', 'openai-completions', 'bedrock'
  ];
  return providers.filter(p => hasServerKey(p));
}

/**
 * Get all available providers (all can be used via BYOK)
 */
export function getAvailableProviders(): ProviderName[] {
  return ['anthropic', 'openrouter', 'openai', 'openai-compatible', 'openai-completions', 'bedrock'];
}
