# Ficha 429 — bitácora del BACKEND (T1–T19)

**Rama:** `feat/429-sinpe-por-bodega`. **Base:** `a876b002`.
**Alcance ejecutado:** T1–T19 salvo T19 (ver «Lo que no se hizo»). T20–T23 son de la pasada de
frontend.

---

## 0. La decisión del leader que cambió la Fase 0, y cómo quedó

El `design.md` proponía sembrar el número y el titular como **literales en `migration.sql`**. El
leader lo vetó el 2026-09-15: **el repositorio es PÚBLICO** y eso publica en internet, de forma
permanente, un móvil real de Costa Rica y el nombre de una persona — quitarlo después no sirve,
`git` conserva la historia.

**La siembra va en tres pasos, y así está implementada:**

| Paso | Qué | Dónde |
| --- | --- | --- |
| 1 | las tres columnas, **NULLABLES**, sin `CHECK`, sin `DEFAULT`, sin escribir ni un valor | `db/migrations/20260918120100_zona_sinpe/` |
| 2 | el trasvase: lee `NEXT_PUBLIC_SINPE_*` **del entorno** y rellena las que están en `NULL` | `scripts/seed-sinpe-inicial.ts` |
| 3 | el `NOT NULL` y los dos `CHECK`, una vez lleno | `db/migrations/20260918120200_zona_sinpe_no_nulo/` |

**NINGÚN archivo versionado lleva un SINPE real.** Los tests y los fixtures usan `80000000` /
`70000001` y «Titular de Prueba». Hay un caso de la suite de migración que lo vigila: *«la migración
de las columnas NO escribe NINGÚN valor»*, y además prohíbe cualquier literal de ocho dígitos en ese
archivo.

### ⚠️ EL ORDEN DE DESPLIEGUE NO ES OPCIONAL, y hay que decidirlo antes de mergear

`prisma migrate deploy` aplica **todas** las migraciones pendientes de un tirón. Si el paso 3 está en
el árbol cuando el paso 1 se aplica por primera vez a una base con zonas, **el build muere** — a
propósito: la migración lleva un `DO $$ … RAISE EXCEPTION` que nombra el script que hay que correr,
en vez del críptico «column contains null values». Está **medido** en la suite:
*«el paso 3 ABORTA mientras haya bodegas sin sembrar, y no deja nada a medias»*.

**Local:** se aplicó en el orden correcto (paso 1 → seed con valores ficticios → paso 3) y
`prisma migrate status` dice *Database schema is up to date!* sin drift.

**Producción / preview: hay que elegir una de las dos, y es decisión del leader.**

1. **Dos despliegues.** Retirar `20260918120200_zona_sinpe_no_nulo` de este PR, desplegar, correr
   `pnpm exec tsx scripts/seed-sinpe-inicial.ts` contra la base, y meter esa migración en el PR de
   la pasada de frontend. Es lo que el plan de tres pasos implica literalmente.
2. **Sembrar antes de desplegar.** Aplicar los pasos 1 y 2 a mano contra prod (MCP de Supabase) y
   después desplegar el PR entero, que ya encontrará las columnas llenas.

No se eligió por el implementador: cambia el plan de release.

---

## 1. Archivos

### Creados

| Archivo | Qué |
| --- | --- |
| `lib/utils/sinpe-cr.ts` | normalización + predicado + los dos esquemas zod (T1) |
| `lib/utils/sinpe-bodega.ts` | `resolverSinpeBodega`: LA regla, una sola función pura (T2) |
| `lib/types/sinpe-bodega.ts` | DTO, esquema `.strict()`, resultados y `ROLES_QUE_EDITAN_SINPE` |
| `lib/interfaces/services/ISinpeBodegaService.ts` | contrato del servicio (T9) |
| `lib/services/SinpeBodegaService.ts` | la regla de permiso de R19/R20 (T9) |
| `lib/actions/sinpe-bodega.ts` | las tres Server Actions (T10) |
| `lib/auth/revision-sinpe-pendiente.ts` | el resolvedor de la revisión del primer login (T18) |
| `scripts/seed-sinpe-inicial.ts` | el trasvase entorno → base, idempotente |
| `db/migrations/20260918120000_historial_accion_zona_sinpe/` | el valor nuevo del enum + su `down` (T3) |
| `db/migrations/20260918120100_zona_sinpe/` | las tres columnas nullables + su `down` (T4) |
| `db/migrations/20260918120200_zona_sinpe_no_nulo/` | `NOT NULL` + los dos `CHECK` + su `down` |
| `tests/fixtures/sinpe-casos.ts` | la tabla de casos, escrita UNA vez para los DOS jueces |

Tests nuevos: `tests/unit/utils/sinpe-cr.test.ts`, `tests/unit/utils/resolver-sinpe.test.ts`,
`tests/unit/repositories/orden-envio-reader.test.ts`,
`tests/unit/services/sinpe-bodega-service.test.ts`,
`tests/unit/services/chat-whatsapp-sinpe-del-servidor.test.ts`,
`tests/unit/auth/revision-sinpe-pendiente.test.ts`,
`tests/integration/actions/sinpe-bodega-action.test.ts`,
`tests/integration/db/historial-accion-zona-sinpe-migration.test.ts`,
`tests/integration/db/zona-sinpe-migration.test.ts`,
`tests/integration/db/zona-sinpe-rastro.test.ts`,
`tests/integration/db/zona-sinpe-revision.test.ts`,
`tests/integration/db/zona-sinpe-permisos.test.ts`,
y las tres guardias: `tests/unit/guards/sinpe-sin-variables-de-entorno.guardia.test.ts`,
`tests/unit/guards/sinpe-en-toda-superficie.guardia.test.ts`,
`tests/unit/guards/revision-sinpe-no-bloquea.guardia.test.ts`.

### Modificados (producción)

