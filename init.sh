#!/usr/bin/env bash
# init.sh — Verificacion e inicializacion del arnes (stack Node/Next/Supabase)
# Debe terminar en verde antes de que el agente empiece a trabajar.
set -euo pipefail

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
fail() { echo "${RED}✗ $1${NC}"; exit 1; }
ok()   { echo "${GREEN}✓ $1${NC}"; }
warn() { echo "${YELLOW}! $1${NC}"; }

# MODO DEL GATE (2026-08-03). `--rapido` existe porque la suite completa son ~10.000 tests y
# ~4 minutos: correrla al cerrar CADA tanda convertia el arnes en una sala de espera (9 tandas
# de una feature = ~35 min de reloj solo esperando). En modo rapido se corre lo que el GRAFO DE
# IMPORTS relaciona con lo que has tocado, MAS todas las guardias.
#
# Las guardias van SIEMPRE y no es un adorno: recorren el arbol de archivos (censo de tablas,
# barridos de columnas sensibles, modulos puros) en vez de importar lo que vigilan, asi que
# NINGUN grafo de imports las selecciona. Son justo las que se perderian. Cuestan ~8s.
#
# `--rapido` NO sustituye al gate completo: es para cerrar tandas. Antes de abrir un PR se corre
# `./init.sh` a secas. La leccion de los PRs #209 y #237 de este repo sigue en pie -se mergeo
# mirando el estado del PR, que es un build y NO corre tests, y entro un guard rojo en `dev`-.
MODO="completo"
if [ "${1:-}" = "--rapido" ]; then
  MODO="rapido"
elif [ -n "${1:-}" ]; then
  echo "uso: ./init.sh [--rapido]"; exit 2
fi

echo "== Arnes SDD :: init (modo: $MODO) =="

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

# 3. Regla: maximo 2 features in_progress por zona (frontend / backend / fullstack).
#    Antes era 1; el humano lo subio a 2 (2026-07-22) para permitir dos peticiones
#    concurrentes por zona. Coincide con CLAUDE.md regla 1 y AGENTS.md Paralelismo.
if command -v jq >/dev/null 2>&1 && [ -f feature_list.json ]; then
  IN_PROGRESS_COUNT=$(jq '[.features[] | select(.status=="in_progress")] | length' feature_list.json)
  if [ "$IN_PROGRESS_COUNT" -gt 0 ]; then
    OVER_LIMIT=$(jq -r '
      [.features[] | select(.status=="in_progress" and .zone != null)]
      | group_by(.zone)
      | map(select(length > 2))[]
      | "\(.[0].zone): \(map(.id|tostring) | join(", ")) (\(length) in_progress, max 2)"
    ' feature_list.json)
    if [ -n "$OVER_LIMIT" ]; then
      fail "mas de 2 features in_progress en la misma zona: $OVER_LIMIT"
    fi
  fi
  ok "regla max-2-por-zona respetada (in_progress=$IN_PROGRESS_COUNT)"

  # 4. Toda feature sdd EN VUELO (spec_ready o in_progress) debe tener su carpeta
  #    de specs. Se acota a "en vuelo" a proposito: las `done` tempranas (1-16) son
  #    previas a la convencion de specs y no tienen carpeta, e incluirlas dejaba el
  #    gate permanentemente rojo; `pending`/`cancelled` no la necesitan aun/ya.
  #    La carpeta se resuelve por `spec_path` explicito o, si no, por glob
  #    `specs/<id>-*` (convencion real `<id>-<slug>`), NO por `.name` (el bug previo:
  #    `.name` no matchea el slug de la carpeta, p.ej. name "login" vs specs/1-login).
  MISSING=$(jq -r '
    .features[]
    | select(.sdd==true and (.status=="spec_ready" or .status=="in_progress"))
    | "\(.id)\t\(.spec_path // "")"
  ' feature_list.json | while IFS=$'\t' read -r id spath; do
    if [ -n "$spath" ] && [ -f "$spath/requirements.md" ]; then
      continue
    fi
    found=""
    for d in specs/"$id"-*/; do
      [ -f "${d}requirements.md" ] && { found=1; break; }
    done
    [ -n "$found" ] || echo "$id"
  done)
  if [ -n "$MISSING" ]; then
    fail "faltan specs para features sdd en vuelo (por id): $MISSING"
  fi
  ok "specs presentes para features sdd en vuelo"
fi

# 5. Calidad de codigo (si los scripts existen)
# Distingue TRES casos que no son lo mismo: (a) pnpm ausente, (b) script no definido
# en package.json -> se omite, (c) el script CORRIO Y FALLO -> rojo, corta el init.
#
# La version previa los confundia: `pnpm run | grep -q ... && { ...; pnpm run "$1"; }
# || warn "no definido"`. Si el script fallaba, el grupo `&&` devolvia no-cero, se
# ejecutaba la rama `||` y reportaba "script no definido, se omite" -> la funcion
# terminaba en `warn` (exit 0), `set -e` no disparaba e init.sh llegaba a "init OK"
# con la suite roja. El gate del que depende la regla #5 del CLAUDE.md mentia.
run_if() {
  if ! pnpm run --help >/dev/null 2>&1; then
    warn "pnpm no disponible para correr script '$1'"
    return 0
  fi
  if ! pnpm run 2>/dev/null | grep -q "^  $1"; then
    warn "script '$1' no definido, se omite"
    return 0
  fi
  echo "-> pnpm run $1"
  pnpm run "$1" || fail "'pnpm run $1' fallo"
  ok "$1 paso"
}

if [ -f package.json ]; then
  run_if typecheck
  run_if lint
  if [ "$MODO" = "rapido" ]; then
    run_if test:rapido
    warn "modo rapido: solo los tests relacionados con tus cambios + las guardias."
    warn "Antes de abrir el PR corre './init.sh' sin flags."
  else
    run_if test
  fi
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
