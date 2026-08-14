FROM node:22-alpine

WORKDIR /app

# Install dependencies (express + tailwindcss for the build step)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy static sources into public/
COPY public ./public

# Build Tailwind CSS
RUN npx tailwindcss \
      --content "./public/index.html,./public/job.html,./public/js/**/*.js" \
      --input ./public/css/styles.css \
      --output ./public/css/tailwind.css \
      --minify

# Copy server
COPY server.js .

EXPOSE 3000

CMD ["node", "server.js"]
