/*
 * Requisicoes de rede das abas do Claude, pra depurar o que ele estiver
 * testando. As abas da pessoa nao entram: o filtro confere a lista de abas do
 * Claude antes de guardar qualquer coisa. Fica so na memoria da background.
 */
import type { NetworkEntry } from "@browser-control-mcp/common";
import { idsDasAbasDoClaude } from "./abas-claude";

const LIMITE_POR_ABA = 300;
const porAba = new Map<number, NetworkEntry[]>();
let abasDoClaude = new Set<number>();

async function atualizarAbas() {
  abasDoClaude = new Set(await idsDasAbasDoClaude());
}

function guardar(tabId: number, entrada: NetworkEntry) {
  if (!abasDoClaude.has(tabId)) return;
  const lista = porAba.get(tabId) ?? [];
  lista.push(entrada);
  if (lista.length > LIMITE_POR_ABA) lista.shift();
  porAba.set(tabId, lista);
}

export function acompanharRede() {
  void atualizarAbas();
  browser.storage.onChanged.addListener((_mudancas, area) => {
    if (area === "session") void atualizarAbas();
  });
  browser.webRequest.onCompleted.addListener(
    (d) => guardar(d.tabId, { url: d.url, method: d.method, status: d.statusCode, type: d.type, timestamp: d.timeStamp }),
    { urls: ["<all_urls>"] },
  );
  browser.webRequest.onErrorOccurred.addListener(
    (d) => guardar(d.tabId, { url: d.url, method: d.method, status: 0, type: `${d.type} (${d.error})`, timestamp: d.timeStamp }),
    { urls: ["<all_urls>"] },
  );
  browser.tabs.onRemoved.addListener((tabId) => porAba.delete(tabId));
}

export function lerRede(tabId: number, padrao?: string, limpar = false): NetworkEntry[] {
  const lista = porAba.get(tabId) ?? [];
  const filtradas = padrao ? lista.filter((e) => e.url.includes(padrao)) : lista;
  if (limpar) porAba.set(tabId, []);
  return filtradas.slice(-150);
}
