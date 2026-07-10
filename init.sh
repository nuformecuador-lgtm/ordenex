#!/usr/bin/env bash
# init.sh — Verificacion e inicializacion del arnes (stack Node/Next/Supabase)
# Debe terminar en verde antes de que el agente empiece a trabajar.
set -euo pipefail

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
fail() { echo "${RED}✗ $1${NC}"; exit 1; }
ok()   { echo "${GREEN}✓ $1${NC}"; }
warn() { echo "${YELLOW}! $1${NC}"; }

echo "== Arnes SDD :: init =="

# 1. Herramientas base
command -v node >/dev/null 2>&1 || fail "node no esta instalado"
command -v pnpm >/dev/null 2>&1 || fail "pnpm no esta instalado. Instalalo con: npm i -g pnpm"
command -v jq   >/dev/null 2>&1 || warn "jq no esta instalado (recomendado para validar feature_list.json)"
ok "node $(node -v)"

# 2. Dependencias
if [ -f package.json ]; then
  if [ ! -d node_modules ]; then
    echo "Instalando dependencias..."
    pnpm install
  fi
  ok "dependencias presentes"
else
  warn "no hay package.json todavia (repo recien inicializado)"
fi

# 3. Candado LOCAL: una feature por zona en in_progress + ancla Jira.
#    Corre via node (garantizado en este repo) para NO depender de jq. La capa de
#    nube (Jira In Progress) la valida el leader en sesion (ver docs/jira-sync.md).
if [ -f feature_list.json ]; then
  if command -v node >/dev/null 2>&1; then
    node scripts/check-zone-lock.mjs || fail "candado local del arnes fallo (ver detalle arriba)"
  else
    warn "node no disponible: se omite el candado local (scripts/check-zone-lock.mjs)"
  fi

  # 4. Toda feature sdd que no este en pending debe tener su carpeta de specs.
  #    Check por-nombre, jq-gated y opcional. OJO: specs/ usa slugs (p.ej.
  #    '31-plantilla-xlsx'), no el .name de la feature -> este check puede dar
  #    falsos positivos hasta unificar el naming. Se mantiene como estaba.
  if command -v jq >/dev/null 2>&1; then
    MISSING=$(jq -r '.features[] | select(.sdd==true and .status!="pending") | .name' feature_list.json | while read -r f; do
      [ -f "specs/$f/requirements.md" ] || echo "$f"
    done)
    if [ -n "$MISSING" ]; then
      fail "faltan specs para features sdd ya iniciadas: $MISSING"
    fi
    ok "specs presentes para features sdd iniciadas"
  fi
fi

# 5. Calidad de codigo (si los scripts existen)
run_if() {
  if pnpm run --help >/dev/null 2>&1; then
    pnpm run | grep -q "^  $1" 2>/dev/null && { echo "-> pnpm run $1"; pnpm run "$1"; } || warn "script '$1' no definido, se omite"
  else
    warn "pnpm no disponible para correr script '$1'"
  fi
}

if [ -f package.json ]; then
  run_if typecheck
  run_if lint
  run_if test
fi

# 6. Migraciones: verificar que toda migracion tenga down.sql
MIGRATIONS_DIR="db/migrations"
if [ -d "$MIGRATIONS_DIR" ]; then
  MISSING_DOWN=""
  for MIG in "$MIGRATIONS_DIR"/*/; do
    [ -d "$MIG" ] || continue
    [ -f "$MIG/down.sql" ] || MISSING_DOWN="$MISSING_DOWN $(basename "$MIG")"
  done
  if [ -n "$MISSING_DOWN" ]; then
    warn "migraciones sin down.sql:$MISSING_DOWN"
  else
    ok "todas las migraciones tienen down.sql"
  fi
fi

# 7. Variables de entorno
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    warn "no hay .env. Crea uno a partir de .env.example"
  else
    warn "no hay .env ni .env.example"
  fi
else
  ok ".env presente"
fi

echo "${GREEN}== init OK ==${NC}"
echo "Siguiente: abre AGENTS.md y sigue el flujo desde ahi."
