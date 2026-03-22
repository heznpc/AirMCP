/**
 * `npx airmcp --help` — usage guide.
 */
import { LOGO_LINES } from "../shared/banner.js";
import { BOLD, DIM, RESET, WHITE, GREEN, CYAN } from "./style.js";

export function runHelp(): void {
  console.log("");
  for (const line of LOGO_LINES) console.log(line);
  console.log("");
  console.log(`  ${BOLD}${WHITE}AirMCP${RESET}  ${DIM}MCP server for the entire Apple ecosystem${RESET}`);
  console.log("");
  console.log(`  ${BOLD}Usage${RESET}`);
  console.log("");
  console.log(`    ${GREEN}$${RESET} npx airmcp ${BOLD}init${RESET}            ${DIM}Interactive setup wizard${RESET}`);
  console.log(`    ${GREEN}$${RESET} npx airmcp ${BOLD}doctor${RESET}          ${DIM}Diagnose installation${RESET}`);
  console.log(`    ${GREEN}$${RESET} npx airmcp                  ${DIM}Start MCP server (stdio)${RESET}`);
  console.log(`    ${GREEN}$${RESET} npx airmcp ${BOLD}--http${RESET}          ${DIM}Start as HTTP server${RESET}`);
  console.log(`    ${GREEN}$${RESET} npx airmcp ${BOLD}--full${RESET}          ${DIM}Enable all modules${RESET}`);
  console.log(`    ${GREEN}$${RESET} npx airmcp ${BOLD}--http --port${RESET} N  ${DIM}Custom port (default: 3847)${RESET}`);
  console.log(`    ${GREEN}$${RESET} npx airmcp ${BOLD}--http --bind-all${RESET}      ${DIM}Bind to 0.0.0.0 (default: 127.0.0.1)${RESET}`);
  console.log("");
  console.log(`  ${BOLD}Commands${RESET}`);
  console.log("");
  console.log(`    ${CYAN}init${RESET}       ${DIM}Choose language, select modules, configure MCP clients${RESET}`);
  console.log(`    ${CYAN}doctor${RESET}     ${DIM}Check Node.js, macOS, permissions, clients, modules${RESET}`);
  console.log("");
  console.log(`  ${BOLD}Environment Variables${RESET}`);
  console.log("");
  console.log(`    ${WHITE}AIRMCP_FULL${RESET}=true              ${DIM}Enable all modules (ignores config)${RESET}`);
  console.log(`    ${WHITE}AIRMCP_DISABLE_${RESET}${DIM}<MODULE>${RESET}=true  ${DIM}Disable a specific module${RESET}`);
  console.log(`    ${WHITE}GEMINI_API_KEY${RESET}=${DIM}<key>${RESET}          ${DIM}Enable Gemini embeddings${RESET}`);
  console.log(`    ${WHITE}AIRMCP_EMBEDDING_MODEL${RESET}=${DIM}...${RESET}    ${DIM}Embedding model (default: gemini-embedding-2-preview)${RESET}`);
  console.log(`    ${WHITE}AIRMCP_EMBEDDING_PROVIDER${RESET}=${DIM}...${RESET} ${DIM}auto / gemini / swift / hybrid${RESET}`);
  console.log(`    ${WHITE}AIRMCP_HTTP_TOKEN${RESET}=${DIM}<secret>${RESET}       ${DIM}Bearer token for HTTP mode auth${RESET}`);
  console.log("");
  console.log(`  ${BOLD}Config${RESET}  ${DIM}~/.config/airmcp/config.json${RESET}`);
  console.log(`  ${BOLD}Docs${RESET}    ${DIM}https://github.com/heznpc/AirMCP${RESET}`);
  console.log(`  ${BOLD}Web${RESET}     ${DIM}https://heznpc.github.io/AirMCP/${RESET}`);
  console.log("");
}
