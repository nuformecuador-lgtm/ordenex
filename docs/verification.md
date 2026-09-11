# docs/verification.md — Cómo demostrar que funciona

"Compila" y "el agente dice que está listo" NO son verificación. Una feature está
verificada cuando hay evidencia ejecutable.

## El gate tiene DOS niveles — usa el que toca

```bash
./init.sh --rapido   # EL GATE NORMAL, tambien para abrir un PR: typecheck + lint + relacionados + guardias
./init.sh            # ANTES DE UNA RELEASE A `prod`, y DESPUES DE CADA MERGE A `dev`: la suite entera
```

> **Cambiado el 2026-08-20.** Antes el completo era obligatorio **antes de cada PR, sin excepción**.
> Se midió lo que costaba: mover un enlace de la nav de la landing = **16.346 tests, 5–11 minutos**,
> cuando lo relacionado con ese cambio eran **21 tests + las guardias = ~33 segundos**. La regla
> cobraba lo mismo por un cambio de texto que por una migración.
>
> **Lo que NO se hizo:** relajarla a secas. `--changed` selecciona por grafo de imports y solo mira
> **tu** diff, así que hay dos huecos, y cada uno tiene su tapa:
>
> | hueco | cómo queda tapado |
> | --- | --- |
> | lo que no se relaciona por imports | **las guardias corren siempre** — recorren el árbol de archivos en vez de importar lo que vigilan |
> | el radio de explosión de un cambio de cimientos | **`--rapido` se niega solo** y te manda al completo (ver abajo) |
> | **un `dev` que ya venía rojo** | **la corrida completa post-merge** sobre `dev`, en segundo plano |
>
> Ese tercero es el que más duele y el que menos se ve: `--changed origin/dev` compara **contra**
> `dev`, así que un rojo que ya estaba ahí **no aparece en tu diff** y el modo rápido sale verde.
> En este repo `dev` llegó rojo **tres veces**, y el único check automático del PR es un build de
> Vercel que **no ejecuta un solo test**.

### El veredicto de los tests lo da el baseline — en los DOS modos

`dev` arrastra rojos que no son tuyos. Si el gate fallara por ellos no contestaría la única
pregunta que hay que contestar —**¿rompí algo?**— y alguien tendría que comparar a mano, archivo
por archivo, contra un número que viaja por chat: en la ficha 311 eso pasó **ocho veces**, y una se
concluyó mal.

Por eso la suite **corre igual** (no se oculta ni un rojo de la consola) pero el veredicto lo dicta
`scripts/comparar-baseline-rojos.mjs` contra `tests/baseline-rojos.json`:

- **verde** si no aparece ningún archivo que antes no fallara;
- **rojo** en cuanto aparece uno **que no está en la lista**.

La comparación es **por archivo, no por número de casos**, y es deliberado: la suite tira 2–5
flakes de saturación que cambian de sitio entre corridas —medido: 30, 31 y 32 rojos sobre el mismo
código—, así que exigir conteos exactos gritaría en falso a diario, y un gate que grita en falso se
acaba ignorando. El coste aceptado a sabiendas: si un archivo **ya listado** gana un rojo nuevo de
verdad, esto no lo ve.

**Estaba solo en el modo completo hasta la ficha 318.** El rápido corría los tests y terminaba, así
que con una deuda roja ajena viva —`superficie-de-uso.guardia`— **terminaba en rojo en
cualquier rama y pasara lo que pasara**. Se lo comieron cinco agentes seguidos (309, 308, 315, 317
y 313). El daño no era la molestia: un gate que siempre acaba en rojo enseña a leer el rojo como
ruido, y el día que el rojo sea propio nadie lo mira dos veces.

**Mantener la lista es parte del trabajo.** Un archivo que vuelve a verde **el gate lo avisa**;
bórralo de `tests/baseline-rojos.json` en ese mismo PR o la lista se fosiliza y deja de proteger.
Nunca añadas uno «para pasar el gate»: se añade cuando la deuda es de otro, está **medida**, y con
su motivo y su fecha escritos.

> **En modo rápido, "no salió rojo" no es "volvió a verde".** El rápido corre un subconjunto
> (`--changed` + guardias), así que la mayor parte del baseline **no se ejecuta** en cada corrida.
> La comparación distingue *rojo* de *no ejecutado* y solo propone podar lo que **corrió y pasó**.
> Si tratara la ausencia como recuperación, el gate pediría borrar entradas que siguen rojas — un
> aviso falso, que es peor que el problema que vino a resolver.

