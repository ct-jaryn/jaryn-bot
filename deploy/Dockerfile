FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json tsconfig.json ./
COPY packages ./packages
COPY scripts ./scripts

# Link every internal @jaryn/* package (no npm install needed: the runtime has no
# external dependencies). Generated dynamically so new packages can never be missed.
RUN node -e '\
const fs=require("fs"),path=require("path");\
for (const dir of fs.readdirSync("packages")) {\
  const manifest=path.join("packages",dir,"package.json");\
  if(!fs.existsSync(manifest)) continue;\
  const name=JSON.parse(fs.readFileSync(manifest,"utf8")).name;\
  if(!name||!name.startsWith("@jaryn/")) continue;\
  const link=path.join("node_modules",name);\
  fs.mkdirSync(path.dirname(link),{recursive:true});\
  try{fs.unlinkSync(link)}catch{}\
  fs.symlinkSync(path.relative(path.dirname(link),path.join("packages",dir)),link,"dir");\
  console.log("linked",name);\
}'

ENV JARY_HOME=/data NODE_ENV=production
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=20s --retries=3 CMD node packages/cli/src/index.ts doctor --home /data || exit 1
CMD ["node", "packages/cli/src/index.ts", "serve", "--port", "8787", "--home", "/data"]
