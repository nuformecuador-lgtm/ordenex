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

# -------------------------------------------------------------------------------------------------
# EL MODO RAPIDO SE NIEGA SOLO CUANDO EL CAMBIO NO ES BARATO (2026-08-20)
# -------------------------------------------------------------------------------------------------
#
# Por que existe esto. Hasta hoy la regla era "el gate completo antes de CADA PR, sin excepcion", y
# se cumplia: mover un enlace de la nav de la landing costaba 16.346 tests y entre 5 y 11 minutos,
# cuando lo relacionado con ese cambio eran 21 tests + las guardias = ~33 segundos. La regla no
# distinguia un cambio de texto de una migracion, asi que cobraba lo mismo por los dos.
#
# Pero relajarla a secas abriria un agujero REAL, no teorico: `test:rapido` corre
# `vitest --changed origin/dev`, que selecciona por GRAFO DE IMPORTS y solo mira TU diff. Hay dos
# cosas que ese grafo no ve:
#
#   (a) lo que no se relaciona por imports  -> ya cubierto: las guardias corren SIEMPRE, y son
#       justo las que recorren el arbol de archivos en vez de importar lo que vigilan;
#   (b) el radio de explosion de un cambio que toca los CIMIENTOS -el esquema, los catalogos de
#       tipos compartidos, la configuracion de build, el dinero-. Ahi "los tests relacionados" es
#       una respuesta que suena bien y no lo es: el import de un enum lo tiene medio repo, y una
#       migracion no la importa nadie.
#
# Por eso el modo rapido MIRA TU DIFF y se niega si toca algo de la lista. No es un aviso que se
# pueda ignorar por prisa: es un `fail`. La salida es correr el gate completo, que es exactamente
# lo que esos cambios merecen.
#
# La lista se mantiene ESTRECHA a proposito -medido el 2026-08-20: los nombres de dinero son 190 de
# 1136 archivos de codigo, un 17 %-. Si crece hasta atrapar todo, vuelve el problema que esto viene
# a resolver.
# `init.sh` se vigila A SI MISMO: tocar el gate cambia LA MEDIDA con la que se mide todo lo demas,
# y un fallo aqui no se ve como un test rojo, se ve como un verde que no significa nada.
RUTAS_SENSIBLES='^db/migrations/|^db/schema\.prisma$|^lib/types/|^init\.sh$|^(package\.json|pnpm-lock\.yaml|tsconfig\.json|middleware\.ts|next\.config\.ts|vitest\.config\.ts|prisma\.config\.ts|eslint\.config\.mjs|\.env\.example)$'
NOMBRES_DE_DINERO='^(lib|app|components)/.*(cierre|tarifa|pago|wallet|liquidacion|ingreso|egreso|caja|comision|flete|moneda|cobro|factura|premio)'

exigir_completo_si_toca_lo_sensible() {
  git rev-parse --git-dir >/dev/null 2>&1 || { warn "no es un repo git: no se puede clasificar el cambio"; return 0; }
  local base
  base="$(git merge-base origin/dev HEAD 2>/dev/null || true)"
  if [ -z "$base" ]; then
    warn "sin 'origin/dev' a mano: no se puede clasificar el cambio. Si toca esquema, tipos, config o dinero, corre './init.sh' completo."
    return 0
  fi

  # El diff va contra la BASE COMUN y contra el arbol de trabajo a la vez: asi entra tanto lo ya
  # commiteado en la rama como lo que todavia no lo esta. Mirar solo una de las dos deja fuera la
  # mitad de los casos.
  local cambiados
  cambiados="$( { git diff --name-only "$base" -- . ; git ls-files --others --exclude-standard ; } | sort -u )"
  [ -n "$cambiados" ] || { warn "sin cambios frente a origin/dev: nada que clasificar"; return 0; }

  local sensibles
  sensibles="$(printf '%s
' "$cambiados" | grep -Ei "$RUTAS_SENSIBLES|$NOMBRES_DE_DINERO" || true)"

  if [ -n "$sensibles" ]; then
    echo "${YELLOW}Tu cambio toca cimientos, y para eso el modo rapido no alcanza:${NC}"
    printf '%s
' "$sensibles" | sed 's/^/    /'
    echo ""
    echo "  El modo rapido corre 'vitest --changed', que selecciona por grafo de IMPORTS."
    echo "  Una migracion no la importa nadie, y un tipo compartido lo importa medio repo:"
    echo "  en los dos casos 'los tests relacionados' no es la respuesta correcta."
    fail "esto exige el gate completo. Corre: ./init.sh"
  fi

  ok "el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta"
}

if [ -f package.json ]; then
  # La clasificacion va ANTES que typecheck y lint a proposito: si el cambio exige el gate
  # completo, decirlo despues de un minuto de espera seria cobrarte la espera dos veces.
  [ "$MODO" = "rapido" ] && exigir_completo_si_toca_lo_sensible
  run_if typecheck
  run_if lint
  if [ "$MODO" = "rapido" ]; then
    run_if test:rapido
    warn "modo rapido: solo los tests relacionados con tus cambios + las guardias."
    warn "El completo NO es opcional antes de una release a prod: ahi se corre './init.sh' a secas."
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
