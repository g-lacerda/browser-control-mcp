/*
 * Roda dentro da aba (content script), so nas abas do grupo do Claude. Le a
 * pagina como uma lista de elementos com referencia (e1, e2...), e clica,
 * digita, rola e escolhe opcao por essas referencias. A background injeta este
 * arquivo uma vez por pagina e depois chama window.__claudeAgente.
 *
 * Nada aqui fala com a rede: o resultado volta so pra background da extensao.
 */
import { CARTOES_DE_TESTE, digitosDoTexto, ehCampoDeCartao, ehCartaoReal } from "./regras";

declare function exportFunction(fn: Function, alvo: object, opcoes?: { defineAs?: string }): Function;

const SELETOR_INTERATIVO = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[contenteditable=''], [contenteditable=true]",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=switch]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=option]",
  "[role=combobox]",
  "[role=textbox]",
  "[onclick]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const SELETOR_TEXTO = "h1,h2,h3,h4,h5,h6,p,li,label,td,th,[role=heading],[role=alert],[role=status]";

/*
 * ── o que a pessoa ve enquanto o Claude age ──
 * Tudo numa camada propria com shadow DOM fechado: o CSS do site nao deforma
 * nada e o site nao alcanca esses elementos. A camada nao pega clique; so o
 * botao de pausar pega.
 */

const LARANJA = "#f28c28";
const DURACAO_MOVIMENTO_MS = 420;
const SOME_DEPOIS_MS = 1600;
let posicao = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let raiz: ShadowRoot | null = null;
let temporizadorAtivo: number | undefined;

