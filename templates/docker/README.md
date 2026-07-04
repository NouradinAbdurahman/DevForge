# Docker starter template

A minimal, generic `Dockerfile` - copy this directory out and adapt the
base image/command to whatever you're containerizing.

## Recommended structure

```text
docker-app/
├── Dockerfile
├── .dockerignore
├── .gitignore
├── .editorconfig
└── LICENSE
```

## Getting started

```bash
docker build -t my-app .
docker run --rm my-app
```

## Example configuration

The shipped `Dockerfile` is a minimal, working multi-stage-ready example
based on `alpine` that just echoes a message - replace the `CMD` and add a
`COPY`/build step for your actual application.
