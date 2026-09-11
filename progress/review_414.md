# review_414 — El comprobante del mensajero deja de atribuirle gestiones que no hizo

- **PR:** #780 · rama `feat/414-comprobante-mensajero-rechazo-contradictorio` · base `dev`
- **Revisado:** `1fd49912` (commits `ecf4e082` producción · `050eea33` tests · `1fd49912` bitácora)
- **SHA base del PR:** `919e6e17`
- **Worktree de revisión:** `R:/wt/rev414` (detached en `1fd49912`, node_modules propios)
- **Fecha:** 2026-09-10
- **Veredicto:** **OK**

Todo lo que sigue está **medido por mí**, no leído de `progress/impl_414.md`. Donde mi número
difiere del suyo, lo digo.

---

## 1. Checklist

### Especificación
- [x] `specs/414-.../requirements.md` con 9 requisitos EARS numerados y **cero preguntas abiertas**.
- [x] `specs/414-.../design.md` con **seis** alternativas descartadas (A-F) y su porqué, una de
      ellas (B) con número medido prestado de la 408.
- [x] `specs/414-.../tasks.md` existe. **T1-T8 en `[x]`; T9 SIN marcar** — ver §4, donde juzgo esa
      decisión.

### Trazabilidad
- [x] Los **9** requisitos mapean a un test concreto que existe y pasa. Verifiqué los **9 yo mismo**
      por mutación (§3), no por lectura del mapa.
- [x] `progress/impl_414.md` contiene la tabla `R1..R9 -> test`.

### Calidad de código (gate corrido por mí, §4)
- [x] `pnpm run typecheck` — **verde**.
- [x] `pnpm run lint` — **verde** (184 warnings preexistentes, **0 errores**).
- [ ] `pnpm test` — **INIT_EXIT=1** por **5 archivos ajenos**. Reproducido por mí contra `dev`
      limpio. No es defecto de esta ficha; ver §4.
- [n/a] E2E: no hay harness Playwright ejecutable en este repo, y la ficha no toca auth, pagos,
      recaudo, ingesta ni webhooks. Checkpoint **inaplicable**, declarado.

### Datos y seguridad (Supabase)
- [n/a] Tablas nuevas / RLS: **cero**. El diff no toca `db/` ni `lib/` — comprobado con
      `git diff --stat 919e6e17 1fd49912 -- lib/ db/` con **salida vacía**.
- [n/a] Migraciones / down.sql / `db:rollback`: **ninguna migración**.
- [x] Sin secretos ni hardcode de país/moneda/cuenta: grepeé el diff de `app/` contra
      CRC, el símbolo de colón, costa rica, api_key, secret, token=, password y process.env —
      **cero coincidencias**.
- [n/a] Webhooks: ninguno nuevo.

### Patrón de capas
- [n/a] Controller/Service/Repository: la ficha es **frontend puro**. Cuatro archivos de `app/`.
- [x] El módulo `cierre-labels.ts` **sigue siendo puro**: cero import de React, sólo `import type`
      y dos imports de datos. Es la condición que permite que las tres descargas lo sigan leyendo.

### Permisos
- [n/a] No hay páginas, Server Actions ni fetch nuevos. `verCierrePasado` se usa tal cual.
- [x] La decisión de audiencia se toma **por prop en el composition root**, no derivando permisos en
      el cliente: `CierreDiaModule.tsx:958` pasa audiencia="mensajero"; `CierresAdminModule.tsx:1245`
      no la pasa y cae en el default "admin".

### Multi-país / configuración
- [x] Nada hardcodeado. Los dos textos nuevos son etiquetas de UI en el módulo de labels, que es
      justo donde el repo las pone.

### Verificación final
- [ ] `./init.sh` en verde — **no**, por los 5 rojos ajenos. §4.
- [x] `progress/review_414.md` existe (este archivo) y su veredicto es **OK**.
- [ ] Entrada en `progress/history.md` — **pendiente del leader**: `AGENTS.md:166` la sitúa en el
      paso 12 (F2.6), **después** de que el humano mergee. No es deuda del implementador.

---

## 2. Alcance del diff — confirmado

`git diff --numstat 919e6e17 1fd49912`, y el mismo listado devuelto por `gh pr view 780`:

