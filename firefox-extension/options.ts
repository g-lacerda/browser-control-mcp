/**
 * Options page script for Browser Control MCP extension
 */
import {
  getModoAutorizacao,
  setModoAutorizacao,
  getDominiosAprovados,
  aprovarDominio,
  revogarDominio,
  type ModoAutorizacao,
  getSecret,
  AVAILABLE_TOOLS,
  getAllToolSettings,
  setToolEnabled,
  getDomainDenyList,
  setDomainDenyList,
  getPorts,
  setPorts,
  getAuditLog,
  clearAuditLog,
  getToolNameById,
} from "./extension-config";

const secretDisplay = document.getElementById(
  "secret-display"
) as HTMLDivElement;
const copyButton = document.getElementById("copy-button") as HTMLButtonElement;
const statusElement = document.getElementById("status") as HTMLDivElement;
const toolSettingsContainer = document.getElementById(
  "tool-settings-container"
) as HTMLDivElement;
const domainDenyListTextarea = document.getElementById(
  "domain-deny-list"
) as HTMLTextAreaElement;
const saveDomainListsButton = document.getElementById(
  "save-domain-lists"
) as HTMLButtonElement;
const domainStatusElement = document.getElementById(
  "domain-status"
) as HTMLDivElement;
const portsInput = document.getElementById("ports-input") as HTMLInputElement;
const savePortsButton = document.getElementById("save-ports") as HTMLButtonElement;
const portsStatusElement = document.getElementById("ports-status") as HTMLDivElement;
const auditLogContainer = document.getElementById("audit-log-container") as HTMLDivElement;
const clearAuditLogButton = document.getElementById("clear-audit-log") as HTMLButtonElement;
const auditLogStatusElement = document.getElementById("audit-log-status") as HTMLDivElement;

/**
 * Loads the secret from storage and displays it
 */
async function loadSecret() {
  try {
    const secret = await getSecret();

    // Check if secret exists
    if (secret) {
      secretDisplay.textContent = secret;
      const comando = document.getElementById("comando-mcp");
      if (comando) {
        comando.textContent = `claude mcp add --scope user navegador -e EXTENSION_SECRET='${secret}' -- node /caminho/do/browser-control-mcp/mcp-server/dist/server.js`;
      }
    } else {
      secretDisplay.textContent =
        "Chave não encontrada. Reinstale a extensão.";
      secretDisplay.style.color = "red";
      copyButton.disabled = true;
    }
  } catch (error) {
    console.error("Error loading secret:", error);
    secretDisplay.textContent =
      "Não deu pra ler a chave. Veja o console da extensão.";
    secretDisplay.style.color = "red";
    copyButton.disabled = true;
  }
}

/**
 * Copies the secret to clipboard
 */
async function copyToClipboard(event: MouseEvent) {
  if (!event.isTrusted) {
    return;
  }
  try {
    const botao = event.currentTarget as HTMLElement | null;
    // o botao diz o que copia: o comando inteiro (passo 2) ou so a chave
    const alvo = document.getElementById(botao?.dataset.copiar ?? "secret-display");
    const texto = alvo?.textContent ?? "";
    if (!texto || texto.startsWith("Carregando") || texto.startsWith("Chave não") || texto.startsWith("Não deu")) {
      return;
    }

    await navigator.clipboard.writeText(texto);

    // Show success message
    statusElement.textContent = "Copiado.";
    setTimeout(() => {
      statusElement.textContent = "";
    }, 3000);
  } catch (error) {
    console.error("Error copying to clipboard:", error);
    statusElement.textContent = "Não deu pra copiar. Selecione e copie à mão.";
    statusElement.style.color = "red";
    setTimeout(() => {
      statusElement.textContent = "";
      statusElement.style.color = "";
    }, 3000);
  }
}

/**
 * Creates the tool settings UI
 */
