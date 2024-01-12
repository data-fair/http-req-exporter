######################################
# Stage: nodejs dependencies and build
FROM node:16.20.2-alpine3.18 AS builder

WORKDIR /webapp
ADD package.json .
ADD package-lock.json .
# use clean-modules on the same line as npm ci to be lighter in the cache
RUN npm ci &&\
 ./node_modules/.bin/clean-modules --yes --exclude "**/.eslintrc.json"
# Adding server files
ADD server server

# Check quality
ADD .gitignore .gitignore
RUN npm run lint

# Cleanup /webapp/node_modules so it can be copied by next stage
RUN npm prune --production && \
    rm -rf node_modules/.cache

##################################
# Stage: main nodejs service stage
FROM node:16.20.2-alpine3.18
MAINTAINER "contact@koumoul.com"

WORKDIR /webapp

RUN apk add --no-cache dumb-init

# We could copy /webapp whole, but this is better for layering / efficient cache use
COPY --from=builder /webapp/node_modules /webapp/node_modules
ADD server server
ADD config config

# Adding licence, manifests, etc.
ADD package.json .
ADD README.md BUILD.json* ./
ADD LICENSE .
ADD nodemon.json .

# configure node webapp environment
ENV NODE_ENV production
EXPOSE 9090

CMD ["dumb-init", "node", "server"]
