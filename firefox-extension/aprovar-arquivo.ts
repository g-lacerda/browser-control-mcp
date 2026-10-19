const id = new URLSearchParams(location.search).get("id") ?? "";

function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

async function mostrar() {
  const pedido = (await browser.runtime.sendMessage({ tipo: "detalhes-arquivo", id })) as {
    site: string;
    arquivos: { nome: string; tamanho: number }[];
  } | null;
  if (!pedido) {
    (document.getElementById("explica") as HTMLParagraphElement).textContent = "Esse pedido já expirou ou foi respondido.";
    (document.querySelector(".acoes") as HTMLDivElement).remove();
    return;
  }
  (document.getElementById("site") as HTMLSpanElement).textContent = pedido.site;
  const lista = document.getElementById("arquivos") as HTMLUListElement;
  for (const a of pedido.arquivos) {
    const item = document.createElement("li");
    const nome = document.createElement("span");
    nome.textContent = a.nome;
    const peso = document.createElement("span");
    peso.textContent = tamanho(a.tamanho);
    item.append(nome, peso);
    lista.appendChild(item);
  }
}

async function responder(ok: boolean) {
  await browser.runtime.sendMessage({ tipo: "resposta-arquivo", id, ok });
  window.close();
}

document.getElementById("enviar")?.addEventListener("click", () => void responder(true));
document.getElementById("negar")?.addEventListener("click", () => void responder(false));
void mostrar();
