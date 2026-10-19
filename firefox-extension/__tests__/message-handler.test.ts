import { MessageHandler } from "../message-handler";
import { WebsocketClient } from "../client";
import type { ServerMessageRequest } from "@browser-control-mcp/common";
import type { ExtensionConfig } from "../extension-config";

jest.mock("../client", () => ({
  WebsocketClient: jest.fn().mockImplementation(() => ({
    sendResourceToServer: jest.fn().mockResolvedValue(undefined),
    sendErrorToServer: jest.fn().mockResolvedValue(undefined),
  })),
}));

/* abas que o Claude abriu (storage.session) */
let abasDoClaude: number[] = [];
let config: ExtensionConfig;

function comConfig(extra: Partial<ExtensionConfig> = {}) {
  config = { secret: "s", ports: [8089], domainDenyList: [], auditLog: [], modoAutorizacao: "autonomo", ...extra };
}

describe("MessageHandler", () => {
  let handler: MessageHandler;
  let client: jest.Mocked<WebsocketClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    abasDoClaude = [];
    comConfig();
    client = new WebsocketClient(8089, "s") as jest.Mocked<WebsocketClient>;
    handler = new MessageHandler(client);
    (browser.storage.local.get as jest.Mock).mockImplementation(async () => ({ config }));
    (browser.storage.local.set as jest.Mock).mockImplementation(async (v: { config: ExtensionConfig }) => {
      config = v.config;
    });
    (browser.storage.session.get as jest.Mock).mockImplementation(async () => ({ abasDoClaude }));
    (browser.storage.session.set as jest.Mock).mockImplementation(async (v: { abasDoClaude: number[] }) => {
      abasDoClaude = v.abasDoClaude;
    });
    (browser.runtime.getURL as jest.Mock).mockReturnValue("moz-extension://x/options.html");
  });

  const pedido = (r: Record<string, unknown>) => ({ correlationId: "c1", ...r }) as unknown as ServerMessageRequest;

  it("pausado, nada roda", async () => {
    comConfig({ pausado: true });
    await expect(handler.handleDecodedMessage(pedido({ cmd: "get-tab-list" }))).rejects.toThrow("pausado");
    expect(browser.tabs.query).not.toHaveBeenCalled();
  });

  it("abre a aba no grupo Claude e passa a reconhecer ela", async () => {
    (browser.tabs.create as jest.Mock).mockResolvedValue({ id: 7, windowId: 1 });
    (browser.tabs.group as jest.Mock).mockResolvedValue(30);
    await handler.handleDecodedMessage(pedido({ cmd: "open-tab", url: "http://127.0.0.1:4100" }));
    expect(abasDoClaude).toEqual([7]);
    expect(browser.tabGroups.update).toHaveBeenCalledWith(30, { title: "Claude", color: "orange" });
    expect(client.sendResourceToServer).toHaveBeenCalledWith({ resource: "opened-tab-id", correlationId: "c1", tabId: 7 });
  });

  it("endereco que nao e http(s) nao abre", async () => {
    await expect(handler.handleDecodedMessage(pedido({ cmd: "open-tab", url: "file:///etc/passwd" }))).rejects.toThrow("http");
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it("aba da pessoa fica fora do alcance, ate pra ler", async () => {
    for (const cmd of ["get-tab-content", "click", "type", "capture-screenshot", "navigate", "read-network"]) {
      await expect(handler.handleDecodedMessage(pedido({ cmd, tabId: 99, url: "https://x.com", text: "a" }))).rejects.toThrow("da pessoa");
    }
    expect(browser.tabs.executeScript).not.toHaveBeenCalled();
    expect(browser.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("lista so as abas do Claude", async () => {
    abasDoClaude = [2];
    (browser.tabs.query as jest.Mock).mockResolvedValue([
      { id: 1, url: "https://mail.google.com", title: "Inbox" },
      { id: 2, url: "https://calourada.com", title: "Calourada" },
    ]);
    await handler.handleDecodedMessage(pedido({ cmd: "get-tab-list" }));
    expect(client.sendResourceToServer).toHaveBeenCalledWith({
      resource: "tabs",
      correlationId: "c1",
      tabs: [{ id: 2, url: "https://calourada.com", title: "Calourada" }],
    });
  });

  it("historico vem desligado", async () => {
    comConfig({ toolSettings: undefined });
    await expect(handler.handleDecodedMessage(pedido({ cmd: "get-browser-recent-history" }))).rejects.toThrow("desligado");
  });

  it("modo perguntar: site novo abre a aprovacao e nao age", async () => {
    comConfig({ modoAutorizacao: "perguntar", dominiosAprovados: ["calourada.com"] });
    await expect(handler.handleDecodedMessage(pedido({ cmd: "open-tab", url: "https://exemplo.com" }))).rejects.toThrow("ainda nao liberou");
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: "moz-extension://x/options.html?aprovarDominio=exemplo.com" });
  });

  it("modo perguntar: site aprovado passa direto", async () => {
    comConfig({ modoAutorizacao: "perguntar", dominiosAprovados: ["calourada.com"] });
    (browser.tabs.create as jest.Mock).mockResolvedValue({ id: 8, windowId: 1 });
    (browser.tabs.group as jest.Mock).mockResolvedValue(31);
    await handler.handleDecodedMessage(pedido({ cmd: "open-tab", url: "https://app.calourada.com" }));
    expect(abasDoClaude).toEqual([8]);
  });

  it("lista de bloqueio vale ate no autonomo", async () => {
    comConfig({ domainDenyList: ["itau.com.br"] });
    await expect(handler.handleDecodedMessage(pedido({ cmd: "open-tab", url: "https://www.itau.com.br" }))).rejects.toThrow("bloqueio");
  });

  it("clica numa aba do Claude pelo agente da pagina", async () => {
    abasDoClaude = [5];
    (browser.tabs.get as jest.Mock).mockResolvedValue({ id: 5, url: "https://calourada.com", title: "Calourada" });
    (browser.tabs.executeScript as jest.Mock)
      .mockResolvedValueOnce([true]) // agente ja injetado
      .mockResolvedValueOnce([{ ok: true, valor: 'Cliquei em button "Entrar"' }]);
    await handler.handleDecodedMessage(pedido({ cmd: "click", tabId: 5, ref: "e3" }));
    expect(client.sendResourceToServer).toHaveBeenCalledWith(
      expect.objectContaining({ resource: "action-result", result: 'Cliquei em button "Entrar"' })
    );
  });

  it("erro do agente (ex.: cartao real) volta como erro", async () => {
    abasDoClaude = [5];
    (browser.tabs.get as jest.Mock).mockResolvedValue({ id: 5, url: "https://loja.com" });
    (browser.tabs.executeScript as jest.Mock)
      .mockResolvedValueOnce([true])
      .mockResolvedValueOnce([{ ok: false, erro: "Recusado: isso parece um cartao de verdade." }]);
    await expect(handler.handleDecodedMessage(pedido({ cmd: "type", tabId: 5, ref: "e1", text: "4539 5787 6362 1486" }))).rejects.toThrow(
      "cartao de verdade"
    );
  });
});
