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

# -------------------------------------------------------------------------------------------------
# 2. Dependencias — SE COMPRUEBAN UNA A UNA, NO SE DAN POR BUENAS (ficha 420, 2026-09-11)
# -------------------------------------------------------------------------------------------------
#
# QUE HABIA AQUI. Este paso preguntaba si existia el DIRECTORIO `node_modules` y, si existia,
# imprimia `✓ dependencias presentes` SIN HABER ABIERTO `package.json`. El `ok` colgaba del `if`
# exterior, no del interior: se imprimia siempre que hubiera `package.json`. Y la unica condicion
# que se llegaba a evaluar -"existe la carpeta"- es verdadera en cuanto se ha instalado UNA vez,
# para siempre.
#
# QUE COSTO. Tras mergear la ficha 410 -que anade `web-push` y `@types/web-push`- el gate completo
# sobre `dev` dio este visto bueno EN VERDE y dos pasos mas tarde:
#
#     lib/push/web-push-sender.ts(11,21): error TS2307: Cannot find module 'web-push'
#     INIT_EXIT=1
#
# Parecia un error de codigo y era un `pnpm install` que faltaba. Se resolvio en 1,3 s; lo caro
# fue el diagnostico, no la reparacion, y por eso el rojo de abajo trae el comando ya escrito.
#
# Y EL AGUJERO ERA MAYOR. Medido el 2026-09-11: si falta SOLO el paquete de runtime y siguen
# estando sus tipos en `node_modules/@types/`, el TYPECHECK PASA EN VERDE -TypeScript resuelve las
# declaraciones desde `@types/`- y el fallo sale en EJECUCION. El typecheck NO es la red de
# seguridad de esto: solo lo caza cuando faltan los dos. Este paso es estrictamente mas fuerte.
#
# POR QUE NO SE INSTALA SIEMPRE Y YA (alternativa medida, no intuida). `pnpm install
# --frozen-lockfile` es idempotente y cuesta 1.711 / 1.573 / 1.772 ms sobre arbol completo, y ni
# siquiera necesita red (exit 0 con el registro apuntando a 127.0.0.1:1). O sea: barato. Se
# descarta igual por dos razones que el precio no toca. La primera es que REPARARIA EN SILENCIO:
# el paso saldria verde y nadie llegaria a saber que el arbol estaba mal -se cambiaria un fallo
# mudo por otro mas callado todavia, y con lo de arriba, sin typecheck detras que grite-. La
# segunda es que un paso que MIDE no debe ESCRIBIR en lo medido: el gate corre en el worktree de
# cada agente, sobre un arbol que otros pasos (`prisma generate`) preparan. La comprobacion cuesta
# 114-130 ms, ~13x menos, y no toca nada.
#
# El arbol VACIO si se instala: ahi no hay nada que reportar -serian 58 ausencias y ningun
# titular-, es un arranque, y la unica salida util es instalarlo. Se hace con `--frozen-lockfile`
# (antes era `pnpm install` a secas) para que un arbol recien creado quede EXACTAMENTE como dice
# el lockfile, y para que un `package.json` desalineado salga a pantalla en vez de resolverse en
# silencio con una resolucion nueva.
#
# LOS MARCADORES DE ABAJO NO SON DECORACION: LA GUARDIA EJECUTA ESTE BLOQUE (2026-09-11).
# `tests/unit/guards/dependencias-declaradas-presentes.guardia.test.ts` corta este archivo por
# `FIN PASO 2` y corre el trozo TAL CUAL con bash, contra un arbol de mentira al que le falta un
# paquete, para exigir que el paso SALGA EN ROJO. Se hace asi porque la version anterior de esa
# guardia afirmaba sobre el TEXTO -- pedia que la linea de la invocacion contuviera la palabra
# `fail` -- y una revision demostro que eso se burla sin esfuerzo: basta cambiar el `|| fail` por
# un `|| DEPENDENCIAS="no se pudo verificar (el fail se silencio)"` para que los 13 tests sigan en
# VERDE mientras el gate imprime un `✓ dependencias: ...` sobre un arbol roto y sigue adelante. O
# sea: la guardia que existe para que el gate deje de mentir se podia silenciar sin que nada se
# pusiera rojo, que es exactamente la ironia que esta ficha vino a cerrar.
#
# Si mueves este bloque, muevete los marcadores con el. Si los borras, la guardia se pone ROJA en
# vez de quedarse sin nada que medir -- que es la diferencia entre una comprobacion y un adorno.
# >>> INICIO PASO 2: DEPENDENCIAS (ficha 420) <<<
if [ -f package.json ]; then
  if [ ! -d node_modules ]; then
    echo "Instalando dependencias..."
    pnpm install --frozen-lockfile || fail "'pnpm install --frozen-lockfile' fallo"
  fi
  # El detalle del rojo -que paquetes faltan- lo escribe el script en STDERR, que ya se ve;
  # `$(...)` solo captura STDOUT, donde va el resumen del caso verde con la CIFRA MEDIDA de
  # dependencias comprobadas. Escrita a mano, esa cifra caducaria con el siguiente `pnpm add`.
  DEPENDENCIAS=$(node scripts/verificar-dependencias.mjs)  || fail "faltan dependencias declaradas (el detalle esta justo arriba)"
  ok "dependencias: $DEPENDENCIAS"
