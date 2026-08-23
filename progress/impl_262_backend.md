# Bitácora — feature 262 · corregir el día de reparto de una orden ya asignada

## B0.1 — M1 y M2 contra producción (2026-08-22, **04:27 hora CR**)

Corridas por el leader con el MCP de Supabase, **sólo lectura**. Los números se escriben; no se
resumen como «son pocas».

### M1 — órdenes con `fecha_reparto` posterior al día CR en curso, **sin acotar estado**

```sql
SELECT os.value AS estado, count(*)
FROM orden o JOIN order_status os ON os.id = o.estatus_id
WHERE o.fecha_reparto > (now() AT TIME ZONE 'America/Costa_Rica')::date
GROUP BY os.value;
```

**Resultado: 0 filas. Ninguna orden, en ningún estado.**

Esto **cierra la duda que el spec planteaba**: la M1 de la feature 261 midió 2 el 2026-08-21 pero
estaba acotada a `en_reparto`/`ayuda_tienda`, y `por_recoger` —el caso principal de esta ficha—
quedaba fuera. Medido ahora sin ningún filtro de estado: sigue siendo 0.

Por qué es 0 y no porque el riesgo no exista: las dos órdenes que M1 contó el 21 (guías 17496963 y
57998428) **llegaron a su día** y hoy tienen `fecha_reparto` = 2026-08-22.

### M2 — órdenes **con** mensajero y **sin** día

**Resultado: 35 órdenes.** Repartidas así:

| estado | órdenes |
| --- | --- |
| `entregada` | 17 |
| `devolviendo_a_tienda` | 5 |
| `incidente` | 3 |
| `en_bodega_central` | 3 |
| `reprogramada` | 2 |
| `devuelta_a_tienda` | 2 |
| `por_devolver_a_tienda` | 2 |
| `devuelta` | 1 |

⚠️ **35 parece un número grande, y por eso hay que mirar el desglose antes de re-abrir nada.**
**Ninguna de las 35 está en `por_recoger` ni en `en_reparto`**: todas están en estados donde el día
de reparto ya no decide nada —entregadas, en devolución o en bodega—. Son exactamente los estados
que **R6 excluye**. Es decir: no son órdenes que esta feature vaya a dejar sin corregir; son órdenes
a las que la corrección no les aplica.

**Conclusión: D3' NO se re-abre.** La condición del spec era «si M2 devuelve un número grande»,
entendido como órdenes que la operación necesitaría tocar y no podría. Esas son 0.

### M2b — comparación: con mensajero y **con** día

**9 órdenes**: `sin_gestionar` (4), `en_reparto` (2), `devolucion_por_confirmar` (1),
`entregada` (1), `reprogramada` (1).

Total con mensajero: **44** = 35 + 9. Los números cuadran.

### Límite de estas mediciones, dicho y no rodeado

Ahora mismo **no hay ninguna orden en `por_recoger` con mensajero asignado**, ni con día ni sin él.
O sea que el estado que esta ficha tiene como caso principal está hoy **vacío en producción**, y las
mediciones no pueden decir nada sobre él más allá de que no hay nada pendiente. El universo vivo es
pequeño (9 órdenes con día), así que estos números describen una operación en calma, no una carga
representativa. **B0.2 vuelve a medir M1 justo antes de desplegar**, que para eso está.

---
---

# ⬛ IMPLEMENTACIÓN DEL BLOQUE BACKEND — 2026-08-22

> Rama `feature/262-corregir-dia-reparto`, desde `origin/dev` en `241f1842`. Worktree aislado con
> `node_modules` montado por junction desde el repo principal.
>
> **Alcance de esta tanda, y lo que NO entra, dicho arriba del todo:** entra el **BLOQUE BACKEND**
> (B1-B13, B15) y el **BLOQUE AVISO** (B17-B23). **NO entra el BLOQUE HISTORIAL (P1, B24-B29) ni
> B14**, y las dos ausencias tienen motivo, no descuido: ver «Lo que quedó a deber» al final.

