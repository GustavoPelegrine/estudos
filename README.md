# Estudos Odonto — Plataforma inteligente de estudos

Aplicação web para estudantes de Odontologia: materiais privados em PDF, leitura do texto extraído,
questões e simulados com gabarito comentado, flashcards com revisão espaçada, tutor fundamentado
nos próprios materiais (com citação de página) e acompanhamento de desempenho.

Evolução do protótipo `legacy/estudos_odonto_gemini_ia_professor.html`, mantendo a identidade visual
(tema escuro azul/ciano, menu lateral, cards de indicadores).

## Arquitetura (resumo)

| Camada | Tecnologia |
| --- | --- |
| Frontend | React 19 + TypeScript + Vite 8 (`web/`) |
| Autenticação | Firebase Authentication (e-mail/senha) |
| Banco de dados | Cloud Firestore (dados sob `users/{uid}`) |
| Arquivos | Firebase Storage (PDFs privados, sem URL pública) |
| Backend | Node 22 + Express 5 + TypeScript, para Cloud Run (`server/`) |
| IA | Gemini API (`gemini-3.8-flash` por padrão), **apenas no backend** |
| Hospedagem | Firebase Hosting, com `/api/**` redirecionado ao Cloud Run (mesma origem) |

Detalhes: [docs/ARQUITETURA.md](docs/ARQUITETURA.md) · Modelo de dados: [docs/MODELO_DE_DADOS.md](docs/MODELO_DE_DADOS.md) ·
Segurança: [docs/SEGURANCA.md](docs/SEGURANCA.md) · Custos: [docs/CUSTOS.md](docs/CUSTOS.md) ·
Implantação: [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md)

## Rodando localmente (sem conta Google, com emuladores)

Pré-requisitos: Node ≥ 22.13 e Java ≥ 11 (para os emuladores do Firebase).

```bash
npm install
cp server/.env.example server/.env          # já vem com AI_PROVIDER=fake e emuladores
npm run dev:emulators                       # terminal 1 — Auth, Firestore, Storage (UI em http://127.0.0.1:4000)
npm run dev:server                          # terminal 2 — API em http://127.0.0.1:8080
npm run dev:web                             # terminal 3 — app em http://127.0.0.1:5173
```

Com `AI_PROVIDER=fake` as respostas de IA são **simuladas** (marcadas na interface) — útil para testar o fluxo
sem gastar cota. Para usar a Gemini de verdade localmente, defina `AI_PROVIDER=gemini` e `GEMINI_API_KEY` em
`server/.env` e rode `npm run check:gemini -w server` para confirmar o modelo.

PDFs de exemplo para testar o upload: `npm run fixtures -w server` (gera em `server/test/fixtures/generated/`).

## Testes

```bash
npm run typecheck        # TypeScript (shared, server, web)
npm run test:unit        # backend (extração de PDF, RAG, validação da IA, cliente Gemini) + frontend
npm run test:emulator    # integração da API + regras do Firestore/Storage nos emuladores
npm run build            # bundle do backend e build de produção do frontend
# E2E no navegador (com os 3 processos acima rodando):
npm run fixtures -w server && npm run e2e   # use E2E_CHROMIUM=/caminho/chrome se quiser um Chromium já instalado
```

## Estrutura

```
shared/   tipos e contratos compartilhados
server/   API (src/ai, src/pdf, src/rag, src/services, src/http) + testes
web/      aplicação React (pages, components, lib, styles)
tests/rules/   testes das regras de segurança
firestore.rules · storage.rules · firebase.json
docs/     arquitetura, dados, segurança, custos e implantação
legacy/   HTML original (referência visual)
```