| Archivo | + / - |
| --- | --- |
| `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` | 11 / 10 |
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` | 10 / 0 |
| `app/(app)/cierres-admin/_components/cierre-factura.tsx` | 70 / 20 |
| `app/(app)/cierres-admin/_components/cierre-labels.ts` | 28 / 0 |
| `progress/impl_414.md` | 231 / 0 |
| `specs/414-.../tasks.md` | 21 / 8 |
| `tests/components/CierreDiaComprobanteMarcasDeOrigen.test.tsx` | 346 / 0 |
| `tests/components/ComprobanteMensajeroOrigenRechazo.test.tsx` | 443 / 0 |

**Producción: sólo `app/(app)/cierres-admin/` y `app/(app)/cierre-dia/`.** Cero `lib/`, cero `db/`,
cero `feature_list.json`, cero `progress/current.md`. **Cero tests ajenos editados**: en todo
`tests/` el diff son los dos archivos nuevos y nada más — ni una línea en ninguno de los que la
ficha vigila.

**Que NO se derivó el origen para la vista del mensajero (mutación 6 de la 408):** confirmado en el
archivo real, no en el grafo. `lib/repositories/CierreDiaRepository.ts` sigue con el literal
`esRechazoSla: false` y su comentario de la 102/R11 intacto, y el diff contra `lib/` es **vacío**.

### Lo que se rehizo tras el `git checkout --`, ¿es equivalente o recortado?

**Equivalente.** Lo medí por el lado que importa, que no es el `--numstat`: saqué **todas** las
líneas eliminadas de `cierre-factura.tsx` respecto de la base. Son **20**, y las 20 están
contabilizadas — 19 son el span del badge de origen (que reaparece re-indentado dentro del
`esMensajero ? null :`) y 1 es la del argumento del motivo, sustituida por su versión con
`!esMensajero &&`. **No se perdió nada preexistente de ese archivo.** Y la prueba de
comportamiento: las mutaciones 1, 3, 4, 5 y 6 —las cinco que viven en ese archivo— enrojecen
todas, cosa que una versión recortada no haría.

---

## 3. Los 9 requisitos, verificados por mutación (todos por mí)

Baseline propio antes de empezar: **103/103 en verde** en los 4 archivos del conjunto, y **103/103
otra vez** tras revertir la última mutación.

| # | Mutación aplicada por mí | Rojos (míos) | Archivos | Qué la mató | ¿Coincide? |
| --- | --- | --- | --- | --- | --- |
| 1 | el distintivo vuelve a pintarse para el mensajero | **8** | 2 | R1 x3, R4 casos 1 y 3, R5 x2, R9 convivencia | sí (8/2) |
| 2 | ocultar el distintivo **también** para el admin | **4** | 2 | R2 x2, R4 caso 2, **y `CierresAdminModule`** | él anotó 3/1 — §5, m3 |
| 3 | volver a `g.esRechazoSla` en el argumento | **1** | 1 | **sólo** R4 caso 3 | sí (1/1) |
| 4 | esconder el fragmento rechazada para el mensajero | **1** | 1 | R3 | sí (1/1) |
| 5 | **anidar «La tienda» dentro del fragmento rechazada** | **1** | 1 | **el caso de la entregada de R7** | sí (1/1) |
| 6 | pintar «La tienda» también para el admin | **2** | 1 | R8, el rechazo y la entrega del admin | sí (2/1) |
| 7 | duplicar la nota de «La tienda» con foto cambiado por imagen | **3** | 2 | **R9** y los dos casos de R7 | sí (3/2) |
| 8 | casos de ausencia **sin** control + mutación 1 | **VERDE** | — | autocomprobación: ver abajo | sí |
| R6 | `renderRechazoOrigen` devolviendo null | **2** | 1 | `CierreMotivoRechazoAutomatico` R8 x2 | sí (2/1) |

**Ninguna de las siete primeras sobrevivió.** Todas se aplicaron sobre árbol commiteado y se
revirtieron dejando el árbol limpio, comprobado con `git status` cada vez.

### La mutación 5, que era el encargo explícito

Es el fallo mudo de la mitad nueva. La reapliqué moviendo el bloque condicionado a
`esMensajero && g.desdeAyudaTienda` a **dentro** del fragmento `g.resultado === "rechazada"` — el
sitio exacto donde vivía el distintivo retirado. Resultado: **1 rojo**, y es el que tiene que ser:

```
FAIL  ComprobanteMensajeroOrigenRechazo.test.tsx
  > R7 ... > una ENTREGA registrada por la tienda va marcada, con su nota completa
Test Files  1 failed | 3 passed (4)
     Tests  1 failed | 102 passed (103)
