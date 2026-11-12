#!/usr/bin/env bash
#
# Interactive setup wizard for lubelogger-mcp.
# Configures .env, verifies LubeLogger connection, launches docker-compose,
# and outputs client connection snippets.
#

set -euo pipefail

if [[ ! -t 0 ]] && [[ -r /dev/tty ]]; then
  exec < /dev/tty
fi

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

TOTAL_STAGES=6
_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"

_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1 && tput clear 2>/dev/null; then return 0; fi
  printf '\033[2J\033[3J\033[H'
}

stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

say()  { printf '  %s\n' "$1"; }
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }
err()  { printf '  %s✖ %s%s\n' "$RED" "$1" "$RESET"; }

pause() {
  local prompt="${1:-Press Enter to continue...}"
  printf '\n  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  read -r _
}

ask() {
  local var_name="$1"
  local prompt="$2"
  local default="${3:-}"
  local current="${!var_name:-$default}"

  if [[ -n "$current" ]]; then
    printf '  %s [%s]: ' "$prompt" "$current"
  else
    printf '  %s: ' "$prompt"
  fi

  read -r answer
  if [[ -z "$answer" ]]; then
    eval "$var_name=\"$current\""
  else
    eval "$var_name=\"$answer\""
  fi
}

ask_secret() {
  local var_name="$1"
  local prompt="$2"
  local current="${!var_name:-}"

  if [[ -n "$current" ]]; then
    printf '  %s [saved value exists, press Enter to keep]: ' "$prompt"
  else
    printf '  %s: ' "$prompt"
  fi

  read -r -s answer
  printf '\n'
  if [[ -n "$answer" ]]; then
    eval "$var_name=\"$answer\""
  fi
}

set_env() {
  local key="$1"
  local val="$2"
  touch "$ENV_FILE"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

# ------------------------------------------------------------------------------
# Banner
# ------------------------------------------------------------------------------
_clear
printf '\n%s%s  🚗 lubelogger-mcp Setup Wizard%s\n' "$BOLD" "$BLUE" "$RESET"
printf '%s  Configure, test, and deploy your LubeLogger MCP Server%s\n\n' "$DIM" "$RESET"
printf '%s  This wizard will guide you through:%s\n' "$DIM" "$RESET"
say "1. Public URL & port configuration"
say "2. Embedded OAuth 2.1 zero-password authentication setup"
say "3. LubeLogger connection & authentication verification"
say "4. Docker Compose deployment"
say "5. AI client connection instructions (Claude, Cursor, Gemini)"
printf '\n'
pause "Press Enter to begin..."

# ------------------------------------------------------------------------------
# Stage 1: Public URL & Network
# ------------------------------------------------------------------------------
stage "Public Endpoint Configuration"

say "Enter the public HTTPS base URL for lubelogger-mcp (e.g. via Cloudflare Tunnel)."
note "Your MCP endpoint will be reachable at \${PUBLIC_URL}/mcp."
printf '\n'

PUBLIC_URL="${PUBLIC_URL:-https://lubelogger-mcp.example.com}"
ask PUBLIC_URL "Public URL" "https://lubelogger-mcp.example.com"
PUBLIC_URL="${PUBLIC_URL%/}"

PORT="${PORT:-3000}"
ask PORT "Host Port" "3000"

set_env "PUBLIC_URL" "$PUBLIC_URL"
set_env "PORT" "$PORT"
set_env "DATA_DIR" "/data"

# ------------------------------------------------------------------------------
# Stage 2: Embedded OAuth 2.1
# ------------------------------------------------------------------------------
stage "OAuth 2.1 Configuration"

say "Users authenticate dynamically via the branded LubeLogger consent screen."
note "Zero-Password Architecture: Users paste their LubeLogger API Key (Settings ➔ Profile ➔ API Keys)."
note "Your master account password is never collected or stored in .env or on disk."
printf '\n'

DEFAULT_REDIRECTS="http://localhost,http://127.0.0.1,https://oauth-redirect.googleusercontent.com/r/,https://oauth-redirect.googleusercontent.com/a/,https://oauth-redirect-sandbox.googleusercontent.com/r/,https://oauth-redirect-sandbox.googleusercontent.com/a/,https://oauth-redirect-test.googleusercontent.com/r/,https://oauth-redirect-test.googleusercontent.com/a/,https://vertexaisearch.cloud.google.com/oauth-redirect"
set_env "OAUTH_ALLOWED_REDIRECT_URIS" "$DEFAULT_REDIRECTS"

# ------------------------------------------------------------------------------
# Stage 3: LubeLogger Connection
# ------------------------------------------------------------------------------
stage "LubeLogger Server & Authentication"

say "Specify your self-hosted LubeLogger instance URL."
note "If running in Docker on the same VPS, use http://host.docker.internal:8383."
printf '\n'

LUBELOGGER_URL="${LUBELOGGER_URL:-http://host.docker.internal:8383}"
ask LUBELOGGER_URL "LubeLogger URL" "http://host.docker.internal:8383"
LUBELOGGER_URL="${LUBELOGGER_URL%/}"

say ""
say "Authentication Mode:"
say "1) Dynamic Authentication (Recommended - sign in with LubeLogger in browser, zero secrets in .env)"
say "2) Server-wide API Key"
say "3) Server-wide Basic Authentication"
ask AUTH_CHOICE "Select [1, 2, or 3]" "1"

set_env "LUBELOGGER_URL" "$LUBELOGGER_URL"

if [[ "$AUTH_CHOICE" == "2" ]]; then
  LUBELOGGER_API_KEY="${LUBELOGGER_API_KEY:-}"
  while [[ -z "$LUBELOGGER_API_KEY" ]]; do
    ask LUBELOGGER_API_KEY "LubeLogger API Key"
  done
  set_env "LUBELOGGER_API_KEY" "$LUBELOGGER_API_KEY"
elif [[ "$AUTH_CHOICE" == "3" ]]; then
  ask LUBELOGGER_USERNAME "LubeLogger Username" "admin"
  ask_secret LUBELOGGER_PASSWORD "LubeLogger Password"
  set_env "LUBELOGGER_USERNAME" "$LUBELOGGER_USERNAME"
  set_env "LUBELOGGER_PASSWORD" "$LUBELOGGER_PASSWORD"
else
  note "Using dynamic authentication: zero secrets stored in .env."
fi

set_env "CACHE_TTL_SECONDS" "30"

# ------------------------------------------------------------------------------
# Stage 4: Test Connection
# ------------------------------------------------------------------------------
stage "Connection Verification"

say "Testing connectivity to LubeLogger..."
TEST_URL="${LUBELOGGER_URL}/api/version"
if [[ "$LUBELOGGER_URL" =~ host.docker.internal ]]; then
  TEST_URL="${TEST_URL//host.docker.internal/127.0.0.1}"
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$TEST_URL" || echo "000")
if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "401" || "$HTTP_CODE" == "403" ]]; then
  printf '  %s✔ Reached LubeLogger server (HTTP %s)%s\n' "$GREEN" "$HTTP_CODE" "$RESET"
