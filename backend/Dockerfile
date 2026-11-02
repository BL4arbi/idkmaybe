FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 4100
# Password hashing runs on this thread pool: 8 logins can be checked in parallel.
ENV UV_THREADPOOL_SIZE=8
# Applies the schema, then starts the API.
CMD ["npm", "start"]