`db/schema.prisma` (los tres campos de `Zona` + el valor del enum),
`lib/types/historial-accion.ts` (el tipo nuevo, su categoría y su etiqueta),
`lib/types/zona.ts` (los dos campos en `crearZonaSchema`, **no** en `actualizarZonaSchema`),
`lib/types/novedad.ts`, `lib/types/plantilla-datos.ts` (el `campo` documental deja de citar el
entorno), `lib/utils/whatsapp-envio-valores.ts` (`negocioDesdeEnv` → `negocioConSinpe`),
`lib/interfaces/repositories/IZonaRepository.ts`, `…/IGestionOrdenRepository.ts`,
`…/IOrdenRepository.ts`, `lib/interfaces/services/IMisAsignacionesService.ts`,
`lib/repositories/ZonaRepository.ts`, `…/OrdenEnvioReader.ts`, `…/GestionOrdenRepository.ts`,
`…/OrdenRepository.ts`, `lib/services/ZonaService.ts`, `…/MisAsignacionesService.ts`,
`…/NovedadesService.ts`, `scripts/seed-zonas.ts`, `.env.example`.

### Los productores del DTO que el typecheck enumeró (T14)

Los dos campos son **requeridos** en `MiAsignacionDTO`, así que el compilador listó a todos:

1. `MisAsignacionesService.toDTO` (y por él `RecoleccionTiendaService.toRecoleccionOrdenDTO`, que
   la reutiliza);
2. `NovedadesService.listarNovedades` (`NovedadDTO extends MiAsignacionDTO`);
3. y las dos FILAS que los alimentan: `MiAsignacionRow` (`GestionOrdenRepository`) y
   `NovedadOrdenRow` (`OrdenRepository.findNovedadesByTienda`).

**Cero consultas nuevas en el camino del envío** (`OrdenEnvioReader`): las dos columnas entran en
los `select` de zona que ese método ya hacía, y el test lo comprueba contando llamadas a Prisma.
En los otros dos caminos se añade la relación `mensajeroAsignado.zona` acotada a las dos columnas —
**no** se ensanchó `NOMBRE_USUARIO_SELECT`, que es la identidad y la comparten otras lecturas.

---

## 2. Mapa `R<n>` → test

| R | Test |
| --- | --- |
| R1 | `integration/db/zona-sinpe-migration.test.ts` · «las tres columnas existen, con su tipo y su ancho» |
| R2 | `integration/db/zona-sinpe-permisos.test.ts` · «dos `adminSatelite` de la MISMA bodega…» |
| R3 | `unit/services/usuario-zona.test.ts` · «dar de alta un SEGUNDO acceso… NO pide el SINPE ni lo pisa» |
| R4 | `integration/db/zona-sinpe-migration.test.ts` (la columna) + `zona-sinpe-rastro.test.ts` (la escribe el camino de escritura) |
| R5 | `integration/db/zona-sinpe-revision.test.ts` · «una bodega SEMBRADA se distingue de una revisada» |
| R6 | `integration/db/zona-sinpe-migration.test.ts` · «un INSERT sin SINPE lo rechaza POSTGRES» |
| R7 | `integration/db/zona-sinpe-migration.test.ts` (`it.each` sobre `CASOS_SINPE`) + `unit/utils/sinpe-cr.test.ts` |
| R8 | `integration/db/zona-sinpe-migration.test.ts` · «espacio en blanco de CUALQUIER clase» + `unit/utils/sinpe-cr.test.ts` |
| R9 | `unit/utils/sinpe-cr.test.ts` · bloque «la normalizacion, y lo que NO normaliza» + `integration/actions/sinpe-bodega-action.test.ts` |
| R10 | `integration/db/zona-sinpe-migration.test.ts` · «la siembra REAL deja las ocho con el mismo par y NINGUNA revisada» + «segunda corrida: CERO rellenadas, y la corrección HUMANA no se pisa» (los dos **llaman a `sembrarSinpeInicial`**) · y `unit/scripts/seed-sinpe-inicial.test.ts` para `leerSemilla` y la forma de la escritura |
| R11 | `unit/types/zona-schema.test.ts` + `integration/actions/zonas-action.test.ts` + `unit/services/zona-service.test.ts` |
| R12 | `integration/db/zona-sinpe-revision.test.ts` · «crear una bodega la deja REVISADA» |
| R13 | `unit/utils/resolver-sinpe.test.ts` + `unit/repositories/orden-envio-reader.test.ts` |
| R14 | `unit/guards/sinpe-en-toda-superficie.guardia.test.ts` + contraprueba de `typecheck` (§4) |
| R15 | `unit/utils/resolver-sinpe.test.ts` + `unit/repositories/orden-envio-reader.test.ts` |
| R16 | `unit/plantillas/preview-mismo-motor.test.ts` · «el servidor y el dispositivo producen el MISMO texto, carácter a carácter» |
| R17 | `unit/guards/sinpe-sin-variables-de-entorno.guardia.test.ts` (con dos contrapruebas) |
| R18 | `unit/services/chat-whatsapp-sinpe-del-servidor.test.ts` |
| R19 | `unit/services/sinpe-bodega-service.test.ts` (matriz rol × 8 bodegas) + `integration/actions/sinpe-bodega-action.test.ts` |
| R20 | `integration/db/zona-sinpe-permisos.test.ts` + `unit/services/sinpe-bodega-service.test.ts` |
| R21 | `integration/db/zona-sinpe-rastro.test.ts` · «un número distinto escribe UNA fila…» |
| R22 | `unit/historial-accion/catalogo-y-choke-point.test.ts` · «FICHA 429 (R22)…» |
| R23 | `integration/db/zona-sinpe-rastro.test.ts` · «el TITULAR no aparece en NINGUNA columna» |
| R24 | `integration/db/zona-sinpe-rastro.test.ts` · «si el registro revienta…» + `unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` |
| R25 | `integration/db/zona-sinpe-rastro.test.ts` + `zona-sinpe-revision.test.ts` |
| R26 | `unit/auth/revision-sinpe-pendiente.test.ts` |
| R27 | `tests/components/RevisionSinpeBodega.test.tsx` · «429/R27 — se corrige EN EL SITIO, sin abandonar la pantalla» (guardar desde el propio aviso, y el número inválido pintando el error junto al campo) |
| R28 | `unit/guards/revision-sinpe-no-bloquea.guardia.test.ts` (la mitad estructural; el montaje llega en T19/T22) |
| R29 | `tests/components/RevisionSinpeBodega.test.tsx` · «429/R28+R29 — cerrarlo no confirma nada, y vuelve al siguiente ingreso» (con la marca de sesión no se pinta; sin ella, vuelve; la marca es POR bodega) |
| R30 | `unit/auth/revision-sinpe-pendiente.test.ts` · «con fecha de revisión… nada que pedir», para los dos administradores |
| R31 | `unit/auth/revision-sinpe-pendiente.test.ts` · «NO EMITE NINGUNA CONSULTA» |

