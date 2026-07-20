FROM node:20-alpine

WORKDIR /app

# Copy package files first to leverage Docker caching
COPY package*.json ./

RUN npm install --production

# Copy the rest of the backend source code
COPY . .

EXPOSE 5001

CMD ["node", "server.js"]