# Python starter template

A minimal Python project scaffold - copy this directory out to start a new
project.

## Recommended structure

```text
python-app/
├── src/
│   └── main.py
├── tests/
│   └── test_main.py
├── pyproject.toml
├── requirements.txt
├── .gitignore
├── .editorconfig
└── LICENSE
```

## Getting started

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python src/main.py
```

Run tests with:

```bash
pip install pytest
pytest
```

## Example configuration

`pyproject.toml` carries project metadata; `requirements.txt` is the
runtime dependency list (kept separate so container builds can `pip
install -r requirements.txt` without needing build tooling for
`pyproject.toml`-based installs).
