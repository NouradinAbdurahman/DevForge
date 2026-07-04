# FastAPI starter template

A minimal FastAPI service - copy this directory out to start a new
project.

## Recommended structure

```text
fastapi-app/
├── main.py
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
uvicorn main:app --reload
```

Then visit <http://localhost:8000> and <http://localhost:8000/docs> for the
interactive API docs FastAPI generates automatically.

## Example configuration

`requirements.txt` pins `fastapi` and `uvicorn`; `main.py` exposes a single
`GET /` route returning a JSON greeting.
