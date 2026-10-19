import WebSocket from "ws";
import type {
  ExtensionMessage,
  BrowserTab,
  BrowserHistoryItem,
  ServerMessage,
  TabContentExtensionMessage,
  ServerMessageRequest,
  ExtensionError,
  ScreenshotExtensionMessage,
} from "@browser-control-mcp/common";
import { isPortInUse } from "./util";
import * as crypto from "crypto";

const WS_DEFAULT_PORT = 8089;
/* a extensao conecta em todas estas: uma sessao do Claude Code por porta */
export const PORTAS_PADRAO = [WS_DEFAULT_PORT, 8090, 8091, 8092, 8093];
const EXTENSION_RESPONSE_TIMEOUT_MS = 1000;
// Capturing may foreground the tab, wait for it to paint, encode the image and transfer a
// payload orders of magnitude larger than the other responses.
const SCREENSHOT_RESPONSE_TIMEOUT_MS = 10000;
// navegar espera a pagina carregar (ate 15s na extensao); agir e ler pagina grande levam mais que 1s
const ACAO_RESPONSE_TIMEOUT_MS = 20000;

/*
 * So a propria extensao conecta: navegador manda Origin moz-extension:// pra
 * ela, e http(s):// pra qualquer site aberto. Sem isso, uma pagina aberta no
 * Firefox podia se conectar em localhost e tomar o lugar da extensao.
 */
export function origemPermitida(origin: string | undefined): boolean {
  return typeof origin === "string" && origin.startsWith("moz-extension://");
}

interface ExtensionRequestResolver<T extends ExtensionMessage["resource"]> {
  resource: T;
  resolve: (value: Extract<ExtensionMessage, { resource: T }>) => void;
  reject: (reason?: string) => void;
}

export class BrowserAPI {
  private ws: WebSocket | null = null;
  private wsServers: WebSocket.Server[] = [];
  private sharedSecret: string | null = null;

  // Map to persist the request to the extension. It maps the request correlationId
  // to a resolver, fulfulling a promise created when sending a message to the extension.
  private extensionRequestMap: Map<
    string,
    ExtensionRequestResolver<ExtensionMessage["resource"]>
  > = new Map();

  async init() {
    const config = readConfig();
    const { secret } = config;
    let port: number | undefined = config.port;
    if (!secret) {
      throw new Error(
        "EXTENSION_SECRET env var missing. See the extension's options page."
      );
    }
    this.sharedSecret = secret;

    /*
     * Cada sessao do Claude Code sobe o proprio servidor. Com a porta fixa, a
     * segunda sessao achava a 8089 ocupada e fechava ("Connection closed").
     * Sem EXTENSION_PORT, pega a primeira livre de 8089 a 8093; a extensao
     * conecta em todas, entao varias sessoes usam o Firefox juntas.
     */
    let livre: number | undefined;
    for (const candidata of port !== undefined ? [port] : PORTAS_PADRAO) {
      if (!(await isPortInUse(candidata))) {
        livre = candidata;
        break;
      }
    }
    if (livre === undefined) {
      throw new Error(
        port !== undefined
          ? `A porta ${port} ja esta em uso. Feche a outra sessao ou use outra porta.`
          : `As portas ${PORTAS_PADRAO.join(", ")} estao todas em uso: ja tem ${PORTAS_PADRAO.length} sessoes do Claude Code usando o Firefox.`
      );
    }
    port = livre;

    // Bind explicitly to both loopback addresses so Firefox connects regardless of how
    // it resolves "localhost". On Linux, getaddrinfo("localhost") often returns ::1
    // before 127.0.0.1; binding only to "localhost" then yields an IPv6-only listener
    // and IPv4 connect attempts get refused. Listening on 127.0.0.1 *and* ::1 keeps
    // the server loopback-only (unlike "::"/"0.0.0.0", which would expose external
    // interfaces), while accepting both IPv4 and IPv6 clients.
    const hosts = process.env.CONTAINERIZED ? ["0.0.0.0"] : ["127.0.0.1", "::1"];

    for (const host of hosts) {
      const wsServer = new WebSocket.Server({
        host,
        port,
        verifyClient: (info: { origin: string }) => {
          const ok = origemPermitida(info.origin);
          if (!ok) console.error(`Conexao recusada de ${info.origin || "origem desconhecida"}`);
          return ok;
        },
      });

      console.error(`Starting WebSocket server on ${host}:${port}`);
      wsServer.on("connection", async (connection) => {
        this.ws = connection;

        console.error("WebSocket connection established on port", port);

        this.ws.on("message", (message) => {
          let decoded: any;
          try {
            decoded = JSON.parse(message.toString());
          } catch {
            console.error("Mensagem que nao e JSON");
            return;
          }
          if (isErrorMessage(decoded)) {
            this.handleExtensionError(decoded);
            return;
          }
          const signature = this.createSignature(JSON.stringify(decoded.payload));
          if (signature !== decoded.signature) {
            console.error("Invalid message signature");
            return;
          }
          this.handleDecodedExtensionMessage(decoded.payload);
        });
      });
      wsServer.on("error", (error) => {
        console.error(`WebSocket server error on ${host}:${port}:`, error);
      });

      this.wsServers.push(wsServer);
    }
  }

