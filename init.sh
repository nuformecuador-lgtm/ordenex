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
if [ -f feature_list.json ]; then
  # EN NODE, NO EN jq (2026-08-28). Este bloque colgaba de `if command -v jq`, y `jq` es
  # OPCIONAL aqui: su ausencia era un `warn`. En una maquina sin `jq` -como la del humano- se
  # saltaba ENTERO y en silencio, asi que NO se comprobaba ni la regla 1 de CLAUDE.md (max 2
  # `in_progress` por zona, marcada NO NEGOCIABLE) ni la correspondencia ficha<->spec. Un check
  # que no corre es peor que uno que no existe: crees que te cubre.
  #
  # Ademas se anade lo que NUNCA existio: IDS DUPLICADOS. La ficha 311 se renumero TRES veces
  # (294 -> 299 -> 308 -> 311) porque otra sesion tomo cada id mientras se trabajaba, y las tres
  # las cazo una lectura humana, no el gate. Coste medido: ~75 min en una sola feature.
  #
  # `node` SI es requisito duro (se comprueba arriba con `fail`), asi que esto corre SIEMPRE.
  # El detalle de los errores lo escribe el script en STDERR, que ya se ve; `$(...)` solo
  # captura STDOUT, donde el script pone el resumen del caso verde. Interpolar la captura en
  # el mensaje de fallo dejaba un "invalido:" seguido de nada.
  VALIDACION=$(node scripts/validar-feature-list.mjs)     || fail "feature_list.json invalido (el detalle esta justo arriba)"
  ok "feature_list.json: $VALIDACION"
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
#
# `tests/fixtures/sin-comentarios.ts` entra por ESE MISMO argumento (feature 283, 2026-08-25). Es
# el quitador de comentarios con el que **171 suites** leen el arbol -134 archivos lo importan
# directamente, 128 de ellos de test, y el resto llega por money-safe, deteccion-maqueta,
# css-reglas, contraste, etiquetas-datatable, aserciones-de-orden, montajes-componente y
# _arbol-de-la-feature; re-medido el 2026-08-25-: ninguna de ellas ejecuta el
# codigo que vigila, todas lo ESCANEAN, y todas lo escanean a traves de este archivo. Si el
# quitador mide de menos, las guardias afirman sobre un texto al que le falta codigo y **no se
# ponen rojas: se ponen verdes**. Es literalmente lo que paso -1.387 lineas de codigo invisibles en
# 64 archivos, medidas el 2026-08-25- y lo que la 283 vino a cerrar. El grafo de imports tampoco
# ayuda aqui: `vitest --changed` SI seleccionaria las suites que lo importan, pero el radio real
# del cambio no es «quien lo importa» sino «quien mide con el», que es todo el arbol.
RUTAS_SENSIBLES='^db/migrations/|^db/schema\.prisma$|^lib/types/|^init\.sh$|^tests/fixtures/sin-comentarios\.ts$|^(package\.json|pnpm-lock\.yaml|tsconfig\.json|middleware\.ts|next\.config\.ts|vitest\.config\.ts|prisma\.config\.ts|eslint\.config\.mjs|\.env\.example)$'
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
  # -----------------------------------------------------------------------------------------
  # EL VEREDICTO DE LOS TESTS LO DA EL BASELINE, Y EN LOS DOS MODOS (ficha 318, 2026-08-28)
  # -----------------------------------------------------------------------------------------
  #
  # POR QUE LA COMPARACION VIVE AQUI, FUERA DEL `if $MODO`. Nacio dentro de la rama del gate
  # completo (2026-08-28) y el modo rapido se quedo sin ella: corria `test:rapido` y terminaba.
  # Como `dev` arrastra deuda ajena -hoy `superficie-de-uso.guardia`-, eso hacia que
  # el modo rapido terminara en rojo EN CUALQUIER RAMA Y PASE LO QUE PASE. Se lo comieron cinco
  # agentes seguidos (fichas 309, 308, 315, 317 y 313), y los cinco tuvieron que razonar A MANO
  # cual de los rojos era suyo, que es exactamente lo que el baseline vino a evitar. Y no es un
  # modo secundario: la regla 5 de CLAUDE.md lo declara "el gate normal, tambien para abrir un
  # PR". El dano real no es la molestia: un gate que termina en rojo SIEMPRE entrena a leer el
  # rojo como ruido, y el dia que el rojo sea propio nadie lo mirara dos veces.
  #
  # Por eso el `if` de abajo decide UNA sola cosa -que suite corre y donde deja su reporte- y
  # el veredicto se calcula una vez, aqui, con una unica llamada. Una segunda copia de la
  # comparacion dentro de cada rama seria mas facil de escribir y divergiria: la primera vez
  # que alguien afinara el criterio, lo afinaria en una sola de las dos y la otra mentiria.
  #
  # La suite corre igual y no se oculta ni un rojo de la consola; lo que cambia es QUIEN dicta
  # el veredicto: la comparacion por ARCHIVO contra `tests/baseline-rojos.json`. Verde si no
  # aparece ningun archivo que antes no fallara. El `|| true` es deliberado -- que la suite
  # termine en rojo ya no decide nada por si solo, y sin el `set -e` cortaria aqui. Antes esto
  # era `run_if test`, que fallaba siempre y obligaba a comparar a mano contra un numero que
  # viajaba por chat: en la ficha 311 paso OCHO veces, y una se concluyo mal.
  #
  # SE BORRAN LOS REPORTES ANTES DE CORRER. Si una corrida se cae sin escribir el suyo, el de
  # la corrida ANTERIOR sigue en disco y la comparacion dictaminaria sobre una foto vieja. Un
  # gate que da un veredicto sobre datos de ayer es peor que uno que falla.
  rm -f .vitest/rojos.json .vitest/rojos-cambiados.json .vitest/rojos-guardias.json

  if [ "$MODO" = "rapido" ]; then
    # LAS DOS CORRIDAS VAN SIEMPRE, cada una con su `|| true`, y NO se usa `pnpm run
    # test:rapido`: ese script encadena las dos con `&&`, asi que un rojo en la primera se
    # lleva por delante a las guardias. Mientras el veredicto lo daba el exit code daba igual
    # -rojo es rojo-, pero con el baseline decidiendo se vuelve peligroso al reves: un rojo YA
    # CONOCIDO en `--changed` saltaria las guardias y el gate saldria VERDE sin haberlas
    # corrido, justo las que "van SIEMPRE" porque ningun grafo de imports las selecciona.
    # Se separan aqui, en bash, y no con `;` dentro del script de package.json, porque los
    # scripts de npm corren en `cmd.exe` en Windows, donde `;` no separa comandos.
    #
    # Y se llama a los scripts EXISTENTES anadiendoles el reporter, en vez de crear un
    # `test:*:json` por cada uno. Dos razones: la primera es que QUE se selecciona sigue
    # definido en un solo sitio -`test:cambiados` y `test:guardias`-, y no hay una copia que
    # se pueda quedar atras cuando alguien afine la seleccion. La segunda esta MEDIDA hoy:
    # tocar `package.json` hace que `--changed` seleccione 1550 archivos de test -- la suite
    # entera-, frente a 0 sin el. Anadir ahi dos entradas cuyo unico llamador es este archivo
    # habria metido al gate en su propia lista de cimientos a cambio de nada.
    echo "-> pnpm run test:cambiados (con reporte JSON)"
    pnpm run test:cambiados --reporter=default --reporter=json --outputFile.json=.vitest/rojos-cambiados.json || true
    echo "-> pnpm run test:guardias (con reporte JSON)"
    pnpm run test:guardias --reporter=default --reporter=json --outputFile.json=.vitest/rojos-guardias.json || true
    REPORTES=".vitest/rojos-cambiados.json .vitest/rojos-guardias.json"
  else
    echo "-> pnpm run test:json"
    pnpm run test:json || true
    REPORTES=".vitest/rojos.json"
  fi

  # Los reportes se pasan JUNTOS a una sola llamada: el modo rapido son dos corridas parciales
  # y solo unidas describen que se ejecuto de verdad. La comparacion distingue "rojo" de "no
  # ejecutado", que en modo rapido deja de ser un caso raro y pasa a ser lo normal -- casi todo
  # el baseline no se corre-, y por eso NO reclama que se poden entradas que siguen rojas.
  COMPARACION=$(node scripts/comparar-baseline-rojos.mjs $REPORTES)                 || fail "hay rojos NUEVOS respecto del baseline (el detalle esta justo arriba)"
  ok "tests: $COMPARACION"

  if [ "$MODO" = "rapido" ]; then
    warn "modo rapido: solo los tests relacionados con tus cambios + las guardias."
    warn "El completo NO es opcional antes de una release a prod: ahi se corre './init.sh' a secas."
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