### Cuándo `--rapido` se niega, y por qué esas rutas

`init.sh --rapido` mira tu diff contra la base común con `origin/dev` —**lo commiteado y lo que
todavía no**— y **falla** si toca alguna de estas:

| ruta | por qué el grafo de imports no basta |
| --- | --- |
| `db/migrations/**` · `db/schema.prisma` | **una migración no la importa nadie**: ningún test sale seleccionado por tocarla |
| **`init.sh`** | tocar el gate cambia **la medida** con la que se mide todo lo demás; un fallo aquí no se ve como un rojo, se ve como **un verde que no significa nada** |
| **`tests/fixtures/sin-comentarios.ts`** | el mismo argumento que `init.sh`, un piso más abajo: es el quitador de comentarios con el que **171 suites** leen el árbol (134 importadores directos + los transitivos, medido el 2026-08-25). Ninguna ejecuta lo que vigila, todas lo **escanean** — y a través de este archivo. Si mide de menos, las guardias afirman sobre un texto al que le falta código y **salen verdes**. Pasó: **1.387 líneas invisibles en 64 archivos** (feature 283) |
| `lib/types/**` | un catálogo o un enum **lo importa medio repo**; "los relacionados" son casi todos, y decidirlo a ojo es peor que correrlos |
| `package.json` · `pnpm-lock.yaml` · `tsconfig.json` · `middleware.ts` · `next.config.ts` · `vitest.config.ts` · `prisma.config.ts` · `eslint.config.mjs` · `.env.example` | cambian **cómo** se construye y se ejecuta todo; el grafo de imports no modela eso |
| nombres de dinero en `lib/`, `app/`, `components/` (`cierre`, `tarifa`, `pago`, `wallet`, `liquidacion`, `ingreso`, `egreso`, `caja`, `comision`, `flete`, `moneda`, `cobro`, `factura`, `premio`) | el precio de equivocarse **no es un test rojo, es dinero mal cobrado** |

**La lista se mantiene estrecha a propósito.** Medido el 2026-08-20: los nombres de dinero son
**190 de 1136** archivos de código, un **17 %**. Si crece hasta atrapar todo, vuelve el problema que
esto vino a resolver.

**No tiene escape.** La salida es correr `./init.sh`, que es exactamente lo que esos cambios
merecen. Se probó en los dos sentidos —que se niega en `lib/types/`, en un servicio de dinero, en
`db/schema.prisma` y ante una migración nueva sin rastrear; y que **deja pasar** un cambio de la
landing o de un util sin dinero—.

Comandos sueltos, por si necesitas uno concreto:

```bash
pnpm run typecheck        # TypeScript strict, cero errores
pnpm run lint             # ESLint, cero errores
pnpm test                 # la suite entera
pnpm run test:cambiados   # solo lo que el grafo de imports relaciona con tu diff vs origin/dev
pnpm run test:guardias    # las guardias (van SIEMPRE, ver abajo)
pnpm exec vitest related --run <archivos>   # que tests cubren ESTOS archivos
```

`init.sh --rapido` no llama a `test:rapido`: llama a esos dos scripts por separado, añadiéndoles el
reporter JSON que la comparación necesita, y **corre los dos aunque el primero falle**.
`test:rapido` los encadena con `&&`, así que un rojo en el primero se llevaría por delante a las
guardias; mientras el veredicto era el exit code daba igual (rojo es rojo), pero con el baseline
decidiendo saldría **verde sin haberlas corrido**. Reproducir a mano lo que corre el gate rápido:

```bash
pnpm run test:cambiados --reporter=default --reporter=json --outputFile.json=.vitest/rojos-cambiados.json
pnpm run test:guardias  --reporter=default --reporter=json --outputFile.json=.vitest/rojos-guardias.json
node scripts/comparar-baseline-rojos.mjs .vitest/rojos-cambiados.json .vitest/rojos-guardias.json
```