else
  warn "no hay package.json todavia (repo recien inicializado)"
fi
# >>> FIN PASO 2: DEPENDENCIAS (ficha 420) <<<

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
# -------------------------------------------------------------------------------------------------
# 2026-10-05 — DINERO Y DATOS YA NO PIDEN EL COMPLETO: AMPLIAN LA RED (pedido del humano)
# -------------------------------------------------------------------------------------------------
# Medido en la ficha 473 (5 archivos, uno con «cierre» en el nombre): backend y frontend corrieron
# el completo cada uno (19 y ~20 min) y el post-merge otro (28 min) = ~67 min, cuando lo relacionado
# eran ~280 tests y el revisor los corrio en minutos. Cada completo ademas arrastro los flakes de la
# base compartida (2 deadlocks 40P01 ese dia) que luego hubo que descartar a mano.
#
# El argumento (b) de arriba sigue en pie, pero el remedio era desproporcionado: lo que el grafo de
# imports NO ve de un cambio de dinero o de datos es la CAPA DE DATOS (una migracion no la importa
# nadie; un WHERE de dinero solo lo muerde un test contra Postgres -ver la memoria «probar el WHERE
# donde vive»-). Los ~2.000 archivos de pantallas ajenas no aportan nada ahi. Por eso esos cambios
# corren ahora lo relacionado + guardias + TODO `tests/integration/db` (418 archivos contra Postgres).
# Y como esa red es justo la de Postgres, sin DATABASE_URL el modo ampliado FALLA en vez de dar un
# verde que no mide nada.
#
# Siguen exigiendo el completo solo los cambios cuyo radio es LITERALMENTE todo el repo: el propio
# gate, el quitador de comentarios con el que leen las guardias y la configuracion de build/tests.
# Tambien `tests/setup/` (lo carga CADA test: cambiarlo cambia lo que ve toda la suite) e
# `instrumentation.ts` (corre antes de cualquier peticion del servidor). Añadidos el 2026-10-05.
RUTAS_GLOBALES='^init\.sh$|^tests/fixtures/sin-comentarios\.ts$|^tests/setup/|^instrumentation\.ts$|^(package\.json|pnpm-lock\.yaml|tsconfig\.json|middleware\.ts|next\.config\.ts|vitest\.config\.ts|prisma\.config\.ts|eslint\.config\.mjs|\.env\.example)$'
RUTAS_DE_DATOS='^db/migrations/|^db/schema\.prisma$|^lib/types/'
NOMBRES_DE_DINERO='^(lib|app|components)/.*(cierre|tarifa|pago|wallet|liquidacion|ingreso|egreso|caja|comision|flete|moneda|cobro|factura|premio)'
AMPLIADO=""

clasificar_cambio() {
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

  local globales
  globales="$(printf '%s
' "$cambiados" | grep -E "$RUTAS_GLOBALES" || true)"
  if [ -n "$globales" ]; then
    echo "${YELLOW}Tu cambio toca algo cuyo radio es TODO el repo:${NC}"
    printf '%s
' "$globales" | sed 's/^/    /'
    echo ""
    echo "  El propio gate, el quitador de comentarios de las guardias o la config de build/tests:"
    echo "  cualquier seleccion parcial mediria con una vara que acaba de cambiar."
    fail "esto exige el gate completo. Corre: ./init.sh"
  fi

  local sensibles
  sensibles="$(printf '%s
' "$cambiados" | grep -Ei "$RUTAS_DE_DATOS|$NOMBRES_DE_DINERO" || true)"
  if [ -n "$sensibles" ]; then
    echo "${YELLOW}Tu cambio toca dinero o la capa de datos:${NC}"
    printf '%s
' "$sensibles" | sed 's/^/    /'
    AMPLIADO="1"
    ok "modo rapido AMPLIADO: relacionados + guardias + toda la integracion contra Postgres"
    return 0
  fi

  ok "el cambio no toca dinero, datos ni config: el modo rapido basta"
}

