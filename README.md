# What is this

This is a typescript script that aims at generating a migration to fix the mojibake in our DB past the conversion to `utf8mb4`.

# How it works

The script uses [pyodide](https://pyodide.org/en/stable/) to run [python-ftfy](https://github.com/rspeer/python-ftfy) in JS. It then iterates over DB rows and generates a migration script to alter the content of said rows removing the mojibake.

# How to use

Ensure python-ftfy is submoduled correctly so that wheels can be built.

## Build the wheels

- `cd python-ftfy && pip wheel .`

## Running

- `npm run start`
