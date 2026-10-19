/**
 * @jest-environment jsdom
 */
import "../agente-pagina";

type Agente = {
  lerPagina: (so: boolean) => Promise<string>;
  digitar: (texto: string, ref?: string, seletor?: string, limpar?: boolean, enviar?: boolean) => Promise<string>;
  clicar: (ref?: string, seletor?: string) => Promise<string>;
};
const agente = () => (window as unknown as { __claudeAgente: Agente }).__claudeAgente;

beforeAll(() => {
  // jsdom nao tem CSS.escape (o Firefox tem)
  (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = { escape: (s: string) => s.replace(/["\\]/g, "\\$&") };
  // jsdom nao calcula layout: todo elemento conta como visivel
  Element.prototype.getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, x: 0, y: 0, toJSON: () => ({}) });
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  document.body.innerHTML = `
    <label for="email">E-mail</label><input id="email" type="email">
    <input id="senha" type="password" value="segredo">
    <input id="cartao" autocomplete="cc-number">
    <input id="obs" name="observacao">
    <button id="entrar">Entrar</button>`;
});

it("le a pagina com referencias e nunca mostra o valor da senha", async () => {
  const texto = await agente().lerPagina(true);
  expect(texto).toContain('textbox (email) "E-mail"');
  expect(texto).toContain('button "Entrar"');
  expect(texto).toContain("preenchido");
  expect(texto).not.toContain("segredo");
});

it("campo de cartao so aceita cartao de teste", async () => {
  await expect(agente().digitar("4539 5787 6362 1486", undefined, "#cartao")).rejects.toThrow("cartao");
  await expect(agente().digitar("1234", undefined, "#cartao")).rejects.toThrow("cartao de teste");
  await agente().digitar("4242 4242 4242 4242", undefined, "#cartao");
  expect((document.getElementById("cartao") as HTMLInputElement).value).toBe("4242 4242 4242 4242");
});

it("cartao real e recusado ate em campo comum", async () => {
  await expect(agente().digitar("4539578763621486", undefined, "#obs")).rejects.toThrow("cartao de verdade");
  expect((document.getElementById("obs") as HTMLInputElement).value).toBe("");
});

it("senha pode ser digitada e clicar acha o botao pela referencia", async () => {
  await agente().digitar("nova-senha", undefined, "#senha");
  expect((document.getElementById("senha") as HTMLInputElement).value).toBe("nova-senha");
  const texto = await agente().lerPagina(true);
  const ref = /\[(e\d+)\] button "Entrar"/.exec(texto)![1];
  let clicado = false;
  document.getElementById("entrar")!.addEventListener("click", () => (clicado = true));
  await agente().clicar(ref);
  expect(clicado).toBe(true);
  // o cursor e o destaque sao desenhados por cima, sem pegar clique
  const camada = document.querySelector("claude-no-navegador") as HTMLElement;
  expect(camada.style.pointerEvents).toBe("none");
  // shadow DOM fechado: a pagina nao alcanca o cursor nem o botao de pausar
  expect(camada.shadowRoot).toBeNull();
});
