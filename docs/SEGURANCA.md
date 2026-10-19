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
* PDFs nunca saem do aparelho: o texto é extraído no navegador e só ele é enviado; o servidor valida tamanho e
  intervalo das páginas e recalcula o relatório de extração.

**Entrada, abuso e custos**
* Validação com zod em todas as rotas (campos extras rejeitados), limite de corpo JSON (512 KB; 6 MB só para
  importação de backup e anotações).
* PDF: limite de tamanho e de páginas, de caracteres por página e por lote, timeout de extração; checagem da
  assinatura `%PDF-`; PDF.js sem `eval` (versão ≥ 4.2.67, CVE-2024-4367), executado em Web Worker.
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
* Site (Vercel, definidos em `scripts/build-vercel.mjs`): CSP restritiva, HSTS, `nosniff`, `X-Frame-Options`,
  `Permissions-Policy`. API: Helmet com CSP `default-src 'none'`, CORS fechado (mesma origem).
* Logs estruturados sem tokens, chaves, texto de materiais, perguntas ou respostas (lista de bloqueio de
  campos). Erros devolvidos ao cliente são genéricos, sem stack trace.

## Testes de segurança executados

* `tests/rules/rules.test.ts` (emuladores): leitura entre contas negada, visitantes/anônimos negados, escrita direta
  negada (inclusive pelo dono), gabaritos/uso ilegíveis, coleções fora de `/users` negadas.
* `server/test/integration/api.test.ts`: um segundo usuário tenta ler, alterar, enviar páginas, finalizar, aprovar,
  excluir, gerar conteúdo, responder simulado e conversar usando ids da primeira conta — tudo negado. Também testa
  que o servidor não confia no relatório de extração enviado pelo cliente.

## Checklist antes de tornar o site público

- [ ] Na Vercel: `AI_PROVIDER=gemini`; **nenhuma** variável `*_EMULATOR_HOST`; `NODE_ENV` não cadastrada (o servidor
      assume produção na Vercel e recusa iniciar com emuladores ou IA simulada).
- [ ] `GEMINI_API_KEY` e `FIREBASE_SERVICE_ACCOUNT` marcadas como *Sensitive* na Vercel; o arquivo `.json` da conta de
      serviço apagado do computador; nada disso no Git (`git log -p | grep -i "private_key\|AIza"` vazio).
- [ ] `ALLOWED_EMAILS` preenchido com o(s) e-mail(s) autorizado(s).
- [ ] Regras do Firestore publicadas (conteúdo de `firestore.rules`) e testadas (`npm run test:emulator`).
- [ ] Authentication: apenas E-mail/senha; anônimo desativado; proteção contra enumeração de e-mail ativada;
      domínio da Vercel em *Domínios autorizados*.
- [ ] Se a chave da Gemini ou a conta de serviço vazarem: revogue a chave no AI Studio / exclua a chave da conta de
      serviço no Console do Google Cloud (IAM → Contas de serviço → Chaves) e gere novas.
- [ ] Testar recuperação de senha e verificação de e-mail com o domínio real.
- [ ] Revisar a política de privacidade: trechos dos materiais são enviados à Gemini API; no nível gratuito o Google
      pode usar esse conteúdo para melhorar os produtos.
