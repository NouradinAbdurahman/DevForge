# Flutter starter template

A minimal, working Flutter app scaffold - copy this directory out to start a
new project.

## Recommended structure

```text
flutter-app/
├── lib/
│   └── main.dart        # app entry point
├── test/
│   └── widget_test.dart # add tests here
├── pubspec.yaml         # dependencies + metadata
├── analysis_options.yaml
├── .gitignore
├── .editorconfig
└── LICENSE
```

## Getting started

```bash
flutter create . --project-name my_app  # optional: let Flutter generate ios/android/web shells
flutter pub get
flutter run
```

This template ships `lib/main.dart` and `pubspec.yaml` only - run
`flutter create .` in the copied directory first if you need the native
`ios/`, `android/`, or `web/` platform folders (this repo's DevForge
Brewfile/mise already provide the Flutter SDK and Android SDK needed to do
that).

## Example configuration

`pubspec.yaml` pins the Dart SDK constraint and lists `flutter_lints` as a
dev dependency; `analysis_options.yaml` wires it up. Add packages with:

```bash
flutter pub add <package>
```
