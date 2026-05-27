FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Set backend URL for build-time Next.js rewrites
ARG BACKEND_URL="http://backend:8000/api/:path*"
ENV BACKEND_URL=$BACKEND_URL

# Build the Next.js application
RUN npm run build

# Expose port
EXPOSE 3000

# Start in production mode
CMD ["npm", "start"]
