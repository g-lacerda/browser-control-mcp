import type { ServerMessageRequest } from "@browser-control-mcp/common";
import { WebsocketClient } from "./client";
import {
  isCommandAllowed,
  isDomainInDenyList,
  COMMAND_TO_TOOL_ID,
  addAuditLogEntry,
  getModoAutorizacao,
  getDominiosAprovados,
  estaPausado,
} from "./extension-config";
import { abrirAbaDoClaude, exigirAbaDoClaude, idsDasAbasDoClaude } from "./abas-claude";
import { lerRede } from "./rede";
import { dominioNaLista, urlPermitida } from "./regras";

// Time to let a newly foregrounded tab paint before capturing it
const TAB_PAINT_DELAY_MS = 250;
// depois de clicar ou digitar, o tempo de a pagina reagir antes de devolver o estado
const PAUSA_DEPOIS_DE_AGIR_MS = 400;
const ESPERA_MAXIMA_CARREGAR_MS = 15000;

const espera = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MessageHandler {
  private client: WebsocketClient;
  private emAndamento = 0;

  constructor(client: WebsocketClient) {
    this.client = client;
  }

  public async handleDecodedMessage(req: ServerMessageRequest): Promise<void> {
    if (await estaPausado()) {
      throw new Error("O Claude esta pausado: a pessoa apertou pausar no botao da extensao. Peca pra ela liberar.");
    }
    const isAllowed = await isCommandAllowed(req.cmd);
    if (!isAllowed) {
      throw new Error(`O comando '${req.cmd}' esta desligado nas opcoes da extensao`);
    }

    this.addAuditLogForReq(req).catch((error) => {
      console.error("Failed to add audit log entry:", error);
    });

    await this.indicarAtividade(true);
    try {
      await this.executar(req);
    } finally {
      await this.indicarAtividade(false);
    }
  }

  private async executar(req: ServerMessageRequest): Promise<void> {
    switch (req.cmd) {
      case "open-tab":
        await this.openUrl(req.correlationId, req.url);
        break;
      case "close-tabs":
        await this.closeTabs(req.correlationId, req.tabIds);
        break;
      case "get-tab-list":
        await this.sendTabs(req.correlationId);
        break;
      case "get-browser-recent-history":
        await this.sendRecentHistory(req.correlationId, req.searchQuery);
        break;
      case "get-tab-content":
        await this.sendTabsContent(req.correlationId, req.tabId, req.offset);
        break;
      case "reorder-tabs":
        await this.reorderTabs(req.correlationId, req.tabOrder);
        break;
      case "find-highlight":
        await this.findAndHighlightText(req.correlationId, req.tabId, req.queryPhrase);
        break;
      case "group-tabs":
        await this.groupTabs(req.correlationId, req.tabIds, req.isCollapsed, req.groupColor as browser.tabGroups.Color, req.groupTitle);
        break;
      case "capture-screenshot":
        await this.captureScreenshot(req.correlationId, req.tabId, req.format, req.quality, req.scale);
        break;
      case "navigate":
        await this.navegar(req.correlationId, req.tabId, req.url);
        break;
      case "snapshot":
        await this.lerPagina(req.correlationId, req.tabId, req.interactiveOnly ?? true);
        break;
      case "click":
        await this.agir(req.correlationId, req.tabId, "clicar", [req.ref, req.selector, req.x, req.y, req.double ?? false]);
        break;
      case "type":
        await this.agir(req.correlationId, req.tabId, "digitar", [req.text, req.ref, req.selector, req.clear ?? true, req.submit ?? false]);
        break;
      case "press-key":
        await this.agir(req.correlationId, req.tabId, "apertarTecla", [req.key]);
        break;
      case "scroll":
        await this.agir(req.correlationId, req.tabId, "rolar", [req.ref, req.direction ?? "down", req.amount ?? 3]);
        break;
      case "select-option":
        await this.agir(req.correlationId, req.tabId, "escolherOpcao", [req.value, req.ref, req.selector]);
        break;
      case "run-js":
        await this.rodarJs(req.correlationId, req.tabId, req.code);
        break;
      case "read-console":
        await this.lerConsole(req.correlationId, req.tabId, req.pattern, req.clear ?? false);
        break;
      case "read-network":
        await this.lerRedeDaAba(req.correlationId, req.tabId, req.urlPattern, req.clear ?? false);
        break;
      default:
        const _exhaustiveCheck: never = req;
        console.error("Invalid message received:", req);
    }
  }

  /* badge vermelho no botao da extensao enquanto o Claude esta agindo */
  private async indicarAtividade(ativo: boolean) {
    this.emAndamento += ativo ? 1 : -1;
    try {
      if (this.emAndamento > 0) {
        await browser.browserAction.setBadgeBackgroundColor({ color: "#d93025" });
        await browser.browserAction.setBadgeText({ text: "●" });
      } else {
        await browser.browserAction.setBadgeText({ text: "" });
      }
    } catch {
      // badge e so aviso visual
    }
  }

  private async addAuditLogForReq(req: ServerMessageRequest) {
    // Get the URL in context (either from param or from the tab)
    let contextUrl: string | undefined;
    if ("url" in req && req.url) {
      contextUrl = req.url;
    }
    if ("tabId" in req) {
      try {
        const tab = await browser.tabs.get(req.tabId);
        contextUrl = tab.url;
      } catch (error) {
        console.error("Failed to get tab URL for audit log:", error);
      }
    }

    const toolId = COMMAND_TO_TOOL_ID[req.cmd];
    await addAuditLogEntry({ toolId, command: req.cmd, timestamp: Date.now(), url: contextUrl });
  }

  /*
   * O site pode receber a acao? Lista de bloqueio vale em qualquer modo. No
   * modo autonomo, o resto passa; no "perguntar", so dominio ja aprovado, e
   * na primeira vez abre a pagina de aprovacao pra pessoa decidir.
   */
  private async autorizar(url: string | undefined) {
    if (!url || !urlPermitida(url)) return;
    if (await isDomainInDenyList(url)) {
      throw new Error("Esse site esta na lista de bloqueio da extensao: o Claude nao age nele.");
    }
    if ((await getModoAutorizacao()) === "autonomo") return;
    const host = new URL(url).hostname;
    if (dominioNaLista(url, await getDominiosAprovados())) return;
    const opcoes = browser.runtime.getURL("options.html");
    await browser.tabs.create({ url: `${opcoes}?aprovarDominio=${encodeURIComponent(host)}` });
    throw new Error(
      `A pessoa ainda nao liberou o Claude em ${host}. Abri a pagina de aprovacao; se ela liberar, tente de novo.`,
    );
  }

  private async openUrl(correlationId: string, url: string): Promise<void> {
    if (!urlPermitida(url)) {
      throw new Error("So da pra abrir enderecos http ou https");
    }
    await this.autorizar(url);
    const tab = await abrirAbaDoClaude(url);
    await this.client.sendResourceToServer({
      resource: "opened-tab-id",
      correlationId,
      tabId: tab.id,
    });
  }

  private async closeTabs(correlationId: string, tabIds: number[]): Promise<void> {
    for (const id of tabIds) await exigirAbaDoClaude(id);
    await browser.tabs.remove(tabIds);
    await this.client.sendResourceToServer({ resource: "tabs-closed", correlationId });
  }

  /* so as abas do Claude: as da pessoa nao aparecem nem pelo titulo */
  private async sendTabs(correlationId: string): Promise<void> {
    const ids = new Set(await idsDasAbasDoClaude());
    const tabs = (await browser.tabs.query({})).filter((t) => t.id !== undefined && ids.has(t.id));
    await this.client.sendResourceToServer({ resource: "tabs", correlationId, tabs });
  }

  private async sendRecentHistory(correlationId: string, searchQuery: string | null = null): Promise<void> {
    const historyItems = await browser.history.search({
      text: searchQuery ?? "", // Search for all URLs (empty string matches everything)
      maxResults: 200, // Limit to 200 results
      startTime: 0, // Search from the beginning of time
    });
    const filteredHistoryItems = historyItems.filter((item) => !!item.url);
    await this.client.sendResourceToServer({ resource: "history", correlationId, historyItems: filteredHistoryItems });
  }

  private async checkForGlobalPermission(permissions: string[]): Promise<void> {
    const granted = await browser.permissions.contains({ permissions });

    if (!granted) {
      // Open the options page with a URL parameter to request permission:
      const optionsUrl = browser.runtime.getURL("options.html");
      const urlWithParams = `${optionsUrl}?requestPermissions=${encodeURIComponent(JSON.stringify(permissions))}`;

      await browser.tabs.create({ url: urlWithParams });
      throw new Error(
        `The user has not yet granted permission for the following operations: ${permissions.join(
          ", "
        )}. A dialog is now being opened to request permission. If the user grants permission, you can try the request again.`
      );
    }
  }

  /* a aba e do Claude e o site dela pode receber acao */
  private async abaLiberada(tabId: number): Promise<browser.tabs.Tab> {
    await exigirAbaDoClaude(tabId);
    const tab = await browser.tabs.get(tabId);
    await this.autorizar(tab.url);
    return tab;
  }

  private async sendTabsContent(correlationId: string, tabId: number, offset?: number): Promise<void> {
    await this.abaLiberada(tabId);

    const MAX_CONTENT_LENGTH = 50_000;
    const results = await browser.tabs.executeScript(tabId, {
      code: `
      (function () {
        function getLinks() {
          const linkElements = document.querySelectorAll('a[href]');
          return Array.from(linkElements).map(el => ({
            url: el.href,
            text: el.innerText.trim() || el.getAttribute('aria-label') || el.getAttribute('title') || ''
          })).filter(link => link.text !== '' && /^https?:/.test(link.url) && !link.url.includes('#'));
        }

        function getTextContent() {
          let isTruncated = false;
          let text = document.body.innerText.substring(${Number(offset) || 0});
          if (text.length > ${MAX_CONTENT_LENGTH}) {
            text = text.substring(0, ${MAX_CONTENT_LENGTH});
            isTruncated = true;
          }
          return {
            text, isTruncated
          }
        }

        const textContent = getTextContent();

        return {
          links: getLinks(),
          fullText: textContent.text,
          isTruncated: textContent.isTruncated,
          totalLength: document.body.innerText.length
        };
      })();
    `,
    });
    const { isTruncated, fullText, links, totalLength } = results[0];
    await this.client.sendResourceToServer({
      resource: "tab-content",
      tabId,
      correlationId,
      isTruncated,
      fullText,
      links,
      totalLength,
    });
  }

  private async reorderTabs(correlationId: string, tabOrder: number[]): Promise<void> {
    for (const id of tabOrder) await exigirAbaDoClaude(id);
    // Reorder the tabs sequentially
    for (let newIndex = 0; newIndex < tabOrder.length; newIndex++) {
      await browser.tabs.move(tabOrder[newIndex], { index: newIndex });
    }
    await this.client.sendResourceToServer({ resource: "tabs-reordered", correlationId, tabOrder });
  }

  private async findAndHighlightText(correlationId: string, tabId: number, queryPhrase: string): Promise<void> {
    await this.abaLiberada(tabId);
    await this.checkForGlobalPermission(["find"]);

    const findResults = await browser.find.find(queryPhrase, { tabId, caseSensitive: true });

    // If there are results, highlight them
    if (findResults.count > 0) {
      // But first, activate the tab. In firefox, this would also enable
      // auto-scrolling to the highlighted result.
      await browser.tabs.update(tabId, { active: true });
      browser.find.highlightResults({ tabId });
    }

    await this.client.sendResourceToServer({ resource: "find-highlight-result", correlationId, noOfResults: findResults.count });
  }

  /*
   * Print so da area visivel de uma aba do Claude. A extensao nao tem como
   * fotografar a tela do computador nem outras janelas: o Firefox so entrega
   * o conteudo da aba.
   */
  private async captureScreenshot(
    correlationId: string,
    tabId: number,
    format: "jpeg" | "png" = "jpeg",
    quality: number = 70,
    scale: number = 1
  ): Promise<void> {
    const tab = await this.abaLiberada(tabId);

    if (tab.windowId === undefined) {
      throw new Error(`Tab ${tabId} does not belong to a window`);
    }

    // captureVisibleTab() captures whichever tab is active in the window, so the target tab
    // has to be foregrounded first. Restore the previous tab afterwards.
    const restoreTabId = tab.active ? undefined : await this.activateTabForCapture(tabId, tab.windowId);

    try {
      const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format, quality, scale });
      const { mimeType, imageData } = parseImageDataUrl(dataUrl);
      await this.client.sendResourceToServer({ resource: "screenshot", correlationId, tabId, imageData, mimeType });
    } finally {
      if (restoreTabId !== undefined) {
        try {
          await browser.tabs.update(restoreTabId, { active: true });
        } catch (error) {
          console.error("Failed to restore the previously active tab:", error);
        }
      }
    }
  }

  // Foregrounds the tab to be captured, returning the tab that was active before, if any.
  private async activateTabForCapture(tabId: number, windowId: number): Promise<number | undefined> {
    const [previouslyActive] = await browser.tabs.query({ active: true, windowId });
    await browser.tabs.update(tabId, { active: true });
    await espera(TAB_PAINT_DELAY_MS);
    return previouslyActive?.id;
  }

  private async groupTabs(
    correlationId: string,
    tabIds: number[],
    isCollapsed: boolean,
    groupColor: browser.tabGroups.Color,
    groupTitle: string
  ): Promise<void> {
    for (const id of tabIds) await exigirAbaDoClaude(id);
    const groupId = await browser.tabs.group({ tabIds });
    const tabGroup = await browser.tabGroups.update(groupId, { collapsed: isCollapsed, color: groupColor, title: groupTitle });
    await this.client.sendResourceToServer({ resource: "new-tab-group", correlationId, groupId: tabGroup.id });
  }

  /* ── agir na pagina ── */

  private async esperarCarregar(tabId: number) {
    const limite = Date.now() + ESPERA_MAXIMA_CARREGAR_MS;
    await espera(150);
    while (Date.now() < limite) {
      const tab = await browser.tabs.get(tabId);
      if (tab.status === "complete") return tab;
      await espera(200);
    }
    return browser.tabs.get(tabId);
  }

  private async navegar(correlationId: string, tabId: number, url: string) {
    await exigirAbaDoClaude(tabId);
    if (url === "back") await browser.tabs.goBack(tabId);
    else if (url === "forward") await browser.tabs.goForward(tabId);
    else if (url === "reload") await browser.tabs.reload(tabId);
    else {
      if (!urlPermitida(url)) throw new Error("So da pra abrir enderecos http ou https");
      await this.autorizar(url);
      await browser.tabs.update(tabId, { url });
    }
    const tab = await this.esperarCarregar(tabId);
    await this.client.sendResourceToServer({
      resource: "action-result",
      correlationId,
      result: tab.status === "complete" ? "Pagina carregada" : "A pagina ainda esta carregando",
      url: tab.url,
      title: tab.title,
    });
  }

  /* injeta o agente uma vez por pagina */
  private async garantirAgente(tabId: number) {
    const [tem] = await browser.tabs.executeScript(tabId, { code: "typeof window.__claudeAgente !== 'undefined'" });
    if (!tem) await browser.tabs.executeScript(tabId, { file: "/dist/agente-pagina.js" });
  }

  private async chamarAgente<T>(tabId: number, metodo: string, args: unknown[]): Promise<T> {
    await this.garantirAgente(tabId);
    const [resposta] = await browser.tabs.executeScript(tabId, {
      code: `(function () {
        try { return { ok: true, valor: window.__claudeAgente[${JSON.stringify(metodo)}](...${JSON.stringify(args)}) } }
        catch (e) { return { ok: false, erro: String((e && e.message) || e) } }
      })()`,
    });
    const r = resposta as { ok: boolean; valor?: T; erro?: string };
    if (!r.ok) throw new Error(r.erro);
    return r.valor as T;
  }

  private async lerPagina(correlationId: string, tabId: number, soInterativos: boolean) {
    const tab = await this.abaLiberada(tabId);
    const text = await this.chamarAgente<string>(tabId, "lerPagina", [soInterativos]);
    await this.client.sendResourceToServer({ resource: "snapshot", correlationId, url: tab.url ?? "", title: tab.title ?? "", text });
  }

  private async agir(correlationId: string, tabId: number, metodo: string, args: unknown[]) {
    await this.abaLiberada(tabId);
    const result = await this.chamarAgente<string>(tabId, metodo, args);
    await espera(PAUSA_DEPOIS_DE_AGIR_MS);
    const tab = await browser.tabs.get(tabId);
    await this.client.sendResourceToServer({ resource: "action-result", correlationId, result, url: tab.url, title: tab.title });
  }

  private async rodarJs(correlationId: string, tabId: number, codigo: string) {
    await this.abaLiberada(tabId);
    const corpo = /\breturn\b/.test(codigo) ? codigo : `return (${codigo})`;
    const [value] = await browser.tabs.executeScript(tabId, {
      code: `(async () => { ${corpo} })().then(
        (v) => { try { return v === undefined ? "undefined" : JSON.stringify(v) } catch (e) { return String(v) } },
        (e) => "Erro: " + ((e && e.message) || e)
      )`,
    });
    await this.client.sendResourceToServer({ resource: "js-result", correlationId, value: String(value) });
  }

  private async lerConsole(correlationId: string, tabId: number, padrao?: string, limpar = false) {
    await this.abaLiberada(tabId);
    const { entries, capturing } = await this.chamarAgente<{ entries: { level: string; text: string; timestamp: number }[]; capturing: boolean }>(
      tabId,
      "lerConsole",
      [padrao, limpar]
    );
    await this.client.sendResourceToServer({ resource: "console", correlationId, entries, capturing });
  }

  private async lerRedeDaAba(correlationId: string, tabId: number, padrao?: string, limpar = false) {
    await exigirAbaDoClaude(tabId);
    await this.client.sendResourceToServer({ resource: "network", correlationId, requests: lerRede(tabId, padrao, limpar) });
  }
}

function parseImageDataUrl(dataUrl: string): { mimeType: string; imageData: string } {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) {
    throw new Error("The browser returned a screenshot in an unexpected format");
  }
  return { mimeType: match[1], imageData: match[2] };
}
