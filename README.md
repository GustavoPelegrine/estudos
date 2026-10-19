# Estudos Odonto — Plataforma inteligente de estudos

Aplicação web para estudantes de Odontologia: leitura do texto dos PDFs das aulas, questões e simulados com gabarito
comentado, flashcards com revisão espaçada, tutor fundamentado nos próprios materiais (com citação de página) e
acompanhamento de desempenho.

Evolução do protótipo `legacy/estudos_odonto_gemini_ia_professor.html`, mantendo a identidade visual
(tema escuro azul/ciano, menu lateral, cards de indicadores).

## Arquitetura (versão custo zero)

| Camada | Tecnologia | Plano |
| --- | --- | --- |
| Frontend | React 19 + TypeScript + Vite 8 (`web/`) | Vercel Hobby |
| Leitura dos PDFs | PDF.js **no navegador** — o arquivo não sai do aparelho; só o texto é salvo | — |
| Autenticação | Firebase Authentication (e-mail/senha) | Spark (gratuito) |
| Banco de dados | Cloud Firestore (dados sob `users/{uid}`) | Spark (gratuito) |
| Backend | Node 22 + Express 5 + TypeScript (`server/`), função da Vercel | Vercel Hobby |
| IA | Gemini API (`gemini-3.8-flash`), **apenas no backend** | Nível gratuito |

Publicação: [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md) (tudo pelo navegador, sem cartão) ·
Arquitetura: [docs/ARQUITETURA.md](docs/ARQUITETURA.md) · Dados: [docs/MODELO_DE_DADOS.md](docs/MODELO_DE_DADOS.md) ·
Segurança: [docs/SEGURANCA.md](docs/SEGURANCA.md) · Custos: [docs/CUSTOS.md](docs/CUSTOS.md)

## Rodando localmente

Pré-requisitos: **Node 22** e **Java 11+** (os emuladores do Firebase usam Java). Nada precisa de conta Google:
login, banco e IA são simulados localmente (as respostas de IA aparecem marcadas como *simuladas*).

**Windows (Prompt de Comando), dentro da pasta do projeto:**

```bat
npm install
copy server\.env.example server\.env
npm run dev:emulators
```

Em **outro** terminal: `npm run dev:server`. Em um **terceiro**: `npm run dev:web`.
Abra <http://127.0.0.1:5173> e crie uma conta (fica só no emulador).

**macOS/Linux:** os mesmos comandos, trocando `copy server\.env.example server\.env` por `cp server/.env.example server/.env`.

> **Rede corporativa:** se o `npm install` falhar com `SELF_SIGNED_CERT_IN_CHAIN`, a rede inspeciona HTTPS.
> Peça ao TI o certificado raiz da empresa e configure `npm config set cafile C:\caminho\empresa.pem` e
> `setx NODE_EXTRA_CA_CERTS C:\caminho\empresa.pem` (reabra o terminal). Não desative a verificação SSL.
> Alternativa sem instalar nada: publique na Vercel (que faz o build nos servidores dela) e use os *Preview Deployments*.

Para usar a Gemini de verdade localmente: em `server/.env`, `AI_PROVIDER=gemini` e `GEMINI_API_KEY=...`, depois
`npm run check:gemini -w server` confirma o modelo. PDFs de exemplo: `npm run fixtures -w server`
(gera em `server/test/fixtures/generated/`).

## Testes

```bash
npm run typecheck        # TypeScript (shared, server, web)
npm run test:unit        # extração de PDF, RAG, validação da IA, cliente Gemini, configuração + frontend
npm run test:emulator    # integração da API e regras do Firestore nos emuladores
npm run build:vercel     # pacote de produção (.vercel/output)
npm run preview:vercel   # simula a Vercel localmente servindo o pacote (precisa das variáveis do backend)
npm run e2e              # navegador real; com os 3 processos de desenvolvimento rodando
```

## Estrutura

```
shared/        tipos, contratos da API e extrator de PDF (usado no navegador e nos testes)
server/        API (src/ai, src/rag, src/services, src/http, src/vercel.ts) + testes
web/           aplicação React (pages, components, lib, styles)
tests/rules/   testes das regras de segurança do Firestore
scripts/       emuladores, build/simulação da Vercel, E2E
firestore.rules · firebase.json (emuladores) · vercel.json
docs/          publicação, arquitetura, dados, segurança e custos
legacy/        HTML original (referência visual)
```
