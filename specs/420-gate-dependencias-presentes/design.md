# Feature 420 — El gate dice "dependencias presentes" cuando falta una dependencia declarada (design)

## Lo que hay hoy

```sh
# init.sh:38-43
if [ -f package.json ]; then
  if [ ! -d node_modules ]; then
    echo "Instalando dependencias..."
    pnpm install
  fi
  ok "dependencias presentes"        # <- afirma sin haber mirado package.json
else
  warn "no hay package.json todavia (repo recien inicializado)"
fi
```

El `ok` cuelga del `if` exterior, no del interior: se imprime **siempre** que haya
`package.json`. La única condición que se llega a evaluar es "existe el directorio", y esa
condición es verdadera en cuanto se ha instalado **una vez**, para siempre.

## La forma del arreglo

Un script de Node, llamado desde `init.sh`, que lee `package.json` y comprueba paquete por
paquete. Mismo patrón que los otros dos verificadores del gate —`scripts/validar-feature-list.mjs`
y `scripts/comparar-baseline-rojos.mjs`—: STDERR para el detalle, STDOUT para el resumen del caso
verde, exit code para el veredicto.

```
scripts/verificar-dependencias.mjs      # la medición (nuevo)
init.sh (paso 2)                        # la llama y falla con ella
tests/unit/guards/dependencias-declaradas-presentes.guardia.test.ts   # los tests
```

### `scripts/verificar-dependencias.mjs`

- Argumento opcional: la raíz a comprobar (por defecto `process.cwd()`). Existe **para los
  tests**: sin él, la única forma de probar el caso rojo sería romper el árbol real de quien
  corre la suite.
- Lee `<raiz>/package.json` y toma **`dependencies` + `devDependencies`**.
  `optionalDependencies` queda fuera **por definición**: pueden faltar legítimamente.
- Para cada nombre, exige que `<raiz>/node_modules/<nombre>/package.json` sea un archivo
  legible. Se comprueba el `package.json` de dentro y no la carpeta porque en pnpm
  `node_modules/<nombre>` es un **enlace simbólico** al store virtual: un enlace **roto** supera
  un `existsSync` sobre el directorio en algunos casos y no supera la lectura del manifiesto.
- Si `node_modules` no existe, lo dice con su propio mensaje: no son 90 paquetes ausentes, es un
  árbol sin instalar (R5 lo resuelve en `init.sh`, instalando).
- Verde → STDOUT: `N declaradas, todas presentes` (cifra medida, R4).
  Rojo → STDERR: una línea por paquete ausente, con el comando de reparación, y `exit 1`.
- **Solo `node:fs` y `node:path`.** Ningún import de `node_modules`, ningún `child_process`,
  ninguna red (R7). Un verificador de dependencias que necesita una dependencia para arrancar
  se cae justo el día que tiene que hablar.

### `init.sh` (paso 2)

```sh
if [ -f package.json ]; then
  if [ ! -d node_modules ]; then
    echo "Instalando dependencias..."
    pnpm install --frozen-lockfile || fail "'pnpm install --frozen-lockfile' fallo"
  fi
  DEPENDENCIAS=$(node scripts/verificar-dependencias.mjs) || fail "faltan dependencias declaradas (el detalle esta justo arriba)"
  ok "dependencias: $DEPENDENCIAS"
fi
```

`--frozen-lockfile` en el arranque (antes era `pnpm install` a secas): un árbol recién creado
debe quedar **exactamente** como dice el lockfile, y si `package.json` y `pnpm-lock.yaml` no
concuerdan eso es una condición que merece salir a pantalla, no ser resuelta en silencio con una
resolución nueva.

## La alternativa que se descartó, y el número que lo decide

**A1 — correr `pnpm install --frozen-lockfile` SIEMPRE, en vez de solo cuando falta el
directorio.** Es idempotente, así que "arreglaría" el caso medido sin preguntar.

