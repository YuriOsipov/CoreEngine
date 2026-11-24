# CoreEngine Vue SPA (Docker / try-out image)
#
# Try-out image swaps the editor packages for in-repo ci/stubs so this build
# does not need a DocEngine checkout. GitHub Actions installs published
# @docengine/*@0.0.105; its app job runs `npm run build`.
#
#   docker build -f Dockerfile -t coreengine-web .
# Compose: context is this repo (coreEngine).

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY ci/stubs ./ci/stubs
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.dependencies['@docengine/editor']='file:./ci/stubs/docengine-editor';p.dependencies['@docengine/field-date']='file:./ci/stubs/docengine-field-date';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');" \
  && npm install --ignore-scripts

COPY . .
RUN rm -rf node_modules \
  && node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.dependencies['@docengine/editor']='file:./ci/stubs/docengine-editor';p.dependencies['@docengine/field-date']='file:./ci/stubs/docengine-field-date';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');" \
  && npm install --ignore-scripts

ENV VITE_DATA_SOURCE=graphql
ENV VITE_RECORDS_SOURCE=graphql
ENV VITE_AUTH_MODE=bff
ENV VITE_GRAPHQL_URL=/graphql
# Vite bundle for this image. The CI app job runs `npm run build`.
RUN npm run build:ci

FROM nginx:1.27-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