# -------------------------------------------------------------------------------------------------
# SIN DATABASE_URL LA SUITE SE ENCOGE, Y ESO SE DICE ANTES DE CORRER (ficha 323, 2026-08-28)
# -------------------------------------------------------------------------------------------------
#
# QUE PASA HOY. 77 archivos de tests van envueltos en HAY_BASE_DE_DATOS (tests/integration/db/
# _postgres-real.ts): si no hay DATABASE_URL resoluble, vitest los da por SALTADOS y la suite
# termina VERDE. Es la decision correcta -la suite tiene que correr en una maquina sin Postgres-,
# pero el aviso llegaba tarde y flojo: el unico rastro era un "no hay .env" al FINAL del init,
# despues de los tests, sin decir que se habia dejado de medir.
#
# POR QUE IMPORTA AHORA. Los worktrees son ya la via normal de paralelismo, y "git worktree add"
# NO lleva el .env (esta gitignorado y vive solo en el arbol principal). O sea: el caso de "sin
# base" dejo de ser la maquina rara de alguien y paso a ser lo habitual. Un verde que no ha
# tocado la capa de datos y no lo dice es la version silenciosa del mismo problema que un rojo
# que confunde.
#
# POR QUE WARN Y NO FAIL. Exigir base para correr el gate dejaria sin gate a todo worktree, que
# es justo donde se trabaja. Lo que se exige es que el hueco tenga NOMBRE y CIFRA en pantalla,
# antes de la corrida y otra vez al final -la salida del completo son minutos y varios miles de
# lineas: un aviso al principio y nada mas, no se lee-.
#
# El conteo se MIDE, no se escribe a mano: una cifra literal caduca en cuanto alguien anade un
# test contra Postgres, y una cifra caducada es peor que ninguna.
SIN_BASE_DE_DATOS=""

anunciar_tests_contra_postgres() {
  local hay archivos
  # Misma resolucion que hacen los tests (urlDeBaseDeDatos): process.env, y si falta, el .env
  # del directorio actual. NO se imprime el valor, solo si existe.
  hay="$(node -e 'try { process.loadEnvFile(); } catch {} process.stdout.write(process.env.DATABASE_URL ? "si" : "no");' 2>/dev/null)" || hay="?"
  archivos="$(grep -rl HAY_BASE_DE_DATOS tests --include='*.test.ts' 2>/dev/null | wc -l | tr -d '[:space:]')" || archivos="?"

  if [ "$hay" = "si" ]; then
    ok "DATABASE_URL resuelta: los $archivos archivos de tests contra Postgres SI se ejecutan"
    return 0
  fi

  SIN_BASE_DE_DATOS="$archivos"
  warn "sin DATABASE_URL: $archivos archivos de tests contra Postgres NO se van a ejecutar."
  echo "    Se SALTAN, no fallan: los envuelve HAY_BASE_DE_DATOS, de"
  echo "    tests/integration/db/_postgres-real.ts. La lista completa:"
  echo "        grep -rl HAY_BASE_DE_DATOS tests --include='*.test.ts'"
  echo "    Consecuencia: el verde de esta corrida NO dice nada de la capa de datos."
  echo "    Si estas en un worktree, el .env vive solo en el arbol principal y no se hereda."
  echo "    Exporta DATABASE_URL en la sesion. NO copies el .env: lleva credenciales."
}

