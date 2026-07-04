# React Native starter template

A minimal, JS-only React Native starting point - copy this directory out to
start a new project.

## Recommended structure

```text
react-native-app/
├── App.js
├── index.js
├── app.json
├── package.json
├── .gitignore
├── .editorconfig
└── LICENSE
```

## Getting started

The native `ios/`/`android/` platform projects are generated, not hand
written - this template only ships the JS layer. Scaffold the native
projects first, then drop these files in:

```bash
npx @react-native-community/cli init MyApp
# then copy App.js, index.js, and app.json from this template into MyApp/
cd MyApp
pnpm install
pnpm ios     # or: pnpm android
```

## Example configuration

`app.json` sets the app display name; `index.js` registers `App.js` as the
root component via `AppRegistry`, matching what the generated native
projects expect.
