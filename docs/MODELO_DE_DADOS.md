# Modelo de dados (Cloud Firestore)

Todo dado privado fica sob `users/{uid}`, onde `uid` é o do Firebase Authentication. Tipos em
`shared/src/types.ts`.

| Caminho | Conteúdo | Cliente pode ler? |
| --- | --- | --- |
| `users/{uid}` | e-mail, nome, `createdAt`, `preferences` (tema, semestre, nº de questões) | sim (dono) |
| `users/{uid}/subjects/{id}` | disciplina: `name`, `semester` | sim |
| `users/{uid}/materials/{id}` | `ownerUid`, `kind` (pdf/notes), `subjectId`, `subjectName`, `semester`, `topic`, `fileName`, `sizeBytes`, `uploadedAt`, `status`, `pageCount`, `extraction` (relatório calculado no servidor), `errorMessage`, `studied` | sim |
| `users/{uid}/materials/{id}/pages/{0001}` | `page`, `text` (normalizado), `charCount`, `hasText`, `layout`, `editedByUser` | sim |
| `users/{uid}/flashcards/{id}` | `front`, `back`, `subjectName`, `topic`, `materialId`, `source` (arquivo/página/trecho), caixa de Leitner `box`, `dueAt`, contadores | sim |
| `users/{uid}/flashcardReviews/{clientReviewId}` | histórico de revisões (idempotente por id do clique) | sim |
| `users/{uid}/quizzes/{id}` | simulado/prática: `mode`, `title`, `materialIds`, `status`, contadores, `model`, `questions[]` **sem gabarito** | sim |
| `users/{uid}/quizKeys/{quizId}` | gabarito: índice correto, justificativa e explicação por alternativa | **não** |
| `users/{uid}/quizzes/{id}/answers/{questionId}` | resposta (`selectedIndex`, `correct`, `answeredAt`, `topic`) — criada uma única vez | sim |
| `users/{uid}/stats/summary` | agregados: respondidas, acertos, simulados finalizados, `topics.{hash}` por assunto | sim |
| `users/{uid}/conversations/{id}` | conversa do tutor: título, `materialIds`, datas, contagem | sim |
| `users/{uid}/conversations/{id}/messages/{id}` | `role`, `text`, `citations[]`, `grounded` | sim |
| `users/{uid}/usage/{AAAA-MM-DD}` | chamadas de IA e tokens do dia | **não** |
| `usageGlobal/{AAAA-MM-DD}` | chamadas de IA da plataforma no dia (orçamento global) | **não** |

Todas as escritas são feitas pelo backend (Admin SDK). As regras negam qualquer escrita do cliente.

## Decisões

* **Texto armazenado uma única vez** (páginas). Trechos para busca são derivados em memória com cache.
  Referências (`source.excerpt`) guardam só um recorte curto (≤ 320 caracteres) para conferência.
* **Gabarito separado e imutável**: questões e gabarito são gravados juntos na criação e nunca regenerados,
  então a correção é consistente durante toda a tentativa; o gabarito não é legível pelo cliente.
* **Respostas idempotentes**: o id do documento de resposta é o id da questão, criado em transação
  (`create`). Cliques repetidos/reenvios devolvem o mesmo resultado sem recontar.
* **Disciplina desnormalizada** em materiais (`subjectName`, `semester`) para listagens baratas; renomear a
  disciplina atualiza os materiais.

## Políticas de exclusão

| Ação | Efeito |
| --- | --- |
| Excluir material | Remove as páginas (texto) e os flashcards gerados dele (o PDF original nunca é enviado); remove o id das conversas. **Mantém** simulados/respostas e estatísticas (histórico de desempenho) — as referências passam a exibir “material excluído”. |
| Excluir simulado | Remove simulado, gabarito e respostas; estatísticas agregadas permanecem. |
| Excluir conversa | Remove a conversa e suas mensagens. |
| Excluir disciplina | Bloqueado enquanto houver materiais vinculados. |
| Excluir conta (Configurações) | Reautenticação → backend apaga `users/{uid}` recursivamente → conta do Auth é removida. |
| Exportar dados | `GET /api/me/export` devolve JSON com todos os dados textuais (portabilidade, LGPD). |

Contadores de uso (`usage`) ainda não expiram sozinhos. Melhoria sugerida: gravar um campo `expireAt`
(timestamp, ~90 dias) e ativar uma política de TTL do Firestore nesse campo.
