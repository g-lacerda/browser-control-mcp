/*
 * As abas do Claude: ele so age (navegar, clicar, digitar, ler console e rede)
 * nas abas que ele mesmo abriu, guardadas num grupo "Claude" por janela. As
 * abas da pessoa ficam fora do alcance, mesmo na mesma janela.
 *
 * A lista vive em storage.session: some quando o Firefox fecha, junto com as
 * abas, e sobrevive a background reiniciar.
 */

const CHAVE = "abasDoClaude";
const TITULO_DO_GRUPO = "Claude";

async function lerAbas(): Promise<number[]> {
  const dados = await browser.storage.session.get(CHAVE);
  return (dados[CHAVE] as number[] | undefined) ?? [];
}

async function gravarAbas(ids: number[]) {
  await browser.storage.session.set({ [CHAVE]: ids });
}

export async function ehAbaDoClaude(tabId: number): Promise<boolean> {
  return (await lerAbas()).includes(tabId);
}

export async function idsDasAbasDoClaude(): Promise<number[]> {
  return lerAbas();
}

/* o grupo "Claude" da janela, se ja existir */
async function grupoDaJanela(windowId: number): Promise<number | undefined> {
  const grupos = await browser.tabGroups.query({ windowId, title: TITULO_DO_GRUPO });
  return grupos[0]?.id;
}

/* abre a aba ja dentro do grupo "Claude" (cria o grupo na primeira vez) */
export async function abrirAbaDoClaude(url: string): Promise<browser.tabs.Tab> {
  const aba = await browser.tabs.create({ url, active: false });
  if (aba.id === undefined) throw new Error("O Firefox nao devolveu a aba aberta");
  await gravarAbas([...(await lerAbas()), aba.id]);
  const existente = aba.windowId !== undefined ? await grupoDaJanela(aba.windowId) : undefined;
  if (existente !== undefined) {
    await browser.tabs.group({ tabIds: [aba.id], groupId: existente });
  } else {
    const novo = await browser.tabs.group({ tabIds: [aba.id] });
    await browser.tabGroups.update(novo, { title: TITULO_DO_GRUPO, color: "orange" });
  }
  return aba;
}

export async function exigirAbaDoClaude(tabId: number) {
  if (!(await ehAbaDoClaude(tabId))) {
    throw new Error(
      `A aba ${tabId} e da pessoa, nao do Claude. So da pra agir nas abas que o Claude abriu (grupo "Claude"). Abra uma aba sua com open-browser-tab.`,
    );
  }
}

/* aba fechada sai da lista */
export function acompanharFechamento() {
  browser.tabs.onRemoved.addListener(async (tabId) => {
    const ids = await lerAbas();
    if (ids.includes(tabId)) await gravarAbas(ids.filter((id) => id !== tabId));
  });
}
