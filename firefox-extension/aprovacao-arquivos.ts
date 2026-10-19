/*
 * Aprovacao de envio de arquivo (modo "perguntar a cada arquivo"): a
 * background abre a pagina aprovar-arquivo.html e espera a pessoa decidir.
 * Sem resposta em 2 minutos, conta como nao.
 */
import type { ArquivoParaEnviar } from "@browser-control-mcp/common";

const ESPERA_MAXIMA_MS = 120_000;

interface Pedido {
  site: string;
  arquivos: { nome: string; tamanho: number }[];
  responder: (ok: boolean) => void;
}

const pendentes = new Map<string, Pedido>();

export async function pedirAprovacao(site: string, arquivos: ArquivoParaEnviar[]): Promise<boolean> {
  const id = crypto.randomUUID();
  const resposta = new Promise<boolean>((resolve) => {
    const tempo = setTimeout(() => {
      pendentes.delete(id);
      resolve(false);
    }, ESPERA_MAXIMA_MS);
    pendentes.set(id, {
      site,
      arquivos: arquivos.map((a) => ({ nome: a.nome, tamanho: a.tamanho })),
      responder: (ok) => {
        clearTimeout(tempo);
        pendentes.delete(id);
        resolve(ok);
      },
    });
  });
  const pagina = await browser.tabs.create({ url: browser.runtime.getURL(`aprovar-arquivo.html?id=${id}`) });
  const ok = await resposta;
  if (pagina.id !== undefined) browser.tabs.remove(pagina.id).catch(() => undefined);
  return ok;
}

/* mensagens da pagina de aprovacao (so da propria extensao) */
export function atenderPaginaDeAprovacao() {
  browser.runtime.onMessage.addListener((mensagem: { tipo?: string; id?: string; ok?: boolean }, remetente) => {
    if (remetente.id !== browser.runtime.id || !mensagem?.id) return;
    const pedido = pendentes.get(mensagem.id);
    if (mensagem.tipo === "detalhes-arquivo") {
      return Promise.resolve(pedido ? { site: pedido.site, arquivos: pedido.arquivos } : null);
    }
    if (mensagem.tipo === "resposta-arquivo" && pedido) {
      pedido.responder(mensagem.ok === true);
      return Promise.resolve(true);
    }
  });
}
