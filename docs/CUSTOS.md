# Custos

A configuração recomendada ([IMPLANTACAO.md](IMPLANTACAO.md)) usa apenas planos **gratuitos e sem cartão**:
Firebase **Spark**, Vercel **Hobby** e Gemini API **nível gratuito**. Sem cartão cadastrado, não há como haver cobrança:
se um limite for atingido, o serviço recusa novas operações até o próximo período, em vez de cobrar.

> Os limites gratuitos são definidos pelos fornecedores e podem mudar. Confira as páginas oficiais de preços
> periodicamente. Não há garantia de que os planos gratuitos continuem existindo nas mesmas condições.

## Onde estão os limites e como o app se protege

| Serviço | O que tem limite no plano gratuito | Proteção no app |
| --- | --- | --- |
| Firestore (Spark) | Leituras, escritas e exclusões por dia; armazenamento total | Só o **texto** dos PDFs é salvo (os arquivos ficam no aparelho); trechos para a busca são calculados em memória; páginas carregadas em lotes. |
| Authentication (Spark) | Usuários ativos e e-mails enviados | `ALLOWED_EMAILS` restringe quem pode usar. |
| Vercel (Hobby) | Execuções e tempo de função, transferência de dados; uso apenas pessoal/não comercial | Função única, sem processamento pesado (o PDF é lido no navegador); IA limitada a 55 s por operação. |
| Gemini (gratuito) | Requisições por minuto e por dia; tokens por minuto | Cota diária por usuário (`AI_DAILY_LIMIT_PER_USER`) e global (`AI_DAILY_LIMIT_GLOBAL`), limite de 6 gerações/minuto, só trechos relevantes são enviados, o tutor não chama a IA quando não há evidência. |

Para uma estudante, o uso normal (alguns PDFs por semana, dezenas de questões e perguntas por dia) tende a ficar
bem abaixo desses limites.

## Contrapartidas do custo zero

* **Privacidade da IA:** no nível gratuito da Gemini o Google pode usar o conteúdo enviado para melhorar os produtos.
* **PDF original não fica na nuvem:** a comparação texto × PDF em outro aparelho exige abrir o arquivo localmente.
* **Uso pessoal:** o plano Hobby da Vercel não permite uso comercial (vender acesso, anúncios, clientes).

## Se um dia quiser pagar (opcional)

* **Claude Haiku 5.5** como IA: US$ 0,10 por milhão de tokens de entrada e US$ 0,50 de saída — cerca de
  US$ 0,003 por geração de 10 questões. A camada de IA do backend é trocável (`server/src/ai/provider.ts`).
* **Gemini nível pago:** o conteúdo deixa de ser usado para treino; cobra por token.
* **Guardar PDFs na nuvem:** exige o plano Blaze do Firebase (Storage); ver a versão do commit `94056a3`.
