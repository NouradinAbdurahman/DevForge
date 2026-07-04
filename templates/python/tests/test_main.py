import subprocess
import sys


def test_main_prints_greeting():
    result = subprocess.run(
        [sys.executable, "src/main.py"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "Hello, Python!" in result.stdout