---

## 3. Lo que NO se hizo, y por qué

### T19 (cablear el layout) — diferido a la pasada de frontend

Su criterio de «hecho» es *montar `RevisionSinpeBodega` como hermano de `{children}`*, y ese
componente es **T22**, que va después de la puerta de `/design` (D7). Calcular en el layout un valor
que nadie consume sería código muerto en la ruta que se pinta en **todas** las páginas del portal.
**T18 sí está entero** (`resolverRevisionSinpePendiente` + su suite), así que T19 es una llamada y
un montaje.

La guardia 3 de T16 ya está escrita y es **condicional a propósito**: hoy afirma que el aviso no
existe; en cuanto exista, afirma que es HERMANO y no envoltorio. Llega antes que el componente, que
es el único momento en que una guardia sirve de algo.

### ⚠️ BLOQUEO MEDIDO: el formulario de zonas se quedó sin los dos campos

T11 puso `sinpeNumero`/`sinpeNombre` como **obligatorios** en `crearZonaSchema` (R11). El formulario
del CRUD de zonas —`app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx`, línea 189—
valida el payload contra **ese mismo esquema** antes de llamar a la acción, y no recoge los dos
campos. Resultado medido: **no envía nada**, y con él caen cuatro archivos de test.

```
FAIL tests/components/CrearZonaFormReconciliacion.test.tsx   (11 casos)
FAIL tests/components/ZonaCentralConfirmacion.test.tsx       (14 casos)
FAIL tests/components/ZonaDistritoEspecial.test.tsx          ( 2 casos)
FAIL tests/components/ZonaNombreNoImprimible.test.tsx        ( 4 casos)
```

**No se arregló porque es UI y el encargo lo excluye explícitamente.** El arreglo es pequeño y está
acotado: dos `FormField` en ese formulario (con `sinpeNumeroSchema`/`sinpeNombreSchema` para el
error junto al campo) y añadirlos al objeto `candidate` de `validar()`. **No es la pantalla nueva**
de T21 (`/configuracion/sinpe`), así que no depende de `/design`.

Mientras no se haga, **crear una zona desde la aplicación no funciona**. Es una consecuencia
declarada de R11, no un efecto colateral inesperado.

---

## 4. Verificación

### Las tres mutaciones exigidas (design §8.4) — todas matan algo

**(a) el `CHECK` relajado a `^[0-9]{8}$`**

```
× el `CHECK` del numero es el formato de R7, no un «no vacio»
× ⭑ R7 — la base y el validador dan el MISMO veredicto sobre "12345678" (aceptado=false)
× ⭑ R7 — la base y el validador dan el MISMO veredicto sobre "22345678" (aceptado=false)
× ⭑ R7 — la base y el validador dan el MISMO veredicto sobre "50612345" (aceptado=false)
 Tests  4 failed | 27 passed (31)     [tests/integration/db/zona-sinpe-migration.test.ts]
```

**(b) el resolvedor devuelve siempre la zona de la orden**

```
× con mensajero de otra bodega, el par es el de SU bodega, no el de la zona de la orden
× los DOS campos viajan juntos: no se puede acabar con el numero de uno y el nombre de otro
× ⭑ con un mensajero de OTRA bodega, el par es el de SU bodega
× los dos campos viajan juntos: nunca el numero de una y el nombre de otra
× ⭑ R17 — el `negocio` NO lee ninguna variable de entorno del SINPE
× ⭑ el servidor y el dispositivo producen el MISMO texto, caracter a caracter
 Test Files  3 failed (3)
      Tests  6 failed | 17 passed (23)
```

**(c) `appendAccion` recibe `this.prisma` en vez de `tx`**

```
× ZonaRepository.ts#guardarSinpe registra su accion en la misma transaccion que la escribe
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 64 passed (65)
```

> ⚠️ **Hallazgo que conviene dejar escrito:** la mutación (c) **NO** la caza
> `zona-sinpe-rastro.test.ts`, y es estructural: ahí `this.prisma` **es** el cliente de la
> transacción del test (`clienteConSavepoint(tx)`), así que escribir «fuera» escribe dentro. La
> única red contra esa mutación es la **guardia estática del censo**. Si alguien la retirara
> «porque ya hay un test de integración», el agujero de la 373 volvería entero.

### La contraprueba del typecheck (T14, R14)

**Quitarle el par a un productor:**

```
lib/services/MisAsignacionesService.ts(784,3): error TS2739: Type '{ … }' is missing the
following properties from type 'MiAsignacionDTO': sinpeNumero, sinpeNombre
```

**Volver los campos opcionales** (apaga el compilador sin romper ningún test): lo caza la guardia.

```
× ⭑ `MiAsignacionDTO` declara `sinpeNumero: string` y `sinpeNombre: string`, sin `?`
 Tests  1 failed | 8 passed (9)   [sinpe-en-toda-superficie.guardia.test.ts]
```

### La contraprueba de T8 (el censo del historial)

Comentar la llamada a `appendAccion` de `guardarSinpe` pone roja
`historial-accion-escrituras-cubiertas.guardia.test.ts` por la vía de la forma de atomicidad —
lo mismo que hace la mutación (c) de arriba, que es esa contraprueba ejecutada.

### Un defecto REAL que la tabla de casos compartida cazó

El `design.md` proponía `CHECK (btrim("sinpe_nombre") <> '')`. **`btrim` sin segundo argumento
recorta SOLO el espacio 0x20**, así que un titular de un único **tabulador** pasaba el `CHECK`
mientras `sinpeNombreSchema` —que usa el `.trim()` de JavaScript— lo rechazaba. Dos fuentes del
mismo formato, dos veredictos: exactamente el precio declarado de tener la regla en los dos sitios.
El `CHECK` pasa a `~ '[^[:space:]]'`.

### Una trampa del entorno que costó 18 archivos rojos

