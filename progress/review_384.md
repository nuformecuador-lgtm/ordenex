# review_384 — la descarga detallada de cierres deja de pre-filtrar a hoy en silencio

- **Rama:** `fix/384-descarga-cierres-prefiltra-hoy` · **HEAD revisado:** `20e5f42b`
- **Base del commit:** `09ff18ee`. **`origin/dev` al revisar:** `d5956728` (se movió por el merge de
  la 388 mientras esta rama estaba abierta; **no es hallazgo**, y el diff no lo nota: los 4 archivos
  del commit dan el MISMO resultado contra `dev...HEAD` que contra `09ff18ee..HEAD`).
- **Diff:** 4 archivos, +286/−38. **PR:** #728 (`OPEN`, `headRefOid` = `20e5f42b`, base `dev`).
- **Ficha `sdd: false`**: no hay `specs/384/`. La fuente de la verdad es el `status_note` de la 384
  en el `feature_list.json` de `dev`, más los requisitos heredados de
  `specs/234-descarga-cierres-general-y-detallada/` que esa ficha declara intocables (D11, R34/R35,
  R38, R39).
- **Revisor:** reviewer, en worktree aislado (`agent-a56f06f9f8c6fb9a3`), con `.env` copiado de la
  raíz y `pnpm install --frozen-lockfile` + `pnpm db:generate` dentro. **Fecha:** 2026-09-07.

> **Veredicto: RECHAZADO — por UN bloqueante, y es documental.**
> El código está bien y **no hay que tocarlo**: cero bloqueantes de código, gate **completo** verde
> corrido por el revisor (`INIT_EXIT=0`, 1770/1770 archivos, 25 283 tests, 132 archivos contra
> Postgres ejecutados), y **tres mutaciones aplicadas, tres muertas** con los números que el
> implementador anunció. Lo que falta es `progress/impl_384.md`, que `CHECKPOINTS.md` exige y que
> no existe **ni en la rama ni en el disco del worktree del implementador**. Es exactamente el
> mismo bloqueante de la ficha 382 el día anterior (`progress/review_382.md`, `BLOQUEANTE 1`), y se
> cierra escribiendo un archivo, no un parche.

---

## 1. Lo que está BIEN (medido, no supuesto)

Esta sección existe para poder distinguir «revisado y correcto» de «no mirado».

### 1.1 El arreglo ataca la causa raíz que la ficha midió

La ficha señalaba `useState(() => fechaCalendarioCR())` en `desde` **y** en `hasta`. Hoy son
`useState("")` en los dos extremos (`DescargarGestionesDialog.tsx:235-236`), y lo que viaja al borde
cuando el usuario no toca nada es `{ mensajeroIds: [...] }` **y ninguna clave más** — afirmado con
`Object.keys`, que es la forma correcta contra un schema `.strict()` (un `desde: undefined` no es
«sin fecha», es una clave de más).

El `status_note` ofrecía dos salidas, (a) arrancar sin rango o (b) conservarlo pero decirlo. Se tomó
**(a) y además la mitad del mensaje de (b)**: el aviso de conjunto vacío ya no culpa a filtros
inexistentes. Cubrir las dos mitades es más de lo que la ficha exigía y es correcto — el usuario
reportó DOS síntomas y aquí se cierran los dos.

### 1.2 `components/shared/DescargarDatasetButton.tsx` está INTACTO — medido, no leído

- `git diff origin/dev -- components/shared/DescargarDatasetButton.tsx` → **0 líneas**.
- `git diff 09ff18ee..HEAD -- components/shared/DescargarDatasetButton.tsx` → **0 líneas**.
- No está en `git show --stat HEAD`: el commit son 4 archivos y ninguno es ése.

La superficie que protege es real: **24 tablas** lo montan por `descarga={` más 5 montajes directos
(`ExportarVistaFinanciera`, `ExportarOperativoPanel`, `CierreDiaModule`, `ConsolidacionBodegaModule`,
`DescargarCierresButton`). El «~26 tablas» del comentario nuevo es una estimación honesta y
prudente, no un número inventado.