## 1 · Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `db/migrations/20260822130000_orden_dia_reparto_cambio/{migration,down}.sql` | La tabla del rastro (B1) |
| `db/migrations/20260822140000_notificacion_evento_dia_reparto_corregido/{migration,down}.sql` | Los dos valores de enum del aviso (B17) |
| `lib/interfaces/services/ICorreccionDiaRepartoService.ts` | Contrato del servicio (B3) |
| `lib/repositories/registrar-cambio-dia-reparto.ts` | Choke point del rastro (B4) |
| `lib/services/CorreccionDiaRepartoService.ts` | Rol, zona, estados, reloj, aviso (B6, B21) |
| `lib/services/mensajes-correccion-dia-reparto.ts` | Motivos tipados del rechazo (B6) |
| `lib/actions/corregir-dia-reparto.ts` | Server Action + zod (B7) |
| `tests/unit/services/correccion-dia-reparto.test.ts` | 45 tests de servicio (B11, B21) |
| `tests/unit/actions/corregir-dia-reparto-action.test.ts` | 13 tests de borde (B7) |
| `tests/unit/services/notificacion-dia-reparto-corregido.test.ts` | 15 tests del aviso (B23) |
| `tests/integration/db/correccion-dia-reparto.int.test.ts` | 18 tests contra Postgres (B12) |
| `tests/integration/db/correccion-dia-reparto-efectos.int.test.ts` | 8 tests de ausencias (B13) |
| `tests/integration/db/notificacion-evento-dia-reparto-corregido-migration.test.ts` | 22 tests de la migración de enum (B22) |

### Modificados

`db/schema.prisma` (modelo + 2 relaciones inversas + 2 valores de enum) ·
`lib/interfaces/repositories/IOrdenRepository.ts` (`corregirDiaRepartoLote`,
`CorreccionDiaAplicada`, `CorreccionDiaConflictoError`, `OrdenTransicionRow.fechaReparto` **sin
`?`**, `RecepcionSateliteRow.fechaRepartoISO`) · `lib/repositories/OrdenRepository.ts` (la escritura
guardada + el día en los dos DTO de listado + `fechaReparto`/`mensajeroAsignadoId` en la fila de
transición) · `lib/interfaces/services/IRecepcionSateliteService.ts` ·
`lib/services/RecepcionSateliteService.ts` · `lib/types/orden.ts` · `lib/types/notificacion.ts` ·
`lib/utils/dia-reparto-textos.ts` · `lib/notificaciones/{emitir,notificadores}.ts` · 17 archivos de
test ajenos (fixtures que ganan el campo obligatorio; **ninguna aserción cambia de sentido**).

## 2 · Mapa `R<n> → test`

