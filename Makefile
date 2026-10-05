# Helenus Makefile

# Build variables
BINARY_NAME=helenus
BIN_DIR=bin
DIST_DIR=web/dist
VERSION=$(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
COMMIT=$(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE=$(shell date -u +'%Y-%m-%dT%H:%M:%SZ')

LDFLAGS=-ldflags "-X github.com/0funct0ry/helenus/cmd.Version=$(VERSION) \
                  -X github.com/0funct0ry/helenus/cmd.Commit=$(COMMIT) \
                  -X github.com/0funct0ry/helenus/cmd.BuildDate=$(BUILD_DATE)"

# Tools
GO=go
# Explicit packages: web/node_modules may contain stray Go files.
GOPKGS=. ./cmd/... ./internal/... ./web
GOLANGCI_LINT=golangci-lint
NPM=npm
# Cassandra images the integration tests run against (SPEC §15).
CASSANDRA_VERSIONS ?= 4.1 5.0

.PHONY: all
all: build

.PHONY: help
## help: Display this help message
help:
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^##' $(MAKEFILE_LIST) | sed -e 's/^## //g' | awk 'BEGIN {FS = ": "}; {printf "  %-20s %s\n", $$1, $$2}'

.PHONY: build
## build: Build web UI and the Go binary
build: web
	@mkdir -p $(BIN_DIR)
	$(GO) build $(LDFLAGS) -o $(BIN_DIR)/$(BINARY_NAME) main.go

.PHONY: clean
## clean: Remove build artifacts
clean:
	rm -rf $(BIN_DIR)
	rm -rf $(DIST_DIR)
	mkdir -p $(DIST_DIR) && touch $(DIST_DIR)/.gitkeep
	rm -rf site/dist

.PHONY: vet
## vet: Run go vet
vet:
	$(GO) vet $(GOPKGS)

.PHONY: test
## test: Run Go unit tests and web tests
test:
	$(GO) test -short $(GOPKGS)
	@if [ -d "web" ]; then cd web && $(NPM) test; fi


.PHONY: test-pkg
## test-pkg: Run Go tests for one package, e.g. make test-pkg PKG=./internal/complete
test-pkg:
	$(GO) test -short -count=1 $(PKG) $(TESTFLAGS)

.PHONY: bench
## bench: Run Go benchmarks for one package, e.g. make bench PKG=./internal/complete
bench:
	$(GO) test -run '^$$' -bench . -benchmem $(PKG)

.PHONY: golden
## golden: Rewrite the statement splitter golden files
golden:
	$(GO) test ./internal/cql -run TestSplitGolden -update

.PHONY: golden-shell
## golden-shell: Rewrite the shell renderer golden files
golden-shell:
	$(GO) test ./internal/shell -run TestRenderGolden -update

.PHONY: golden-mutate
## golden-mutate: Rewrite the grid change compiler golden files
golden-mutate:
	$(GO) test ./internal/mutate -run TestCompileGolden -update

.PHONY: golden-seed
## golden-seed: Rewrite the seed generator golden files
golden-seed:
	$(GO) test ./internal/seed -run TestSeedGolden -update

.PHONY: lint
## lint: Run linters (Go and web)
lint:
	$(GOLANGCI_LINT) run
	@if [ -d "web" ]; then cd web && $(NPM) run typecheck && $(NPM) run lint; fi

.PHONY: it
## it: Run integration tests (requires Docker)
it:
	@for v in $(CASSANDRA_VERSIONS); do \
		echo "== integration tests against cassandra:$$v =="; \
		HELENUS_IT_CASSANDRA_VERSION=$$v $(GO) test -tags integration -count=1 -timeout 20m ./internal/... || exit 1; \
	done

.PHONY: it-pkg
## it-pkg: Run integration tests for one package, e.g. make it-pkg PKG=./internal/mutate (set HELENUS_IT_ADDR=host:port to reuse a node)
it-pkg:
	$(GO) test -tags integration -count=1 -timeout 20m $(PKG) $(TESTFLAGS)

.PHONY: fmt
## fmt: Format Go code
fmt:
	$(GO) fmt $(GOPKGS)

.PHONY: dev
## dev: Run Go server with rebuild on change (requires air) and Vite dev server
dev:
	@echo "Starting Vite (http://localhost:5173) and the Go server (http://127.0.0.1:4042)..."
	@(cd web && $(NPM) run dev) & \
	if command -v air >/dev/null 2>&1; then air -c .air.toml; else $(GO) run main.go ui --open=false; fi

.PHONY: web
## web: Build the web UI
web:
	@if [ -d "web" ]; then \
		cd web && $(NPM) install && $(NPM) run build; \
	else \
		echo "Web directory not found, skipping web build"; \
	fi

.PHONY: site
## site: Build the Astro site
site:
	@if [ -d "site" ]; then \
		cd site && $(NPM) install && $(NPM) run build; \
	else \
		echo "Site directory not found, skipping site build"; \
	fi

.PHONY: release-snapshot
## release-snapshot: Build a local GoReleaser snapshot (not implemented until M11)
release-snapshot:
	@echo "release-snapshot is not implemented yet (planned for M11)"

.PHONY: tidy
## tidy: Run go mod tidy
tidy:
	$(GO) mod tidy

.PHONY: get
## get: Add Go dependencies, e.g. make get PKG=github.com/spf13/viper
get:
	$(GO) get $(PKG)