La vía que se usó para no tocarlo es la que el propio control ya ofrece y documenta en su línea 69
(«El mensaje del propio `obtenerFilas` … tiene prioridad»): el diálogo devuelve
`{ status: "error", mensaje }` y el control lo dice por toast sin generar archivo. **El
comportamiento no cambia** —antes tampoco había archivo—; cambia el texto. Las otras ~26 tablas
siguen viendo `MENSAJE_SIN_DATOS` del control común, palabra por palabra.

### 1.3 Ningún test se debilitó para acomodar el defecto nuevo

Medido, no leído:

- En `CierresAdminDescargaDetallada.test.tsx` y `CierresBodegaDescargaDetallada.test.tsx` las
  **líneas cambiadas no-comentario son CERO**. Solo se actualizó la prosa que explicaba el defecto
  viejo. Los `userEvent.clear` de las fechas **siguen ahí**, y el comentario nuevo dice la verdad
  incómoda: con esos `clear` puestos, ESOS archivos ya no vigilarían un defecto reintroducido, y por
  eso quien lo vigila es `DescargarGestionesDialog.test.tsx`. La mutación 1 (§3.1) lo confirma
  experimentalmente: cae en el diálogo y **no** en las dos pantallas.
- En `DescargarGestionesDialog.test.tsx` la única línea borrada no-comentario es el **título** del
  `it` renombrado. No se eliminó ni una aserción. Casos: **13 → 17**.

### 1.4 Los dos avisos nuevos se afirman como LITERALES

`DescargarGestionesDialog.test.tsx:545-547` y `:567-569` comparan con el texto completo escrito a
mano, no contra `MENSAJE_SIN_DATOS` / `MENSAJE_SIN_DATOS_EN_RANGO`. Una aserción contra su propia
fuente estaría verde por construcción; ésta no. El nombre accesible del atajo (`:204`) también es un
literal.

**El único punto donde el test comparte fuente con el componente está justificado y cubierto
aparte:** `const HOY = fechaCalendarioCR()` (`:78`). No es una tautología abierta, porque
`fechaCalendarioCR` está clavada por su propio test con relojes fijos y expectativas literales
(`tests/unit/utils/fecha-cr-calendario.test.ts`: 20:00 CR del 15 → `"2026-07-15"`, etc.). Un literal
aquí ataría la suite al día en que se escribió; la alternativa elegida es la correcta.

### 1.5 Lo que la ficha declaraba intocable, sigue intocable

- **Nivel «Resumen»** — `DescargarCierresButton.tsx` **no está en el diff** (`git diff --stat` sobre
  él: vacío). El resumen sigue descargando directo con `resumen.obtenerFilas` y el mensaje del
  control común. Solo cambió la rama «Detalle».
- **D11, R34/R35 (independencia de la barra)** — las props del componente siguen siendo
  `catalogo` / `accion` / `columnas` / decoración. No entra ni sale un filtro de pantalla. Los dos
  casos de `describe("independencia de la barra de filtros…")` siguen verdes sin tocarse.
- **R39 (`mensajeroIds` obligatorio y no vacío)** — intacto en las dos capas: el corte de cliente
  (`elegidos.length === 0` → error, sin llamar al borde) y el borde
  (`lib/types/filtros-cierres.ts:39,151`: `z.array(uuid).nonempty()` dentro de un `.strict()`).
  Su caso sigue en pie y sigue afirmando `expect(accion).not.toHaveBeenCalled()`.
- **R31** — el requisito literal (`specs/234/requirements.md:170`) dice «un rango de fechas
  **opcional**». Un rango que arranca vacío lo cumple **mejor** que uno prerrelleno; R31 pide que
  los controles existan, no que vengan puestos. El código no pierde nada de R31.

### 1.6 Detalles del atajo «Hoy» que están bien pensados

- Usa `fechaCalendarioCR()` y no `toISOString().slice(0,10)`: después de las 18:00 CR el segundo
  pondría el día siguiente y el atajo dejaría un rango vacío de cierres.
- **Se calcula al pulsar, no al montar.** Una pestaña abierta desde ayer pone HOY, no ayer.
- `type="button"`, y el nombre accesible **empieza por la palabra visible** («Hoy: poner el rango…»),
  igual que `DISPARADOR_ARIA`: quien navega por voz puede decir «Hoy» (WCAG 2.5.3) y quien lee el
  nombre sabe qué hace (WCAG 2.4.6).

