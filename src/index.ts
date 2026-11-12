import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createGatewayRegistry } from './gateway/gatewayRegistry.js';

export function startServer(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const gatewayRegistry = createGatewayRegistry({
    serverUrl: config.LUBELOGGER_URL,
    cacheTtlSeconds: config.CACHE_TTL_SECONDS,
    defaultCredentials: {
      apiKey: config.LUBELOGGER_API_KEY,
      username: config.LUBELOGGER_USERNAME,
      password: config.LUBELOGGER_PASSWORD,
    },
  });

  void gatewayRegistry.initialize().catch((error) => {
    console.error('Failed to initialize connection to LubeLogger:', error);
  });

  const app = createApp({ config, gatewayRegistry });

  const server = app.listen(config.PORT, () => {
    console.log(`lubelogger-mcp listening on port ${config.PORT}`);
  });

  const handleShutdownSignal = () => {
    void gatewayRegistry.shutdown().finally(() => {
      server.close();
    });
  };

  process.once('SIGTERM', handleShutdownSignal);
  process.once('SIGINT', handleShutdownSignal);

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
