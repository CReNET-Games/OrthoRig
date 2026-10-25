.PHONY: all install build build-rig lint lint-fix format test ip-check dev preview clean

all: install build lint ip-check test

install:
	npm install

build:
	npm run build

build-rig:
	npm run build:rig

lint:
	npm run lint

lint-fix:
	npm run lint:fix

format:
	npm run format

test:
	npm run test

ip-check:
	npm run ip:check

dev:
	npm run dev

preview:
	npm run preview

clean:
	rm -rf dist node_modules
