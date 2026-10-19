#!/usr/bin/env node
// Executa os emuladores do Firebase removendo variáveis de proxy HTTP do ambiente.
// Motivo: em redes com proxy corporativo, a comunicação interna entre emuladores
// (ex.: regras do Storage que consultam o Firestore) pode ser bloqueada pelo proxy.
// Uso: node scripts/emulators.mjs exec "<comando>"  |  node scripts/emulators.mjs start
import { spawn } from "node:child_process";

const env = { ...process.env };
for (const k of Object.keys(env)) {
  if (/^(https?_proxy|all_proxy|global_agent_https?_proxy|npm_config_(https_)?proxy)$/i.test(k)) delete env[k];
}
const [mode = "start", ...rest] = process.argv.slice(2);
const args = ["firebase", "emulators:" + mode, "--project", "demo-estudos-odonto"];
if (mode === "exec") args.push("--only", "auth,firestore,storage", rest.join(" "));
else args.push("--only", "auth,firestore,storage", "--import=.emulator-data", "--export-on-exit");
const child = spawn("npx", args, { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 1));