Los parches se aplicaron con Python, y `io.open(..., "w")` en Windows traduce `\n` a `\r\n`. Eso
convirtió a CRLF **en el árbol de trabajo** todos los archivos tocados —incluido
`db/schema.prisma`—, y **cuatro guardias que leen el esquema y el árbol dejaron de encontrar nada**:
`api-key-dependencias-usuario` reportó *«expected 0 to be greater than 40»*. Git normaliza al
commitear, así que el blob estaba bien y el diff no lo mostraba. Se normalizó a LF todo lo que esta
rama toca (110 archivos) y las cuatro volvieron a verde sin tocar una línea de lógica.

---

## 5. Salidas reales

`pnpm run typecheck` → **limpio, sin una sola línea de salida.**

`pnpm run lint` → **0 errores**, 200 warnings (`no-unused-vars` de parámetros con `_`, los mismos
que ya traía `dev`; uno de ellos es del archivo nuevo `chat-whatsapp-sinpe-del-servidor.test.ts`).

### `./init.sh` COMPLETO — `progress/gate_429_backend.log`

El rápido **se niega solo** con este diff (migraciones + `db/schema.prisma` + `lib/types/**`), así
que el veredicto sale del completo. Corrido dos veces; estas son las cifras de la **segunda**, sobre
el árbol ya commiteado:

```
✓ typecheck paso
✓ lint paso            (0 errores; 200 warnings de `no-unused-vars`, los mismos que traía `dev`)

 Test Files   4 failed | 1986 passed (1990)
      Tests  32 failed | 29007 passed | 26 skipped (29065)
   Duration  638.63s

INIT_EXIT=1
```

#### ⚠️ LOS `skipped`, MIRADOS — el veredicto de la capa de datos SÍ vale

**26 saltados, y los 26 están identificados**: `AnaliticaPage.test.tsx` (17) y
`AnaliticaShell.test.tsx` (9). Son los dos de siempre. **NO son los ~147-183 archivos de
`tests/integration/db` que se saltan cuando falta `DATABASE_URL`** — esta ficha vive justo ahí, y un
«init OK» con la capa de datos saltada no habría valido nada.

**Medido, no supuesto: `273` archivos de `tests/integration/db/` corrieron en verde**, incluidos los
cinco nuevos de esta ficha. El `.env` se copió al worktree para el gate y **se borra al terminar**;
no está commiteado (`.gitignore` cubre `.env*`) y se comprobó que no entra en el índice.

Las suites nuevas, una a una:

```
✓ tests/integration/db/zona-sinpe-migration.test.ts                   (31 tests) 2063ms
✓ tests/integration/db/historial-accion-zona-sinpe-migration.test.ts  (17 tests) 1013ms
✓ tests/integration/db/zona-sinpe-rastro.test.ts                      ( 6 tests)  538ms
✓ tests/integration/db/zona-sinpe-permisos.test.ts                    ( 3 tests)  893ms
✓ tests/integration/db/zona-sinpe-revision.test.ts                    ( 4 tests)  470ms
✓ tests/integration/actions/sinpe-bodega-action.test.ts               (10 tests)   22ms
✓ tests/unit/auth/revision-sinpe-pendiente.test.ts                    (12 tests)   13ms
✓ tests/unit/guards/sinpe-sin-variables-de-entorno.guardia.test.ts    ( 6 tests)  831ms
✓ tests/unit/guards/sinpe-en-toda-superficie.guardia.test.ts          ( 9 tests)  960ms
✓ tests/unit/guards/revision-sinpe-no-bloquea.guardia.test.ts         ( 7 tests) 1110ms
```

#### Los 4 rojos: un solo defecto, y está fuera de alcance

```
❯ tests/components/CrearZonaFormReconciliacion.test.tsx (11 tests | 11 failed)
❯ tests/components/ZonaCentralConfirmacion.test.tsx     (15 tests | 15 failed)
❯ tests/components/ZonaNombreNoImprimible.test.tsx      ( 4 tests |  4 failed)
❯ tests/components/ZonaDistritoEspecial.test.tsx        ( 5 tests |  2 failed)
```

Los 32 casos caen por **la misma causa**: `CrearZonaForm` valida contra `crearZonaSchema`, que desde
T11 exige los dos campos del SINPE, y el formulario no los recoge — así que no llega a llamar a la
acción («expected vi.fn() to be called … got 0 times»). Es el §3 de esta bitácora.

**`tests/baseline-rojos.json` tiene `archivos: {}`**, así que el gate falla por estos cuatro y hace
bien: son deuda de ESTA rama, no de `dev`. **No se añaden al baseline**: el propio archivo lo
prohíbe («nunca añadas un archivo aquí para pasar el gate»), y aquí ni siquiera es deuda ajena — es
la mitad de la ficha que falta.

#### Primera corrida (antes del commit de arreglos), para que quede la traza

```
 Test Files  23 failed | 1967 passed (1990)
      Tests 100 failed | 28875 passed | 26 skipped (29001)
INIT_EXIT=1
```

De los 23, **19 eran ruido propio** y están cerrados en `cf44256d`: 12 por el CRLF del §4, 5 por
`INSERT INTO "zona"` crudos, y 2 por censos que esta ficha obliga a actualizar (el orden del enum de
la 398 y la lista de migraciones posteriores de la 427). Los 4 que quedan son los de arriba.


---
---

# Ficha 429 — bitácora del FRONTEND (T21, T22, T23, T19)

**Rama base:** `feat/429-sinpe-por-bodega`, commit `a9e9b5c9` (final del backend).
**Alcance ejecutado:** el arreglo del formulario de zonas que tenía el gate en rojo, **T21**
(las dos pantallas), **T22** (el aviso del primer ingreso), **T19** (el cableado del layout) y
**T23** (el ítem de menú).

---

## 0. Lo primero: el rojo que dejó T11, cerrado

`crearZonaSchema` exige `sinpeNumero`/`sinpeNombre` desde T11, y `CrearZonaForm` validaba su
payload contra ESE esquema sin recoger los dos campos: **crear una zona desde la aplicación no
funcionaba**, y caían 4 archivos con 32 casos.

El arreglo tiene DOS mitades, y la segunda no estaba en el encargo:

