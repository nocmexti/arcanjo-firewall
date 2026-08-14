FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client sshpass ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Copy initialization script and configuration files
COPY whitelabel-init.cjs ./
COPY package.json ./

# Install dependencies
RUN npm install --legacy-peer-deps --no-audit --no-fund

# Copy the rest of the application
COPY . .

# Run whitelabel initialization before starting the app
RUN node whitelabel-init.cjs

EXPOSE 8080

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8080"]
