# Firebase starter template

A minimal Firebase Hosting project - copy this directory out to start a new
project. Requires the Firebase CLI (already installed by DevForge's
`Brewfile`).

## Recommended structure

```text
firebase-app/
├── public/
│   └── index.html
├── firebase.json
├── .firebaserc.example
├── .gitignore
├── .editorconfig
└── LICENSE
```

## Getting started

```bash
firebase login
cp .firebaserc.example .firebaserc   # then edit in your real project ID
firebase deploy --only hosting
```

Or serve locally without deploying:

```bash
firebase emulators:start --only hosting
```

## Example configuration

`firebase.json` points Hosting at the `public/` directory; `.firebaserc.example`
shows the project-alias format Firebase expects (`.firebaserc` itself is
gitignored since it's project-specific).
