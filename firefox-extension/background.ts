import { WebsocketClient } from "./client";
import { MessageHandler } from "./message-handler";
import { getConfig, generateSecret, setPausado } from "./extension-config";
import { acompanharFechamento } from "./abas-claude";
import { acompanharRede } from "./rede";
import { atenderPaginaDeAprovacao } from "./aprovacao-arquivos";

function initClient(port: number, secret: string) {
  const wsClient = new WebsocketClient(port, secret);
  const messageHandler = new MessageHandler(wsClient);

  wsClient.connect();

  wsClient.addMessageListener(async (message) => {
    try {
      await messageHandler.handleDecodedMessage(message);
    } catch (error) {
      console.error("Error handling message:", error);
      if (error instanceof Error) {
        await wsClient.sendErrorToServer(message.correlationId, error.message);
      }
    }
  });
}

async function initExtension() {
  let config = await getConfig();
  if (!config.secret) {
    console.log("No secret found, generating new one");
    await generateSecret();
    // Open the options page to allow the user to view the config:
    await browser.runtime.openOptionsPage();
    config = await getConfig();
  }
  return config;
}

acompanharFechamento();
acompanharRede();
atenderPaginaDeAprovacao();

/* o botao "Pausar o Claude" que aparece na propria pagina */
/* sem async: devolver Promise pra mensagem que nao e nossa roubaria a resposta de outro listener */
browser.runtime.onMessage.addListener((mensagem: { tipo?: string }, remetente) => {
  if (mensagem?.tipo !== "pausar" || remetente.id !== browser.runtime.id) return;
  return setPausado(true);
});

initExtension()
  .then((config) => {
    const secret = config.secret;

    if (!secret) {
      console.error("Secret not found in storage - reinstall extension");
      return;
    }
    const portList = config.ports;
    if (portList.length === 0) {
      console.error("No ports configured in extension config");
      return;
    }
    for (const port of portList) {
      initClient(port, secret);
    }
    console.log("Browser extension initialized");
  })
  .catch((error) => {
    console.error("Error initializing extension:", error);
  });
