FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client sshpass ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=development
ENV VITE_HOST=0.0.0.0
ENV VITE_PORT=8080
ENV LOCAL_DEMO_MODE=true
ENV VITE_LOCAL_DEMO_MODE=true

COPY package.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY . .

EXPOSE 8080

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8080"]