```

Nada más se rompe, que es precisamente lo que hace peligroso ese fallo: una entrega registrada por
la tienda se quedaría muda **sin romper nada visible**. R7 lo caza porque afirma sobre **dos
resultados distintos**, y ésa es la parte del spec que hay que defender si alguien la quiere
simplificar a un solo caso.

### La mutación 8, la autocomprobación

Escribí **mi propio** archivo sin control (`RevM8SinControl.test.tsx`, borrado después), con los
cuatro casos de ausencia **sin desplegar la fila**, y le puse encima la mutación 1:

```
Test Files  1 failed | 1 passed (2)
     Tests  5 failed | 14 passed (19)
```

El archivo **sin** control: **4/4 VERDE**. El archivo real, **con** control: **5 rojos**. Cifras
idénticas a las que él anotó. Queda demostrado que lo único que separa el falso verde del verde de
verdad es abrir la fila y probarlo antes de afirmar la ausencia. **La mutación 8 sale verde, como
debía.**

### Los dos textos que se mudaron, carácter por carácter

Extraje las declaraciones del blob viejo (`919e6e17:CierreDiaModule.tsx`) y del nuevo
(`1fd49912:cierre-labels.ts`) y las comparé:

```
sha256  101972a28a35985f2fc0a081f32605e10f0f2d658ef4bcb1224b3c8ad450e439  (viejo)
sha256  101972a28a35985f2fc0a081f32605e10f0f2d658ef4bcb1224b3c8ad450e439  (nuevo)
```

**Idénticos byte a byte**, comillas angulares y tildes incluidas. Y **la guardia de R9 muerde**: la
mutación 7 —copiar el literal en `cierre-factura.tsx` con una palabra cambiada, que es la salida
fácil que R9 existe para cerrar— pone **3 rojos en 2 archivos**, uno de ellos el caso de R9 que
afirma el mismo texto en las dos superficies del mismo montaje.

El movimiento no rompió a nadie: fuera de los cuatro archivos de la ficha, **nadie importa** esas
dos constantes; los tests ajenos que las vigilan (`CierreDiaModule.test.tsx:1464`) las teclean a
mano y siguen verdes sin tocarlos.

### Trampas buscadas, y lo que encontré

- **Aserción contra su propia fuente** — **limpia**. Ningún test importa las constantes de badge ni
  llama a `motivoGestionLegible`. Las únicas apariciones de esos nombres en `tests/` son
  **comentarios que explican por qué NO se importan**. Todos los literales van tecleados a mano.
- **Literal: contrato o polizón** — **limpia**. Ni un `toEqual` ajeno se tocó; el diff en `tests/`
  son 0 líneas fuera de los dos archivos nuevos. Los literales nuevos (la variante corta del
  motivo, la larga de la 408, las dos notas) **son** el contrato, y se afirman a mano.
- **El test que vive dentro de lo que borras** — **limpia**. Lo único borrado son las dos
  declaraciones const de `CierreDiaModule.tsx`; no se borró ningún componente ni ningún test. La
  cobertura de la tabla en vivo (`CierreDiaModule.test.tsx`, 75 casos) sobrevive intacta y verde.
- **Test verde sin datos** — **limpia**. Cero early returns condicionales, cero `.skip`, cero
  `.only`, cero `todo` en los dos archivos nuevos. Y cada caso de ausencia lleva su control de
  no-vacuidad, que la mutación 8 demuestra que es load-bearing.
- **Derivar el origen para el mensajero (mutación 6 de la 408)** — **no se intentó**. `lib/` sin
  tocar; comprobado en el archivo real, no en el grafo.

---

## 4. El gate, y mi juicio sobre dejar T9 vacía

### Mi corrida completa, independiente

`./init.sh` en `R:/wt/rev414`, con DATABASE_URL **exportada en la sesión** (que es lo que el propio
`init.sh:215` manda hacer: *«NO copies el .env»*) y con el exit code **escrito dentro del log**. El
comando envolvente volvió a reportar **«exit code 0» con el gate ROJO dentro** — el modo de fallo
por el que existe esa regla.

```
OK feature_list.json: sin ids duplicados (412 fichas), cupo por zona respetado (in_progress=2)
OK typecheck paso
OK lint paso                    (184 warnings preexistentes, 0 errores)
OK DATABASE_URL resuelta: los 160 archivos de tests contra Postgres SI se ejecutan
 Test Files  5 failed | 1902 passed (1907)
      Tests  6 failed | 27661 passed | 26 skipped (27693)
   Duration  671.48s
