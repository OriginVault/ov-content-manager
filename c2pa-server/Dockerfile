FROM node:18

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
RUN npm install -g ts-node typescript
COPY . .

EXPOSE 8080
CMD ["npx", "tsx", "src/server.ts"] 