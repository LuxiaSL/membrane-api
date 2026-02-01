/**
 * membrane-api entry point
 * 
 * HTTP API wrapper for @animalabs/membrane LLM middleware.
 */

import { loadConfig, validateConfig } from './config.js';
import { initializeProviders } from './providers.js';
import { createServer } from './server.js';

async function main() {
  console.log('membrane-api starting...');

  // Load and validate configuration
  const config = loadConfig();

  try {
    validateConfig(config);
  } catch (error) {
    console.error('Configuration error:', (error as Error).message);
    process.exit(1);
  }

  // Initialize providers
  initializeProviders(config);
  console.log(`Providers initialized: ${config.anthropicApiKey ? 'anthropic' : ''} ${config.openrouterApiKey ? 'openrouter' : ''}`.trim());

  // Create and start server
  const server = await createServer(config);

  try {
    await server.listen({ port: config.port, host: config.host });
    console.log(`membrane-api listening on http://${config.host}:${config.port}`);
    console.log(`Default provider: ${config.defaultProvider}`);
    console.log(`Default model: ${config.defaultModel}`);

    if (!config.apiToken) {
      console.log('WARNING: No API_TOKEN configured - endpoints are unauthenticated');
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