Los dos reportes van **juntos a una sola llamada**: cada uno es media corrida, y por separado cada
llamada trataría como "no ejecutado" lo que la otra sí corrió. No hay scripts `:json` en
`package.json` a propósito: *qué* se selecciona queda definido en un solo sitio, y —medido el
2026-08-28— **tocar `package.json` hace que `--changed` seleccione 1550 archivos de test, la suite
entera, frente a 0 sin él**.

### Por que dos niveles

La suite son ~10.000 tests y ~4 minutos. Correrla al cerrar **cada** tanda convertia el arnes en
una sala de espera: una feature de 9 tandas se llevaba ~35 minutos de reloj **solo esperando**, y
el arnes existe para mejorar el trabajo, no para alargarlo.

Medido en este repo el 2026-08-03:

| Que corres | Archivos | Tests | Tiempo |
| --- | --- | --- | --- |
| suite entera | 804 | 10.187 | ~235 s |
| relacionados con un servicio | 16 | 437 | 21 s |
| relacionados con un cambio en un util muy importado | 155 | 2.577 | 103 s |
| **`./init.sh --rapido` entero** (typecheck + lint + tests) | — | — | **~58 s** |

### Las guardias van SIEMPRE, y esta es la razon

`--rapido` selecciona por el **grafo de imports**. Las guardias **no importan lo que vigilan**:
recorren el arbol de archivos (censo de tablas, columnas sensibles, modulos puros, emisores de una
categoria). **Ningun grafo de imports las selecciona**, asi que serian justo lo que se pierde. Por
eso el modo rapido las corre enteras siempre; cuestan ~8 s.

Se seleccionan por patron (`vitest run guard`), no por lista: una guardia nueva entra sola.

### Lo que `--rapido` NO cubre — no te engañes

- Acoplamientos que **no son imports**: SQL, nombres de archivo, lectura de `feature_list.json`.
- Un cambio en un archivo **sin tests que lo importen** selecciona cero tests y sale verde.
- Regresiones lejanas que solo aparecen con la suite entera.

Por eso **antes de abrir un PR se corre `./init.sh` completo, sin excepcion**. La leccion de los
PRs #209 y #237 de este repo va justo en esa direccion: se mergeo mirando el estado del PR —que es
un build y **no corre tests**— y entro un guard rojo en `dev`.

### El paso de dependencias mide, ya no afirma (ficha 420, 2026-09-11)

El paso 2 de `init.sh` comprobaba si existía el **directorio** `node_modules` y, si existía,
imprimía `✓ dependencias presentes` **sin abrir `package.json`**. Esa condición es cierta en
cuanto se ha instalado **una vez**, para siempre. Tras mergear la ficha 410 —que añade
`web-push` y `@types/web-push`— el gate completo sobre `dev` dio ese visto bueno **en verde** y
dos pasos después:

```
lib/push/web-push-sender.ts(11,21): error TS2307: Cannot find module 'web-push'
INIT_EXIT=1
```

Parecía un error de código y era un `pnpm install` que faltaba: **1,3 s de arreglo**, todo el
coste en el diagnóstico. Es la familia de fallo que este repo persigue —el sistema no falla,
**aparenta**— y engaña en la peor dirección: dice que algo está bien **justo en el paso que
existe para avisarte de lo contrario**.

Ahora `node scripts/verificar-dependencias.mjs` comprueba **paquete por paquete** que cada
entrada de `dependencies` y `devDependencies` resuelve en el árbol, y el gate **corta ahí**
nombrando lo que falta:

```
falta 1 de las 58 dependencias declaradas en package.json:
    - web-push
  Reparalo con: pnpm install --frozen-lockfile
✗ faltan dependencias declaradas (el detalle esta justo arriba)
INIT_EXIT=1
```

**El typecheck no es la red de seguridad de esto**, y eso se midió al arreglarlo: si falta
**solo** el paquete de runtime y siguen estando sus tipos en `node_modules/@types/`, el typecheck
**pasa en verde** —TypeScript resuelve las declaraciones desde `@types/`— y el fallo sale **en
ejecución**. Este paso es estrictamente más fuerte.

**Lo que NO se hizo, y el número que lo decidió.** La alternativa obvia era correr
`pnpm install --frozen-lockfile` **siempre**: es idempotente y, medido el 2026-09-11 sobre un
árbol ya instalado, cuesta **1.711 / 1.573 / 1.772 ms** y **ni siquiera necesita red** (exit 0 con
el registro apuntando a `127.0.0.1:1`); tampoco destruye el cliente Prisma generado. O sea,
barato. Se descartó igual por dos razones que el precio no toca:

