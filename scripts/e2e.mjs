#!/usr/bin/env node
/**
 * Teste ponta a ponta no navegador (Chromium/Playwright) contra o ambiente local:
 *   npm run dev:emulators   (terminal 1)
 *   npm run dev:server      (terminal 2, com AI_PROVIDER=fake)
 *   npm run dev:web         (terminal 3)
 *   npm run fixtures -w server && npm run e2e
 * Gera capturas de tela em e2e-output/ e falha se houver erro de console ou etapa quebrada.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const OUT = "e2e-output";
const FIXTURES = "server/test/fixtures/generated";
mkdirSync(OUT, { recursive: true });

// E2E_CHROMIUM permite usar um Chromium já instalado (ex.: /opt/pw-browsers/chromium).
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const errors = [];
const steps = [];

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, locale: "pt-BR" });
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
  page.on("response", (res) => {
    if (res.url().includes("/api/") && res.status() >= 500) errors.push(`[api ${res.status()}] ${res.url()}`);
  });
  return { ctx, page };
}

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    steps.push(`✓ ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    steps.push(`✗ ${name}: ${err.message.split("\n")[0]}`);
    throw err;
  }
}

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
const email = `estudante.${Date.now()}@example.com`;
const password = "senha-forte-123";

const { ctx, page } = await newPage({ width: 1366, height: 860 });
// Confirmações (finalizar simulado, nova versão…) são aceitas automaticamente.
page.on("dialog", (d) => void d.accept());
try {
  await step("redireciona para login quando não autenticada", async () => {
    await page.goto(BASE + "/");
    await page.waitForURL("**/entrar");
    await page.getByRole("heading", { name: "Entrar" }).waitFor();
    await shot(page, "01-login");
  });

  await step("mostra erro de login em português", async () => {
    await page.getByLabel("E-mail").fill("ninguem@example.com");
    await page.getByLabel("Senha").fill("errada-123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.getByRole("alert").filter({ hasText: /incorretos|Não foi possível/ }).waitFor();
  });

  await step("cadastra nova conta", async () => {
    await page.goto(BASE + "/cadastro");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByLabel("Confirmar senha").fill(password);
    await page.getByRole("button", { name: "Criar conta" }).click();
    await page.getByRole("heading", { name: "Vamos estudar?" }).waitFor();
    await page.getByText("Nenhuma matéria cadastrada").waitFor();
    await shot(page, "02-painel-vazio");
  });

  await step("cadastra disciplina", async () => {
    await page.getByRole("link", { name: /Meu material/ }).first().click();
    await page.getByLabel("Disciplina", { exact: true }).fill("Histologia Bucal");
    await page.getByLabel("Semestre").selectOption("2");
    await page.getByRole("button", { name: "Adicionar disciplina" }).click();
    await page.getByText("Histologia Bucal · 2º").waitFor();
  });

  await step("lê o PDF no navegador, salva só o texto, confere e aprova", async () => {
    await page.getByLabel("Tema (opcional)").fill("Tecidos dentários");
    await page.getByLabel("Arquivo PDF").setInputFiles(join(FIXTURES, "texto-simples.pdf"));
    await page.getByRole("button", { name: "Extrair e salvar texto" }).click();
    await page.waitForURL("**/materiais/*", { timeout: 30000 });
    await page.getByText("Qualidade da extração").waitFor();
    await page.getByRole("heading", { name: "ESMALTE DENTÁRIO" }).waitFor();
    // O PDF original não é enviado: a tela de conferência o abre a partir da memória da aba.
    await page.locator("iframe.pdf-frame").waitFor();
    await page.waitForTimeout(800);
    await shot(page, "03-conferir-texto");
    await page.getByRole("button", { name: /Texto conferido/ }).click();
    await page.locator(".notice.good", { hasText: "Material liberado" }).waitFor();
  });

  await step("envia PDF em duas colunas e aprova", async () => {
    await page.getByRole("link", { name: "← Meu material" }).click();
    await page.getByLabel("Arquivo PDF").setInputFiles(join(FIXTURES, "duas-colunas.pdf"));
    await page.getByRole("button", { name: "Extrair e salvar texto" }).click();
    await page.waitForURL("**/materiais/*", { timeout: 30000 });
    await page.getByText(/Layout em colunas detectado/).waitFor();
    await page.getByRole("button", { name: /Texto conferido/ }).click();
    await page.locator(".notice.good", { hasText: "Material liberado" }).waitFor();
  });

  await step("identifica PDF digitalizado (exige OCR)", async () => {
    await page.getByRole("link", { name: "← Meu material" }).click();
    await page.getByLabel("Arquivo PDF").setInputFiles(join(FIXTURES, "digitalizado.pdf"));
    await page.getByRole("button", { name: "Extrair e salvar texto" }).click();
    await page.waitForURL("**/materiais/*", { timeout: 30000 });
    await page.getByText("Este documento exige OCR.").waitFor();
    await shot(page, "04-pdf-digitalizado");
  });

  await step("lista materiais com status", async () => {
    await page.getByRole("link", { name: "← Meu material" }).click();
    await page.getByText("3 de 60 materiais").waitFor();
    await shot(page, "05-meu-material");
  });

  await step("lê o conteúdo por página", async () => {
    await page.getByRole("link", { name: /Conteúdo/ }).first().click();
    await page.getByText("Página 1", { exact: true }).first().waitFor();
    await shot(page, "06-conteudo");
  });

  await step("gera questões e responde com feedback imediato", async () => {
    await page.getByRole("link", { name: /Questões/ }).first().click();
    await page.locator(".check").first().click();
    await page.getByLabel("Número de questões").selectOption("3");
    await page.getByRole("button", { name: "Criar questões" }).click();
    await page.waitForURL("**/quiz/*", { timeout: 30000 });
    const choice = page.locator("button.choice").nth(1);
    await choice.dblclick(); // clique duplo não pode registrar duas vezes
    await page.locator(".notice.good, .notice.bad").first().waitFor();
    await page.locator(".answer").first().waitFor();
    await shot(page, "07-questao-respondida");
  });

  await step("completa as questões e vê o gabarito comentado", async () => {
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "Próxima →" }).click();
      await page.locator("button.choice").first().click();
      await page.locator(".notice.good, .notice.bad").first().waitFor();
    }
    await page.getByRole("button", { name: "Ver resultado" }).click();
    await page.getByRole("heading", { name: "Gabarito comentado" }).waitFor();
    await shot(page, "08-resultado");
  });

  await step("simulado: registra sem revelar e mostra gabarito ao finalizar", async () => {
    await page.getByRole("link", { name: /Simulados/ }).first().click();
    await page.locator(".check").first().click();
    await page.getByLabel("Número de questões").selectOption("3");
    await page.getByRole("button", { name: "Iniciar simulado" }).click();
    await page.waitForURL("**/quiz/*", { timeout: 30000 });
    for (let i = 0; i < 3; i++) {
      await page.locator("button.choice").nth(i % 4).click();
      await page.getByRole("button", { name: "Confirmar resposta" }).click();
      await page.waitForTimeout(300);
    }
    if ((await page.locator(".choice.correct").count()) !== 0) throw new Error("gabarito revelado antes de finalizar");
    await page.getByRole("button", { name: "Finalizar simulado" }).click();
    await page.getByRole("heading", { name: "Gabarito comentado" }).waitFor();
  });

  await step("gera flashcards e revisa", async () => {
    await page.getByRole("link", { name: /Flashcards/ }).first().click();
    await page.locator(".check").first().click();
    await page.getByRole("button", { name: "Criar cartões com IA" }).click();
    await page.locator("button.flashcard").waitFor({ timeout: 30000 });
    await page.locator("button.flashcard").click();
    await page.getByRole("button", { name: "Mostrar pergunta" }).waitFor();
    await shot(page, "09-flashcard");
    await page.getByRole("button", { name: "Revisar", exact: true }).click();
    await page.locator("button.flashcard").click();
    await page.getByRole("button", { name: "Sei", exact: true }).click();
  });

  await step("conversa com o tutor e recebe citações", async () => {
    await page.getByRole("link", { name: /Tutor de estudos/ }).first().click();
    await page.locator(".check", { hasText: "texto-simples.pdf" }).click();
    await page.getByRole("button", { name: "Nova conversa" }).click();
    await page.getByLabel("Sua pergunta").fill("Quais células produzem a dentina?");
    await page.getByRole("button", { name: "Perguntar" }).click();
    await page.locator(".citation").first().waitFor({ timeout: 30000 });
    await page.getByLabel("Sua pergunta").fill("Qual a receita de bolo de cenoura?");
    await page.keyboard.press("Enter");
    await page.getByText(/Não encontrei trechos/).waitFor();
    await shot(page, "10-tutor");
  });

  await step("mostra desempenho e sugestões", async () => {
    await page.getByRole("link", { name: /Desempenho/ }).first().click();
    await page.getByRole("heading", { name: "Desempenho por assunto" }).waitFor();
    await shot(page, "11-desempenho");
  });

  await step("painel com indicadores", async () => {
    await page.getByRole("link", { name: /Visão geral/ }).click();
    await page.getByText("Matérias cadastradas").waitFor();
    await shot(page, "12-painel");
  });

  await step("menu lateral recolhível", async () => {
    await page.getByRole("button", { name: "Recolher menu" }).click();
    await page.waitForTimeout(300);
    await shot(page, "13-menu-recolhido");
    await page.getByRole("button", { name: "Expandir menu" }).click();
  });

  await step("tema claro", async () => {
    await page.getByRole("button", { name: "Alternar tema claro/escuro" }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await page.waitForTimeout(400);
    await shot(page, "14-tema-claro");
    await page.getByRole("button", { name: "Alternar tema claro/escuro" }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  });

  await step("envia nova versão de um PDF no mesmo material", async () => {
    await page.getByRole("link", { name: /Meu material/ }).first().click();
    await page.locator(".subject", { hasText: "duas-colunas.pdf" }).getByRole("link").click();
    await page.getByText("Qualidade da extração").waitFor();
    await page.locator("label", { hasText: "Enviar nova versão" }).locator("input[type=file]").setInputFiles(join(FIXTURES, "texto-simples.pdf"));
    await page.getByText(/versão 2, atualizada em/).waitFor({ timeout: 30000 });
    await page.getByRole("heading", { name: "texto-simples.pdf" }).waitFor();
    await page.getByRole("button", { name: /Texto conferido/ }).waitFor();
    await shot(page, "18-nova-versao");
    await page.getByRole("link", { name: "← Meu material" }).click();
    await page.locator(".pill", { hasText: "versão 2" }).waitFor();
    await page.getByRole("link", { name: /Visão geral/ }).click();
  });

  await step("sessão persiste após recarregar", async () => {
    await page.reload();
    await page.getByRole("heading", { name: "Vamos estudar?" }).waitFor();
  });

  // Celular: mesma conta, outro "dispositivo" (contexto novo) — os dados vêm do servidor.
  const mobile = await newPage({ width: 390, height: 844 });
  await step("celular: login em outro dispositivo e dados sincronizados", async () => {
    const p = mobile.page;
    await p.goto(BASE + "/entrar");
    await p.getByLabel("E-mail").fill(email);
    await p.getByLabel("Senha").fill(password);
    await p.getByRole("button", { name: "Entrar" }).click();
    await p.getByText("Histologia Bucal").first().waitFor();
    await shot(p, "15-celular-painel");
    await p.getByRole("button", { name: "Mais" }).click();
    await p.locator(".more-sheet.open").waitFor();
    await shot(p, "16-celular-menu-mais");
    await p.locator(".more-sheet").getByRole("link", { name: /Simulados/ }).click();
    await p.locator(".table").first().waitFor();
    await shot(p, "17-celular-simulados");
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) throw new Error("rolagem horizontal no celular");
  });

  await step("logout protege páginas privadas", async () => {
    await page.getByRole("button", { name: "Sair" }).click();
    await page.waitForURL("**/entrar");
    await page.goto(BASE + "/materiais");
    await page.waitForURL("**/entrar");
  });
  await mobile.ctx.close();
} catch (err) {
  await shot(page, "falha").catch(() => undefined);
  console.error("\nFALHA:", err.message);
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
  console.log(steps.join("\n"));
  // Erros 4xx esperados (ex.: login inválido) aparecem como erro de recurso no console; filtramos apenas esses.
  const relevant = errors.filter((e) => !/status of 4\d\d|identitytoolkit|auth\/invalid-credential/i.test(e));
  if (relevant.length) {
    console.error("\nErros de console/servidor:\n" + relevant.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("\nSem erros de console ou do servidor.");
  }
}