  close() {
    for (const wsServer of this.wsServers) {
      wsServer.close();
    }
    this.wsServers = [];
  }

  getSelectedPort() {
    return this.wsServers[0]?.options.port;
  }

  async openTab(url: string): Promise<number | undefined> {
    const correlationId = this.sendMessageToExtension({
      cmd: "open-tab",
      url,
    });
    const message = await this.waitForResponse(correlationId, "opened-tab-id", ACAO_RESPONSE_TIMEOUT_MS);
    return message.tabId;
  }

  async closeTabs(tabIds: number[]) {
    const correlationId = this.sendMessageToExtension({
      cmd: "close-tabs",
      tabIds,
    });
    await this.waitForResponse(correlationId, "tabs-closed");
  }

  async getTabList(): Promise<BrowserTab[]> {
    const correlationId = this.sendMessageToExtension({
      cmd: "get-tab-list",
    });
    const message = await this.waitForResponse(correlationId, "tabs");
    return message.tabs;
  }

  async getBrowserRecentHistory(
    searchQuery?: string
  ): Promise<BrowserHistoryItem[]> {
    const correlationId = this.sendMessageToExtension({
      cmd: "get-browser-recent-history",
      searchQuery,
    });
    const message = await this.waitForResponse(correlationId, "history");
    return message.historyItems;
  }

  async getTabContent(
    tabId: number,
    offset: number
  ): Promise<TabContentExtensionMessage> {
    const correlationId = this.sendMessageToExtension({
      cmd: "get-tab-content",
      tabId,
      offset,
    });
    return await this.waitForResponse(correlationId, "tab-content", ACAO_RESPONSE_TIMEOUT_MS);
  }

  async reorderTabs(tabOrder: number[]): Promise<number[]> {
    const correlationId = this.sendMessageToExtension({
      cmd: "reorder-tabs",
      tabOrder,
    });
    const message = await this.waitForResponse(correlationId, "tabs-reordered");
    return message.tabOrder;
  }

  async findHighlight(tabId: number, queryPhrase: string): Promise<number> {
    const correlationId = this.sendMessageToExtension({
      cmd: "find-highlight",
      tabId,
      queryPhrase,
    });
    const message = await this.waitForResponse(
      correlationId,
      "find-highlight-result"
    );
    return message.noOfResults;
  }

  async groupTabs(
    tabIds: number[],
    isCollapsed: boolean,
    groupColor: string,
    groupTitle: string
  ): Promise<number> {
    const correlationId = this.sendMessageToExtension({
      cmd: "group-tabs",
      tabIds,
      isCollapsed,
      groupColor,
      groupTitle,
    });
    const message = await this.waitForResponse(correlationId, "new-tab-group");
    return message.groupId;
  }

