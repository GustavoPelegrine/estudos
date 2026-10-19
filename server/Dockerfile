# Imagem do backend para o Cloud Run. Construir a partir da RAIZ do repositório:
#   docker build -f server/Dockerfile -t estudos-odonto-api .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace server --include-workspace-root=false --ignore-scripts
COPY shared shared
COPY server server
RUN npm run build -w server

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace server --include-workspace-root=false --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/server/dist server/dist
USER node
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