ROJOS NUEVOS (5 archivo(s) que no estan en el baseline)
FAIL hay rojos NUEVOS respecto del baseline
INIT_EXIT=1
```

**Cifra por cifra la misma que la suya.** Mismos 5 archivos, mismos 6 casos, mismo INIT_EXIT.

- **2BP01 x 6**, mensaje idéntico: *«no se puede eliminar tipo notificacion_evento_old porque otros
  objetos dependen de él»*. Los seis casos rojos son los CONTROL de los down.sql.
- **40P01: cero.** No es contención; no hizo falta re-correr aislado por esa vía.
- **skipped: 26**, y los miré uno a uno — 17 en `AnaliticaPage.test.tsx` y 9 en
  `AnaliticaShell.test.tsx`. Preexistentes y ajenos. **Ninguno de esta ficha.**
- **Los 160 archivos contra Postgres SÍ corrieron.** No es el caso de «gate sin .env».

### La verificación que decide el juicio: los rojos son ajenos

Corrí esos cinco archivos en el checkout principal, **rama `dev` limpia** (`5e558a1d`), árbol sin
modificar, **sin una sola línea de la 414**:

```
Test Files  5 failed (5)
     Tests  6 failed | 98 passed (104)
     6 x Code: 2BP01 ... notificacion_evento_old