const espera = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function semMovimento(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const ESTILO = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .borda { position: fixed; inset: 0; pointer-events: none; opacity: 0; transition: opacity 300ms ease;
    box-shadow: inset 0 0 0 3px ${LARANJA}, inset 0 0 28px rgba(242,140,40,.45); }
  .borda.ativa { opacity: 1; animation: respira 1.8s ease-in-out infinite; }
  @keyframes respira { 50% { box-shadow: inset 0 0 0 3px ${LARANJA}, inset 0 0 44px rgba(242,140,40,.6); } }
  .cursor { position: fixed; width: 22px; height: 22px; pointer-events: none; opacity: 0; transition: opacity 200ms ease; }
  .cursor.visivel { opacity: 1; }
  .etiqueta { position: absolute; left: 20px; top: 18px; white-space: nowrap; max-width: 280px; overflow: hidden; text-overflow: ellipsis;
    background: #1f1d1a; color: #fff; font-size: 12px; line-height: 1; padding: 6px 9px; border-radius: 7px;
    border: 1px solid ${LARANJA}; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
  .etiqueta:empty { display: none; }
  .destaque { position: fixed; pointer-events: none; border: 2px solid ${LARANJA}; border-radius: 6px;
    box-shadow: 0 0 0 4px rgba(242,140,40,.18); opacity: 0; transition: opacity 300ms ease; }
  .pulso { position: fixed; width: 28px; height: 28px; border-radius: 50%; border: 2px solid ${LARANJA}; pointer-events: none;
    transform: translate(-50%,-50%) scale(.4); animation: pulso 380ms ease-out forwards; }
  @keyframes pulso { to { transform: translate(-50%,-50%) scale(1.7); opacity: 0; } }
  .varredura { position: fixed; left: 0; right: 0; height: 90px; pointer-events: none; top: -90px;
    background: linear-gradient(180deg, rgba(242,140,40,0) 0%, rgba(242,140,40,.16) 70%, rgba(242,140,40,.5) 100%);
    animation: varre 900ms ease-in-out forwards; }
  @keyframes varre { to { top: 100%; } }
  .pausar { position: fixed; right: 16px; bottom: 16px; pointer-events: auto; cursor: pointer; display: none;
    background: #d93025; color: #fff; border: 0; border-radius: 999px; padding: 9px 14px; font-size: 13px; font-weight: 600;
    box-shadow: 0 6px 18px rgba(0,0,0,.3); }
  .pausar.visivel { display: inline-flex; align-items: center; gap: 7px; }
  .pausar:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  .pausar::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #fff; }
  @media (prefers-reduced-motion: reduce) {
    .borda.ativa { animation: none; } .pulso, .varredura { display: none; } .cursor, .borda, .destaque { transition: none; }
  }
`;

function camada(): ShadowRoot {
  if (raiz && raiz.host.isConnected) return raiz;
  const host = document.createElement("claude-no-navegador");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  raiz = host.attachShadow({ mode: "closed" });
  raiz.innerHTML = `
    <style>${ESTILO}</style>
    <div class="borda"></div>
    <div class="destaque"></div>
    <div class="cursor"><svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13.5 19.2 L10.6 12.8 L16.5 12.8 Z" fill="${LARANJA}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><div class="etiqueta"></div></div>
    <button class="pausar" type="button">Pausar o Claude</button>`;
  const botao = raiz.querySelector(".pausar") as HTMLButtonElement;
  botao.addEventListener("click", () => {
    // a background guarda a pausa: a partir dai nenhum comando passa
    void browser.runtime.sendMessage({ tipo: "pausar" });
    botao.textContent = "Claude pausado";
    setTimeout(desligarAtividade, 900);
  });
  const c = raiz.querySelector(".cursor") as HTMLDivElement;
  c.style.left = `${posicao.x}px`;
  c.style.top = `${posicao.y}px`;
  document.documentElement.appendChild(host);
  return raiz;
}

const peca = <T extends HTMLElement>(classe: string) => camada().querySelector(`.${classe}`) as T;

/* borda brilhando e botao de pausar enquanto o Claude age; somem um pouco depois da ultima acao */
function ligarAtividade(texto: string) {
  peca("borda").classList.add("ativa");
  peca("pausar").textContent = "Pausar o Claude";
  peca("pausar").classList.add("visivel");
  peca("cursor").classList.add("visivel");
  peca("etiqueta").textContent = texto;
  clearTimeout(temporizadorAtivo);
  temporizadorAtivo = window.setTimeout(desligarAtividade, SOME_DEPOIS_MS);
}

function desligarAtividade() {
  if (!raiz) return;
  peca("borda").classList.remove("ativa");
  peca("pausar").classList.remove("visivel");
  peca("etiqueta").textContent = "";
}

async function moverAte(el: Element, texto: string, ponto?: { x: number; y: number }) {
  ligarAtividade(texto);
  const r = el.getBoundingClientRect();
  const destino = ponto ?? { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 };
  const c = peca<HTMLDivElement>("cursor");
  const anima = !semMovimento();
  c.style.transition = anima ? `left ${DURACAO_MOVIMENTO_MS}ms ease, top ${DURACAO_MOVIMENTO_MS}ms ease, opacity 200ms ease` : "none";
  c.style.left = `${destino.x}px`;
  c.style.top = `${destino.y}px`;
  posicao = destino;
  destacar(el);
  if (anima) await espera(DURACAO_MOVIMENTO_MS);
}

/* contorno laranja no elemento em que o Claude esta mexendo */
function destacar(el: Element) {
  const r = el.getBoundingClientRect();
  const caixa = peca<HTMLDivElement>("destaque");
  caixa.style.opacity = "1";
  caixa.style.left = `${r.left - 4}px`;
  caixa.style.top = `${r.top - 4}px`;
  caixa.style.width = `${r.width + 8}px`;
  caixa.style.height = `${r.height + 8}px`;
  clearTimeout((caixa as unknown as { __t?: number }).__t);
  (caixa as unknown as { __t?: number }).__t = window.setTimeout(() => (caixa.style.opacity = "0"), 1200);
}

function pulsar() {
  const p = document.createElement("div");
  p.className = "pulso";
  p.style.left = `${posicao.x}px`;
  p.style.top = `${posicao.y}px`;
  camada().appendChild(p);
  setTimeout(() => p.remove(), 450);
}

/* linha descendo pela tela enquanto o Claude le a pagina */
function varrer() {
  ligarAtividade("Lendo a página");
  const v = document.createElement("div");
  v.className = "varredura";
  camada().appendChild(v);
  setTimeout(() => v.remove(), 950);
}

/* rola ate o elemento suavemente e espera chegar */
async function rolarAte(el: Element) {
  const r = el.getBoundingClientRect();
  const dentro = r.top >= 0 && r.bottom <= window.innerHeight;
  if (dentro) return;
  const suave = !semMovimento();
  el.scrollIntoView({ block: "center", inline: "center", behavior: suave ? "smooth" : "auto" });
  if (suave) await espera(380);
}

/* como na tela, letra por letra: no maximo ~1,2s, o texto longo acelera */
async function escreverAosPoucos(el: HTMLInputElement | HTMLTextAreaElement, inicio: string, texto: string) {
  const passo = Math.max(4, Math.min(28, Math.floor(1200 / Math.max(1, texto.length))));
  const porVez = texto.length > 120 ? Math.ceil(texto.length / 60) : 1;
  for (let i = porVez; i < texto.length; i += porVez) {
    definirValor(el, inicio + texto.slice(0, i));
    await espera(passo);
  }
  definirValor(el, inicio + texto);
}

let proximaRef = 1;
let porRef = new Map<string, Element>();

interface EntradaConsole {
  level: string;
  text: string;
  timestamp: number;
}
const consoleCapturado: EntradaConsole[] = [];
let capturandoConsole = false;

function visivel(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const estilo = window.getComputedStyle(el);
  return estilo.visibility !== "hidden" && estilo.display !== "none" && estilo.opacity !== "0";
}

function curto(texto: string | null | undefined, max = 80): string {
  const limpo = (texto ?? "").replace(/\s+/g, " ").trim();
  return limpo.length > max ? `${limpo.slice(0, max - 1)}…` : limpo;
}

function nomeDoElemento(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return curto(aria);
  const rotuladoPor = el.getAttribute("aria-labelledby");
  if (rotuladoPor) {
    const texto = rotuladoPor
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (texto.trim()) return curto(texto);
  }
  if (el.id) {
    const rotulo = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (rotulo?.textContent?.trim()) return curto(rotulo.textContent);
  }
  const pai = el.closest("label");
  if (pai && pai !== el && pai.textContent?.trim()) return curto(pai.textContent);
  for (const atributo of ["placeholder", "title", "alt", "name"]) {
    const valor = el.getAttribute(atributo);
    if (valor) return curto(valor);
  }
  return curto((el as HTMLElement).innerText ?? el.textContent);
}

function papelDoElemento(el: Element): string {
  const role = el.getAttribute("role");
  if (role) return role;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "input") {
    const tipo = (el as HTMLInputElement).type;
    if (tipo === "checkbox" || tipo === "radio") return tipo;
    if (tipo === "submit" || tipo === "button" || tipo === "reset") return "button";
    return `textbox (${tipo})`;
  }
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if ((el as HTMLElement).isContentEditable) return "textbox (editavel)";
  return tag;
}

function estadoDoElemento(el: Element): string {
  const partes: string[] = [];
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") partes.push(el.checked ? "marcado" : "desmarcado");
    // o valor de senha nunca sai da pagina
    else if (el.type !== "password" && el.value) partes.push(`valor: "${curto(el.value, 40)}"`);
    else if (el.type === "password" && el.value) partes.push("preenchido");
  } else if (el instanceof HTMLTextAreaElement && el.value) {
    partes.push(`valor: "${curto(el.value, 40)}"`);
  } else if (el instanceof HTMLSelectElement) {
    partes.push(`escolhido: "${curto(el.selectedOptions[0]?.textContent, 40)}"`);
  }
  if ((el as HTMLButtonElement).disabled) partes.push("desabilitado");
  if (el.getAttribute("aria-expanded")) partes.push(`expandido=${el.getAttribute("aria-expanded")}`);
  if (el instanceof HTMLAnchorElement && el.href) partes.push(`href=${curto(el.href, 100)}`);
  return partes.length ? ` (${partes.join(", ")})` : "";
}

function registrar(el: Element): string {
  const ref = `e${proximaRef++}`;
  porRef.set(ref, el);
  return ref;
}

/* apps montam a tela aos poucos: espera 300ms sem mudanca no DOM (no maximo 2s) antes de ler */
function esperarAssentar(): Promise<void> {
  return new Promise((resolve) => {
    let quieto = window.setTimeout(fim, 300);
    const limite = window.setTimeout(fim, 2000);
    const observador = new MutationObserver(() => {
      clearTimeout(quieto);
      quieto = window.setTimeout(fim, 300);
    });
    observador.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    function fim() {
      observador.disconnect();
      clearTimeout(quieto);
      clearTimeout(limite);
      resolve();
    }
  });
}

async function lerPagina(soInterativos: boolean): Promise<string> {
  varrer();
  await esperarAssentar();
  proximaRef = 1;
  porRef = new Map();
  const linhas: string[] = [];
  const seletor = soInterativos ? SELETOR_INTERATIVO : `${SELETOR_INTERATIVO},${SELETOR_TEXTO}`;
  const vistos = new Set<Element>();
  for (const el of Array.from(document.querySelectorAll(seletor))) {
    if (vistos.has(el) || !visivel(el)) continue;
    vistos.add(el);
    if (el.matches(SELETOR_INTERATIVO)) {
      linhas.push(`[${registrar(el)}] ${papelDoElemento(el)} "${nomeDoElemento(el)}"${estadoDoElemento(el)}`);
    } else {
      // texto solto: so se nao for dentro de um interativo ja listado
      if (el.closest(SELETOR_INTERATIVO)) continue;
      const texto = curto((el as HTMLElement).innerText, 200);
      if (texto) linhas.push(`${el.tagName.toLowerCase()}: ${texto}`);
    }
    if (linhas.length >= 1500) {
      linhas.push("… (pagina grande: lista cortada em 1500 itens)");
      break;
    }
  }
  return linhas.join("\n");
}

function alvo(ref?: string, seletor?: string, x?: number, y?: number): Element {
  let el: Element | null | undefined = null;
  if (ref) {
    el = porRef.get(ref);
    if (!el || !el.isConnected) throw new Error(`A referencia ${ref} nao existe mais na pagina. Leia a pagina de novo (snapshot).`);
  } else if (seletor) {
    el = document.querySelector(seletor);
    if (!el) throw new Error(`Nenhum elemento com o seletor ${seletor}`);
  } else if (x !== undefined && y !== undefined) {
    el = document.elementFromPoint(x, y);
    if (!el) throw new Error(`Nenhum elemento no ponto (${x}, ${y})`);
  } else {
    throw new Error("Diga o elemento: ref, selector ou x/y");
  }
  return el;
}

function centroDe(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/*
 * Todo evento leva a posicao de verdade (a pedida ou o centro do elemento).
 * Antes o clique saia com el.click(), que nao tem coordenada: a pagina via o
 * clique em (0, 0), e marcar ponto numa imagem caia no canto.
 */
function eventoDeMouse(el: Element, tipo: string, ponto: { x: number; y: number } = centroDe(el)) {
  const apertado = tipo === "pointerdown" || tipo === "mousedown";
  const opcoes = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: ponto.x,
    clientY: ponto.y,
    screenX: window.screenX + ponto.x,
    screenY: window.screenY + ponto.y,
    button: 0,
    buttons: apertado ? 1 : 0,
    detail: tipo === "dblclick" ? 2 : 1,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
  };
  const Construtor = tipo.startsWith("pointer") && typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
  el.dispatchEvent(new Construtor(tipo, opcoes));
}

async function clicar(ref?: string, seletor?: string, x?: number, y?: number, duplo = false): Promise<string> {
  const el = alvo(ref, seletor, x, y);
  // com coordenada, o ponto e da tela como esta: rolar mudaria o que esta embaixo dele
  const pelaCoordenada = x !== undefined && y !== undefined && !ref && !seletor;
  if (!pelaCoordenada) await rolarAte(el);
  const ponto = pelaCoordenada ? { x: x!, y: y! } : centroDe(el);
  await moverAte(el, `Clicando em ${curto(nomeDoElemento(el), 40) || papelDoElemento(el)}`, ponto);
  pulsar();
  for (const tipo of ["pointerover", "pointerenter", "mouseover", "pointerdown", "mousedown"]) eventoDeMouse(el, tipo, ponto);
  if (el instanceof HTMLElement) el.focus({ preventScroll: true });
  for (const tipo of ["pointerup", "mouseup", "click"]) eventoDeMouse(el, tipo, ponto);
  if (duplo) eventoDeMouse(el, "dblclick", ponto);
  return `Cliquei em ${papelDoElemento(el)} "${nomeDoElemento(el)}"`;
}

/* muda o valor do jeito que React e afins enxergam (setter nativo + eventos) */
function definirValor(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const prototipo = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototipo, "value")?.set;
  if (setter) setter.call(el, valor);
  else el.value = valor;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function conferirCartao(el: Element, texto: string) {
  if (ehCartaoReal(texto)) {
    throw new Error("Recusado: isso parece um cartao de verdade. So cartoes de teste (sandbox) podem ser digitados.");
  }
  const campoDeCartao = ehCampoDeCartao({
    autocomplete: el.getAttribute("autocomplete"),
    name: el.getAttribute("name"),
    id: el.id,
  });
  if (campoDeCartao) {
    const digitos = digitosDoTexto(texto.trim());
    if (!digitos || !CARTOES_DE_TESTE.has(digitos)) {
      throw new Error("Recusado: campo de numero de cartao so aceita cartao de teste (sandbox).");
    }
  }
}

async function digitar(
  texto: string,
  ref?: string,
  seletor?: string,
  limpar = true,
  enviar = false,
  animar = true,
): Promise<string> {
  const el = alvo(ref, seletor);
  conferirCartao(el, texto);
  await rolarAte(el);
  await moverAte(el, `Digitando em ${curto(nomeDoElemento(el), 40) || papelDoElemento(el)}`);
  if (el instanceof HTMLElement) el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const inicio = limpar ? "" : el.value;
    // senha nao e animada: nao faz sentido mostrar letra por letra nem esperar
    if (animar && !semMovimento() && !(el instanceof HTMLInputElement && el.type === "password")) {
      await escreverAosPoucos(el, inicio, texto);
    } else {
      definirValor(el, inicio + texto);
    }
  } else if ((el as HTMLElement).isContentEditable) {
    if (limpar) (el as HTMLElement).textContent = "";
    document.execCommand("insertText", false, texto);
  } else {
    throw new Error(`O elemento ${papelDoElemento(el)} nao recebe texto`);
  }
  if (enviar) apertarTecla("Enter");
  return `Digitei em ${papelDoElemento(el)} "${nomeDoElemento(el)}"${enviar ? " e enviei" : ""}`;
}

const FOCAVEIS = "a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

function apertarTecla(tecla: string): string {
  ligarAtividade(`Apertando ${tecla}`);
  const el = (document.activeElement as HTMLElement | null) ?? document.body;
  const opcoes = { key: tecla, code: tecla.length === 1 ? `Key${tecla.toUpperCase()}` : tecla, bubbles: true, cancelable: true };
  const naoCancelado = el.dispatchEvent(new KeyboardEvent("keydown", opcoes));
  el.dispatchEvent(new KeyboardEvent("keypress", opcoes));
  el.dispatchEvent(new KeyboardEvent("keyup", opcoes));
  if (naoCancelado) {
    // evento sintetico nao faz o padrao do navegador: Enter e Tab feitos a mao
    if (tecla === "Enter" && el instanceof HTMLInputElement && el.form) el.form.requestSubmit();
    if (tecla === "Tab") {
      const focaveis = Array.from(document.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(visivel);
      const i = focaveis.indexOf(el);
      focaveis[(i + 1) % focaveis.length]?.focus();
    }
  }
  return `Apertei ${tecla}`;
}

/* o conteiner rolavel sob o meio da tela, subindo pelos pais; nulo quando quem rola e a propria janela */
function conteinerRolavel(eixo: "x" | "y"): Element | null {
  let el: Element | null = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  while (el && el !== document.body && el !== document.documentElement) {
    const estilo = window.getComputedStyle(el);
    const overflow = eixo === "y" ? estilo.overflowY : estilo.overflowX;
    const sobra = eixo === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
    if ((overflow === "auto" || overflow === "scroll") && sobra > 1) return el;
    el = el.parentElement;
  }
  return null;
}

async function rolar(ref?: string, direcao: "up" | "down" | "left" | "right" = "down", quantidade = 3): Promise<string> {
  if (ref) {
    const el = alvo(ref);
    await rolarAte(el);
    await moverAte(el, `Rolando até ${curto(nomeDoElemento(el), 40) || papelDoElemento(el)}`);
    return `Rolei ate ${papelDoElemento(el)} "${nomeDoElemento(el)}"`;
  }
  const passo = 120 * quantidade;
  const dx = direcao === "left" ? -passo : direcao === "right" ? passo : 0;
  const dy = direcao === "up" ? -passo : direcao === "down" ? passo : 0;
  ligarAtividade("Rolando a página");
  // apps (React Native web e afins) rolam dentro de um conteiner, nao na janela
  const alvoDaRolagem = conteinerRolavel(dy !== 0 ? "y" : "x") ?? window;
  alvoDaRolagem.scrollBy({ left: dx, top: dy, behavior: semMovimento() ? "auto" : "smooth" });
  if (!semMovimento()) await espera(380);
  return `Rolei ${direcao} (${passo}px)`;
}

async function escolherOpcao(valor: string, ref?: string, seletor?: string): Promise<string> {
  const el = alvo(ref, seletor);
  await rolarAte(el);
  await moverAte(el, `Escolhendo "${curto(valor, 30)}"`);
  if (!(el instanceof HTMLSelectElement)) throw new Error("Esse elemento nao e uma lista de opcoes (select)");
  const opcao = Array.from(el.options).find((o) => o.value === valor || curto(o.textContent) === curto(valor));
  if (!opcao) throw new Error(`Opcao "${valor}" nao existe nessa lista`);
  el.value = opcao.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return `Escolhi "${curto(opcao.textContent)}"`;
}

/*
 * Console da pagina: o content script vive num mundo isolado, entao embrulha o
 * console da propria pagina (wrappedJSObject + exportFunction, do Firefox). So
 * comeca a guardar a partir do primeiro pedido.
 */
function iniciarConsole() {
  if (capturandoConsole) return;
  capturandoConsole = true;
  const pagina = (window as unknown as { wrappedJSObject: Window & { console: Console } }).wrappedJSObject;
  for (const nivel of ["log", "info", "warn", "error", "debug"] as const) {
    const original = pagina.console[nivel];
    exportFunction(
      function (...args: unknown[]) {
        consoleCapturado.push({ level: nivel, text: args.map((a) => curto(String(a), 500)).join(" "), timestamp: Date.now() });
        if (consoleCapturado.length > 500) consoleCapturado.shift();
        return original.apply(pagina.console, args);
      },
      pagina.console,
      { defineAs: nivel },
    );
  }
  window.addEventListener("error", (e) => {
    consoleCapturado.push({ level: "error", text: `${e.message} (${e.filename}:${e.lineno})`, timestamp: Date.now() });
  });
}

function lerConsole(padrao?: string, limpar = false) {
  iniciarConsole();
  const regex = padrao ? new RegExp(padrao, "i") : null;
  const entradas = consoleCapturado.filter((e) => !regex || regex.test(e.text));
  if (limpar) consoleCapturado.length = 0;
  return { entries: entradas.slice(-200), capturing: true };
}

/*
 * ── enviar arquivos do computador ──
 * O servidor local le o arquivo e a background manda pra ca (por mensagem, nao
 * por codigo injetado: arquivo grande nao cabe numa string de script). Com um
 * input[type=file] na tela, o arquivo vai direto nele. Sem, o arquivo fica
 * "armado" e e entregue quando a pagina abrir o seletor (input.click() ou
 * showPicker()), que e como o botao "Escolher imagem" dos apps funciona.
 */
interface ArquivoRecebido {
  nome: string;
  tipo: string;
  base64: string;
}

const ARMADO_POR_MS = 60_000;
let armado: File[] | null = null;
let temporizadorArmado: number | undefined;
let interceptando = false;

function paraFile(a: ArquivoRecebido): File {
  const binario = atob(a.base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new File([bytes], a.nome, { type: a.tipo });
}

function colocarNoInput(input: HTMLInputElement, arquivos: File[]) {
  const dt = new DataTransfer();
  (input.multiple ? arquivos : arquivos.slice(0, 1)).forEach((f) => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/* troca o click() e o showPicker() dos inputs da pagina: com arquivo armado, entrega em vez de abrir o seletor */
function interceptarSeletor() {
  if (interceptando) return;
  interceptando = true;
  const pagina = (window as unknown as { wrappedJSObject: { HTMLInputElement: { prototype: HTMLInputElement } } }).wrappedJSObject;
  const proto = pagina.HTMLInputElement.prototype;
  const clickOriginal = proto.click;
  const pickerOriginal = (proto as HTMLInputElement & { showPicker?: () => void }).showPicker;
  const entregar = (input: HTMLInputElement): boolean => {
    if (!armado || input.type !== "file") return false;
    const arquivos = armado;
    armado = null;
    clearTimeout(temporizadorArmado);
    colocarNoInput(input, arquivos);
    ligarAtividade(`Enviando ${arquivos.length === 1 ? arquivos[0]!.name : `${arquivos.length} arquivos`}`);
    return true;
  };
  exportFunction(
    function (this: HTMLInputElement) {
      if (entregar(this)) return;
      return clickOriginal.call(this);
    },
    proto,
    { defineAs: "click" },
  );
  if (pickerOriginal) {
    exportFunction(
      function (this: HTMLInputElement) {
        if (entregar(this)) return;
        return pickerOriginal.call(this);
      },
      proto,
      { defineAs: "showPicker" },
    );
  }
}

async function enviarArquivos(recebidos: ArquivoRecebido[], ref?: string, seletor?: string): Promise<string> {
  const arquivos = recebidos.map(paraFile);
  const nomes = arquivos.map((f) => f.name).join(", ");
  if (ref || seletor) {
    const el = alvo(ref, seletor);
    if (!(el instanceof HTMLInputElement) || el.type !== "file") {
      throw new Error("Esse elemento nao e um campo de arquivo. Sem ref, o arquivo fica pronto pro proximo seletor que a pagina abrir.");
    }
    await rolarAte(el);
    await moverAte(el, `Enviando ${nomes}`);
    colocarNoInput(el, arquivos);
    return `Enviei ${nomes} no campo de arquivo`;
  }
  interceptarSeletor();
  armado = arquivos;
  clearTimeout(temporizadorArmado);
  temporizadorArmado = window.setTimeout(() => (armado = null), ARMADO_POR_MS);
  ligarAtividade(`Arquivo pronto: ${nomes}`);
  return `Arquivo pronto (${nomes}). Agora clique no botao que abre a escolha de arquivo; vale por 1 minuto.`;
}

browser.runtime.onMessage.addListener((mensagem: { tipo?: string; arquivos?: ArquivoRecebido[]; ref?: string; selector?: string }) => {
  if (mensagem?.tipo !== "claude-arquivos" || !mensagem.arquivos) return;
  return enviarArquivos(mensagem.arquivos, mensagem.ref, mensagem.selector).then(
    (valor) => ({ ok: true, valor }),
    (e: unknown) => ({ ok: false, erro: e instanceof Error ? e.message : String(e) }),
  );
});

(window as unknown as { __claudeAgente: unknown }).__claudeAgente = {
  lerPagina,
  clicar,
  digitar,
  apertarTecla,
  rolar,
  escolherOpcao,
  lerConsole,
};