### 1.7 La frontera estática sigue en pie

`tests/unit/guards/cierres-descarga-detallada-frontera.guardia.test.ts` lee el fuente del diálogo y
prohíbe importar servicios, repositorios, Prisma, armar `where`/`orderBy` o ramificar por
`esCentral`. El código nuevo no introduce ninguno de esos, y la guardia corrió verde en el gate
completo.

---

## 2. Verificación ejecutable — corrida por el revisor

Se corrió **`./init.sh` completo dos veces**, con `INIT_EXIT` escrito **dentro** del log.

**Antes de nada, la trampa del verde falso:** el implementador había borrado el `.env` de su
worktree; el mío venía sin él y sin `node_modules`. Se copió el `.env` de la raíz y se comprobó en
el log la línea que lo dice:

```
✓ DATABASE_URL resuelta: los 132 archivos de tests contra Postgres SI se ejecutan
```

En las **dos** corridas. Sin eso, 132 archivos se habrían saltado y el verde no habría valido nada.

| corrida | `INIT_EXIT` | archivos | tests | skipped | duración |
| --- | --- | --- | --- | --- | --- |
| 1ª | **1** | 1769 pasan / **1 rojo** de 1770 | 25 282 pasan / 1 rojo | 26 | 1107 s |
| 2ª | **0** | **1770 / 1770** | **25 283 pasan** | 26 | 741 s |

- Los **26 `skipped` son ajenos y preexistentes**, y se comprobó dónde viven: 17 en
  `tests/components/AnaliticaPage.test.tsx` y 9 en `tests/components/AnaliticaShell.test.tsx`.
  Coincide con lo que anunció el implementador.
- Los números de la 2ª corrida **coinciden exactamente** con los que el implementador reportó
  (1770 archivos, 25 283 tests, 26 skipped, 132 contra Postgres).
- `typecheck` y `lint` verdes en las dos.

### 2.1 El rojo de la 1ª corrida, medido hasta el final (no es regresión)

- **Archivo:** `tests/components/descarga/CierresDescargaColumnas.test.tsx`, un solo caso: «la
  preferencia se persiste en la clave de SU ámbito y en ninguna otra».
- **Modo de fallo:** `Error: Test timed out in 20000ms`. **No es una aserción**, es el reloj.
- **Aislado: 6 corridas, 6 verdes** (10/10 casos cada vez).
- **No lo causa este cambio.** Se midió la duración de ESE caso aislado, tres veces con el
  componente en `HEAD` y tres con el componente revertido a `09ff18ee`:
  - `HEAD`: **9,0 s · 9,5 s · 9,6 s**
  - base `09ff18ee`: **10,7 s · 8,6 s · 9,7 s**

  Las distribuciones se solapan; el cambio no mueve la aguja. (Una primera medición dio 14,1 s en
  `HEAD` y estuvo a punto de convertirse en un falso positivo: era ruido de la propia máquina, y por
  eso se repitió. Queda dicho.)
- **Por qué el gate lo cazó igual:** `tests/baseline-rojos.json` tiene la lista de archivos
  **VACÍA** (`archivos: {}`). No hay tolerancia a ningún rojo, ni a los flakes de saturación. Eso
  está bien como política y explica por qué la 1ª corrida terminó en rojo con el árbol correcto.
- **Conclusión:** flake de saturación del tipo ya conocido en este repo (timeout bajo carga, sobre
  un caso que consume ~9-10 s de un presupuesto de 20 s recorriendo 17 superficies). **No es
  hallazgo del implementador y no se añade al baseline** — pasa aislado, así que no es deuda de
  nadie.
- El flake que se me advirtió (`CrearTiendaForm.test.tsx`, ficha 390) **no apareció** en ninguna de
  las dos corridas.

---

## 3. Las mutaciones — los números reales

Corridas sobre los tres archivos de test tocados. **Línea base sin mutar: 26/26 verdes.**

### 3.1 Mutación 1 — devolver el defecto `hoy-hoy` → **2 ROJOS** (lo anunciado)