  async captureScreenshot(
    tabId: number,
    format: "jpeg" | "png",
    quality: number,
    scale: number
  ): Promise<ScreenshotExtensionMessage> {
    const correlationId = this.sendMessageToExtension({
      cmd: "capture-screenshot",
      tabId,
      format,
      quality,
      scale,
    });
    return await this.waitForResponse(
      correlationId,
      "screenshot",
      SCREENSHOT_RESPONSE_TIMEOUT_MS
    );
  }

  /* comandos de agir e ler: mandam e esperam o recurso de resposta */
  async comando<T extends ExtensionMessage["resource"]>(
    message: ServerMessage,
    resource: T,
    timeoutMs: number = ACAO_RESPONSE_TIMEOUT_MS
  ): Promise<Extract<ExtensionMessage, { resource: T }>> {
    const correlationId = this.sendMessageToExtension(message);
    return this.waitForResponse(correlationId, resource, timeoutMs);
  }

  private createSignature(payload: string): string {
    if (!this.sharedSecret) {
      throw new Error("Shared secret not initialized");
    }
    const hmac = crypto.createHmac("sha256", this.sharedSecret);
    hmac.update(payload);
    return hmac.digest("hex");
  }

  private sendMessageToExtension(message: ServerMessage): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }

    const correlationId = Math.random().toString(36).substring(2);
    const req: ServerMessageRequest = { ...message, correlationId };
    const payload = JSON.stringify(req);
    const signature = this.createSignature(payload);
    const signedMessage = {
      payload: req,
      signature: signature,
    };

    // Send the signed message to the extension
    this.ws.send(JSON.stringify(signedMessage));

    return correlationId;
  }

  private handleDecodedExtensionMessage(decoded: ExtensionMessage) {
    const { correlationId } = decoded;
    const pendente = this.extensionRequestMap.get(correlationId);
    // resposta de pedido que ja expirou (ou que ninguem fez): ignora em vez de derrubar o servidor
    if (!pendente) return;
    const { resolve, resource } = pendente;
    if (resource !== decoded.resource) {
      console.error("Resource mismatch:", resource, decoded.resource);
      return;
    }
    this.extensionRequestMap.delete(correlationId);
    resolve(decoded);
  }

  private handleExtensionError(decoded: ExtensionError) {
    const { correlationId, errorMessage } = decoded;
    const pendente = this.extensionRequestMap.get(correlationId);
    if (!pendente) return;
    const { reject } = pendente;
    this.extensionRequestMap.delete(correlationId);
    reject(errorMessage);
  }

  private async waitForResponse<T extends ExtensionMessage["resource"]>(
    correlationId: string,
    resource: T,
    timeoutMs: number = EXTENSION_RESPONSE_TIMEOUT_MS
  ): Promise<Extract<ExtensionMessage, { resource: T }>> {
    return new Promise<Extract<ExtensionMessage, { resource: T }>>(
      (resolve, reject) => {
        this.extensionRequestMap.set(correlationId, {
          resolve: resolve as (value: ExtensionMessage) => void,
          resource,
          reject,
        });
        setTimeout(() => {
          this.extensionRequestMap.delete(correlationId);
          reject("Timed out waiting for response");
        }, timeoutMs);
      }
    );
  }
}

function readConfig() {
  return {
    secret: process.env.EXTENSION_SECRET,
    // so com EXTENSION_PORT a porta e fixa; sem, o servidor escolhe uma livre da faixa padrao
    port: process.env.EXTENSION_PORT ? parseInt(process.env.EXTENSION_PORT, 10) : undefined,
  };
}

export function isErrorMessage(message: any): message is ExtensionError {
  return (
    message.errorMessage !== undefined && message.correlationId !== undefined
  );
}