else
  warn "Could not verify connection to $TEST_URL (HTTP $HTTP_CODE)."
  note "If LubeLogger is in another Docker container, ensure host.docker.internal is reachable."
fi

pause "Press Enter to proceed to deployment..."

# ------------------------------------------------------------------------------
# Stage 5: Deploy with Docker Compose
# ------------------------------------------------------------------------------
stage "Docker Deployment"

mkdir -p data
if command -v docker >/dev/null 2>&1; then
  say "Starting container using docker compose..."
  docker compose up -d
  printf '\n  %s✔ Container started!%s\n' "$GREEN" "$RESET"
else
  warn "docker command not found. Run 'docker compose up -d' manually once installed."
fi

pause "Press Enter to view client connection details..."

# ------------------------------------------------------------------------------
# Stage 6: Client Configuration
# ------------------------------------------------------------------------------
stage "Connecting AI Clients"

printf '  %sYour LubeLogger MCP endpoint is ready!%s\n\n' "$GREEN" "$RESET"
say "Endpoint URL: ${PUBLIC_URL}/mcp"
say "Health check: http://127.0.0.1:${PORT}/healthz"
printf '\n'

say "• For Claude Desktop (claude_desktop_config.json):"
printf '%s' "$DIM"
cat << EOF
  "mcpServers": {
    "lubelogger": {
      "url": "${PUBLIC_URL}/mcp"
    }
  }
EOF
printf '%s\n' "$RESET"

say "• For Cursor / Google Gemini:"
say "  Add Custom MCP server with Server URL: ${PUBLIC_URL}/mcp"
say "  When prompted in your browser, paste your LubeLogger API Key to authorize."
printf '\n'
say "Setup complete! Enjoy managing your garage with AI."
printf '\n'