`useState("")` → `useState(() => fechaCalendarioCR())` en los dos extremos.

```
× valores por defecto del diálogo > abre con todos los mensajeros marcados y SIN rango (ficha 384)
    :395  toHaveValue("")  ->  recibido "2026-09-07"
× aviso de conjunto vacío > sin rango puesto, el aviso no culpa a ningún filtro de fecha
    :545  esperado "Los mensajeros elegidos no tienen…"  ->  recibido "No hay gestiones … en el rango…"
```

Los dos en `DescargarGestionesDialog.test.tsx`. **El test nuevo SÍ falla con el código de ayer**, y
falla por la razón exacta del defecto: el control pintado con la fecha de hoy sin que nadie la
pusiera. El segundo rojo es un regalo: la variante del aviso también delata el defecto.

Los dos archivos de pantalla se quedan **verdes** bajo esta mutación, tal como su comentario nuevo
advierte (sus `clear` de fechas taparían el defecto). El comentario no miente: lo dice y señala
quién sí lo vigila.

### 3.2 Mutación 6 — que la variante del aviso dependa de QUÉ mensajero se eligió → **3 ROJOS**, uno preexistente

`conRango ? A : B` → `elegidos[0] === idsCatalogo[0] ? B : A`.

```
× DescargarGestionesDialog.test.tsx > con rango puesto, el aviso dice que es EL RANGO…      :567
× DescargarGestionesDialog.test.tsx > dos mensajeros distintos … el mismo aviso (D12/R38)   :601
× CierresAdminDescargaDetallada.test.tsx > un mensajero sin cierres y uno fuera de alcance
    producen el mismo mensaje (R38)                                                         :385  <- PREEXISTENTE
```

**3 rojos, incluido el caso preexistente.** Coincide exactamente con lo anunciado.

### 3.3 Mutación 6-bis (propia del revisor) — una fuga de alcance de verdad → **3 ROJOS**

La mutación 6 es un proxy. Se aplicó además la fuga real: elegir el aviso según si los mensajeros
elegidos están en `catalogo.mensajerosFiltro`, con un tercer texto «Alguno de los mensajeros
elegidos no está en tu alcance».

```
× sin rango puesto, el aviso no culpa a ningún filtro de fecha                    :545
× con rango puesto, el aviso dice que es EL RANGO lo que no trae nada             :567
× dos mensajeros distintos con cero filas producen el mismo aviso (D12/R38)       :601
```

El caso preexistente **no** cae aquí, y se comprobó por qué: en SU fixture
(`CierresAdminDescargaDetallada.test.tsx:98-101`) los dos mensajeros están en `mensajerosFiltro`, así
que para él la mutación es inerte. **No es un agujero de la red**: los tres rojos del diálogo la
cazan igual.

### 3.4 Veredicto sobre la fuga de R38/D12: **NO la hay**

La afirmación del implementador es cierta y está medida. La única rama nueva es

```ts
mensaje: conRango ? MENSAJE_SIN_DATOS_EN_RANGO : MENSAJE_SIN_DATOS
```

y `conRango = desde !== "" || hasta !== ""` es **estado del cliente**, escrito por el usuario en esa
misma ventana. Es idéntico en las dos llamadas de la comparación de R38, así que «este mensajero no
tiene cierres» y «este mensajero no es de tu alcance» —los dos `{ ok, items: [] }`, el servicio no
devuelve `forbidden` para el segundo— producen **el mismo texto**. Del aviso **no se puede inferir**
qué mensajeros tienen gestiones ni quién está en el alcance del actor. Ninguna rama mira `resultado`
salvo para saber si vino vacío, que es información que el usuario ya tiene por definición.

Se revisó también el sentido inverso: el texto «Los mensajeros elegidos no tienen gestiones de
cierre» **afirma** algo que puede ser falso (los tienen, pero fuera de alcance). Como se emite igual
en los dos casos, transmite cero información y R38 se cumple. Es el mismo compromiso que ya hacía el
mensaje compartido.

---

## 4. `CHECKPOINTS.md`, punto por punto

