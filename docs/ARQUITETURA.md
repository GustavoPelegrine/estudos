# Arquitetura

## Visão geral (versão custo zero)

```
Navegador (React)                          Vercel (Hobby)                         Google (planos gratuitos)
─────────────────                          ──────────────                         ─────────────────────────
Login (Firebase Auth SDK) ──────────────────────────────────────────────────────▶ Firebase Authentication
PDF lido NO APARELHO (PDF.js) → texto
fetch /api/* + ID token  ──▶  site estático + função /api (Express)
                              verifica token → valida → Firestore (Admin SDK) ──▶ Cloud Firestore (Spark)
                              IA: trechos relevantes (BM25) ──────────────────────▶ Gemini API (nível gratuito)
```

* **O PDF não sai do aparelho.** O texto é extraído no navegador com o mesmo algoritmo testado em Node
  (`shared/src/pdf`) e só o texto é enviado, em lotes. O servidor recalcula o relatório de extração a partir do que
  recebeu (não confia nos números do cliente). Isso elimina o Firebase Storage, que exige plano pago.
* **O navegador nunca grava no Firestore**: todas as escritas passam pelo backend, que valida dados, aplica limites
  e mantém contadores consistentes. As regras do Firestore permitem apenas leitura dos próprios dados.
* **O uid vem sempre do token verificado** (`req.user.uid`). Nenhuma rota aceita `ownerUid`/`uid` do cliente;
  os caminhos são montados em um único lugar (`server/src/lib/paths.ts`).
* **Segredos só no backend** (variáveis de ambiente da Vercel): chave da Gemini (enviada no cabeçalho
  `x-goog-api-key`, nunca na URL) e credencial da conta de serviço do Firebase.

## Por que Vercel

Firebase Spark não permite Cloud Functions nem Cloud Run (exigem plano Blaze). A Vercel Hobby hospeda o site e uma
função Node sem cartão, no mesmo domínio (sem CORS). O build gera `.vercel/output` no formato *Build Output API v3*
(`scripts/build-vercel.mjs`): o Express é empacotado com esbuild e as dependências são rastreadas com `@vercel/nft`.
`npm run preview:vercel` simula localmente esse pacote; o teste E2E roda contra ele.

O mesmo Express roda como servidor comum (`server/src/index.ts`) em desenvolvimento ou em qualquer hospedagem Node.

## Fluxo de um material

1. A estudante escolhe o PDF; o navegador extrai o texto página a página (com barra de progresso).
2. `POST /api/materials` registra o material (`status: processing`, `pageCount`).
3. `POST /api/materials/{id}/pages` recebe as páginas em lotes (≤ 25 páginas / 600 mil caracteres por lote).
4. `POST /api/materials/{id}/finalize` confere se todas as páginas chegaram e calcula o relatório:
   `needs_review` ou `needs_ocr`. Envios interrompidos aparecem como falha após 15 minutos.
5. A estudante confere o texto ao lado do PDF original (aberto localmente, nunca enviado), corrige páginas se
   preciso e **aprova** (`ready`). Só materiais `ready` podem ser usados pela IA.

## Extração de PDF (`shared/src/pdf`)

PDF.js 6 (build *legacy*, no navegador e em Node — o build padrão usa APIs de JavaScript recentes demais para Safari/Chrome antigos) fornece fragmentos com posição. O algoritmo próprio (`layout.ts`):

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