1. **Los dos campos**, en un `fieldset` propio con su `FormField` cada uno (pista, `required`, y el
   error JUNTO A SU CAMPO por `aria-describedby`), y los dos añadidos al `candidate` de `validar()`.
2. **`validar()` pasa a elegir esquema por modo.** Con un solo esquema el arreglo no podía estar
   completo: `actualizarZonaSchema` **no** lleva el par —el SINPE se edita por su propia acción, y
   meterlo en el reemplazo completo de `actualizarZona` dejaría que un guardado de distritos pisara
   en silencio la corrección de un `adminSatelite`— y los dos esquemas son `.strict()`. Validar
   siempre contra el de crear rompía las dos ramas a la vez: al crear no se recogían los campos, y
   al editar se habrían mandado a un esquema que los rechaza.

   Se elige por `zonaIdGuardada` y **no** por `mode`, que es la MISMA condición que ya decide a qué
   acción se llama en `enviar()`: tras crear con éxito, un reintento es una actualización aunque el
   modo siga siendo «crear». Dos condiciones distintas para la misma bifurcación divergirían sin que
   nada se pusiera rojo.

**Los cuatro archivos vuelven a verde (35/35).** Los 8 casos que quedaban tras el arreglo eran de
modo «crear» y no tecleaban el SINPE: se arreglan **aportando el dato**, nunca aflojando el esquema
(`tests/fixtures/sinpe-en-formulario-zona.ts`, que busca los campos por ROL y nombre accesible, así
que se rompe si algún día el campo deja de estar etiquetado).

---

## 1. Archivos

### Creados — producción

| Archivo | Qué |
| --- | --- |
| `app/(app)/mi-bodega/page.tsx` | Server Component, gate por `ROLES_MI_BODEGA` (T21-A) |
| `app/(app)/mi-bodega/_components/MiBodegaSinpeModule.tsx` | la tarjeta + la vista previa + el aviso |
| `app/(app)/configuracion/sinpe/page.tsx` | Server Component, gate por `puedeEditarAlgunSinpe` (T21-B) |
| `app/(app)/configuracion/sinpe/_components/SinpeBodegasModule.tsx` | la tabla de las 8 y su modal |
| `components/shared/RevisionSinpeBodega.tsx` | el aviso del primer ingreso (T22) |
| `components/shared/SinpeCampos.tsx` | los DOS campos, escritos una vez para las TRES superficies |
| `components/shared/SinpeMensajePreview.tsx` | el mensaje real con el par resaltado |
| `components/shared/sinpe-preview-segmentos.ts` | el mensaje partido en trozos, con el MISMO motor del envío |
| `components/shared/SinpeAvisoRiesgo.tsx` | el aviso que nombra el daño |
| `components/shared/sinpe-textos.ts` | todo el texto de la superficie, en un solo sitio |

### Modificados — producción

`app/(app)/layout.tsx` (T19: la tercera lectura y el montaje), `lib/auth/menu-visibility.ts`
(T23: `ROLES_MI_BODEGA`, el ítem «Mi bodega» y el subítem «SINPE por bodega»),
`app/(app)/_components/Sidebar.tsx` (el icono `warehouse`),
`app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx` (el §0),
`lib/actions/sinpe-bodega.ts` (**se retiran las tres anotaciones `@sin-superficie`**: la
excepción CADUCA con el montaje, y dejarla habría fosilizado una excepción que
`superficie-de-uso.guardia` se come en silencio).

### Tests

Nuevos: `tests/components/MiBodegaSinpe.test.tsx` (15), `tests/components/RevisionSinpeBodega.test.tsx`
(11), `tests/components/SinpePorBodegaTabla.test.tsx` (11), `tests/unit/auth/menu-mi-bodega.test.ts`
(15), `tests/fixtures/sinpe-en-formulario-zona.ts`.

Actualizados: `tests/components/AppLayout.test.tsx` (5 casos de T19),
`tests/components/Sidebar.test.tsx` (`warehouse` en el censo de `IconKey`),
`tests/unit/auth/menu-visibility.test.ts` (las dos listas comparadas por igualdad),
`tests/unit/guards/pwa-manifiesto-atajos.guardia.test.ts` (destinos por rol: `maestro` 19→20,
`adminSatelite` 6→7; los otros tres NO se mueven, y eso es la mitad de lo que se afirma),
`tests/unit/descarga/censo-tablas.ts` + `cobertura-tablas.guardia.test.ts` (la tabla nueva, `fuera`),
y los cuatro del §0.

---

## 2. Las decisiones que no estaban en el encargo

### 2.1 «Último cambio» pasa a decir **«Última revisión»**

El diseño aprobado rotulaba la columna y el pie de la tarjeta como «Último cambio: <persona> ·
<fecha>». Se entrega **«Última revisión: <fecha>»**, sin persona, por dos motivos medidos:

- **La persona NO está en `SinpeBodegaDTO`.** Vive en `historial_accion`, cuya lectura es
  `maestro`-only (`ROLES_HISTORIAL_ACCIONES`), así que el `adminSatelite` —el destinatario de
  `/mi-bodega`— no puede verla. Traerla es backend nuevo y está fuera de este alcance.
- **«Cambio» sería falso la mitad de las veces.** Lo que se pinta es `zona.sinpe_revisado_at`, y esa
  fecha se mueve TAMBIÉN cuando alguien confirma **sin cambiar nada** —R25 dice que eso no deja fila
  de historial precisamente porque no cambió nada—. Titularlo «Último cambio» le diría a la oficina
  que ese día alguien tocó el número, y a veces no será verdad: un dato falso en una pantalla de
  dinero, que es la familia de fallo entera de esta ficha.

**Es reversible con dos líneas** (`SINPE_OFICINA.columnaRevision` y `SINPE_MI_BODEGA.ultimaRevision`)
si el humano prefiere el rótulo original; lo que no se puede entregar sin backend es el «quién».

### 2.2 El `admin` no tiene entrada de menú a «SINPE por bodega»

