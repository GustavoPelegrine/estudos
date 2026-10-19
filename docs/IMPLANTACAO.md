# Implantação

Nada é publicado automaticamente. Todos os passos abaixo dependem da sua conta Google.
Região sugerida: `southamerica-east1` (São Paulo).

## 1. Projeto Firebase

1. Crie um projeto em <https://console.firebase.google.com> e **ative o plano Blaze** (necessário para Storage
   e Cloud Run — ver [CUSTOS.md](CUSTOS.md)). Crie o alerta de orçamento antes de continuar.
2. **Authentication** → Métodos de login → habilite **E-mail/senha**. Em Configurações: domínios autorizados,
   proteção contra enumeração de e-mail e política de senha.
3. **Firestore** → criar banco (modo produção) na região escolhida.
4. **Storage** → criar o bucket padrão.
5. Configurações do projeto → Seus apps → adicionar app **Web** → copie a configuração para `web/.env.production`
   (modelo em `web/.env.example`; esses valores são públicos).

```bash
npm install -g firebase-tools   # ou use npx firebase
firebase login
cp .firebaserc.example .firebaserc   # e coloque o id do projeto
```

## 2. Gemini API

1. Crie uma chave em <https://aistudio.google.com> (Get API key) **no mesmo projeto Google Cloud**.
   A assinatura do app Gemini não é a mesma coisa que acesso à API.
2. Restrinja a chave à *Generative Language API* (Console Cloud → APIs e serviços → Credenciais).
3. Teste localmente sem gravar a chave no Git:
   ```bash
   echo "GEMINI_API_KEY=cole-aqui" >> server/.env      # server/.env é ignorado pelo Git
   npm run check:gemini -w server                      # confirma o modelo gemini-3.8-flash e a resposta JSON
   ```
   Se o modelo não estiver disponível para sua chave, o script lista os disponíveis; ajuste `GEMINI_MODEL`.
4. Guarde a chave no Secret Manager:
   ```bash
   printf "%s" "SUA_CHAVE" | gcloud secrets create gemini-api-key --data-file=- --project SEU_PROJETO
   ```

## 3. Regras de segurança

```bash
npm run test:emulator                                  # testes das regras e da API
firebase deploy --only firestore:rules,firestore:indexes,storage
```

## 4. Backend (Cloud Run)

```bash
gcloud iam service-accounts create estudos-odonto-api --project SEU_PROJETO
for role in roles/datastore.user roles/firebaseauth.viewer; do
  gcloud projects add-iam-policy-binding SEU_PROJETO --member "serviceAccount:estudos-odonto-api@SEU_PROJETO.iam.gserviceaccount.com" --role $role
done
gcloud storage buckets add-iam-policy-binding gs://SEU_PROJETO.firebasestorage.app --member "serviceAccount:estudos-odonto-api@SEU_PROJETO.iam.gserviceaccount.com" --role roles/storage.objectAdmin
gcloud secrets add-iam-policy-binding gemini-api-key --member "serviceAccount:estudos-odonto-api@SEU_PROJETO.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor

# Build da imagem (a partir da raiz) e deploy
gcloud builds submit --config cloudbuild.yaml --project SEU_PROJETO \
  --substitutions _IMAGE=southamerica-east1-docker.pkg.dev/SEU_PROJETO/apps/estudos-odonto-api
gcloud run deploy estudos-odonto-api \
  --image southamerica-east1-docker.pkg.dev/SEU_PROJETO/apps/estudos-odonto-api \
  --region southamerica-east1 --service-account estudos-odonto-api@SEU_PROJETO.iam.gserviceaccount.com \
  --allow-unauthenticated --max-instances 2 --memory 1Gi --timeout 120 \
  --set-env-vars NODE_ENV=production,FIREBASE_PROJECT_ID=SEU_PROJETO,FIREBASE_STORAGE_BUCKET=SEU_PROJETO.firebasestorage.app,AI_PROVIDER=gemini,GEMINI_MODEL=gemini-3.8-flash,ALLOWED_EMAILS=email.da.estudante@exemplo.com \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

(Crie antes o repositório do Artifact Registry `apps`: `gcloud artifacts repositories create apps --repository-format docker --location southamerica-east1`.)

`--allow-unauthenticated` libera apenas o acesso HTTP; **cada rota exige o ID token do Firebase**. O nome do
serviço e a região precisam coincidir com o `rewrites` de `firebase.json`.

## 5. Frontend (Firebase Hosting)

```bash
npm run build -w web          # usa web/.env.production
firebase deploy --only hosting
```

O Hosting serve o app e encaminha `/api/**` ao Cloud Run (mesma origem: sem CORS, sem expor a URL do serviço).

## 6. Pós-implantação

* Siga o checklist de [SEGURANCA.md](SEGURANCA.md).
* Crie a conta da estudante pelo próprio site (Cadastro) e confirme o e-mail.
* Se ela tiver dados da versão HTML antiga: na versão antiga, “Exportar dados”; na nova,
  Configurações → “Importar backup da versão antiga”.
* Monitore em Cloud Run → Logs (`severity`, `message`) e o uso diário em `users/{uid}/usage`.
