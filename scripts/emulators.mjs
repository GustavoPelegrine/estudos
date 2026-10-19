#!/usr/bin/env node
// Executa os emuladores do Firebase removendo variáveis de proxy HTTP do ambiente.
// Motivo: em redes com proxy corporativo, a comunicação interna entre emuladores
// (ex.: regras do Storage que consultam o Firestore) pode ser bloqueada pelo proxy.
// Uso: node scripts/emulators.mjs exec "<comando>"  |  node scripts/emulators.mjs start
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const env = { ...process.env };
for (const k of Object.keys(env)) {
  if (/^(https?_proxy|all_proxy|global_agent_https?_proxy|npm_config_(https_)?proxy)$/i.test(k)) delete env[k];
}
const [mode = "start", ...rest] = process.argv.slice(2);
const args = ["firebase", "emulators:" + mode, "--project", "demo-estudos-odonto"];
// Com shell (Windows), o comando do exec precisa ir entre aspas para não ser quebrado em vários argumentos.
if (mode === "exec") args.push("--only", "auth,firestore", process.platform === "win32" ? `"${rest.join(" ")}"` : rest.join(" "));
else {
  // Mantém os dados de desenvolvimento entre execuções.
  args.push("--only", "auth,firestore", "--export-on-exit=.emulator-data");
  if (existsSync(".emulator-data")) args.push("--import=.emulator-data");
}
// No Windows, npx/npm são scripts .cmd e precisam do shell.
const child = spawn("npx", args, { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