async function createToolSettingsUI() {
  const toolSettings = await getAllToolSettings();

  // Clear existing content
  toolSettingsContainer.innerHTML = "";

  // Create a toggle switch for each tool
  AVAILABLE_TOOLS.forEach((tool) => {
    const isEnabled = toolSettings[tool.id] !== false; // Default to true if not set

    const toolRow = document.createElement("div");
    toolRow.className = "tool-row";

    const labelContainer = document.createElement("div");
    labelContainer.className = "tool-label-container";

    const toolName = document.createElement("div");
    toolName.className = "tool-name";
    toolName.textContent = tool.name;

    const toolDescription = document.createElement("div");
    toolDescription.className = "tool-description";
    toolDescription.textContent = tool.description;

    labelContainer.appendChild(toolName);
    labelContainer.appendChild(toolDescription);

    const toggleContainer = document.createElement("label");
    toggleContainer.className = "toggle-switch";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isEnabled;
    checkbox.dataset.toolId = tool.id;
    checkbox.addEventListener("change", handleToolToggle);

    const slider = document.createElement("span");
    slider.className = "slider";

    toggleContainer.appendChild(checkbox);
    toggleContainer.appendChild(slider);

    toolRow.appendChild(labelContainer);
    toolRow.appendChild(toggleContainer);

    toolSettingsContainer.appendChild(toolRow);
  });
}

/**
 * Handles toggling a tool on/off
 */
async function handleToolToggle(event: Event) {
  const checkbox = event.target as HTMLInputElement;
  const toolId = checkbox.dataset.toolId;
  const isEnabled = checkbox.checked;

  if (!toolId) {
    console.error("Tool ID not found");
    return;
  }

  try {
    await setToolEnabled(toolId, isEnabled);
    // No status message displayed
  } catch (error) {
    console.error("Error saving tool setting:", error);

    // Revert the checkbox state
    checkbox.checked = !isEnabled;
  }
}

/**
 * Loads the domain lists from storage and displays them
 */
async function loadDomainLists() {
  try {
    // Load deny list
    const denyList = await getDomainDenyList();
    domainDenyListTextarea.value = denyList.join("\n");
  } catch (error) {
    console.error("Error loading domain lists:", error);
    domainStatusElement.textContent =
      "Error loading domain lists. Please check console for details.";
    domainStatusElement.style.color = "red";
    setTimeout(() => {
      domainStatusElement.textContent = "";
      domainStatusElement.style.color = "";
    }, 3000);
  }
}

/**
 * Saves the domain lists to storage
 */
async function saveDomainLists(event: MouseEvent) {
  if (!event.isTrusted) {
    return;
  }

  try {
    // Parse deny list (split by newlines and filter out empty lines)
    const denyListText = domainDenyListTextarea.value.trim();
    const denyList = denyListText
      ? denyListText
          .split("\n")
          .map((domain) => domain.trim())
          .filter(Boolean)
      : [];

    // Save to storage
    await setDomainDenyList(denyList);

    // Show success message
    domainStatusElement.textContent = "Lista de bloqueio salva.";
    domainStatusElement.style.color = "#4caf50";
    setTimeout(() => {
      domainStatusElement.textContent = "";
      domainStatusElement.style.color = "";
    }, 3000);
  } catch (error) {
    console.error("Error saving domain lists:", error);
    domainStatusElement.textContent = "Não deu pra salvar a lista.";
    domainStatusElement.style.color = "red";
    setTimeout(() => {
      domainStatusElement.textContent = "";
      domainStatusElement.style.color = "";
    }, 3000);
  }
}

/**
 * Loads the ports from storage and displays them
 */
async function loadPorts() {
  try {
    const ports = await getPorts();
    portsInput.value = ports.join(", ");
  } catch (error) {
    console.error("Error loading ports:", error);
    portsStatusElement.textContent =
      "Error loading ports. Please check console for details.";
    portsStatusElement.style.color = "red";
    setTimeout(() => {
      portsStatusElement.textContent = "";
      portsStatusElement.style.color = "";
    }, 3000);
  }
}

/**
 * Saves the ports to storage
 */