| R | Test que lo defiende |
| --- | --- |
| R1 | `correccion-dia-reparto.int` · «R1/R27: la fila queda con el dia nuevo y todo lo demas IDENTICO» (compara la fila ENTERA menos el día) |
| R2 | `correccion-dia-reparto.test` · «dos `now` distintos producen dos fechas distintas» · `corregir-dia-reparto-action.test` · «una llamada SIN `dia` FALLA en el borde» |
| R3 | `corregir-dia-reparto-action.test` · «un `dia` que no es uno de los DOS tokens falla» · `correccion-dia-reparto.test` · «el pasado NO es expresable» (afirma el CONJUNTO de salidas posibles) |
| R4 | `correccion-dia-reparto.test` · «sin dia de reparto» · `correccion-dia-reparto.int` · «una orden SIN dia no se corrige» |
| R5 | `correccion-dia-reparto.test` · «sin mensajero asignado» + «los dos motivos son DISTINTOS» · `correccion-dia-reparto.int` · «una orden SIN mensajero no se corrige» |
| R6 | `correccion-dia-reparto.test` · los 3 admitidos + los 5 rechazados NOMBRANDO el estado · `carga-del-mensajero.guardia` (censo) |
| R7 | `correccion-dia-reparto.test` · «ya esta en el dia elegido» + «la comparacion es por FECHA CALENDARIO» · `correccion-dia-reparto.int` · el `<>` del WHERE + el CHECK de la tabla |
| R8 | `correccion-dia-reparto.test` · «CERO llamadas al writer» · `correccion-dia-reparto.int` · «NI UNA se corrige y NI UNA fila de rastro» |
| R9 | `correccion-dia-reparto.int` · las cinco guardas del WHERE, una a una, contra Postgres |
| R10 | `correccion-dia-reparto.test` · «el `ok` dice CUANTAS quedaron y PARA QUE DIA». ⚠️ La frase en palabras es F5 (frontend) |
| R11 | `correccion-dia-reparto.test` · maestro/admin/adminSatelite sí; mensajero/adminTienda `forbidden` sin leer nada |
| R12 | `correccion-dia-reparto.test` · `sin_zona` + zona ajena `forbidden` · `correccion-dia-reparto.int` · el `zona_id` del WHERE **con su control positivo** |
| R13 | ⏳ **frontend** (F5/F6). El backend no distingue superficie |
| R14 | `correccion-dia-reparto.test` · el `Pick` NO expone el predicado (`@ts-expect-error`) + comportamiento con un repo que ni lo tiene |
| R15 | `correccion-dia-reparto.test` · `forbidden` para mensajero y adminTienda |
| R16-R19 | ⏳ **frontend** (F5). El backend deja el insumo: `fechaRepartoISO` en los dos DTO (B8) y `avisoDiaActualDeLaOrden` (B2) |
| R20 | `correccion-dia-reparto.int` · «UNA fila de rastro por orden, con las dos fechas, el actor y el motivo» |
| R21 | `corregir-dia-reparto-action.test` · trim + min(10) + max(300) · `correccion-dia-reparto.test` · el motivo llega INTACTO al writer |
| R22 | `correccion-dia-reparto.int` · «CERO filas de rastro» al abortar + pareja de mutación M-f+M-n |
| R23 | `correccion-dia-reparto.int` · «la tabla es APPEND-ONLY tambien en la base» (columnas leídas de `information_schema`) |
| R24 | `correccion-dia-reparto.int` · «`fecha_anterior` es el dia REAL de CADA fila» + la aserción de FORMA del `FOR UPDATE` |
| R25 | `correccion-dia-reparto-efectos.int` · cero filas de historial, cero gestiones, `intentos_contacto` intacto |
| R26 | `correccion-dia-reparto-efectos.int` · `pg_class.relrowsecurity` **leído de la base**, sin policies |
| R27 | `correccion-dia-reparto.int` · `asignado_at` intacto · `fecha-reparto-acompana-asignado-at.guardia` (M-k) |
| R28 | `correccion-dia-reparto.int` · el WHERE exige día y mensajero · la guardia (d2) |
| R29 | `fecha-reparto-acompana-asignado-at.guardia` · cláusulas (d1)-(d4) **con autocomprobación sobre el SQL final** |
| R30 | `correccion-dia-reparto-efectos.int` · el predicado del corte, en los DOS sentidos |
| R31 | `correccion-dia-reparto-efectos.int` · la guarda de la 261 con el valor **que la base devolvió** |
| R32 | `correccion-dia-reparto-efectos.int` · **tres tests con ruta SEMBRADA** (2026-08-23): las filas enteras de `ruta_optimizada`/`ruta_optimizada_parada` antes y despues · los indicadores del portal por `listarMisAsignaciones` con repos REALES · el delta de `jobs` `optimizacion_ruta`. ⛔ **Hasta el 2026-08-23 esta fila decia «B15», que NO es un test**: la mutacion `rutaOptimizadaParada.deleteMany` sobrevivia a 3.302 tests |
| R33 | La guardia (d1)+(d3): el censo del día tiene cota y **exactamente una** excepción |
| R34-R36 | ⏳ **B14, no hecha** (depende de F3/F4). Ver «Lo que quedó a deber» |
| R37-R45 | ⏳ **BLOQUE HISTORIAL, no hecho.** Ver «Lo que quedó a deber» |
| R46 | `notificacion-dia-reparto-corregido.test` · una fila al mensajero asignado · `correccion-dia-reparto.test` · el servicio emite tras confirmar |
| R47 | `notificacion-dia-reparto-corregido.test` · la fecha en palabras, sin «hoy»/«mañana», **con contraprueba** de que el texto no es fijo |
| R48 | `notificacion-dia-reparto-corregido.test` · sin motivo ni PII, y el contexto **no tiene hueco** donde meterlo |
| R49 | `correccion-dia-reparto.test` · el notificador que lanza sigue devolviendo `ok` · `notificacion-dia-reparto-corregido.test` · el fallo queda loggeado con causa |
| R50 | `notificacion-dia-reparto-corregido.test` · **dos correcciones seguidas → dos avisos**, con su CONTRAPRUEBA (con el `ordenId` el segundo se pierde) |
| R51 | `notificacion-dia-reparto-corregido.test` · ni una fila dirigida a un ROL |
| R52 | `notificacion-productores-wiring.test` (lista literal, seis) · `notificacion-evento-dia-reparto-corregido-migration.test` |
| R53 | `notificacion-evento-dia-reparto-corregido-migration.test` · el down con los CINCO previos + los dos downs anteriores intactos |
| R54 | idem · «el down NO borra ni reescribe NINGUNA fila» |
| R55 | `notificacion-dia-reparto-corregido.test` + `correccion-dia-reparto.test` · los dos sentidos |
| R56 | **Ausencia en el diff**: `lib/types/dia-reparto.ts` y `lib/utils/dia-reparto.ts` NO aparecen en `git diff --stat` (C6, verificado) |

