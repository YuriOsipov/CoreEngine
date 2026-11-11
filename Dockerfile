# CoreEngine Vue SPA
#
# Build with parent folder as context (sibling docEngine required):
#   docker build -f coreEngine/Dockerfile -t coreengine-web ..
# Compose sets context: ..

FROM node:22-bookworm-slim AS build
WORKDIR /src

COPY docEngine/packages/editor /src/docEngine/packages/editor
COPY docEngine/packages/field-date /src/docEngine/packages/field-date

WORKDIR /src/coreEngine
COPY coreEngine/package.json coreEngine/package-lock.json* ./
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.dependencies['@docengine/editor']='file:../docEngine/packages/editor';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"
RUN npm install

COPY coreEngine/ ./
ENV VITE_DATA_SOURCE=graphql
ENV VITE_RECORDS_SOURCE=graphql
ENV VITE_AUTH_MODE=bff
ENV VITE_GRAPHQL_URL=/graphql
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY coreEngine/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/coreEngine/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