El subítem cuelga de «Configuración», que es **`maestro`-only desde antes de esta ficha**. Abrirlo al
`admin` le regalaría además Usuarios, Tarifas y API, que no lo pidió nadie. El gate de la página SÍ
lo deja entrar (`puedeEditarAlgunSinpe`), así que llega por URL o desde el aviso del primer ingreso.
**Queda dicho, no resuelto a la brava:** es una decisión de permisos de menú, no de esta ficha.

### 2.3 La vista previa lee la plantilla REAL de la base

`/mi-bodega` lee `PlantillaMensajeRepository.findByNombre("listo_para_entrega_mensajero")` desde el
Server Component —el mismo patrón con el que `app/(app)/layout.tsx` lee `UserRepository`—. No pasa
por `listarPlantillas`, que es `maestro`-only y devolvería `forbidden` justo al rol al que sirve esta
pantalla. **Si la plantilla no está sincronizada, la pantalla LO DICE**: no se hornea un cuerpo de
repuesto, porque una vista previa que existe para comparar contra el mensaje de verdad y enseña uno
inventado es peor que no tener vista previa.

El render usa `renderPlantilla(cuerpo, resolverValoresPlantilla(...))`, que es **literalmente** el par
de llamadas del envío. El resaltado se hace con centinelas —no con una segunda regex de `{{clave}}`—
para no crear otra fuente que pueda divergir de `PLACEHOLDER_RE`.

### 2.4 La tabla de las 8 bodegas entra al censo como `fuera`

Cuarto motivo distinto en ese censo, y ninguno de los tres anteriores servía: **no es un libro**. Son
ocho filas de configuración que caben enteras en la pantalla, sin paginación ni acción de dataset
completo; y lo único exportable de ellas es la lista de las ocho cuentas a las que cobran los
clientes, que a quien administra no le da nada que no tenga delante.

---

## 3. Verificación

### 3.1 Las tres mutaciones de esta pasada — las tres matan algo

**(a) el chip «Sin revisar» pasa a `danger`** (la alarma roja que la ficha descarta)

```
FAIL tests/components/SinpePorBodegaTabla.test.tsx > ⭑ el chip es `warning` y NO una señal de error
     Tests  1 failed | 10 passed (11)
```

**(b) «Ahora no» confirma la bodega** (el cierre que marca como revisado sin que nadie lea nada)

```
FAIL tests/components/RevisionSinpeBodega.test.tsx > ⭑ «Ahora no» NO llama a ninguna acción
     Tests  1 failed | 10 passed (11)
```

**(c) la vista previa usa un cuerpo de relleno en vez del real de la plantilla**

```
FAIL tests/components/MiBodegaSinpe.test.tsx > ⭑ pinta el cuerpo de la plantilla con los demás campos ya resueltos
     Tests  1 failed | 14 passed (15)
```

Las tres se revirtieron y las suites volvieron a verde (37/37 en los tres archivos).

### 3.2 Una trampa del entorno, encontrada y cerrada

`components/shared/sinpe-preview-segmentos.ts` se escribió con `\u0000` como literal y la
herramienta dejó **cinco BYTES NUL de verdad dentro del fuente**. Un archivo con NUL deja de ser
texto para `git`: el diff se vuelve ilegible y la normalización de `.gitattributes` no aplica. Se
reescribió construyendo el centinela con `String.fromCharCode(0)`, **sin ningún literal de escape en
el fuente**, y se barrió el árbol entero: 0 archivos NUL/CRLF entre los tocados por esta pasada (los
10 que quedan en el repo vienen de `dev` y no los toca esta rama).

### 3.3 `./init.sh` COMPLETO — `progress/gate_429_frontend.log`

El rápido se niega solo con este diff (la rama lleva migraciones), así que el veredicto sale del
completo.

```
✓ typecheck paso
✓ lint paso            (0 errores; 200 warnings de `no-unused-vars`, los mismos que traía `dev`)

 Test Files  1994 passed (1994)
      Tests  29096 passed | 26 skipped (29122)
   Duration  613.39s

INIT_EXIT=0
```

#### Los `skipped`, MIRADOS

**26 saltados, y están identificados**: `AnaliticaPage.test.tsx` (17) y
`AnaliticaShell.test.tsx` (9) — los dos de siempre, la misma cifra que reportó la pasada de backend.
**NO son los ~183 archivos de `tests/integration/db` que se saltan cuando falta `DATABASE_URL`**: el
`.env` se copió al worktree para el gate y **273 archivos de `tests/integration/db/`
corrieron**. El `.env` está cubierto por `.gitignore` (`.env*`) y se comprobó que no entra en el
índice.

---
---

# Ficha 429 — bitácora del ARREGLO DE REVISIÓN (bloqueante 1 + menores 1, 2 y 3)

**Rama:** `feat/429-sinpe-por-bodega`, sobre `cc4e17ce` (el informe de revisión).
**Alcance:** el **bloqueante 1** de `progress/review_429.md` —el script de siembra sin un solo
test— y sus tres menores 1, 2 y 3. **El bloqueante 2 (el plan de release) NO se toca**: es decisión
del humano. Los menores 4, 5, 6 y 7 quedan como deuda declarada, por encargo.

---

## 1. El bloqueante: por qué el script no estaba cubierto, y qué se hizo

`scripts/seed-sinpe-inicial.ts` decide el número que ocho bodegas le enseñan a cada cliente, y sus
dos exports no los importaba **ningún** test. El revisor lo demostró con dos mutaciones a la vez
—quitar el `WHERE … IS NULL` y hacer que `leerSemilla` invente un valor— y **19.902 tests siguieron
en verde**.

La causa no estaba en el código: **R10 colgaba de un caso que reescribía a mano el `UPDATE` del
seed** contra el esquema clon (`zona-sinpe-migration.test.ts`, «aquí se reproduce esa sentencia»).
Afirmaba el resultado de un SQL que él mismo escribía: la familia «probar el `WHERE` donde vive».

**Lo que ahora existe:**

