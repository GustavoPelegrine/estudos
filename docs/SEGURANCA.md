# Segurança e privacidade

## Controles implementados

**Autenticação e isolamento**
* Firebase Authentication (e-mail/senha), sessão persistente com renovação automática do token.
* Backend exige `Authorization: Bearer <ID token>` em toda rota `/api/*` exceto `/api/health`;
  verifica o token com `checkRevoked`, rejeita contas anônimas e, opcionalmente, restringe por
  `ALLOWED_EMAILS` e `REQUIRE_EMAIL_VERIFIED`.
* Todos os caminhos de dados derivam do uid do token; IDs vindos da URL são validados por regex
  (sem `/`, `..`). Acesso a um id de outra conta resulta em **404** (não revela existência).
* Regras do Firestore: leitura apenas do próprio `users/{uid}`; **nenhuma escrita** do cliente; gabaritos e
  contadores de uso ilegíveis; coleções não listadas negadas.
* Regras do Storage: leitura só do dono; upload somente para slot reservado, PDF, tamanho limitado, sem
  sobrescrita; exclusão só pelo backend. Sem URLs públicas (`getDownloadURL` não é usado; o PDF é servido pelo
  backend autenticado com `Cache-Control: private, no-store`).

**Entrada, abuso e custos**
* Validação com zod em todas as rotas (campos extras rejeitados), limite de corpo JSON (512 KB; 6 MB só para
  importação de backup e anotações).
* PDF: limite de tamanho (cliente, regras e backend), de páginas, de caracteres por página e timeout de
  extração; checagem da assinatura `%PDF-`; PDF.js sem `eval` (versão ≥ 4.2.67, CVE-2024-4367).
* Rate limit por usuário (geral e de IA) + cota diária de IA por usuário e global (transação no Firestore).
* Limites de materiais por conta, de materiais por geração e de questões/flashcards por pedido.
* IA: timeout, novas tentativas com backoff, `maxOutputTokens`, orçamento de contexto, cota devolvida em falha.

**Conteúdo não confiável**
* Texto dos PDFs é enviado à IA apenas como dado delimitado; instruções embutidas são explicitamente
  ignoradas pelas regras do sistema; marcadores são escapados. Teste: `instruções maliciosas dentro do PDF`.
* Respostas da IA são validadas no servidor; citações só podem apontar para trechos realmente enviados.
* O React escapa todo texto exibido (nenhum `dangerouslySetInnerHTML`); teste garante que HTML vindo do PDF
  não é interpretado.

**Cabeçalhos e logs**
* Hosting: CSP restritiva, HSTS, `nosniff`, `X-Frame-Options`, `Permissions-Policy`. API: Helmet com CSP
  `default-src 'none'`, CORS fechado por padrão (mesma origem via rewrite).
* Logs estruturados sem tokens, chaves, texto de materiais, perguntas ou respostas (lista de bloqueio de
  campos). Erros devolvidos ao cliente são genéricos, sem stack trace.

## Testes de segurança executados

* `tests/rules/rules.test.ts` (emuladores): 12 casos — leitura entre contas negada, visitantes/anônimos
  negados, escrita direta negada, gabaritos/uso ilegíveis, upload fora do slot/tipo/tamanho negado,
  exclusão pelo cliente negada.
* `server/test/integration/api.test.ts`: um segundo usuário tenta ler, alterar, processar, aprovar, excluir,
  baixar, gerar conteúdo, responder simulado e conversar usando ids da primeira conta — tudo negado.

## Checklist antes de tornar o site público

- [ ] `NODE_ENV=production`, `AI_PROVIDER=gemini`; nenhuma variável `*_EMULATOR_HOST` no Cloud Run (o servidor recusa iniciar se houver).
- [ ] `GEMINI_API_KEY` no **Secret Manager**, montada como variável; chave restrita à Generative Language API.
- [ ] Nenhum `.env`, chave ou JSON de conta de serviço no Git (`git log -p | grep -i "AIza"` vazio).
- [ ] `ALLOWED_EMAILS` preenchido enquanto a plataforma for de uso restrito.
- [ ] Regras publicadas (`firebase deploy --only firestore:rules,storage`) e testadas (`npm run test:emulator`).
- [ ] Authentication: apenas provedor e-mail/senha habilitado; anônimo desabilitado; domínios autorizados = domínio do Hosting; política de senha (mín. 8) e proteção contra enumeração de e-mail ativadas.
- [ ] Considere ativar **App Check** (reCAPTCHA Enterprise) para Storage/Auth e exigi-lo no backend.
- [ ] Cloud Run com `--max-instances` baixo (ex.: 2) e conta de serviço dedicada com papéis mínimos (Firestore User, Storage Object Admin no bucket, Secret Accessor no segredo).
- [ ] Alertas de orçamento no Cloud Billing (ex.: 50%, 90%, 100%) e limite de cota na Gemini API (AI Studio).
- [ ] `AI_DAILY_LIMIT_PER_USER` e `AI_DAILY_LIMIT_GLOBAL` ajustados ao orçamento.
- [ ] Testar recuperação de senha e verificação de e-mail com o domínio real.
- [ ] Revisar a política de privacidade: PDFs e trechos enviados à Gemini API (no nível gratuito, o Google pode usar o conteúdo para melhorar produtos — use o nível pago para materiais sensíveis).