### Especificación
- [n/a] `specs/384/requirements.md` — **ficha `sdd: false`**. La fuente es el `status_note`, y el
  arreglo entregado responde a lo que ese `status_note` describe, incluida la elección entre sus dos
  salidas. No aplica.
- [n/a] `design.md` con alternativa descartada — no aplica. Aun así, la cabecera del componente
  documenta la alternativa descartada (mejorar solo el texto) y **por qué** («el texto ya estaba»).
- [n/a] `tasks.md` — no aplica.

### Trazabilidad
- [x] Cada requisito heredado en juego mapea a un test concreto **y verificado por mutación**:
  R31 -> `ofrece un rango de fechas que viaja al borde` + `una fecha vacía no viaja`; R32 -> `un
  rango invertido no produce archivo`; R34/R35 -> los dos de `independencia de la barra`; R38/D12 ->
  los tres de §3.2-3.3; R39 -> `cancelar o confirmar sin selección…`; el defecto de la ficha -> los
  dos de §3.1.
- [ ] **`progress/impl_384.md` con el mapa `R<n> -> test` — NO EXISTE.** -> `BLOQUEANTE 1`.

### Calidad de código
- [x] `pnpm run typecheck` — verde (las dos corridas).
- [x] `pnpm run lint` — verde (las dos corridas).
- [x] `pnpm test` — verde en la 2ª corrida completa: 1770/1770, 25 283 tests. La 1ª, un flake medido
      (§2.1).
- [n/a] E2E — no toca auth, pagos, recaudo, ingesta ni webhooks; y este repo no tiene harness E2E
      ejecutable.

### Datos y seguridad
- [n/a] RLS — **no hay tabla nueva**. El diff no toca `db/`, ni migraciones, ni el schema.
- [n/a] Migraciones y su reverso — ninguna. (El gate avisa de 3 migraciones de agosto sin reverso;
      son ajenas y preexistentes, no de esta rama.)
- [x] Sin secretos hardcodeados — el diff no introduce ninguna credencial ni URL.
- [n/a] Webhooks — ninguno.

### Patrón de capas
- [x] El componente es cliente puro: no importa servicio, repositorio ni Prisma; no arma `where`. La
      guardia de frontera lo comprueba estáticamente y pasó.
- [x] El recorte lo compone el servidor; el alcance no viaja (sigue resolviéndose desde la sesión).

### Permisos
- [x] El catálogo llega ya acotado al alcance por el servidor (R29); el diálogo no fetchea nada
      sensible por su cuenta.

### Multi-país y configuración
- [~] `fechaCalendarioCR()` fija el calendario de Costa Rica, pero es el helper **de toda la app**
      (48 archivos lo usan) y **ya estaba en este componente antes** de la ficha. No es un hardcode
      nuevo; queda anotado, no imputado.

### Verificación final
- [x] `./init.sh` termina en verde (2ª corrida, `INIT_EXIT=0` leído de dentro del log).
- [x] `progress/review_384.md` existe — este archivo.
- [n/a] Entrada en `progress/history.md` — la escribe el leader al cerrar la ficha (precedente:
      `chore(374)`, `chore(375)`), no el implementador en su rama. No se le imputa.

---

## 5. Hallazgos

### `BLOQUEANTE 1` — no existe `progress/impl_384.md`

`CHECKPOINTS.md > Trazabilidad` lo exige explícitamente. Comprobado de tres formas:

- `git ls-tree -r HEAD progress/` lista `impl_382.md` y `impl_388.md`, pero **ningún archivo con
  384** bajo ningún nombre.
- El commit son 4 archivos y ninguno está en `progress/`.
- **Tampoco está sin commitear**: el directorio `progress/` del worktree del implementador
  (`agent-a8071bfda2d22c0fe`) solo tiene tres archivos de otras fichas. No es «lo escribí y no lo
  commiteé»: no se escribió.

**Por qué es bloqueante y no una molestia administrativa.** Todo lo que sostiene esta entrega vive
hoy en el chat y en ningún archivo: los números del gate, qué mutaciones se aplicaron y con qué
texto exacto, y el razonamiento de por qué se eligió la salida (a) del `status_note`. Para poder
confirmar las mutaciones 1 y 6 hubo que **reconstruirlas**, no reproducirlas: no hay forma de saber
si mi mutación 6 es la del implementador o una prima suya que da el mismo número por otro camino
(§3.2 y §3.3 son dos mutaciones distintas que dan 3 rojos por caminos distintos). El precedente es
de ayer y es idéntico: `progress/review_382.md` -> `BLOQUEANTE 1` -> el implementador escribió la
bitácora en `35b6c0f2` y la ficha se cerró.