1. **`tests/unit/scripts/seed-sinpe-inicial.test.ts` (nuevo, 20 casos)** — `leerSemilla` entera:
   falta cada variable (y el motivo la nombra **a ella** y no a la otra), variable presente pero
   vacía o solo espacios, los cuatro formatos inválidos del encargo (`12345678`, `50612345`,
   `6123456`, `612345678`), el veredicto **caso a caso contra `CASOS_SINPE`** —la misma tabla que
   juzgan el validador y el `CHECK` de Postgres—, el titular de 61 y el de 60 justos, la
   normalización de `"+506 8888 1111"` → `88881111`, y que **el valor NUNCA aparece en el mensaje de
   error** (hoy no aparece; ahora está afirmado, también troceado). Más la FORMA de la escritura de
   `sembrarSinpeInicial` con un doble que apunta el SQL: una sola escritura, acotada a los NULL, con
   los dos valores parametrizados y sin tocar `sinpe_revisado_at`.
2. **R10 pasa a ejercer el código real.** Los dos casos de `zona-sinpe-migration.test.ts` llaman a
   `sembrarSinpeInicial` **de verdad** —y la semilla sale de `leerSemilla`, no de un objeto a mano,
   así que el camino medido es el entero: entorno → validación → escritura—. Y se añade el caso que
   faltaba: **idempotencia**, segunda corrida con `rellenadas === 0` y una fila corregida a mano que
   **no se pisa** (ni ella ni las otras siete).

### ⚠️ La trampa que hubo que rodear para ejercer el seed contra el clon

`sembrarSinpeInicial` escribe `UPDATE "zona"` **sin cualificar**, y la suite de migraciones trabaja
en un esquema desechable. `crearPrismaDeTestEnEsquema` **no sirve**: la opción `schema` de `PrismaPg`
solo viaja como `schemaName` en la información de conexión —lo que cualifica las consultas de
MODELO— y **nunca emite un `SET search_path`** (comprobado en el `dist` del adaptador instalado: la
cadena no aparece). El SQL crudo se manda tal cual, así que el `UPDATE` se habría ido a
`public."zona"`: **la tabla real de la base de desarrollo**.

La solución es un adaptador de 20 líneas que toma el SQL que emite el script —el texto sale del
`$executeRaw` etiquetado del propio script, no del test— y le antepone el esquema del clon, igual
que `cualificar()` hace con el SQL de las migraciones. **Con un `throw` que no es decorativo**: si
alguna aparición de `"zona"` quedara sin cualificar, aborta ANTES de tocar la base en vez de
arrasar la tabla viva.

---

## 2. Las DOS mutaciones del revisor, aplicadas otra vez — las dos mueren

### Mutación A — quitar el `WHERE "sinpe_numero" IS NULL OR "sinpe_nombre" IS NULL`

```
 ❯ tests/unit/scripts/seed-sinpe-inicial.test.ts (20 tests | 1 failed)
     × ⭑ el `UPDATE` va RESTRINGIDO a las filas sin valor: la idempotencia es del `WHERE`
 ❯ tests/integration/db/zona-sinpe-migration.test.ts (32 tests | 1 failed)
     × ⭑ R10 — segunda corrida: CERO rellenadas, y la correccion HUMANA no se pisa

AssertionError: expected '\n    UPDATE "zona" SET "sinpe_numero…' to match
  /WHERE\s+"sinpe_numero"\s+IS\s+NULL\s+OR\s+"sinpe_nombre"\s+IS\s+NULL/i

AssertionError: expected { rellenadas: 8, intactas: +0 } to deeply equal { rellenadas: +0, intactas: 8 }

 Test Files  2 failed (2)
      Tests  2 failed | 50 passed (52)
```

### Mutación B — `leerSemilla` inventa un valor y se borra la validación de formato

```
 ❯ tests/unit/scripts/seed-sinpe-inicial.test.ts (20 tests | 11 failed)
     × ⭑ sin `NEXT_PUBLIC_SINPE_NUMERO` no se siembra, y el motivo nombra esa variable
     × ⭑ sin `NEXT_PUBLIC_SINPE_NOMBRE` tampoco, y el motivo nombra ESA otra
     × una variable PRESENTE pero vacia (o solo espacios) es lo mismo que ausente
     × ⭑ `12345678` se rechaza (ocho digitos pero empieza por 1: no es una serie movil)
     × ⭑ `50612345` se rechaza (ocho digitos que empiezan por 506: se rechaza por el primer digito)
     × ⭑ `6123456` se rechaza (siete digitos: falta uno)
     × ⭑ `612345678` se rechaza (nueve digitos: sobra uno)
     × ⭑ el `506` de ocho digitos NO se convierte en `12345` por el camino
     × ⭑ el MISMO veredicto que la tabla compartida, caso a caso
     × ⭑ un titular de mas de 60 caracteres se rechaza AQUI, no lo trunca Postgres
     × ⭑ ni el numero ni el titular aparecen en el mensaje: el log de un build se conserva

AssertionError: se esperaba un rechazo y la semilla se acepto: expected true to be false

 Test Files  1 failed | 1 passed (2)
      Tests  11 failed | 41 passed (52)
```

**El árbol se revirtió por copia tras cada mutación** (el estado del árbol vuelve a quedar limpio
para `scripts/`), no por edición inversa: una reversión a mano es justo donde se cuela el residuo.

**Límite declarado, para que nadie lo lea de más:** la mutación B deja el archivo de INTEGRACIÓN en
verde —ese ejercita `leerSemilla` con valores válidos, que la mutación sigue aceptando—. Quien la
mata es el unitario. Es el reparto buscado: el unitario juzga la lectura del entorno, la integración
juzga lo que Postgres hace con la escritura.

---

## 3. Los tres menores

**Menor 1 — el `CHECK` del titular, documentado con la formulación descartada.**
`db/schema.prisma` y `lib/utils/sinpe-cr.ts` decían `btrim("sinpe_nombre") <> ''`. La real es
`~ '[^[:space:]]'`, y la diferencia no es cosmética: `btrim` sin segundo argumento recorta **solo**
el espacio 0x20, así que un titular de un único tabulador pasaba el `CHECK` mientras
`sinpeNombreSchema` lo rechazaba. Los dos archivos corregidos **y con el porqué escrito**, para que
la formulación vieja no «vuelva» en la siguiente lectura.
`specs/429-sinpe-por-bodega/design.md` sigue diciendo `btrim` **a propósito**: es la propuesta
original, y la desviación ya está anotada en §4 de la bitácora del backend.

