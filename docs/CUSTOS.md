# Custos, limites gratuitos e fontes de cobrança

> **Não há garantia de custo zero.** Preços e cotas mudam; confira as páginas oficiais de preços do Firebase,
> do Cloud Run e da Gemini API antes de publicar. Valores abaixo são orientativos.

## O que exige faturamento

| Serviço | Precisa do plano Blaze / conta de faturamento? | Observação |
| --- | --- | --- |
| Firebase Authentication (e-mail/senha) | Não | Cota gratuita ampla para usuários ativos. |
| Cloud Firestore | Não para começar (cota diária gratuita) | Cobra leituras/escritas/armazenamento acima da cota. |
| Firebase Storage | **Sim** para projetos novos (o bucket padrão exige Blaze desde 2024) | Há faixa gratuita de armazenamento e transferência no Blaze. |
| Cloud Run | **Sim** (conta de faturamento) | Faixa gratuita mensal de requisições/CPU/memória. |
| Firebase Hosting | Não | Cota gratuita de armazenamento e transferência. |
| Gemini API | Nível gratuito sem faturamento, com limites menores | No nível gratuito o Google pode usar os dados para melhorar produtos; o nível pago não. |
| Secret Manager | Sim (Blaze) | Poucas versões de segredo ficam na faixa gratuita. |

**Alternativa mais econômica** para começar: Hosting + Auth + Firestore no Spark seriam gratuitos, mas Storage e
Cloud Run exigem Blaze. Com Blaze, um uso individual tende a ficar dentro das faixas gratuitas desses
serviços; a principal fonte de custo variável é a **Gemini API**.

## Fontes de cobrança e como o app as controla

| Fonte | Controle no app |
| --- | --- |
| Tokens da Gemini (entrada + saída) | Apenas trechos relevantes (≤ `AI_CONTEXT_MAX_CHARS`, padrão 24 mil caracteres ≈ 6–8 mil tokens); `maxOutputTokens`; cota diária por usuário (`AI_DAILY_LIMIT_PER_USER`, padrão 60) e global (`AI_DAILY_LIMIT_GLOBAL`, 400); rate limit de IA (6/min); tutor não chama a IA sem evidência; tokens registrados por dia em `users/{uid}/usage`. |
| Leituras do Firestore | Trechos derivados em cache de memória; listas com `limit`; páginas carregadas em lotes de 20. |
| Armazenamento de PDFs | `MAX_PDF_MB` (20) e `MAX_MATERIALS_PER_USER` (60); exclusão remove arquivos. |
| CPU do Cloud Run | Escala a zero; `--max-instances` baixo; extração de PDF com timeout e limite de páginas. |
| Cadastros indesejados consumindo IA | `ALLOWED_EMAILS`, cota por usuário e cota global. |

## Alertas de orçamento (configuração manual — depende de você)

1. Google Cloud Console → Faturamento → **Orçamentos e alertas** → criar orçamento para o projeto
   (ex.: R$ 30/mês) com alertas em 50%, 90% e 100%.
2. Google AI Studio → projeto da chave → definir limites de uso/gasto da Gemini API, se disponíveis.
3. Opcional: vincular o orçamento a um tópico Pub/Sub para desligar a IA automaticamente
   (ex.: mudar `AI_PROVIDER=none`) — não implementado nesta versão.

Estimativa grosseira de tokens por operação (com padrões): questões ≈ 7–9 mil tokens de entrada e
2–5 mil de saída; tutor ≈ 3–4 mil de entrada e até 1 mil de saída. Multiplique pelo preço vigente do modelo.