## 3 · Decisiones tomadas al implementar

1. **`findByIdsForTransicion` no emitía `mensajeroAsignadoId`.** El comentario del tipo decía «el
   repo SIEMPRE lo emite» y era **falso** para esa vía (sólo lo emitía
   `findByNumGuiaForTransicion`). Se añade al `select`, porque sin él R5 no puede distinguir «sin
   mensajero» de «sin día» y el rechazo sería genérico — el defecto que originó la 241.
2. **`RecepcionSateliteDTO` vive en `lib/interfaces/services/IRecepcionSateliteService.ts`**, no en
   `lib/types/recepcion-satelite.ts` como decía `design.md` §8. El campo se añade donde el tipo
   está de verdad. `lib/types/orden.ts` sí se toca, así que el gate completo sigue siendo
   obligatorio por esa vía y por las otras cuatro.
3. **El `@sin-superficie` de la Server Action.** `superficie-de-uso.guardia` se puso ROJA: la acción
   no la importa ningún módulo alcanzable, porque **los modales son F1-F4 y llegan después**. Se
   anota con su motivo real y **caduca sola**: la otra mitad de esa misma guardia se pone roja en
   cuanto la acción recupere superficie, así que quien monte los modales está obligado a borrarla.
   Es la opción honesta frente a dejar el gate rojo o inventar una superficie.
4. **`prisma migrate deploy` y no `migrate dev`.** La base local es COMPARTIDA con otra sesión;
   `migrate dev` detecta drift y puede proponer un reset. `deploy` sólo aplica lo pendiente.
5. **El ciclo up → down → up se ejercitó de verdad** en local para las dos migraciones (el
   `db:rollback` del repo sólo alcanza la ÚLTIMA carpeta, así que el `down.sql` del rastro se aplicó
   a mano con `prisma db execute` y se borró su fila de `_prisma_migrations`). `migrate status`
   quedó en «up to date» y sin residuos.

## 4 · Mutaciones (B16) — 30 corridas, con su salida real

⚠️ **El arnés se autocomprueba** (`scratchpad/mutaciones-262.mjs`): exige que el texto a mutar
aparezca **exactamente una vez**, que vitest emita la línea `Test Files` y —esto es lo importante
aquí— **que la corrida EN LIMPIO del mismo comando esté verde antes de mutar**. Se añadió después de
descubrir que la primera tanda estaba contaminada (ver §6).