- **repararía en silencio** — el paso saldría verde y nadie llegaría a saber que el árbol estaba
  mal; se cambiaría un fallo mudo por otro más callado todavía, y con lo de arriba, sin typecheck
  detrás que grite;
- **un paso que mide no debe escribir en lo medido** — el gate corre en el worktree de cada
  agente, sobre un árbol que otros pasos (`prisma generate`) preparan.

La comprobación cuesta **114–130 ms** (casi todo arranque de Node), no toca la red y no modifica
nada. El árbol **vacío** sí se instala: ahí no hay nada que reportar, es un arranque.

**Su límite, dicho aquí para que no se descubra como sorpresa:** mide **ausencia**, no versiones.
Un `web-push@2` instalado donde `package.json` pide `^3.6.7` pasa. De eso responde
`--frozen-lockfile` cuando alguien instala.

### Sin `DATABASE_URL` la suite se encoge — y en un worktree eso es lo normal

**147 archivos de test** (medido por el propio gate el 2026-09-09; eran 77 el 2026-08-28) van
envueltos en `HAY_BASE_DE_DATOS` (`tests/integration/db/_postgres-real.ts`). Sin una
`DATABASE_URL` resoluble, vitest los da por **saltados** y la suite termina **verde sin haber
tocado la capa de datos**: en la corrida completa del 2026-08-28, **52 archivos enteros** no
ejecutaron ni una aserción. **La cifra de este párrafo caduca** —ha casi doblado en doce días—;
la buena es la que imprime el gate en cada corrida, no esta.

`git worktree add` **no lleva el `.env`** —está gitignorado y vive solo en el árbol principal—, así
que ese caso dejó de ser la máquina rara de alguien: pasa cada vez que se abre un árbol aparte, que
es la vía normal de paralelismo aquí.

Por eso `init.sh` lo dice **con nombre y cifra, antes de correr**, y lo repite junto al veredicto:

```
! sin DATABASE_URL: 147 archivos de tests contra Postgres NO se van a ejecutar.
    Se SALTAN, no fallan: los envuelve HAY_BASE_DE_DATOS, de
    tests/integration/db/_postgres-real.ts. La lista completa: ...
```

La cifra **se mide en cada corrida**: escrita a mano caducaría con el siguiente test contra
Postgres, y una cifra caducada engaña más que ninguna.

**Lo que NO se hizo, a propósito: copiar o enlazar el `.env` al crear el worktree.** Lleva
credenciales, y además una sola base local compartida entre árboles hace que la migración de una
feature ponga **rojo el gate de las otras**. Si necesitas esos archivos, exporta `DATABASE_URL` en
la sesión.

**El guardia de drift de `analytics_daily` ya no depende de esto** (ficha 323). Nunca necesitó una
base viva: solo que `env("DATABASE_URL")` resolviera, porque el CLI de Prisma carga
`prisma.config.ts` antes de mirar qué subcomando le pediste. Su `prisma migrate diff` corre ahora
con una URL **propia e inalcanzable** (`127.0.0.1:1`), así que mide lo mismo en el árbol principal,
en un worktree y en CI —y si algún día intentara conectarse de verdad, se pondría rojo en vez de
pasar—. **No se saltó ni se metió en el baseline**: un guardia que se abstiene queda verde por
vacío, que es justo el modo de fallo que existe para cerrar.

## Qué cuenta como evidencia
- Salida real de los tests pasando, pegada en `progress/impl_<feature>.md`.
- El mapa `R<n> → test`: para cada requisito, el test que lo cubre.
- Para features con UI o flujo crítico: un test E2E que ejercita el camino
  completo, no solo un unit test del helper.

## Qué NO cuenta
- "Debería funcionar."
- Un test que no asegura nada (sin asserts reales).
- Tests que el implementer escribió para pasar, sin cubrir el requisito.

## Datos (Supabase)
- Verifica RLS con un test que intente acceder sin permiso y confirme el rechazo.
- Verifica migraciones aplicando y revirtiendo en un entorno de prueba.

## Regla del reviewer
Si un requisito no tiene test, o un test no verifica el requisito que dice cubrir,
es hallazgo bloqueante. La feature no pasa a `done`.