```

**Los mismos 6 rojos, sin su código.** Queda probado por mi mano, no por su bitácora: la causa es la
migración de la ficha **410** aplicada a la base local **compartida** mientras esa ficha sigue en su
rama, y los down.sql históricos son fotos de su momento que no pueden dropear un enum que ganó
valores después. Su diagnóstico es correcto y completo.

**Y no meterlos en `tests/baseline-rojos.json` es la decisión correcta.** Ese archivo es para deuda
de `dev`; esto es el artefacto de una rama en vuelo que desaparecerá solo cuando la 410 se mergee o
la base se rehaga. Baselinearlo lo fosilizaría y taparía el día que algo de verdad rompa esos cinco.

**Los diez archivos que la ficha vigila, verdes en MI corrida completa:**

```
OK ComprobanteMensajeroOrigenRechazo.test.tsx     (15)   OK CierresAdminModule.test.tsx        (32)
OK CierreDiaComprobanteMarcasDeOrigen.test.tsx    ( 5)   OK CierreFacturaPapel.test.tsx        (35)
OK CierreMotivoRechazoAutomatico.test.tsx         ( 8)   OK CierreFacturaSinGestionar.test.tsx (20)
OK CierreDiaMotivoRechazoAutomatico.test.tsx      ( 7)   OK CierreDetallePagos.test.tsx        (11)
OK CierreDiaModule.test.tsx                       (75)   OK cierre-detalle-superficies.guardia ( 4)
```

Más los de `tests/unit/descarga/`, también verdes.

### Mi juicio: **dejar T9 vacía fue lo correcto.** La mantendría así.

Tres razones, y una objeción que también digo.

1. **El criterio de «Hecho» de esa casilla dice, literalmente, «gate verde contra el baseline».**
   Eso no ocurrió. Marcarla `[x]` sería afirmar algo falso, y `[x]` es exactamente lo que un lector
   posterior grepea cuando decide si una ficha está lista. La regla de este repo es que nada se da
   por hecho sin pasar el gate; una casilla marcada «con nota» es el primer paso para que la nota
   deje de leerse.
2. **No es una casilla en blanco: es una casilla en blanco con la cuenta entera al lado.** El bloque
   de `tasks.md` enumera qué SÍ está hecho (gate corrido con el exit code dentro del log, skipped
   mirados, 160 archivos contra Postgres ejecutados, los 9 requisitos mapeados, todo commiteado) y
   qué exactamente falta, con las tres medidas. Eso es **más** información que `[x]` + nota, no
   menos, y dice además la condición de cierre: *se marca cuando la 410 se mergee o la base se
   rehaga*.
3. **Hizo lo contrario de lo fácil.** Lo fácil era meter los cinco en baseline-rojos.json, cerrar en
   verde y marcar la casilla. No lo hizo. Un implementador que prefiere una casilla vacía honesta a
   un verde comprado es el comportamiento que hay que premiar, no corregir.

**La objeción, dicha:** `[ ]` a secas es visualmente indistinguible de «no lo hizo», y este repo no
tiene convención para «hecho salvo por una condición externa». Es un problema del vocabulario del
arnés, no de su juicio — y con el bloque escrito debajo, el riesgo de malinterpretarlo es bajo.

**Consecuencia que sí hay que asumir, y va al leader:** `CHECKPOINTS.md` pide `./init.sh` en verde
para pasar a `done`. Con este rojo ajeno vivo, **la 414 no puede marcarse `done` todavía** aunque su
código esté listo para mergear. Es la tercera ficha del día que choca con esto; el arreglo no está
en la ficha, está en la base local compartida.

---

## 5. Hallazgos

### BLOQUEANTES

**Ninguno.**

### Menores

- **m1 — `menor`. `design.md` §9 predice mal la mutación 2, y conviene corregir esa línea.** El spec
  dice «(y debe caer `CierreMotivoRechazoAutomatico`)». **No cae, y no puede caer**: ese archivo
  monta `DetalleSecciones` de `cierre-detalle-shared.tsx` (verificado en su import de la línea 5),
  nunca `CierreFacturaDetalle` de `cierre-factura.tsx`, que es el único archivo que toca esa
  mutación. El spec confundió el **badge del comprobante** con la **columna «Origen» de la tabla**:
  son dos caminos de código distintos. **El análisis del implementador es correcto y no hay hueco**
  — lo medí por los dos lados (ver m3 y la fila R6 de §3).
- **m2 — `menor`. La base del PR va 9 commits por detrás de `origin/dev`.** El PR sale de `919e6e17`
  y `origin/dev` está en `5e558a1d` (la 417 mergeada, con código real en `lib/`). **Intersección de
  archivos: cero** — medido con `git diff --name-only 919e6e17 origin/dev` filtrando los cuatro
  archivos de la ficha, y no sale ninguno. El gate que corrimos los dos vale para el árbol de la
  rama, no para el resultado del merge. Antes de mergear conviene el `git merge origin/dev` del
  paso 9 de `AGENTS.md`; no espero sorpresas, pero está sin medir.
- **m3 — `menor`, y es a favor. El radio de la mutación 2 es mayor del anotado.** Él apuntó **3
  rojos / 1 archivo**; en mi corrida más ancha son **4 rojos / 2 archivos**, porque
  `CierresAdminModule.test.tsx` **también** enrojece («feature 102/R9: cada fila rechazada se marca
  como SLA (cron) o Manual (mensajero) según esRechazoSla»). Su número es correcto **dentro del
  conjunto de 4 archivos que declara al principio de su §3**, que no incluye ese. La noticia es
  buena: el comprobante del admin está protegido por **dos** archivos, uno nuevo (R2) y uno
  preexistente.
- **m4 — `menor`, no imputable. `progress/history.md` no tiene entrada de la 414.** `AGENTS.md:166`
  la sitúa en el paso 12, **después** del merge. Queda anotado para el leader.
- **m5 — `menor`, de proceso. El gate completo lo corrió el implementador.** `AGENTS.md`, sección
  «quien corre qué», reserva la suite completa al leader y deja al `frontend_dev` sus archivos. El
  `tasks.md` de esta ficha (T9) se lo encargó explícitamente, así que siguió su encargo; lo dejo
  anotado porque la tensión entre las dos instrucciones es real y salió bien por poco (una corrida
  de 11 minutos es justo el escenario de los cortes de stream del 2026-08-02).

---

## 6. Veredicto

**OK.**

Las dos mitades de la ficha están implementadas y probadas: el distintivo que no podía afirmar nada
cierto se retira **sólo** para la audiencia del mensajero, la marca que sí se puede afirmar entra
**fuera** del fragmento rechazada —y la mutación 5, reaplicada por mí, demuestra que si se anidara
dentro nadie vería el error salvo R7—, y los dos textos se mudaron al módulo puro **byte a byte**
con la guardia de R9 mordiendo. El alcance es exactamente el declarado, no se tocó ningún test
ajeno, no se derivó el origen para el mensajero, y las ocho mutaciones dan lo que la bitácora dice,
incluida la 8 en verde.

**El único `[ ]` que queda —T9— no es un defecto de la ficha, y su casilla vacía es la lectura
honesta de un gate rojo por causa ajena.** Verificado por mí contra `dev` limpio.

**Condición para `done`, no para mergear:** que el gate cierre en verde una vez la 410 se mergee o
se rehaga la base local compartida.