**Mueren 26:** M-a, M-b, M-c, M-d, M-e, M-f, M-g, M-i, M-j, M-k, M-l, M-m, M-o, M-p, M-s, M-t, M-w,
M-ab, M-ab2, M-ad, M-ae, M-af, M-ag, M-ah, M-h+M-j, M-f+M-n, M-ai-inv. Cada una con el nombre del
test rojo en `scratchpad/mutaciones.log`. Los tres que más importan:

- **M-ab** (el `entidadId` del aviso pasa a ser el `ordenId`, o sea **A20**) → mata
  «R50: DOS correcciones del lote => DOS avisos» y «un aviso al MENSAJERO ASIGNADO».
  Y **M-ab2**, el mismo defecto en el emisor, mata el test estrella:
  «⭑⭑ el caso «mañana → hoy» que la puerta humana nombró, y que llega SEGUNDO».
- **M-w** (una SEGUNDA escritura del día sin `asignado_at`) → mata la cláusula **(d3)** de la
  guardia, y **sólo** esa. Es la prueba de que (d3) es lo que cierra el hueco que (d2) dejaría.
- **M-ag / M-ah** (el `down.sql` con cuatro valores / con un `DELETE` para «hacer sitio») → matan
  R53 y R54 respectivamente.

**Sobreviven 2, y las dos son EQUIVALENTES. Se dicen, no se disimulan:**

| # | Por qué sobrevive | Qué se hizo |
| --- | --- | --- |
| **M-h** — quitar `AND "fecha_reparto" IS NOT NULL` | Es **redundante** con el `<>` de la línea siguiente: en la lógica ternaria de SQL `NULL <> '2026-08-21'` vale NULL —no TRUE—, así que la fila sin día tampoco entra. **No hay comportamiento que observar.** | Se conserva la guarda (escribe R5 donde se aplica, y vuelve a ser necesaria si alguien toca el `<>`), con el porqué escrito en el código. Y se demuestra con la **pareja M-h+M-j**: quitar las dos SÍ mata un test. |
| **M-n** — escribir el rastro con todas las `ordenIds` | El **todo-o-nada** garantiza `movidas.length === ids.length`, así que los dos conjuntos son el mismo. Sólo difieren si además se quita el `throw`. | Se demuestra con la **pareja M-f+M-n**: sin el todo-o-nada, escribir el rastro con todas las ids mata cuatro tests. |

**Y una medición que contradice lo que el spec anticipaba, escrita porque es lo que se midió:**

> **M-p (pasar el `Date` al SQL sin `fechaRepartoComoTexto(...)::date`) NO rompe el test de la
> sesión en `America/Costa_Rica`.** Se comprobó que el `SET LOCAL TIME ZONE` **sí toma efecto**
> (`SHOW TimeZone` devuelve `America/Costa_Rica`; la aserción está ahora en el test para que no
> pueda volverse vacuo) y aun así el día persistido sigue siendo el correcto. El motivo medido: el
> parámetro va **sin tipo** y Postgres lo infiere del destino del `SET` —una columna `date`—, así
> que lo parsea como fecha y **no hay conversión horaria que aplicar**. En ESTA sentencia la trampa
> de la 246 no se reproduce.
>
> **Qué se hizo:** la forma con texto y `::date` **se conserva** —no depende de una inferencia que
> cambia con el contexto y con la versión del driver— y se sostiene con una **aserción de FORMA**
> sobre el SQL que el repositorio emite de verdad (`crearPrismaDeTestConEspia`), declarada como tal.
> Con ella, M-p muere. La misma aserción cubre **M-l** (`FOR UPDATE`), que `design.md` ya declaraba
> como aserción de forma. Lo que **no** se hace es decir que el test de la zona horaria mata M-p.

**Dos mutaciones salen VERDES a propósito**, porque **relajan** una guardia en vez de introducir un
defecto: **M-q** (`(d3)` a «≤ 1») y **M-ai** (la lista literal a `toEqual(valores)`). Su prueba es la
pareja: M-w muere **sólo** en (d3), así que relajar (d3) lo deja pasar; y **M-ai-inv** —colar
`evento_colado_sin_revisar` en el enum del schema— **mata dos tests**, que es la demostración de que
el inventario sigue cerrado.

