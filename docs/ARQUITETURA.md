# Arquitetura

## Visão geral

```
Navegador (React)                 Firebase Hosting                Cloud Run (Node/Express)          Google
───────────────────               ────────────────                ────────────────────────          ──────
Login (Firebase Auth SDK) ───────────────────────────────────────────────────────────────────────▶ Firebase Auth
Upload do PDF (Storage SDK) ─────────────────────────────────────────────────────────────────────▶ Storage (regras)
fetch /api/* + ID token  ──▶  rewrite /api/** ──▶  verifica token → valida → Firestore/Storage (Admin SDK)
                                                    └─ IA: recupera trechos (BM25) → Gemini API (chave só aqui)
```

* **O navegador nunca grava no Firestore**: todas as escritas passam pelo backend, que valida dados,
  aplica limites e mantém contadores consistentes. O único acesso direto é o *upload* do PDF para um caminho
  reservado pelo backend, validado pelas regras do Storage.
* **O uid vem sempre do token verificado** (`req.user.uid`). Nenhuma rota aceita `ownerUid`/`uid` do cliente;
  os caminhos são montados em um único lugar (`server/src/lib/paths.ts`).
* **A chave da Gemini fica só no backend** (variável de ambiente / Secret Manager), enviada no cabeçalho
  `x-goog-api-key` (nunca na URL, para não aparecer em logs).

## Por que Cloud Run (e não Cloud Functions)

Cloud Run executa o mesmo Express usado em desenvolvimento, sem adaptação; suporta requisições longas
(extração de PDF e IA, até 60 s pelo rewrite do Hosting), escala a zero e tem cota gratuita mensal. Funções
de 2ª geração também rodam sobre o Cloud Run — a escolha direta evita uma camada extra.

## Fluxo de um material

1. `POST /api/materials` reserva o material (`status: awaiting_upload`, `maxBytes`) e devolve o caminho
   `users/{uid}/materials/{id}/original.pdf`.
2. O navegador envia o PDF ao Storage. As regras só aceitam se o slot existir, estiver aguardando,
   for do próprio usuário, tiver `contentType` PDF e tamanho ≤ `maxBytes`, e sem sobrescrever.
3. `POST /api/materials/{id}/process` (transação impede reprocessamento por clique duplo): o backend baixa o
   arquivo, confere tamanho/tipo/assinatura `%PDF-`, extrai o texto por página e grava `pages/{n}`.
   Status resultante: `needs_review`, `needs_ocr` ou `failed` (com mensagem).
4. A estudante confere o texto ao lado do PDF original, corrige páginas se preciso e **aprova** (`ready`).
   Só materiais `ready` podem ser usados pela IA.

## Extração de PDF (`server/src/pdf`)

PDF.js 6 (build *legacy* para Node) fornece fragmentos com posição. O algoritmo próprio (`layout.ts`):

* agrupa fragmentos em linhas pela linha de base e insere espaço **somente** quando há separação visual
  proporcional ao corpo da fonte (evita “frag mentadas” e também evita unir palavras distintas);
* reconstrói títulos com letras espaçadas (“D E N T I N A” → “DENTINA”) apenas quando o fragmento inteiro é
  composto por letras isoladas e há sequência ≥ 4 — artigos como “a e o” não são unidos (bug da versão HTML);
* detecta de forma conservadora um corredor vertical entre **duas colunas** e lê a página em faixas
  (linhas de largura total quebram as faixas; esquerda antes da direita), independentemente da ordem do fluxo;
* reconstrói parágrafos por espaçamento vertical, títulos por tamanho de fonte/caixa alta e hifenização de
  fim de linha (preservando prefixos que exigem hífen: anti-inflamatório, micro-ondas…);
* remove cabeçalhos/rodapés repetidos e números de página;
* identifica páginas sem texto e se contêm imagens (**PDF digitalizado → exige OCR**), e texto com
  codificação de fonte quebrada.

Testado com PDFs gerados (texto, hifenização, fragmentos, letras espaçadas, duas colunas em fluxo sequencial e
intercalado, digitalizado, misto, corrompido) — `server/test/unit/pdf-extract.test.ts`.

**OCR — limitação atual:** documentos digitalizados são identificados (`needs_ocr`) e a interface orienta a
gerar um PDF pesquisável (Acrobat, Google Drive/Docs, apps de digitalização) e reenviar. Próxima etapa sugerida:
OCR no backend com Cloud Vision API (`files:asyncBatchAnnotate` para PDF) ou Document AI, acionado sob demanda
e com cota própria (serviço pago por página após a faixa gratuita).

## RAG (`server/src/rag`)

1. Texto normalizado por página (fonte única da verdade).
2. Trechos de ~900 caracteres **derivados em memória** das páginas (não são armazenados — sem duplicação),
   nunca atravessando páginas, com título de seção, material e disciplina de origem.
3. Busca **BM25** com normalização para português (acentos, stopwords, radicalização leve).
4. Tutor: só os 8 trechos mais relevantes são enviados; se a cobertura da pergunta for baixa,
   o backend responde “não encontrei evidências” **sem chamar a IA**.
5. Questões/flashcards: com foco, usa a busca; sem foco, amostra distribuída ao longo do material,
   limitada por `AI_CONTEXT_MAX_CHARS`.
6. O modelo cita rótulos (`T3`); o backend converte em referências reais (arquivo, página e trecho original).
   Rótulos inexistentes são descartados — **a IA não consegue inventar citações**.

Embeddings/banco vetorial não foram adicionados: para o volume de um estudante a busca lexical é rápida,
barata e auditável. Reavaliar se a base crescer muito ou se perguntas por sinônimos falharem com frequência.

## Camada de IA (`server/src/ai`)

* `provider.ts` — contrato; `gemini.ts` — cliente REST com timeout, novas tentativas (429/5xx/timeout,
  backoff exponencial) e sem retry para erros de configuração; `fake.ts` — provedor simulado (dev/testes,
  bloqueado em produção).
* `prompts.ts` — regras de sistema fixas; o conteúdo dos PDFs vai entre `<trecho …>` e é tratado como dado
  (marcadores escapados para impedir que o PDF “feche” o trecho).
* `validate.ts` — validação com zod e regras de qualidade: 4 alternativas distintas, 1 correta, sem
  “todas/nenhuma das anteriores”, sem moldes “qual afirmação aparece no material”, fundamentação obrigatória,
  sem duplicatas; posição da correta redistribuída de forma equilibrada.
* `service.ts` — cota diária (transação), uma nova tentativa para formato inválido, devolução da cota em falhas.

## Frontend (`web/src`)

`pages/` (telas), `components/` (layout, toasts, estados, seletor de materiais, referências), `lib/` (Firebase,
cliente da API, upload, formatação), `hooks/` (carregamento e proteção contra clique duplo), `styles/`
(tokens de tema, base, layout, componentes — portados do HTML original).
