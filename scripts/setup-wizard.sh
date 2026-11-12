#!/usr/bin/env bash
#
# Interactive setup & deployment wizard for lubelogger-mcp.
# Configures .env, downloads docker-compose.yml if missing, sets up OAuth redirect URIs
# for target AI agents, verifies LubeLogger connection, deploys via Docker Compose,
# and outputs client connection instructions.
#

set -euo pipefail

# Reopen stdin from /dev/tty if running via pipe (e.g. curl ... | bash)
if [[ ! -t 0 ]] && [[ -r /dev/tty ]]; then
  exec < /dev/tty
fi

# ──────────────────────────────────────────────────────────────────────────
# Wizard Library: High-contrast, legible UX
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); RESET=$(tput sgr0)
  # High-contrast palette: use bright cyan/sky-blue instead of dark navy blue
  CYAN=$(tput setaf 6); BLUE=$(tput setaf 6); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
  if [[ "$(tput colors 2>/dev/null || echo 0)" -ge 256 ]]; then
    DIM=$(tput setaf 250)
  else
    DIM=""
  fi
else
  BOLD=""; DIM=""; RESET=""; CYAN=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

TOTAL_STAGES=6
_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()

_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1 && tput clear 2>/dev/null; then return 0; fi
  printf '\033[2J\033[3J\033[H'
}

banner() {
  _clear
  printf '\n%s%s  🚗 %s%s\n' "$BOLD" "$CYAN" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  This wizard will guide you through configuring .env, testing your\n' "$DIM"
  printf '  connection to LubeLogger, configuring AI agents, deploying via Docker Compose,\n'
  printf '  and connecting your AI clients (Gemini, Claude, Cursor, ChatGPT, etc.).\n'
  printf '  Stop any time with Ctrl-C and re-run later (remembers saved values).%s\n\n' "$RESET"
  pause "Ready to start?"
}

stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n\n' \
    "$BOLD" "$CYAN" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

say()  { printf '  %s\n' "$1"; }
step() { printf '  %s•%s %s\n' "$CYAN" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }
err()  { printf '  %s✖ %s%s\n' "$RED" "$1" "$RESET"; }

open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview      >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open     >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open         >/dev/null 2>&1; then open "$url"
    else false; fi
  } >/dev/null 2>&1 || warn "Couldn't open browser automatically. Please visit: $url"
}

pause() {
  local prompt="${1:-Press Enter to continue}"
  printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  read -r _ || true
}

confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line value sq="'\\''"; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  value="${line#*=}"
  if [[ "$value" == \'*\' ]]; then value="${value:1:${#value}-2}"; value="${value//"$sq"/\'}"
  elif [[ "$value" == \"*\" ]]; then
    value="${value:1:${#value}-2}"
    [[ "$value" == *[\\\$\"]* ]] && return 1
  fi
  printf '%s' "$value"
}

ask() {
  local key="$1" prompt="$2" default_override="${3:-}" current input s=$'\001' e=$'\002' p rc=0
  current=$(_existing "$key" || true)
  [[ -n "$default_override" ]] && current="$default_override"
  p="  $s$BOLD$e$prompt$s$RESET$e "
  [[ -n "$current" ]] && p+="$s$CYAN$e[Enter keeps: $current]$s$RESET$e "
  read -e -r -p "$p" input || rc=1
  if (( rc )) && [[ -z "$input" ]]; then return 1; fi
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

ask_secret() {
  local key="$1" prompt="$2" current input rc=0
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current secret]%s ' "$BOLD" "$prompt" "$RESET" "$CYAN" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || rc=1
  printf '\n'
  if (( rc )) && [[ -z "$input" ]]; then return 1; fi
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

write_env() {
  local key="$1" value="$2" tmp sq="'\\''"
  [[ -e "$ENV_FILE" ]] || (umask 077 && : > "$ENV_FILE")
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf "%s='%s'\n" "$key" "${value//\'/$sq}" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
  printf -v "$key" '%s' "$value"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ saved%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

finish() {
  _clear
  printf '\n%s%s  ✓ Setup complete!%s\n\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} )) && note "Saved ${#WRITTEN_ENV[@]} configuration value(s) in $ENV_FILE"
  printf '\n%sContainer status & next steps:%s\n' "$BOLD" "$RESET"
  say "1. View logs:      docker compose logs -f lubelogger-mcp"
  say "2. Restart:        docker compose restart lubelogger-mcp"
  say "3. Verify local:   curl -fsS http://127.0.0.1:${PORT:-3000}/healthz"
  say "4. Verify public:  curl -fsS ${PUBLIC_URL}/healthz"
  say "5. Connect AI:     Add MCP server URL ${PUBLIC_URL}/mcp"
  printf '\n'
}

join_by() {
  local delim="$1"; shift; local first_item="${1:-}"; shift || true
  if [[ -z "$first_item" ]]; then return 0; fi
  printf '%s' "$first_item" "${@/#/$delim}"
}

parse_agent_selection() {
  local raw="$1"
  local clean
  clean=$(printf '%s' "$raw" | tr ',' ' ' | tr '[:upper:]' '[:lower:]')

  SELECTED_GEMINI=0
  SELECTED_CLAUDE=0
  SELECTED_CURSOR=0
  SELECTED_CHATGPT=0
  SELECTED_CUSTOM=0

  if [[ " $clean " =~ [[:space:]]all[[:space:]] ]]; then
    SELECTED_GEMINI=1
    SELECTED_CLAUDE=1
    SELECTED_CURSOR=1
    SELECTED_CHATGPT=1
    SELECTED_CUSTOM=1
    return 0
  fi

  for token in $clean; do
    case "$token" in
      1|gemini|google)
        SELECTED_GEMINI=1
        ;;
      2|claude|anthropic)
        SELECTED_CLAUDE=1
        ;;
      3|cursor)
        SELECTED_CURSOR=1
        ;;
      4|chatgpt|openai|gpt)
        SELECTED_CHATGPT=1
        ;;
      5|custom|other)
        SELECTED_CUSTOM=1
        ;;
      *)
        return 1
        ;;
    esac
  done

  if (( SELECTED_GEMINI == 0 && SELECTED_CLAUDE == 0 && SELECTED_CURSOR == 0 && SELECTED_CHATGPT == 0 && SELECTED_CUSTOM == 0 )); then
    return 1
  fi
  return 0
}

# ──────────────────────────────────────────────────────────────────────────
# Wizard Execution Flow
# ──────────────────────────────────────────────────────────────────────────

run_wizard() {

banner "LubeLogger MCP Setup & Deployment Wizard"

# Ensure data directory and docker-compose.yml exist in current working directory
mkdir -p data
if [[ ! -f "docker-compose.yml" ]]; then
  DOCKER_COMPOSE_URL="https://raw.githubusercontent.com/PedroLiu1999/lubelogger-mcp/main/docker-compose.yml"
  printf '  %s• Downloading docker-compose.yml from GitHub...%s\n' "$CYAN" "$RESET"
  if curl -fsSL "$DOCKER_COMPOSE_URL" -o docker-compose.yml; then
    printf '  %s✓ Saved docker-compose.yml%s\n\n' "$GREEN" "$RESET"
  else
    warn "Failed to download docker-compose.yml from $DOCKER_COMPOSE_URL. You can download it manually."
  fi
fi

# ── Stage 1: Public Domain & Port ──────────────────────────────────────────
stage "Public Domain & Local Port"
say "lubelogger-mcp will be exposed over your Cloudflare Tunnel (or reverse proxy)."
say "Enter the full public HTTPS URL configured in your Cloudflare Zero Trust tunnel."
note "Example: https://lubelogger-mcp.yourdomain.com"
printf '\n'

ask PUBLIC_URL "Public HTTPS URL (no trailing slash):"
while [[ -z "$PUBLIC_URL" || "$PUBLIC_URL" != https://* ]]; do
  warn "PUBLIC_URL must start with https:// (e.g. https://lubelogger-mcp.yourdomain.com)"
  ask PUBLIC_URL "Public HTTPS URL (no trailing slash):"
done
PUBLIC_URL="${PUBLIC_URL%/}"
write_env PUBLIC_URL "$PUBLIC_URL"

printf '\n'
say "Select the local host port where lubelogger-mcp should listen (default: 3000)."
ask PORT "Local host port:" "3000"
PORT="${PORT:-3000}"
write_env PORT "$PORT"

# Ensure DATA_DIR is configured
write_env DATA_DIR "/data"

# ── Stage 2: Target AI Clients & Return URLs ───────────────────────────────
stage "Target AI Clients & OAuth Return URLs"
say "Select which AI clients / agents you plan to connect with LubeLogger."
say "The wizard will configure the exact OAuth redirect return URLs needed for each client."
printf '\n'
say "Available AI client presets:"
say "  1) Google Gemini (Web Connected Apps, Developer Mode, Vertex AI)"
say "  2) Claude (Claude Desktop, Claude Code CLI, Claude Web)"
say "  3) Cursor (Cursor IDE)"
say "  4) ChatGPT / OpenAI (Custom GPTs / Actions)"
say "  5) Custom / Other MCP Client"
printf '\n'

CURRENT_AGENTS=$(_existing "AI_AGENTS" || true)
DEFAULT_SELECTION="1, 2, 3"
if [[ -n "$CURRENT_AGENTS" ]]; then
  DEFAULT_NUMS=()
  [[ "$CURRENT_AGENTS" == *"gemini"* ]] && DEFAULT_NUMS+=("1")
  [[ "$CURRENT_AGENTS" == *"claude"* ]] && DEFAULT_NUMS+=("2")
  [[ "$CURRENT_AGENTS" == *"cursor"* ]] && DEFAULT_NUMS+=("3")
  [[ "$CURRENT_AGENTS" == *"chatgpt"* ]] && DEFAULT_NUMS+=("4")
  [[ "$CURRENT_AGENTS" == *"custom"* ]] && DEFAULT_NUMS+=("5")
  if (( ${#DEFAULT_NUMS[@]} > 0 )); then
    DEFAULT_SELECTION=$(join_by ", " "${DEFAULT_NUMS[@]}")
  fi
elif [[ -n "$(_existing 'OAUTH_ALLOWED_REDIRECT_URIS' || true)" ]]; then
  EXISTING_REDIRECTS=$(_existing "OAUTH_ALLOWED_REDIRECT_URIS" || true)
  DEFAULT_NUMS=()
  is_loopback_only=1
  IFS=',' read -ra existing_parts <<< "$EXISTING_REDIRECTS"
  for part in "${existing_parts[@]}"; do
    clean_part=$(printf '%s' "$part" | tr -d ' ')
    if [[ "$clean_part" != "http://localhost"* && "$clean_part" != "http://127.0.0.1"* && -n "$clean_part" ]]; then
      is_loopback_only=0
      break
    fi
  done

  if (( is_loopback_only )); then
    DEFAULT_NUMS=("1" "2" "3")
  else
    if [[ "$EXISTING_REDIRECTS" == *"googleusercontent"* || "$EXISTING_REDIRECTS" == *"vertexaisearch"* ]]; then
      DEFAULT_NUMS+=("1")
    fi
    if [[ "$EXISTING_REDIRECTS" == *"localhost"* || "$EXISTING_REDIRECTS" == *"127.0.0.1"* || "$EXISTING_REDIRECTS" == *"claude"* ]]; then
      DEFAULT_NUMS+=("2" "3")
    fi
    if [[ "$EXISTING_REDIRECTS" == *"chatgpt"* || "$EXISTING_REDIRECTS" == *"openai"* ]]; then
      DEFAULT_NUMS+=("4")
    fi
  fi
  if (( ${#DEFAULT_NUMS[@]} > 0 )); then
    DEFAULT_SELECTION=$(join_by ", " "${DEFAULT_NUMS[@]}")
  fi
fi

ask AGENT_CHOICES "AI Clients to set up (numbers, 'all', or names):" "$DEFAULT_SELECTION"
while ! parse_agent_selection "$AGENT_CHOICES"; do
  warn "Invalid selection '$AGENT_CHOICES'. Enter numbers (e.g. 1, 2, 3), 'all', or names."
  ask AGENT_CHOICES "AI Clients to set up (numbers, 'all', or names):" "$DEFAULT_SELECTION"
done

SELECTED_NAMES=()
SELECTED_KEYS=()
REDIRECT_URIS=("http://localhost" "http://127.0.0.1")

if (( SELECTED_GEMINI )); then
  SELECTED_NAMES+=("Google Gemini")
  SELECTED_KEYS+=("gemini")
  REDIRECT_URIS+=("https://oauth-redirect.googleusercontent.com/r/")
  REDIRECT_URIS+=("https://oauth-redirect.googleusercontent.com/a/")
  REDIRECT_URIS+=("https://oauth-redirect-sandbox.googleusercontent.com/r/")
  REDIRECT_URIS+=("https://oauth-redirect-sandbox.googleusercontent.com/a/")
  REDIRECT_URIS+=("https://oauth-redirect-test.googleusercontent.com/r/")
  REDIRECT_URIS+=("https://oauth-redirect-test.googleusercontent.com/a/")
  REDIRECT_URIS+=("https://vertexaisearch.cloud.google.com/oauth-redirect")
fi

if (( SELECTED_CLAUDE )); then
  SELECTED_NAMES+=("Claude")
  SELECTED_KEYS+=("claude")
  REDIRECT_URIS+=("https://claude.ai/api/mcp/auth_callback")
fi

if (( SELECTED_CURSOR )); then
  SELECTED_NAMES+=("Cursor")
  SELECTED_KEYS+=("cursor")
fi

if (( SELECTED_CHATGPT )); then
  SELECTED_NAMES+=("ChatGPT / OpenAI")
  SELECTED_KEYS+=("chatgpt")
  REDIRECT_URIS+=("https://chatgpt.com/aip/")
  REDIRECT_URIS+=("https://chat.openai.com/aip/")
  printf '\n'
  say "OpenAI Custom GPTs use return URLs like: https://chatgpt.com/aip/g-<id>/oauth/callback"
  if confirm "Do you have a specific OpenAI Custom GPT redirect URI to add?"; then
    ask CHATGPT_SPECIFIC_URI "Paste full Custom GPT redirect URI (must start with https://):"
    while [[ -n "$CHATGPT_SPECIFIC_URI" && "$CHATGPT_SPECIFIC_URI" != https://* ]]; do
      warn "Redirect URI must start with https://"
      ask CHATGPT_SPECIFIC_URI "Paste full Custom GPT redirect URI (must start with https://):"
    done
    if [[ -n "$CHATGPT_SPECIFIC_URI" ]]; then
      REDIRECT_URIS+=("$CHATGPT_SPECIFIC_URI")
    fi
  fi
fi

if (( SELECTED_CUSTOM )); then
  SELECTED_NAMES+=("Custom / Other")
  SELECTED_KEYS+=("custom")
  printf '\n'
  if confirm "Do you have an additional custom HTTPS OAuth redirect URI to add?"; then
    ask CUSTOM_URI "Custom OAuth redirect URI (must start with https://):"
    while [[ -n "$CUSTOM_URI" && "$CUSTOM_URI" != https://* ]]; do
      warn "Redirect URI must start with https://"
      ask CUSTOM_URI "Custom OAuth redirect URI (must start with https://):"
    done
    if [[ -n "$CUSTOM_URI" ]]; then
      REDIRECT_URIS+=("$CUSTOM_URI")
    fi
  fi
fi

# Deduplicate redirect URIs
DEDUP_URIS=()
for uri in "${REDIRECT_URIS[@]}"; do
  already_present=0
  for existing_u in "${DEDUP_URIS[@]}"; do
    if [[ "$existing_u" == "$uri" ]]; then
      already_present=1
      break
    fi
  done
  if (( ! already_present )); then
    DEDUP_URIS+=("$uri")
  fi
done

OAUTH_ALLOWED_REDIRECT_URIS=$(join_by "," "${DEDUP_URIS[@]}")
AI_AGENTS=$(join_by "," "${SELECTED_KEYS[@]}")

printf '\n'
say "${BOLD}Selected AI Clients:${RESET} $(join_by ", " "${SELECTED_NAMES[@]}")"
say "Configured OAuth Redirect URIs based on your selection:"
for u in "${DEDUP_URIS[@]}"; do
  note "  • $u"
done
printf '\n'

if confirm "Customize or add more redirect URIs manually?"; then
  ask OAUTH_ALLOWED_REDIRECT_URIS "Allowed Redirect URIs:" "$OAUTH_ALLOWED_REDIRECT_URIS"
fi

write_env AI_AGENTS "$AI_AGENTS"
write_env OAUTH_ALLOWED_REDIRECT_URIS "$OAUTH_ALLOWED_REDIRECT_URIS"

# ── Stage 3: LubeLogger Server & Authentication ───────────────────────────
stage "LubeLogger Server & Authentication"
say "Specify your self-hosted LubeLogger instance URL."
note "If running in Docker on the same VPS, use http://host.docker.internal:8383."
printf '\n'

ask LUBELOGGER_URL "LubeLogger URL:" "http://host.docker.internal:8383"
while [[ -z "$LUBELOGGER_URL" ]]; do
  warn "LUBELOGGER_URL is required."
  ask LUBELOGGER_URL "LubeLogger URL:" "http://host.docker.internal:8383"
done
LUBELOGGER_URL="${LUBELOGGER_URL%/}"
write_env LUBELOGGER_URL "$LUBELOGGER_URL"

printf '\n'
say "Authentication Mode:"
say "  1) Dynamic Authentication (Recommended: users approve via browser with their LubeLogger API Key on /authorize; zero secrets stored in .env)"
say "  2) Server-wide API Key (shared key stored in .env)"
say "  3) Server-wide Basic Authentication (shared username & password stored in .env)"
ask AUTH_CHOICE "Select mode [1, 2, or 3]:" "1"

if [[ "$AUTH_CHOICE" == "2" ]]; then
  ask LUBELOGGER_API_KEY "LubeLogger API Key:"
  while [[ -z "$LUBELOGGER_API_KEY" ]]; do
    warn "API Key cannot be empty in static mode."
    ask LUBELOGGER_API_KEY "LubeLogger API Key:"
  done
  write_env LUBELOGGER_API_KEY "$LUBELOGGER_API_KEY"
elif [[ "$AUTH_CHOICE" == "3" ]]; then
  ask LUBELOGGER_USERNAME "LubeLogger Username:" "admin"
  ask_secret LUBELOGGER_PASSWORD "LubeLogger Password:"
  while [[ -z "$LUBELOGGER_PASSWORD" ]]; do
    warn "Password cannot be empty in Basic Auth mode."
    ask_secret LUBELOGGER_PASSWORD "LubeLogger Password:"
  done
  write_env LUBELOGGER_USERNAME "$LUBELOGGER_USERNAME"
  write_env LUBELOGGER_PASSWORD "$LUBELOGGER_PASSWORD"
else
  note "Using dynamic authentication: zero secrets stored in .env."
fi

write_env CACHE_TTL_SECONDS "30"

# ── Stage 4: Connection Verification ──────────────────────────────────────
stage "Connection Verification"
say "Testing connectivity to LubeLogger..."
TEST_URL="${LUBELOGGER_URL}/api/version"
if [[ "$LUBELOGGER_URL" =~ host.docker.internal ]]; then
  TEST_URL="${TEST_URL//host.docker.internal/127.0.0.1}"
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$TEST_URL" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "401" || "$HTTP_CODE" == "403" ]]; then
  printf '  %s✔ Reached LubeLogger server (HTTP %s)%s\n' "$GREEN" "$HTTP_CODE" "$RESET"
else
  warn "Could not verify connection to $TEST_URL (HTTP $HTTP_CODE)."
  note "If LubeLogger is in another Docker container, ensure host.docker.internal is reachable."
fi

printf '\n'
pause "Press Enter to proceed to deployment..."

# ── Stage 5: Cloudflare Tunnel & Docker Startup ───────────────────────────
stage "Cloudflare Tunnel & Docker Startup"
say "Configuration has been saved to $ENV_FILE."
printf '\n'
step "Cloudflare Tunnel routing check:"
say "  In Cloudflare Zero Trust (or your VPS cloudflared config.yml):"
say "  Point hostname: ${PUBLIC_URL#https://}"
say "  To service:     http://localhost:${PORT:-3000}"
printf '\n'

step "Starting container:"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  if confirm "Start lubelogger-mcp container with Docker Compose now?"; then
    say "Pulling pre-built container image and starting..."
    docker compose pull && docker compose up -d || warn "Docker startup encountered an error. Check 'docker compose logs'."
  else
    say "Skipped. You can start it later with: docker compose pull && docker compose up -d"
  fi
else
  warn "docker or docker compose not detected on PATH. Start later with: docker compose pull && docker compose up -d"
fi
printf '\n'
pause "Press Enter after you have started the container and Cloudflare Tunnel"

say "Testing health endpoint locally and publicly..."
if curl -fsS "http://127.0.0.1:${PORT:-3000}/healthz" >/dev/null 2>&1; then
  printf '  %s✓ Local healthcheck passed:%s http://127.0.0.1:%s/healthz\n' "$GREEN" "$RESET" "${PORT:-3000}"
else
  warn "Local healthcheck at http://127.0.0.1:${PORT:-3000}/healthz did not respond yet."
fi

if curl -fsS "${PUBLIC_URL}/healthz" >/dev/null 2>&1; then
  printf '  %s✓ Public healthcheck passed:%s %s/healthz\n' "$GREEN" "$RESET" "$PUBLIC_URL"
else
  warn "Public URL ${PUBLIC_URL}/healthz not reachable yet. Check your Cloudflare Tunnel route."
fi
printf '\n'
pause "Press Enter to continue to AI client connection details"

# ── Stage 6: Connect your AI Client(s) ────────────────────────────────────
stage "Connect your AI Client(s)"
say "Your LubeLogger MCP server is running and ready to connect."
printf '\n'
say "${BOLD}──────────────── Copy & Paste into Your Client ────────────────${RESET}"
say "  ${CYAN}MCP Server URL:${RESET}        ${PUBLIC_URL}/mcp"
say "  ${CYAN}OAuth Authentication:${RESET}  OAuth 2.1 (PKCE, public client)"
say "  ${CYAN}Authorization URL:${RESET}     ${PUBLIC_URL}/authorize"
say "  ${CYAN}Token URL:${RESET}             ${PUBLIC_URL}/token"
say "${BOLD}────────────────────────────────────────────────────────────────${RESET}"
printf '\n'
say "Consent approval workflow:"
step "1. When connecting, your client opens: ${PUBLIC_URL}/authorize"
step "2. Paste your LubeLogger API Key to approve the connection."
step "3. Your client completes authentication with zero passwords stored in the server!"
printf '\n'

# Display tailored instructions for selected agents
if [[ "${AI_AGENTS:-}" == *"gemini"* || "${SELECTED_GEMINI:-0}" == "1" ]]; then
  say "${BOLD}▸ Google Gemini Setup Instructions:${RESET}"
  step "Open Google Gemini in your browser: https://gemini.google.com"
  step "Go to Settings > Connected Apps / Extensions (or Developer Mode)."
  step "Click 'Connect to an MCP server' (or 'Add custom app')."
  step "Enter your Server URL (only field required):"
  say "    ${CYAN}${PUBLIC_URL}/mcp${RESET}"
  note "    Gemini automatically discovers OAuth metadata and vehicle maintenance tools."
  step "Click Connect. In the popup tab at ${PUBLIC_URL}/authorize, paste your LubeLogger API Key."
  printf '\n'
fi

if [[ "${AI_AGENTS:-}" == *"claude"* || "${SELECTED_CLAUDE:-0}" == "1" ]]; then
  say "${BOLD}▸ Claude Setup Instructions (Desktop & CLI):${RESET}"
  step "For Claude Desktop:"
  say "  Add lubelogger to your claude_desktop_config.json:"
  printf '    %s{\n' "$CYAN"
  printf '      "mcpServers": {\n'
  printf '        "lubelogger": {\n'
  printf '          "url": "%s/mcp"\n' "${PUBLIC_URL}"
  printf '        }\n'
  printf '      }\n'
  printf '    }%s\n' "$RESET"
  note "  Config file locations:"
  note "    • macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json"
  note "    • Windows: %APPDATA%\\Claude\\claude_desktop_config.json"
  note "    • Linux:   ~/.config/Claude/claude_desktop_config.json"
  step "For Claude Code (CLI):"
  say "  Run: claude mcp add lubelogger ${PUBLIC_URL}/mcp"
  step "Start Claude. It will open ${PUBLIC_URL}/authorize in your browser."
  step "Paste your LubeLogger API Key to grant access."
  printf '\n'
fi

if [[ "${AI_AGENTS:-}" == *"cursor"* || "${SELECTED_CURSOR:-0}" == "1" ]]; then
  say "${BOLD}▸ Cursor Setup Instructions:${RESET}"
  step "Open Cursor Settings > Features > MCP (or Settings > MCP Servers)."
  step "Click '+ Add New MCP Server'."
  step "Configure:"
  say "    • Name: lubelogger"
  say "    • Type: sse or http"
  say "    • URL:  ${PUBLIC_URL}/mcp"
  step "Click Connect. When your browser opens, paste your LubeLogger API Key."
  printf '\n'
fi

if [[ "${AI_AGENTS:-}" == *"chatgpt"* || "${SELECTED_CHATGPT:-0}" == "1" ]]; then
  say "${BOLD}▸ ChatGPT / OpenAI (Custom GPT) Setup Instructions:${RESET}"
  step "In ChatGPT, navigate to Explore GPTs > Create a GPT > Configure > Actions."
  step "Create an Action pointing to: ${PUBLIC_URL}/mcp"
  step "Under Authentication, choose OAuth:"
  say "    • Authorization URL: ${PUBLIC_URL}/authorize"
  say "    • Token URL:         ${PUBLIC_URL}/token"
  say "    • Scope:             mcp:tools"
  step "When running the action in chat, click Authorize and paste your LubeLogger API Key."
  printf '\n'
fi

if [[ "${AI_AGENTS:-}" == *"custom"* || "${SELECTED_CUSTOM:-0}" == "1" ]]; then
  say "${BOLD}▸ Custom MCP Client Instructions:${RESET}"
  step "MCP Server URL:          ${PUBLIC_URL}/mcp"
  step "Transport:               Streamable HTTP (JSON-RPC over POST /mcp)"
  step "Protected Resource Doc:  ${PUBLIC_URL}/.well-known/oauth-protected-resource"
  step "Auth Server Metadata:    ${PUBLIC_URL}/.well-known/oauth-authorization-server"
  step "Auth Flow:               Authorization Code with PKCE (S256)"
  printf '\n'
fi

pause "Press Enter once you have connected your client(s)"

finish
}

run_wizard "$@"; exit
