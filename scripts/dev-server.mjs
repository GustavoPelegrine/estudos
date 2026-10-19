#!/usr/bin/env node
// Inicia o backend em modo desenvolvimento sem variáveis de proxy (o tráfego para os emuladores é local).
import { spawn } from "node:child_process";
const env = { ...process.env };
for (const k of Object.keys(env)) if (/^(https?_proxy|all_proxy|global_agent_https?_proxy)$/i.test(k)) delete env[k];
const child = spawn("npm", ["run", "dev", "-w", "server"], { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