if [ -f package.json ]; then
  # La clasificacion va ANTES que typecheck y lint a proposito: si el cambio exige el gate
  # completo, decirlo despues de un minuto de espera seria cobrarte la espera dos veces.
  [ "$MODO" = "rapido" ] && clasificar_cambio
  run_if typecheck
  run_if lint
  # Antes de la corrida, no despues: si falta la base, lo que NO se va a medir se dice con su
  # nombre y su cifra mientras todavia se puede arreglar (ficha 323).
  anunciar_tests_contra_postgres
  if [ -n "$AMPLIADO" ] && [ -n "$SIN_BASE_DE_DATOS" ]; then
    fail "el modo ampliado existe para medir contra Postgres y no hay DATABASE_URL: exportala y repite"
  fi
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
  rm -f .vitest/rojos*.json

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
    if [ -n "$AMPLIADO" ]; then
      # Directo con `pnpm exec` y no con un script nuevo de package.json: tocar package.json hace
      # que `--changed` seleccione la suite entera (medido, ver arriba).
      echo "-> vitest run tests/integration/db (modo ampliado, con reporte JSON)"
      pnpm exec vitest run tests/integration/db --reporter=default --reporter=json --outputFile.json=.vitest/rojos-integracion.json || true
      REPORTES="$REPORTES .vitest/rojos-integracion.json"
    fi
  else
    echo "-> pnpm run test:json"
    pnpm run test:json || true
    REPORTES=".vitest/rojos.json"
  fi

  # UN ROJO SE REPITE AISLADO (2026-10-05, pedido del humano). En paralelo, la base local compartida
  # da rojos que no son del cambio -deadlocks 40P01, conteos de tabla entera mientras otro test
  # escribe-: medido ese mismo dia, 3 de 418 archivos de `tests/integration/db` rojos en paralelo y
  # 3 de 3 verdes aislados en 3 s. Se repiten SOLO los archivos rojos, sin paralelismo, y su
  # reporte SUSTITUYE al original en la comparacion: lo que sigue rojo aislado es rojo de verdad;
  # lo que pasa se anuncia como intermitente, con su nombre, y no tumba el gate. Solo en modo
  # rapido: el completo de la release se lee entero y a mano.
  if [ "$MODO" = "rapido" ]; then
    REPORTES_FINALES=""
    for REP in $REPORTES; do
      ROJOS="$(node scripts/archivos-rojos-de-reporte.mjs "$REP")"
      if [ -n "$ROJOS" ]; then
        REINTENTO="${REP%.json}-aislado.json"
        rm -f "$REINTENTO"
        echo "-> repitiendo AISLADOS los rojos de $REP:"
        printf '%s
' "$ROJOS" | sed 's/^/    /'
        # shellcheck disable=SC2086
        pnpm exec vitest run --no-file-parallelism $ROJOS --reporter=default --reporter=json --outputFile.json="$REINTENTO" || true
        AUN_ROJOS="$(node scripts/archivos-rojos-de-reporte.mjs "$REINTENTO")"
        for F in $ROJOS; do
          printf '%s
' "$AUN_ROJOS" | grep -qxF "$F" || warn "intermitente (rojo en paralelo, verde aislado): $F"
        done
        REPORTES_FINALES="$REPORTES_FINALES $REINTENTO"
      else
        REPORTES_FINALES="$REPORTES_FINALES $REP"
      fi
    done
    REPORTES="$REPORTES_FINALES"
  fi

  # Los reportes se pasan JUNTOS a una sola llamada: el modo rapido son dos corridas parciales
  # y solo unidas describen que se ejecuto de verdad. La comparacion distingue "rojo" de "no
  # ejecutado", que en modo rapido deja de ser un caso raro y pasa a ser lo normal -- casi todo
  # el baseline no se corre-, y por eso NO reclama que se poden entradas que siguen rojas.
  COMPARACION=$(node scripts/comparar-baseline-rojos.mjs $REPORTES)                 || fail "hay rojos NUEVOS respecto del baseline (el detalle esta justo arriba)"
  ok "tests: $COMPARACION"

  if [ "$MODO" = "rapido" ]; then
    if [ -n "$AMPLIADO" ]; then
      warn "modo rapido AMPLIADO: relacionados + guardias + tests/integration/db."
    else
      warn "modo rapido: solo los tests relacionados con tus cambios + las guardias."
    fi
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

# El aviso se repite JUNTO AL VEREDICTO (ficha 323): la corrida completa son minutos y miles de
# lineas, y lo dicho al principio ya no esta en pantalla cuando aparece el "init OK". Un verde
# incompleto que solo se anuncio hace cinco minutos se lee como un verde a secas.
if [ -n "$SIN_BASE_DE_DATOS" ]; then
  warn "recuerda: este verde NO incluye los $SIN_BASE_DE_DATOS archivos de tests contra Postgres (sin DATABASE_URL se saltaron)."
fi

echo "${GREEN}== init OK ==${NC}"
echo "Siguiente: abre AGENTS.md y sigue el flujo desde ahi."
