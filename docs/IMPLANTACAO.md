# Publicação sem custo (Firebase Spark + Vercel Hobby + Gemini gratuita)

Tudo é feito **pelo navegador**: não é preciso instalar Node, npm nem nenhuma ferramenta no computador.
A Vercel baixa o código do GitHub, faz o build nos servidores dela e publica o site.

| Peça | Serviço | Plano | Cartão? |
| --- | --- | --- | --- |
| Login e banco de dados | Firebase Authentication + Cloud Firestore | Spark (gratuito) | Não |
| Site e API | Vercel | Hobby (gratuito, uso pessoal e não comercial) | Não |
| IA | Gemini API (Google AI Studio) | Nível gratuito | Não |
| PDFs | Ficam no aparelho da estudante (o texto é extraído no navegador) | — | — |

> Leia [CUSTOS.md](CUSTOS.md) para entender os limites gratuitos e o que fazer se forem atingidos.

## 1. Firebase (projeto já criado: plano Spark)

1. **Authentication** → Primeiros passos → Método de login → ative **E-mail/senha** (deixe "Link do e-mail" desativado).
   Em *Configurações*: confira a **proteção contra enumeração de e-mail** (ativada) e, se quiser, a política de senha.
2. **Firestore Database** → Criar banco de dados → **modo de produção** → local `southamerica-east1 (São Paulo)`.
   O local não pode ser alterado depois.
3. **Firestore → Regras**: apague o conteúdo, cole o arquivo [`firestore.rules`](../firestore.rules) inteiro e clique em **Publicar**.
   (Nenhum índice composto é necessário.)
4. **Configurações do projeto (engrenagem) → Geral → Seus apps → `</>` (Web)**: registre o app com um apelido
   (ex.: "portal"). **Não** marque "Firebase Hosting". Anote os valores `apiKey`, `authDomain`, `projectId` e `appId`.
   Esses valores são públicos (identificam o projeto); a segurança vem das regras e do backend.
5. **Configurações do projeto → Contas de serviço → Gerar nova chave privada**. Será baixado um arquivo `.json`.
   ⚠ **Este arquivo é um segredo** (dá acesso administrativo ao banco). Não envie por e-mail/chat, não coloque no GitHub
   e apague-o do computador depois de colar na Vercel (passo 3.4).

## 2. Chave da Gemini (gratuita)

1. Acesse <https://aistudio.google.com> com a mesma conta Google → **Get API key → Create API key**
   (escolha o projeto do Firebase). **Não** ative faturamento para continuar no nível gratuito.
2. Guarde a chave para o passo 3.4. Ela também é um segredo.
3. Atenção: no nível gratuito o Google pode usar o conteúdo enviado (trechos das apostilas e perguntas) para melhorar
   os produtos dele, e há limites de requisições por minuto/dia.

## 3. Vercel

1. Crie a conta em <https://vercel.com/signup> com **Continue with GitHub** (plano *Hobby*).
2. **Add New → Project → Import** o repositório `GustavoPelegrine/estudos` (autorize o acesso da Vercel a ele).
3. Em *Configure Project*: **Framework Preset = Other**. Build e instalação já estão em [`vercel.json`](../vercel.json)
   (não altere).
4. Em **Environment Variables**, cadastre (em *Production* e *Preview*):

   | Nome | Valor |
   | --- | --- |
   | `VITE_FIREBASE_API_KEY` | `apiKey` do passo 1.4 |
   | `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` do passo 1.4 |
   | `VITE_FIREBASE_PROJECT_ID` | `projectId` do passo 1.4 |
   | `VITE_FIREBASE_APP_ID` | `appId` do passo 1.4 |
   | `FIREBASE_PROJECT_ID` | `projectId` do passo 1.4 |
   | `FIREBASE_SERVICE_ACCOUNT` | conteúdo **inteiro** do arquivo `.json` do passo 1.5 (marque como *Sensitive*) |
   | `AI_PROVIDER` | `gemini` |
   | `GEMINI_API_KEY` | chave do passo 2 (marque como *Sensitive*) |
   | `GEMINI_MODEL` | `gemini-3.8-flash` |
   | `ALLOWED_EMAILS` | e-mail(s) de quem pode usar o portal, separados por vírgula |
   | `AI_DAILY_LIMIT_PER_USER` | `40` (sugestão para o nível gratuito) |
   | `AI_DAILY_LIMIT_GLOBAL` | `100` |

   Não cadastre `NODE_ENV` (a Vercel já indica produção; cadastrá-la quebra a instalação do build).

5. Clique em **Deploy**. Ao final a Vercel mostra o endereço, por exemplo `https://estudos-xxxx.vercel.app`.
6. Opcional: *Settings → Functions → Function Region* → **São Paulo (gru1)**, se disponível no seu plano (fica mais
   perto do Firestore). Depois, *Deployments → … → Redeploy*.
7. Apague do computador o arquivo `.json` da conta de serviço.

## 4. Autorizar o domínio no Firebase

**Authentication → Configurações → Domínios autorizados → Adicionar domínio** → cole o domínio da Vercel
(ex.: `estudos-xxxx.vercel.app`, sem `https://`).

## 5. Primeiro acesso

1. Abra o endereço da Vercel → **Criar conta** com o e-mail que está em `ALLOWED_EMAILS`.
2. *Meu material* → cadastre uma disciplina → selecione um PDF → **Extrair e salvar texto** → confira → **liberar para estudo**.
3. Gere algumas questões para confirmar que a Gemini está respondendo. Se aparecer "A integração com a IA está mal
   configurada", revise `GEMINI_API_KEY`/`GEMINI_MODEL` na Vercel e faça *Redeploy*.

A cada novo commit na branch `main`, a Vercel publica automaticamente uma nova versão.

## Se algo der errado

| Sintoma | Causa provável |
| --- | --- |
| "Esta conta ainda não tem acesso à plataforma" | O e-mail não está em `ALLOWED_EMAILS` (ou há espaço/maiúscula diferente). |
| Login falha com erro de domínio | Passo 4 (domínio autorizado) não foi feito. |
| "Erro interno" ao abrir o painel | `FIREBASE_SERVICE_ACCOUNT` incompleta ou de outro projeto; veja *Vercel → Logs*. |
| "Limite de uso da Gemini API atingido" | Limite por minuto/dia do nível gratuito; aguarde alguns minutos ou até o dia seguinte. |
| Site em branco | Variáveis `VITE_*` ausentes no momento do build; cadastre e faça *Redeploy*. |

## Alternativa paga (opcional, futuro)

A primeira versão (Cloud Run + Firebase Storage para guardar os PDFs) continua no histórico do Git
(commit `94056a3`). Ela exige o plano Blaze (cartão) e só faz sentido se você quiser guardar os PDFs originais na nuvem.