## 5 · El gate

`./init.sh` **COMPLETO** (no hay modo rápido en esta ficha: el diff toca `db/migrations/**`,
`db/schema.prisma` y `lib/types/**`). Corrido con `INIT_EXIT=$?` **escrito dentro del log**:

```
✓ typecheck paso
✓ lint paso
 Test Files  1313 passed (1313)
      Tests  17634 passed | 26 skipped (17660)
   Duration  359.70s
✓ test paso
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

El aviso de «migraciones sin down.sql» es **preexistente** (tres migraciones de la feature 92) y no
lo introduce esta ficha: las dos migraciones nuevas traen su `down.sql`.

**La primera corrida salió ROJA con 2 fallos, y los dos eran míos y legítimos** —la guardia de
superficie (§3.3) y un `toEqual` literal de `RecepcionSateliteRow` en
`orden-repository.recepcion-satelite.test.ts`—. El literal **se amplió con el campo nuevo, no se
relajó**: ese literal ES el contrato de la fila, y cambiarlo por un `objectContaining` lo dejaría
verde para siempre.

## 6 · Un riesgo del entorno que hay que saber (y que ya mintió una vez)

**`node_modules` está montado por junction desde el repo principal y hay otra sesión trabajando en
paralelo.** Cada `prisma generate` de la otra sesión **sobrescribe el cliente compartido**, y con un
cliente rancio `tx.ordenDiaRepartoCambio` es `undefined`: todos los tests que escriben el rastro se
caen con un `TypeError` que **no tiene nada que ver con lo que se está midiendo**.

Pasó tres veces durante esta implementación, y una de ellas **contaminó la primera tanda de
mutaciones** (una mutación aparecía como «MUERE» por el `TypeError`, no por el defecto). Por eso el
arnés regenera el cliente y **exige una corrida limpia en verde antes de cada mutación**. Quien
retome esto: `pnpm exec prisma generate` antes de cualquier corrida que importe, y desconfía de un
rojo que hable de `undefined`.

## 7 · Lo que quedó a deber, dicho y no disimulado

1. **BLOQUE HISTORIAL (P1, B24-B29) — NO HECHO.** `B24` convierte `OrdenHistorialEntradaDTO` en una
   unión discriminada y **rompe el build a propósito** en `HistorialOrdenTimeline.tsx`, que es un
   **componente**. Este agente tiene prohibido tocar UI, y el gate exige verde: hacer B24 sin F7
   dejaría `pnpm typecheck` rojo. **B24, B25, B26, B27, B28 y B29 son de `lib/` y `tests/`, así que
   siguen siendo trabajo de backend**: hay que lanzarlos en una tanda que incluya F7 (o autorizar
   explícitamente que el mismo agente toque ese componente). R37-R45 **no tienen ni un test**.
2. **B14 (el cierre del riesgo de la 261) — NO HECHA.** Sus dependencias declaradas son **F3 y F4**:
   la nota de `IMisAsignacionesService.ts` pasaría a decir «ya existe superficie, está en los dos
   listados», y **eso todavía no es cierto** — los modales no existen. Escribirlo ahora sería poner
   en el código una afirmación falsa y dejar `d5-revertida.guardia` afirmando algo que no pasa. La
   guardia sigue **verde e intacta** vigilando la nota vieja. R34, R35 y R36 sin test.
3. **B0.2 (re-medir M1 antes de desplegar)** — es del leader (necesita el MCP de producción).
4. **C7 (P4 y P5 a la puerta humana)** — decisiones de producto, no bloquean, pero se preguntan
   antes de desplegar.
5. **F6 («ver la app»)** — frontend, y no es opcional.
6. **`db:rollback` sólo revierte la ÚLTIMA carpeta de migraciones** (mira el nombre de carpeta más
   alto, no la última fila aplicada). Correrlo dos veces re-aplica el mismo `down.sql`. No es de
   esta ficha, pero se descubrió aquí y quien revierta las dos migraciones tiene que saberlo.