**Menor 2 — R27 y R29 decían PENDIENTE.** Sus tests existen desde la pasada de frontend
(`tests/components/RevisionSinpeBodega.test.tsx`). Las dos filas del mapa apuntan ya al bloque
concreto. De paso, **la fila de R10** apunta a los dos casos nuevos y al unitario.

**Menor 3 — `tasks.md` sin un solo `[x]`.** Marcadas las 24 hechas, **comprobando el árbol y no la
bitácora**. Sin marcar quedan cinco, cada una con su nota: **T0** (la mitad de los literales ya no
aplica, y la medida del formato es el bloqueante 2, del humano), **T20** (la puerta de `/design` no
deja registro en esta rama y su criterio de «hecho» es una aprobación humana) y **T27–T29**, que son
posteriores al despliegue. T4 lleva nota de que se hizo en tres piezas, no en una.

---

## 4. Archivos de esta pasada

| Archivo | Qué |
| --- | --- |
| `tests/unit/scripts/seed-sinpe-inicial.test.ts` | **NUEVO** — 20 casos: `leerSemilla` entera y la forma de la escritura |
| `tests/integration/db/zona-sinpe-migration.test.ts` | R10 llama a `sembrarSinpeInicial` de verdad; + caso de idempotencia; + el adaptador al esquema clon |
| `db/schema.prisma` | menor 1 — el `CHECK` del titular, con su porqué (solo comentario) |
| `lib/utils/sinpe-cr.ts` | menor 1 — idem (solo comentario) |
| `progress/impl_429.md` | menor 2 — R10, R27 y R29 en el mapa; y esta bitácora |
| `specs/429-sinpe-por-bodega/tasks.md` | menor 3 — los `[x]`, y las notas de las cinco sin marcar |

**Ni una línea de producción cambió de comportamiento:** los dos únicos archivos de `lib/` y `db/`
tocados lo son **solo en comentarios**. Lo que cambia es lo que la suite ve.

---

## 5. Salidas reales

### 5.1 `pnpm run typecheck`

```
> tsc --noEmit
```
Sin salida: verde. (Primer intento rojo con 3 errores `TS2345/TS2741`: `NodeJS.ProcessEnv` declara
`NODE_ENV` **obligatorio** en este proyecto, así que un entorno de mentira `{}` no es asignable. Se
arregló poniendo `NODE_ENV: "test"` en los dos ayudantes, no relajando el tipo.)

### 5.2 `pnpm run lint`

```
✖ 200 problems (0 errors, 200 warnings)
```
**0 errores.** Los 200 avisos son los `no-unused-vars` de siempre, los mismos que traía `dev`;
**ninguno cae en los archivos de esta pasada** (comprobado filtrando por sus rutas: sin resultados).

### 5.3 `./init.sh` COMPLETO — dos corridas

El rápido se niega solo con este diff (la rama lleva migraciones y `db/schema.prisma`), así que el
veredicto sale del completo. `INIT_EXIT` escrito **dentro** del log y sin canalizar por `tail`.

**Primera — `progress/gate_429_fix.log`: 1 rojo, y es un FLAKE de saturación.**

```
 Test Files  1 failed | 1994 passed (1995)
      Tests  1 failed | 29116 passed | 26 skipped (29143)
   Duration  675.25s
INIT_EXIT=1

 FAIL  tests/unit/guards/censo-order-status-rename.test.ts
 Error: Test timed out in 20000ms.
```

Es el modo de fallo que el propio gate manda comprobar («corre ese archivo AISLADO»). **Aislado pasa
en 2,21 s, con el caso en 688 ms contra un tope de 20 s**:

```
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  2.21s
```

Ese archivo **recorre el árbol de ficheros** (`app/`, `lib/`, `components/`, `hooks/`, `scripts/`,
`tests/`, `e2e/`) y no importa nada de lo que vigila: bajo 1.995 archivos en paralelo es de los
primeros que se queda sin CPU. No está en `tests/baseline-rojos.json` y **no se añade**: no es deuda
de nadie, y meterlo ahí taparía un rojo de verdad el día que lo tenga.

**Segunda — `progress/gate_429_fix_b.log`: VERDE, y confirma el flake.**

```
✓ typecheck paso
✓ lint paso

 Test Files  1995 passed (1995)
      Tests  29117 passed | 26 skipped (29143)
   Duration  635.31s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1995 ejecutado(s))
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado
  20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

El aviso de los tres `down.sql` que faltan es **anterior a esta ficha** (migraciones de agosto, de
rutas) y sale igual en los gates previos de la rama. Las tres de la 429 traen el suyo.

#### Los `skipped`, MIRADOS — y los de la base, CONTADOS

**26 saltados, los de siempre**: `AnaliticaPage.test.tsx` (17) + `AnaliticaShell.test.tsx` (9). Es
exactamente la cifra de referencia de las dos pasadas anteriores.

**Y lo que de verdad hay que mirar en esta ficha: los `tests/integration/db/`.** Si se saltan, el
verde no vale, porque los `CHECK`, el `NOT NULL` y ahora la siembra viven justo ahí.

```
273 archivos distintos de tests/integration/db/ en el log
273 de ellos con la marca ✓  (o sea: TODOS corrieron, ninguno saltado)
```

El `.env` se copió al worktree para el gate y está cubierto por `.gitignore` (`.env*`): no entra en
el índice.

#### Las cifras, comparadas con la corrida del revisor

| | revisor (sobre `1fa283b1`) | esta pasada |
| --- | --- | --- |
| archivos | 1.994 | **1.995** (+1: el unitario del seed) |
| tests | 29.096 + 26 saltados | **29.117 + 26 saltados** (+21: 20 del unitario + 1 de idempotencia) |
| `integration/db` | «SÍ corrieron» | **273, todos en verde** |
| `INIT_EXIT` | 0 | **0** (en la segunda corrida; la primera, un flake de timeout) |

---

## 6. Veredicto

**El bloqueante 1 está levantado y comprobado rompiéndolo**: las dos mutaciones que el revisor dejó
sobrevivir ahora matan tests con nombre, y R10 dejó de afirmar el resultado de un SQL escrito por el
propio test. Los tres menores encargados, hechos. El bloqueante 2 y los menores 4-7 siguen abiertos,
a propósito.