async function savePorts(event: MouseEvent) {
  if (!event.isTrusted) {
    return;
  }

  try {
    // Parse ports (split by commas and filter out empty values)
    const portsText = portsInput.value.trim();
    const portStrings = portsText
      ? portsText
          .split(",")
          .map((port) => port.trim())
          .filter(Boolean)
      : [];

    // Validate and convert to numbers
    const ports: number[] = [];
    for (const portStr of portStrings) {
      const port = parseInt(portStr, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`Porta inválida: ${portStr}. Use um número entre 1 e 65535.`);
      }
      ports.push(port);
    }

    // Ensure at least one port is provided
    if (ports.length === 0) {
      throw new Error("Informe pelo menos uma porta.");
    }

    // Save to storage
    await setPorts(ports);

    // Reload the extension:
    browser.runtime.reload();
  } catch (error) {
    console.error("Error saving ports:", error);
    portsStatusElement.textContent = error instanceof Error ? error.message : "Não deu pra salvar as portas.";
    portsStatusElement.style.color = "red";
    setTimeout(() => {
      portsStatusElement.textContent = "";
      portsStatusElement.style.color = "";
    }, 3000);
  }
}

/**
 * Loads the audit log from storage and displays it
 */
async function loadAuditLog() {
  try {
    const auditLog = await getAuditLog();
    
    // Clear existing content
    auditLogContainer.innerHTML = "";
    
    if (auditLog.length === 0) {
      // Show empty state
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "audit-log-empty";
      emptyDiv.textContent = "Nenhuma ação registrada ainda.";
      auditLogContainer.appendChild(emptyDiv);
      return;
    }
    
    // Create table
    const table = document.createElement("table");
    table.className = "audit-log-table";
    
    // Create header
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    
    const headers = ["Ação", "Quando", "Site"];
    headers.forEach(headerText => {
      const th = document.createElement("th");
      th.textContent = headerText;
      headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Create body
    const tbody = document.createElement("tbody");
    
    auditLog.forEach(entry => {
      const row = document.createElement("tr");
      
      // Tool name
      const toolCell = document.createElement("td");
      toolCell.textContent = getToolNameById(entry.toolId);
      row.appendChild(toolCell);
      
      // Timestamp
      const timestampCell = document.createElement("td");
      timestampCell.className = "audit-log-timestamp";
      const date = new Date(entry.timestamp);
      timestampCell.textContent = date.toLocaleString("pt-BR");
      row.appendChild(timestampCell);
      
      // URL Domain
      const urlCell = document.createElement("td");
      urlCell.className = "audit-log-url";
      if (entry.url) {
        // Show only the domain part of the URL
        try {
          const urlObj = new URL(entry.url);
          urlCell.textContent = urlObj.hostname;
        } catch (e) {
          console.error("Invalid URL in audit log entry:", e);
          urlCell.textContent = "endereço inválido";
        }
      } else {
        urlCell.textContent = "-";
      }
      row.appendChild(urlCell);
      
      tbody.appendChild(row);
    });
    
    table.appendChild(tbody);
    auditLogContainer.appendChild(table);
    
  } catch (error) {
    console.error("Error loading audit log:", error);
    auditLogContainer.innerHTML = '<div class="audit-log-empty">Não deu pra carregar o registro.</div>';
  }
}

/**
 * Clears the audit log
 */
async function handleClearAuditLog(event: MouseEvent) {
  if (!event.isTrusted) {
    return;
  }

  try {
    await clearAuditLog();
    
    // Reload the audit log display
    await loadAuditLog();
    
    // Show success message
    auditLogStatusElement.textContent = "Registro limpo.";
    auditLogStatusElement.style.color = "#4caf50";
    setTimeout(() => {
      auditLogStatusElement.textContent = "";
      auditLogStatusElement.style.color = "";
    }, 3000);
  } catch (error) {
    console.error("Error clearing audit log:", error);
    auditLogStatusElement.textContent = "Não deu pra limpar o registro.";
    auditLogStatusElement.style.color = "red";
    setTimeout(() => {
      auditLogStatusElement.textContent = "";
      auditLogStatusElement.style.color = "";
    }, 3000);
  }
}

/**
 * Initializes the collapsible sections
 */
function initializeCollapsibleSections() {
  const sectionHeaders = document.querySelectorAll(".section-container > h2");

  sectionHeaders.forEach((header) => {
    // teclado: Enter e espaco abrem e fecham como o clique
    header.addEventListener("keydown", (event) => {
      const tecla = (event as KeyboardEvent).key;
      if (tecla === "Enter" || tecla === " ") {
        event.preventDefault();
        (header as HTMLElement).click();
      }
    });
    // Add click event listener to toggle section visibility
    header.addEventListener("click", (event) => {
      event.preventDefault();

      // Toggle the collapsed class on the header
      const recolhido = header.classList.toggle("collapsed");
      header.setAttribute("aria-expanded", String(!recolhido));

      // Toggle the collapsed class on the section content
      const sectionContent = header.nextElementSibling as HTMLElement;
      sectionContent.classList.toggle("collapsed");
    });
  });
}

function showPermissionRequest(url: string) {
  const domain = new URL(url).hostname;
  const origin = new URL(url).origin;

  // Show the modal and hide the main content
  const modal = document.getElementById("permission-modal") as HTMLDivElement;
  const mainContent = document.getElementById("main-content") as HTMLDivElement;
  const domainElement = document.getElementById("permission-domain") as HTMLDivElement;
  const grantBtn = document.getElementById("grant-btn") as HTMLButtonElement;
  const cancelBtn = document.getElementById("cancel-btn") as HTMLButtonElement;
  const permissionText = document.getElementById("permission-text") as HTMLParagraphElement;

  // Set the domain in the modal
  domainElement.textContent = domain;
  
  // Update permission text for URL permission
  permissionText.textContent = "This will allow the extension to interact with pages on this domain as requested by the MCP server.";

  // Show modal and blur main content
  modal.classList.remove("hidden");
  mainContent.classList.add("modal-open");

  // Handle grant permission button click
  const handleGrant = async () => {
    try {
      const granted = await browser.permissions.request({
        origins: [`${origin}/*`],
      });

      if (granted) {
        // Permission granted, close the window or redirect back
        window.close();
      } else {
        // Permission denied, hide modal and show main content
        hidePermissionModal();
      }
    } catch (error) {
      console.error("Error requesting permission:", error);
      hidePermissionModal();
    }
  };

  // Handle cancel button click
  const handleCancel = () => {
    hidePermissionModal();
  };

  // Add event listeners
  grantBtn.addEventListener("click", handleGrant);
  cancelBtn.addEventListener("click", handleCancel);

  // Store references to remove listeners later
  (window as any).permissionHandlers = {
    handleGrant,
    handleCancel,
    grantBtn,
    cancelBtn
  };
}

function showGlobalPermissionRequest(permissions: string[]) {
  // Show the modal and hide the main content
  const modal = document.getElementById("permission-modal") as HTMLDivElement;
  const mainContent = document.getElementById("main-content") as HTMLDivElement;
  const domainElement = document.getElementById("permission-domain") as HTMLDivElement;
  const grantBtn = document.getElementById("grant-btn") as HTMLButtonElement;
  const cancelBtn = document.getElementById("cancel-btn") as HTMLButtonElement;
  const permissionText = document.getElementById("permission-text") as HTMLParagraphElement;

  // Set the permissions in the modal
  domainElement.textContent = permissions.join(", ");
  
  // Update permission text for global permissions
  permissionText.textContent = "This will allow the extension to use these browser capabilities as requested by the MCP server.";

  // Show modal and blur main content
  modal.classList.remove("hidden");
  mainContent.classList.add("modal-open");

  // Handle grant permission button click
  const handleGrant = async () => {
    try {
      const granted = await browser.permissions.request({
        permissions: permissions as browser.permissions.Permissions["permissions"],
      });

      if (granted) {
        // Permission granted, close the window or redirect back
        window.close();
      } else {
        // Permission denied, hide modal and show main content
        hidePermissionModal();
      }
    } catch (error) {
      console.error("Error requesting permission:", error);
      hidePermissionModal();
    }
  };

  // Handle cancel button click
  const handleCancel = () => {
    hidePermissionModal();
  };

  // Add event listeners
  grantBtn.addEventListener("click", handleGrant);
  cancelBtn.addEventListener("click", handleCancel);

  // Store references to remove listeners later
  (window as any).permissionHandlers = {
    handleGrant,
    handleCancel,
    grantBtn,
    cancelBtn
  };
}

function hidePermissionModal() {
  const modal = document.getElementById("permission-modal") as HTMLDivElement;
  const mainContent = document.getElementById("main-content") as HTMLDivElement;

  // Hide modal and restore main content
  modal.classList.add("hidden");
  mainContent.classList.remove("modal-open");

  // Clean up event listeners
  const handlers = (window as any).permissionHandlers;
  if (handlers) {
    handlers.grantBtn.removeEventListener("click", handlers.handleGrant);
    handlers.cancelBtn.removeEventListener("click", handlers.handleCancel);
    delete (window as any).permissionHandlers;
  }
}

/* ── modo de autorizacao e sites liberados ── */

async function carregarModo() {
  const select = document.getElementById("modo-autorizacao") as HTMLSelectElement;
  select.value = await getModoAutorizacao();
  select.onchange = () => void setModoAutorizacao(select.value as ModoAutorizacao);
}

async function carregarDominiosAprovados() {
  const lista = document.getElementById("dominios-aprovados") as HTMLUListElement;
  lista.textContent = "";
  const dominios = await getDominiosAprovados();
  if (dominios.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Nenhum ainda.";
    lista.appendChild(item);
    return;
  }
  for (const dominio of dominios) {
    const item = document.createElement("li");
    item.textContent = `${dominio} `;
    const botao = document.createElement("button");
    botao.textContent = "Revogar";
    botao.onclick = async () => {
      await revogarDominio(dominio);
      await carregarDominiosAprovados();
    };
    item.appendChild(botao);
    lista.appendChild(item);
  }
}

/* o Claude pediu pra agir num site novo (modo "perguntar") */
function pedirAprovacaoDeDominio(dominio: string) {
  const modal = document.getElementById("permission-modal") as HTMLDivElement;
  const mainContent = document.getElementById("main-content") as HTMLDivElement;
  (modal.querySelector("h2") as HTMLHeadingElement).textContent = "Liberar o Claude neste site?";
  (modal.querySelector("p") as HTMLParagraphElement).textContent = "O Claude quer navegar, ler, clicar e digitar nas abas dele neste site:";
  (document.getElementById("permission-domain") as HTMLDivElement).textContent = dominio;
  (document.getElementById("permission-text") as HTMLParagraphElement).textContent =
    "Vale até você revogar aqui nas opções. As suas abas continuam fora do alcance dele.";
  const permitir = document.getElementById("grant-btn") as HTMLButtonElement;
  const cancelar = document.getElementById("cancel-btn") as HTMLButtonElement;
  permitir.textContent = "Liberar";
  cancelar.textContent = "Agora não";
  modal.classList.remove("hidden");
  mainContent.classList.add("modal-open");
  permitir.onclick = async () => {
    await aprovarDominio(dominio);
    window.close();
  };
  cancelar.onclick = () => window.close();
}

// Initialize the page
document.querySelectorAll<HTMLButtonElement>("[data-copiar]").forEach((b) => b.addEventListener("click", copyToClipboard));
saveDomainListsButton.addEventListener("click", saveDomainLists);
savePortsButton.addEventListener("click", savePorts);
clearAuditLogButton.addEventListener("click", handleClearAuditLog);
document.addEventListener("DOMContentLoaded", () => {
  loadSecret();
  createToolSettingsUI();
  loadDomainLists();
  loadPorts();
  loadAuditLog();
  void carregarModo();
  void carregarDominiosAprovados();
  initializeCollapsibleSections();

  // Ensure modal is hidden by default
  const modal = document.getElementById("permission-modal") as HTMLDivElement;
  const mainContent = document.getElementById("main-content") as HTMLDivElement;
  modal.classList.add("hidden");
  mainContent.classList.remove("modal-open");

  const params = new URLSearchParams(window.location.search);
  const requestUrl = params.get("requestUrl");
  const requestPermissions = params.get("requestPermissions");

  const aprovarDominioParam = params.get("aprovarDominio");
  if (aprovarDominioParam) {
    pedirAprovacaoDeDominio(aprovarDominioParam);
  } else if (requestUrl) {
    // Show UI for requesting permission for this specific URL
    showPermissionRequest(requestUrl);
  } else if (requestPermissions) {
    // Show UI for requesting global permissions
    try {
      const permissions = JSON.parse(decodeURIComponent(requestPermissions));
      showGlobalPermissionRequest(permissions);
    } catch (error) {
      console.error("Error parsing requestPermissions:", error);
    }
  }

  // Add interval to refresh the audit log every 5 seconds:
  setInterval(() => {
    loadAuditLog();
  }, 5000);
});