**Qué falta exactamente para cumplirlo:** un `progress/impl_384.md` commiteado en esta rama con
(1) el mapa requisito -> test de §4, (2) los números del gate **con `INIT_EXIT` leído de dentro del
log**, (3) las mutaciones con su **texto literal** y su conteo de rojos, y (4) el porqué de la
salida elegida y del alcance del atajo «Hoy». Nada más. **No se toca el código.**

### `menor 1` — el párrafo de R31 quedó a medias: el gemelo sigue diciendo lo contrario

El implementador corrigió el párrafo del tope de 5000 en la cabecera del componente (dice, con
honradez, que el «choca casi siempre» nunca se volvió a medir y que hoy producción tiene 52
cierres). **Pero el mismo párrafo sobrevive casi literal en otro archivo**,
`lib/types/filtros-cierres.ts` (líneas 138-140):

> «**`desde`/`hasta` no son un adorno** (R31): sin ellos el conjunto por defecto es TODO el
> historico del mensajero, que a grano de gestion choca contra el tope de 5000 casi de inmediato.
> Son la mitigacion de producto de ese riesgo, no una comodidad.»

Después de esta ficha, «el conjunto por defecto es TODO el histórico del mensajero» ya **no** es una
hipótesis: es literalmente el defecto. Y la afirmación que le sigue, «choca … casi de inmediato», es
justo la que el componente acaba de declarar no medida y hoy falsa. **Dos archivos del mismo camino
dicen cosas opuestas sobre el mismo riesgo.** El texto de la cabecera no miente; el que no se tocó,
ahora sí. Es un párrafo de comentario, en un archivo que la ficha no tenía por qué abrir, y por eso
es `menor` y no bloqueante. (Ojo: tocar `lib/types/` obliga al gate completo, que aquí ya se corre.)

### `menor 2` — el atajo es de ida y no de vuelta, y la ayuda perdió la instrucción de vaciar

El texto de ayuda cambió así:

- antes: «… Arranca en el día de hoy; **vaciá una fecha para quitar ese extremo**.»
- ahora: «… Vacías no recortan nada: se lleva todo el historial de los mensajeros elegidos.»

La descripción del estado vacío es correcta, pero **desapareció la única instrucción de cómo
vaciar**, y ahora hay un botón que llena los dos extremos de un clic y nada que los vacíe. Un
`input type="date"` nativo no ofrece un aspa evidente: hay que enfocar cada campo y borrar. El
usuario que pulse «Hoy» para ver el día y luego quiera volver a «todo» tiene que descubrir cómo. La
instrucción sobrevive, pero solo dentro del mensaje de error («vaciá las fechas y volvé a
intentarlo»), es decir, solo si ya se topó con el conjunto vacío. Se sugiere **o** devolver el
«vaciá una fecha…» a la ayuda **o** darle al atajo su contrapartida. No bloquea.

### `menor 3` — el defecto nuevo es ilimitado, y eso hay que mirarlo con el tiempo

El conjunto por defecto pasa a ser todo el histórico de toda la flota. Hoy queda lejísimos del tope
(52 cierres en producción, arranque comercial del 2026-08-25), y el modo de fallo del otro lado está
verificado y es bueno: lo aplica el **servidor** y `mensajeLimite()` dice el total, dice el tope y
dice «acota los filtros, por ejemplo el rango de fechas»
(`components/shared/descarga-resultado.ts`). Cambiar un resultado callado y equivocado por un aviso
ruidoso y accionable es el intercambio correcto. Queda anotado como **algo que vigilar**, no como
defecto: el día que el histórico crezca, el botón por defecto empezará a fallar hasta que el usuario
acote, y ese día conviene que el atajo «Hoy» (o un «último mes») siga a la vista. No bloquea.

