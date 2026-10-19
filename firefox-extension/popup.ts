import {
  digitacaoAnimada,
  estaPausado,
  getModoAutorizacao,
  setDigitacaoAnimada,
  setModoAutorizacao,
  setPausado,
  type ModoAutorizacao,
} from "./extension-config";

const botaoPausa = document.getElementById("pausa") as HTMLButtonElement;
const estado = document.getElementById("estado") as HTMLDivElement;
const estadoTexto = document.getElementById("estado-texto") as HTMLSpanElement;
const modo = document.getElementById("modo") as HTMLSelectElement;
const opcoes = document.getElementById("opcoes") as HTMLButtonElement;
const digitacao = document.getElementById("digitacao") as HTMLInputElement;

async function mostrar() {
  const pausado = await estaPausado();
  estado.classList.toggle("pausado", pausado);
  estadoTexto.textContent = pausado ? "Pausado: o Claude não age em nada" : "Liberado";
  botaoPausa.textContent = pausado ? "Liberar o Claude" : "Pausar o Claude";
  botaoPausa.className = pausado ? "liberar" : "pausar";
  modo.value = await getModoAutorizacao();
  digitacao.checked = await digitacaoAnimada();
}

digitacao.addEventListener("change", () => void setDigitacaoAnimada(digitacao.checked));

botaoPausa.addEventListener("click", async () => {
  await setPausado(!(await estaPausado()));
  await mostrar();
});

modo.addEventListener("change", async () => {
  await setModoAutorizacao(modo.value as ModoAutorizacao);
  await mostrar();
});

opcoes.addEventListener("click", () => {
  void browser.runtime.openOptionsPage();
  window.close();
});

void mostrar();