Medido el 2026-09-11 en este worktree (`R:/wt/wt420`, Windows 11, pnpm 10.10.0, 90 paquetes
declarados), árbol ya instalado y sin nada que hacer:

| corrida | tiempo |
| --- | --- |
| 1 | 1.711 ms |
| 2 | 1.573 ms |
| 3 | 1.772 ms |
| con registro inalcanzable (`npm_config_registry=http://127.0.0.1:1/`) | 1.584 ms, **exit 0** |
| con 2 paquetes ausentes (reparación real) | 1.705 ms |

Y se comprobó que **no** destruye el cliente Prisma generado dentro de
`node_modules/.pnpm/@prisma+client@.../node_modules/.prisma/client` (mismo tamaño y mismo mtime
antes y después), que era el riesgo obvio de dejar que un paso de medición escriba en el árbol.

O sea: **~1,7 s, y no necesita red en el caso normal**. Barato. Y aun así se descarta, por dos
razones que el número no toca:

1. **No produce el rojo, y el rojo es el entregable.** Un `install` incondicional *repara* y
   sigue: el paso sale verde y **nadie llega a saber** que el árbol estaba mal. Cambiaría un
   fallo mudo por otro más silencioso todavía —hoy al menos el typecheck gritaba dos pasos
   después; con A1 no gritaría nadie, y en el caso medido aquí (falta solo el paquete de
   runtime) **el typecheck ya no grita de todas formas**.
2. **Un paso que mide no debe escribir.** El gate lo corre cada agente en su worktree, sobre un
   árbol que otros pasos (`prisma generate`) preparan. Que la medición mute lo medido es como se
   fabrican los heisenbugs.

Coste de la opción elegida, medido en el mismo árbol (3 corridas): **114, 126 y 130 ms** —casi
todo arranque de Node— y sin tocar la red, o sea **~13x más barata que A1** y sin efectos sobre
el árbol. El precio que se paga es un viaje de ida y vuelta del
agente (ver el rojo → `pnpm install --frozen-lockfile` → repetir el gate); se acepta a sabiendas,
y por eso R3 exige que el rojo traiga el comando ya escrito.

**A2 — `pnpm list --depth 0` / `pnpm install --offline --dry-run`.** Descartada: lanza un
proceso, depende del formato de salida de una versión de pnpm y tarda más de un segundo, a cambio
de responder la misma pregunta que responden dos `readFileSync`.

**A3 — `require.resolve(nombre)` desde Node.** Descartada: respeta el campo `exports` del
paquete, así que falla con paquetes que no exportan su `package.json` ni un entry point resoluble
desde la raíz del repo — daría **falsos rojos**, que es lo peor que puede hacer un gate.

## Lo que esto NO cubre (dicho aquí para que no se descubra como sorpresa)

- **Versiones.** Un `web-push@2` instalado donde `package.json` pide `^3.6.7` pasa esta
  comprobación. De eso responde `pnpm install --frozen-lockfile` cuando alguien instala; aquí se
  mide **ausencia**, que es el defecto medido.
- **Dependencias transitivas** rotas dentro del store.
- **Imports por nombre de un paquete que nadie declaró** (dependencia fantasma que resuelve por
  hoisting): lo caza el typecheck, no esto.

## Riesgo de red

Ninguno en el camino verde: la comprobación es solo `readFileSync`. El único punto que puede
necesitar red es el `pnpm install` de arranque (R5), que solo corre cuando **no hay**
`node_modules` — y ahí la red hace falta de todos modos. Medido además que un
`pnpm install --frozen-lockfile` sobre árbol completo termina en **exit 0 con el registro
inalcanzable**, así que el caso "sin red" no se rompe ni siquiera en el camino de arranque si el
store local ya tiene el contenido.

## Nota sobre el gate de esta propia ficha

`init.sh` está en `RUTAS_SENSIBLES` (`docs/verification.md`): tocarlo **niega el modo rápido** a
propósito, porque cambia la medida con la que se mide todo lo demás. El gate de esta ficha es
`./init.sh` **completo**, sin atajo.