### `menor 4` — el caso de D12 no clava ninguno de los dos textos

`dos mensajeros distintos con cero filas producen el mismo aviso` compara `calls[1][0]` con
`calls[0][0]` y nada más: si los dos fueran `undefined`, pasaría. El agujero está cerrado **en la
práctica** por sus dos hermanos, que sí fijan los literales sobre el mismo componente, y por el caso
preexistente de la pantalla. Anotado por completitud. No bloquea.

### `menor 5` — el texto de ayuda visible no lo fija ningún test

`RANGO_AYUDA` es copy que el usuario lee y que esta ficha cambió, y ningún caso lo afirma. Editarlo
mañana para que vuelva a mentir no pondría nada rojo. Es la norma del archivo (tampoco se fija
`MENSAJE_SIN_MENSAJERO` entero), así que no se le imputa a esta ficha; queda dicho porque es
exactamente el tipo de fallo mudo que esta ficha vino a cerrar.

---

## 6. El botón «Hoy»: decisión valorada, no defecto

El implementador lo declara como lo único más allá del arreglo mínimo y ofrece vetarlo.
**Recomendación del revisor: conservarlo.**

**A favor**

- El pedido humano del 2026-08-19 era real y sigue vivo: la descarga que se pide a diario es el
  cierre del día de toda la flota. Quitar el defecto **sin sustituto** encarece ese caso de cero
  interacciones a cuatro (abrir dos selectores de fecha y teclear la misma fecha dos veces), y en un
  campo de tipo fecha eso no es trivial. El atajo lo deja en **un clic**, menos que los «dos clics
  de fecha» que aquel defecto vino a ahorrar.
- **No reintroduce el defecto: lo invierte.** El fallo era «un filtro que el usuario no puso». Un
  botón que el usuario pulsa es, por definición, un filtro que sí puso. La autoría del recorte, que
  es el corazón de la ficha, cambia de manos.
- El coste de superficie es un botón dentro de un diálogo que ya tiene cinco controles, y está
  **colocado con los campos que rellena**, no en el pie: se lee como un control DE esos campos.
- Está cubierto (afirma los **dos** extremos y que el rango viaja al borde) y está bien construido
  (§1.6): fecha al pulsar, calendario de CR, nombre accesible que empieza por la palabra visible.

**En contra, dicho honestamente**

- Es alcance por encima del mínimo, y este repo ha descartado specs por proponer de más. La
  diferencia aquí es que **no introduce modelo nuevo ni rediseña nada**: son seis líneas de
  componente y dos constantes.
- Abre la puerta a la acumulación de atajos («Ayer», «Últimos 7 días», «Este mes»). Ése es su coste
  real, y es futuro. Se cierra diciendo que no al siguiente.
- Deja la asimetría del `menor 2`: llena de un clic, vacía a mano.

**Si el humano prefiere vetarlo:** es seguro y barato. El arreglo de la ficha **se sostiene entero
sin él** (el defecto estaba en el `useState`, no en el botón) y quitarlo cuesta borrar el `Button`,
`ponerHoy`, dos constantes y un caso de test; ningún otro test depende de él. La única pérdida es la
comodidad del pedido del 2026-08-19. La opinión del revisor es que esa comodidad era legítima y que
este botón es la forma correcta de conservarla: convierte un defecto silencioso en una acción
explícita, que es justo la lección de la ficha.

---

## 7. Veredicto

**RECHAZADO**, por el `BLOQUEANTE 1` y solo por él.

- **Bloqueantes de código: 0.** No hay que tocar `DescargarGestionesDialog.tsx` ni los tests.
- La fuga de R38/D12 que había que descartar **no existe**, y está medida con tres mutaciones.
- El test nuevo **sí** vigila el defecto: 2 rojos al restaurar el código de ayer.
- El control compartido de las ~26 tablas está intacto, byte a byte.
- Gate completo verde, corrido por el revisor, con los 132 archivos contra Postgres **ejecutados**.

Vuelve al implementador **solo** para escribir `progress/impl_384.md` (contenido exigido al final
del `BLOQUEANTE 1`) y, si quiere cerrarlo de paso, el `menor 1`, que es un párrafo. Con eso, `OK`.
