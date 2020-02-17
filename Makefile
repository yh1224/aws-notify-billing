.PHONY: all
all: build

.PHONY: build
build:
	sam build --use-container

env.json: env.json.example
	test -e env.json || cp env.json.example env.json

.PHONY: local-invoke
local-invoke: build env.json
	sam local invoke --env-vars env.json

.PHONY:
deploy: build
	sam deploy
