FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json tsconfig.json ./
COPY packages ./packages
RUN mkdir -p node_modules/@jaryn \
 && for p in kernel agent-core store-sqlite tools-shell tools-fs testing cli memory bots tasks scheduler llm-deepseek web sandbox-docker mcp; do ln -s ../../packages/$p node_modules/@jaryn/$p; done

ENV JARY_HOME=/data NODE_ENV=production
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "packages/cli/src/index.ts", "serve", "--port", "8787", "--home", "/data"]
