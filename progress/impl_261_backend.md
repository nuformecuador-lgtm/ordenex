# Feature 261 — BLOQUE 0 + BLOQUE BACKEND

> Rama: `feat/261-dia-reparto-protege`. **Sin commit, sin PR** (así se pidió).
> Alcance de esta bitácora: **BLOQUE 0** y **BLOQUE BACKEND**. El FRONTEND y el CIERRE quedan fuera.
> El gate (`./init.sh` completo, obligatorio en esta ficha por nombre de dinero) lo corre el leader.

---

## Veredicto en una línea

Las **tres puertas del mensajero**, las **dos de la tienda** y el **`CASE` del deshacer** están
puestas y probadas donde deciden —las de SQL contra Postgres real—; **las 16 mutaciones del
`design.md` §9.4 murieron, más una extra**; y queda **abierto sólo el BLOQUE 0**, que necesita
producción y yo no la alcanzo.

---

## BLOQUE 0 — mediciones

### B0.1 — M1 y M2 · el número que sostiene P1

**M1, medida contra producción el 2026-08-21** (por quien escribió el spec; yo **no** la re-corrí,
ver el bloqueo de abajo):

> **2 órdenes**, de **un solo mensajero**, **ambas reservadas para el 22**. Son las de la prueba del
> humano.

Ése es el número del que depende **P1** («se dejan correr, sin backfill»). Se escribe el número y no
«son pocas» a propósito: quien relea esto dentro de seis meses tiene que poder **juzgar** la
decisión en vez de creerla. Si M1 hubiera dado decenas de órdenes repartidas entre varios
mensajeros, la recomendación se caía y la salida era el `UPDATE` autorizado.

**Las consultas, listas para pegar** (sólo lectura; `<dia_cr>` = fecha calendario de Costa Rica en
curso, `YYYY-MM-DD`):

```sql
-- M1 — órdenes ya en la mano del mensajero y reservadas para un día que aún no llegó.
--      Es la población a la que el despliegue deja sin botón (R27).
SELECT o.id, o.num_guia, o.fecha_reparto, o.mensajero_asignado_id, u.nombre AS mensajero,
       s.value AS estatus
FROM   "orden" o
JOIN   "order_status" s ON s.id = o.estatus_id
LEFT JOIN "usuario" u   ON u.id = o.mensajero_asignado_id
WHERE  o.deleted_at IS NULL
  AND  s.value IN ('en_reparto', 'ayuda_tienda')
  AND  o.fecha_reparto > '<dia_cr>'::date
ORDER BY o.mensajero_asignado_id, o.fecha_reparto;

-- M2 — órdenes que dejarán de poder recogerse el primer día. Es el tamaño del cambio visible.
SELECT count(*) AS ordenes, count(DISTINCT o.mensajero_asignado_id) AS mensajeros
FROM   "orden" o
JOIN   "order_status" s ON s.id = o.estatus_id
WHERE  o.deleted_at IS NULL
  AND  s.value = 'por_recoger'
  AND  o.fecha_reparto > '<dia_cr>'::date;
```

### B0.2 y B0.3 — ⛔ BLOQUEADAS, y hay que decirlo

**No las pude correr, y no por olvido:** este subagente **no tiene el MCP de Supabase** entre sus
herramientas, y la `DATABASE_URL` de producción es *sensitive* (irrecuperable por CLI o dashboard).
La única base que alcanzo es la local (`localhost:5432/ordenex`), y medir ahí no responde ninguna de
las dos preguntas: son fotos **de producción**.

**Lo que sí queda hecho:** las cuatro consultas escritas y listas. **Las corre el leader**, con el
MCP, y pega los números aquí. `M3'` es la que sustituye la anécdota por evidencia en el texto de la
reversión de D5, así que **no es un trámite**: hoy la reversión se apoya en un caso medido (la guía
17496963) y no en una distribución.

```sql
-- M3' — la REFUTACIÓN de M3, en números: ¿a qué hora se recogen las órdenes que estaban
--        reservadas para un día posterior? Últimos 30 días.
SELECT date_part('hour', h.created_at - interval '6 hours') AS hora_cr, count(*) AS recogidas
FROM   "orden_historial_estado" h
JOIN   "orden" o ON o.id = h.orden_id
WHERE  h.origen_tipo = 'recoleccion'
  AND  h.created_at >= now() - interval '30 days'
  AND  o.fecha_reparto IS NOT NULL
  -- reservada A FUTURO EN EL INSTANTE DE LA RECOGIDA (no respecto de hoy): el día CR de la
  -- transición sale del mismo desplazamiento de -6 h, que es la convención del repo.
  AND  o.fecha_reparto > (h.created_at - interval '6 hours')::date
GROUP BY 1
ORDER BY 1;

-- M4 — la población real del defecto (3): anulaciones de gestión de los últimos 30 días que
--      cayeron sobre órdenes con reserva futura. Hoy sabemos de UNA; esto dice si fue casualidad.
SELECT count(*) AS anulaciones, count(DISTINCT g.orden_id) AS ordenes
FROM   "gestion_orden" g
JOIN   "orden" o ON o.id = g.orden_id
WHERE  g.anulada_at IS NOT NULL
  AND  g.anulada_at >= now() - interval '30 days'
  AND  o.fecha_reparto IS NOT NULL
  AND  o.fecha_reparto > (g.anulada_at - interval '6 hours')::date;
```

> ⚠️ **M4 mide el estado de HOY de `fecha_reparto`, no el de entonces.** Y justamente el defecto que
> esta ficha arregla **reescribía esa columna al anular**: en las filas afectadas, la reserva futura
> ya fue pisada. Es decir, **M4 subestima por construcción** — un `0` no prueba que no pasara. Para
> medirlo bien haría falta el `fecha_reparto` previo, que no se guarda en ninguna parte. Se deja
> escrito para que nadie lea un número bajo como una absolución.

---

## BLOQUE BACKEND — archivos tocados

### Contratos (B1)

| Archivo | Qué cambia |
| --- | --- |
| `lib/interfaces/repositories/IGestionOrdenRepository.ts` | `OrdenGestionRow.fechaReparto: Date \| null` **sin `?`**; `recogerLote(..., diaEnCurso: Date)`; `CrearGestionDesdeAyudaInput.diaEnCurso: Date` |
| `lib/interfaces/services/IMisAsignacionesService.ts` | `now?: Date` en las tres operaciones; `DetalleConflicto.codigo?`; `MiAsignacionDTO.fechaRepartoISO?`; **la reversión de D5 + la nota R33** |
| `lib/interfaces/repositories/ICierreDiaRepository.ts` | `AnularGestionInput` gana `asignadoAt` y `diaEnCurso` |
| `lib/interfaces/services/ICierreDiaService.ts` | `deshacerGestion(gestionId, actor, now?)` |
| `lib/interfaces/repositories/IOrdenNotaRepository.ts` | `OrdenParaHilo.fechaReparto: Date \| null` |
| `lib/interfaces/services/IGestionDesdeAyudaService.ts` | `gestionar(input, actor, now?)` |

**El rojo de quitar el `?` fue el objetivo, no un accidente:** `pnpm typecheck` señaló **11 archivos
de test** con fixtures que se olvidaban del campo. Un fixture que se lo olvide tiene que romper el
build, no apagar la guarda en silencio devolviendo `undefined`.

### Textos (B2)

`lib/utils/dia-reparto-textos.ts`: `avisoReservaParaOtroDia(fechaISO)` + `RESERVA_MOTIVO_SERVIDOR`
(que es **la misma función invocada sin fecha**, no un segundo literal). `ETIQUETA_PARA_MANANA` no
se tocó, `fechaLegible()` se reutilizó, y el módulo **sigue sin importar `Date` ni `Intl`**.

### Las puertas

| Bloque | Archivo | Qué |
| --- | --- | --- |
| B3 | `lib/repositories/GestionOrdenRepository.ts` | `findByIdsParaGestion` emite `fechaReparto` |
| B4 | `lib/services/MisAsignacionesService.ts` | `estaReservadaParaOtroDia()` + las **tres** guardas + `fechaRepartoISO` en el DTO |
| B5 | `lib/repositories/GestionOrdenRepository.ts` | el `AND ("fecha_reparto" IS NULL OR <= …::date)` en el `WHERE` de `recogerLote` |
| B15 | `lib/repositories/OrdenNotaRepository.ts` | `findOrdenParaHilo` emite `fechaReparto` |
| B16 | `lib/services/GestionDesdeAyudaService.ts` | paso **5-bis**, entre el 5 y el 6, **antes del upload** |
| B17 | `lib/repositories/GestionOrdenRepository.ts` | el `OR` del día en el `where` del `updateMany` |
| B6 | `lib/services/CierreDiaService.ts` | `now = new Date()`, `asignadoAt = now`, `diaEnCurso = startOfDayCR(now)` |
| B7 | `lib/repositories/CierreDiaRepository.ts` | el paso 2 pasa a `$queryRaw` con el `CASE`; **`startOfDayCR` retirado del archivo** |

### La reversión escrita (B8)

- `lib/interfaces/services/IMisAsignacionesService.ts` — la reversión con sus **seis piezas** + la
  nota **R33** del agujero abierto, con puntero a la **ficha 262**.
- `specs/246-asignacion-por-dia/requirements.md` — apéndice fechado al pie de §D5.
- `specs/246-asignacion-por-dia/design.md` — apéndice a la línea «no se bloquea nada».
- **`git diff --numstat` sobre el spec de la 246: `14 0` y `11 0`. Cero líneas borradas.**

### Tests nuevos

| Archivo | Qué prueba |
| --- | --- |
| `tests/unit/services/mis-asignaciones-reserva-bloquea.test.ts` | B10 · las tres guardas, la ausencia de efectos, el límite `>`, R9/R10 |
| `tests/unit/services/cierre-dia-deshacer-dia-reparto.test.ts` | B10 · el reloj inyectable del deshacer |
| `tests/unit/services/gestion-desde-ayuda-reserva.test.ts` | B18 · la puerta A de la tienda, con «`storage.upload` no se llamó» |
| `tests/integration/db/recoger-lote-dia-reserva.int.test.ts` | B11 · **Postgres real**: el `WHERE` de recoger |
| `tests/integration/db/deshacer-gestion-conserva-reserva.int.test.ts` | B12 · **Postgres real**: el `CASE`, sus tres casos y R20 |
| `tests/integration/db/gestion-desde-ayuda-dia-reserva.int.test.ts` | B18 · **Postgres real**: el `where` del `updateMany` + la compensación |
| `tests/unit/guards/d5-revertida.guardia.test.ts` | B9 · la guardia de prosa, con autocomprobación |

### Tests existentes actualizados (y por qué, no sólo qué)

- **11 fixtures** ganan `fechaReparto: null` / `diaEnCurso` — el rojo buscado de B1.
- `tests/unit/repositories/cierre-dia-repository.test.ts` — **B14, el punto delicado.** El paso 2
  del deshacer dejó de ser `orden.updateMany` y pasó a `$queryRaw`, así que los dos casos que la 246
  había escrito **leyendo `data.fechaReparto` del doble ya no pueden existir**: afirmar ahí el valor
  persistido sería una aserción contra su propia fuente —siempre verde, con el defecto suelto—.
  - **Lo que se movió:** la afirmación sobre **el valor** de `fecha_reparto` tras deshacer, entera,
    a `deshacer-gestion-conserva-reserva.int.test.ts` (tres casos + R20).
  - **Lo que se quedó**, que es lo único que un doble puede demostrar honestamente: que el `SET`
    escribe **las dos columnas en la misma sentencia** (246/R10), que el día es un **`CASE`** y no
    un estampado a secas, que entra como **parámetro `YYYY-MM-DD::date`** sin reloj dentro del SQL,
    y que `asignado_at` es el instante **inyectado** y no el `NOW()` del motor.
  - Y un detalle que costó un rojo: `appendCambioEstado` **usa el mismo `$queryRaw`** para su
    guardia de catálogo, así que contar «llamadas a `$queryRaw`» mide dos cosas a la vez. Se filtra
    por `UPDATE "orden"`.
- `tests/unit/services/orden-nota-service.test.ts` — la **lista cerrada** de la proyección de
  autorización gana `fechaReparto`, con nota fechada. La lista sigue cerrada y `notas` sigue fuera.
- `tests/unit/repositories/gestion-desde-ayuda-repository.test.ts` — el literal del `where` **es el
  contrato** y por eso se actualiza como literal, no se relaja a un `toMatchObject`.

---

## Comandos, con su salida real

```
$ pnpm run typecheck
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit
                                    ← sin una sola línea de error
```

```
$ pnpm run lint
✖ 99 problems (0 errors, 99 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

> Los 99 warnings son **preexistentes**: se midió el baseline con `git stash` y salió
> **exactamente el mismo número**. Este diff no añade ninguno.

```
$ pnpm exec vitest related --run lib/services/MisAsignacionesService.ts \
    lib/services/CierreDiaService.ts lib/services/GestionDesdeAyudaService.ts \
    lib/repositories/GestionOrdenRepository.ts lib/repositories/CierreDiaRepository.ts \
    lib/repositories/OrdenNotaRepository.ts lib/utils/dia-reparto-textos.ts \
    lib/interfaces/services/IMisAsignacionesService.ts \
    lib/interfaces/repositories/IGestionOrdenRepository.ts

 Test Files  142 passed (142)
      Tests  2351 passed (2351)
   Duration  107.41s
```

```
$ pnpm run test:guardias

 Test Files  131 passed (131)
      Tests  1968 passed (1968)
   Duration  13.20s
```

```
$ pnpm exec vitest run <los 13 archivos de la 261 y sus vecinos>

 Test Files  13 passed (13)
      Tests  387 passed (387)
   Duration  2.08s
```

```
$ pnpm exec vitest run tests/unit/services/corte-diario-service.test.ts \
    tests/unit/repositories/corte-diario-repository.test.ts \
    tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts

 Test Files  3 passed (3)
      Tests  44 passed (44)
```

> **B14 verificado, los tres puntos:** la guardia `fecha-reparto-acompana-asignado-at` **en verde
> sin tocarla** (y la mutación M-h demuestra que sigue pudiendo fallar), el corte diario intacto
> (R21) y el archivo de dobles del cierre revisado con la lista de aserciones movidas, arriba.

---

## B13 — Las mutaciones, una a una

**El arnés se autocomprueba**, porque en este repo ya reportó «9/9 supervivientes» dos veces sin
haber ejecutado un test: (1) el parche **revienta** si no encuentra su patrón; (2) el archivo tiene
que **cambiar de verdad** —se compara con la copia previa, **no con git**—; (3) se imprime el exit
code **real** de vitest y las líneas del log de la corrida.

> **Y el punto (2) sirvió de algo:** en el primer intento de **M-j** el arnés abortó con «EL ARCHIVO
> NO CAMBIÓ». No era un falso positivo del arnés: comparaba contra `git`, y esa mutación **devuelve
> el archivo exactamente a su estado en HEAD** (borra el apéndice, que es lo único que yo había
> añadido). Se corrigió el arnés para comparar con la copia previa.

| # | Mutación | Muere en | Salida real (exit + resumen) |
| --- | --- | --- | --- |
| **M-a** | borrar la guarda de reserva de `recogerAsignaciones` | servicio (R1) | `exit=1` · `Tests 5 failed \| 17 passed (22)` — *«R1: la reservada para MAÑANA se rechaza con `conflict`»: expected 'ok' to be 'conflict'* |
| **M-b** | borrar la guarda de `gestionar` | servicio (R2) | `exit=1` · `Tests 3 failed \| 19 passed (22)` — *«⚠️ R4: el rechazo ocurre ANTES de subir la evidencia»: expected "vi.fn()" to not be called at all, but actually been called 1 times* |
| **M-c** | borrar la guarda de `escogerParaGestion` | servicio (R3) | `exit=1` · `Tests 2 failed \| 20 passed (22)` — *«R4: el puntero 1-a-1 NO se toca»: called 1 times* |
| **M-d** | quitar `AND ("fecha_reparto" …)` del `WHERE` de `recogerLote` | **Postgres real** (R5) | `exit=1` · `Tests 4 failed \| 3 passed (7)` — *«transicionan TRES»: expected [ 'de-ayer', 'de-hoy', …(2) ] to deeply equal [ 'de-ayer', 'de-hoy', 'sin-dia' ]* y *«NO deja fila de historial»: expected 1 to be +0* |
| **M-e** | `<=` → `<` en ese `WHERE` | **Postgres real** (R8) | `exit=1` · `Tests 4 failed \| 3 passed (7)` — *expected [ 'de-ayer', 'sin-dia' ] to deeply equal [ 'de-ayer', 'de-hoy', 'sin-dia' ]* (la de HOY deja de recogerse) |
| **M-f** | `>` → `>=` en la guarda del servicio | servicio | `exit=1` · `Tests 7 failed \| 15 passed (22)` — *«reservada para HOY se recoge»: expected 'conflict' to be 'ok'* (y R9: la etiqueta empieza a mentir) |
| **M-g** | el `CASE` → `${diaTexto}::date` a secas (**el defecto original**) | **Postgres real** (R17) | `exit=1` · `Tests 3 failed \| 95 passed (98)` — *«⭑ R17: con `fecha_reparto = MAÑANA`, tras deshacer SIGUE siendo mañana»: expected 2026-08-21 to deeply equal 2026-08-22* y *«⭑ R20: NO cumple el predicado del corte»: expected 1 to be +0* |
| **M-h** | el `CASE` → no tocar la columna | **Postgres real** (R18) | `exit=1` · `Tests 6 failed \| 101 passed (107)` — *«con `fecha_reparto = NULL`, tras deshacer queda en HOY»: expected null to deeply equal 2026-08-21* **y la guardia 246/R10 en rojo**: *«Estas escrituras tocan `asignado_at` y NO tocan `fecha_reparto`»* |
| **M-i** | `startOfDayCR` → `inicioDelDiaCREnUtc` en `CierreDiaService` | servicio, reloj a las 22:30 CR | `exit=1` · `Tests 8 failed \| 119 passed (127)` — *expected 2026-08-21T**06:00**:00.000Z to deeply equal 2026-08-21T**00:00**:00.000Z* (el off-by-one de seis horas, visible) |
| **M-i2** *(extra)* | lo mismo en `MisAsignacionesService` | servicio | `exit=1` · `Tests 1 failed \| 21 passed (22)` — *«el día que viaja a la ESCRITURA»: expected …T06:00 to deeply equal …T00:00* |
| **M-j** | borrar el apéndice de §D5 en el spec de la 246 | guardia (R25) | `exit=1` · `Tests 1 failed \| 17 passed (18)` — *«(c) §D5 apunta a la ficha 261»: expected [ 'que D5 fue supersedida', …(1) ] to deeply equal []* |
| **M-k** | reescribir el enunciado de §D5 «para dejarlo coherente» | guardia, testigos verbatim | `exit=1` · `Tests 2 failed \| 16 passed (18)` — *«(d) el texto original de §D5 sigue VERBATIM»* |
| **M-l** | el servidor escribe su propio literal en vez de importarlo | fuente única (R15) | `exit=1` · `Tests 4 failed \| 18 passed (22)` — *expected 'Esta orden es para otro dia de repart…' to contain 'día de reparto posterior'* |
| **M-m** | borrar la guarda de `GestionDesdeAyudaService` | servicio de la tienda (R28) | `exit=1` · `Tests 7 failed \| 4 passed (11)` — *expected 'ok' to be 'conflict'* y *«`storage.upload` NO se llamó»: called 2 times* |
| **M-n** | mover esa guarda **después** de `subirEvidenciasCompensadas` | R29 | `exit=1` · `Tests 2 failed \| 9 passed (11)` — *«`storage.upload` NO se llamó, y no hay gestión ni transición»: called 2 times* |
| **M-o** | quitar el `OR` del `where` de `crearGestionDesdeAyuda` | **Postgres real** (R30) | `exit=1` · `Tests 2 failed \| 20 passed (22)` — *«⭑ R30: con la puerta A saltada, el `updateMany` NO transiciona»: expected 'ok' to be 'conflict'* |
| **M-p** | borrar la nota del agujero / el puntero a la 262 | guardia (R33) | `exit=1` · `Tests 1 failed \| 17 passed (18)` — *«(e) la nota vive junto a la reversión»: expected […(3)] to deeply equal []* |

**17 mutaciones, 17 muertas. Ninguna superviviente**, y ninguna «murió» sin que el log muestre una
corrida con su recuento de tests.

Después de la tanda: `git status` limpio de restos, `pnpm typecheck` sin errores y los 13 archivos
de la 261 en verde (387 tests). El directorio del arnés se borró.

---

## Mapa `R<n> → test` (lo que cubre este bloque)

| R | Test |
| --- | --- |
| R1 | `mis-asignaciones-reserva-bloquea` · **`recoger-lote-dia-reserva.int`** |
| R2 | `mis-asignaciones-reserva-bloquea` («gestionar una orden reservada») |
| R3 | `mis-asignaciones-reserva-bloquea` («escoger para gestión») |
| R4 | ídem (0 llamadas a repo/storage/puntero) · **`recoger-lote-dia-reserva.int`** (sin fila de historial) |
| R5 | **`recoger-lote-dia-reserva.int`** — el `WHERE`, contra Postgres |
| R6 | `mis-asignaciones-reserva-bloquea` (dos `now`, dos resultados) · `cierre-dia-deshacer-dia-reparto` |
| R7 | ídem, con el reloj movido al día siguiente · **`recoger-lote-dia-reserva.int`** |
| R8 | ídem (`null` y «hoy») · **`recoger-lote-dia-reserva.int`** |
| R9 | `mis-asignaciones-reserva-bloquea` («sigue viniendo en su grupo») → *el resto es F5* |
| R10 | ídem («KPIs idénticos con y sin reserva») |
| R11/R14 | `mis-asignaciones-reserva-bloquea` (`fechaRepartoISO`) → *el texto es F5* |
| R15 | `mis-asignaciones-reserva-bloquea` + `gestion-desde-ayuda-reserva` (contra la constante/función exportada) |
| R16 | `cierre-dia-deshacer-dia-reparto` · **`deshacer-gestion-conserva-reserva.int`** · guardia 246/R10 |
| **R17** | **`deshacer-gestion-conserva-reserva.int` caso 1** ⚠️ |
| R18 | **`deshacer-gestion-conserva-reserva.int` casos 2, 3 y la frontera** |
| R19 | `cierre-dia-deshacer-dia-reparto` · `cierre-dia-repository` (el día como parámetro) |
| R20 | **`deshacer-gestion-conserva-reserva.int`** (4.ª aserción del caso 1) |
| R21 | `corte-diario-service` + `corte-diario-repository`, en verde sin tocarlos |
| R22 | guardia `fecha-reparto-acompana-asignado-at`, en verde sin tocarla |
| R23 | `d5-revertida.guardia` (testigo verbatim de `db/schema.prisma`) |
| R24 | `d5-revertida.guardia` (a) y (b) |
| R25 | `d5-revertida.guardia` (c) y (d) |
| R26 | `d5-revertida.guardia` · autocomprobación · M-j / M-k |
| R27 | `mis-asignaciones-reserva-bloquea` (orden ya en `en_reparto` con día futuro) · B0.1 |
| R28 | `gestion-desde-ayuda-reserva` |
| R29 | ídem — aserción «`storage.upload` no se llamó» + «tampoco se resolvió el catálogo» |
| R30 | **`gestion-desde-ayuda-dia-reserva.int`** (+ la compensación de las fotos) |
| R31 | `gestion-desde-ayuda-reserva` (dos `now`, dos resultados) |
| R32 | el motivo con el día ya se afirma en `gestion-desde-ayuda-reserva`; **la pantalla es F7** |
| R33 | `d5-revertida.guardia` (e) · M-p |

---

## Lo que queda abierto, y lo que me obligó a desviarme

### 1 · ⛔ BLOQUE 0 sin producción — **para el leader**

B0.2 y B0.3 **no se pudieron correr**: sin MCP de Supabase y con la `DATABASE_URL` de producción
*sensitive*. Las cuatro consultas están escritas arriba. **B0.3 es la que decide si P1 sigue en
pie**: si M1 creció respecto de las 2 medidas el 2026-08-21, la decisión se re-abre y hay que
preguntar antes de desplegar.

### 2 · Desviación declarada — el `MSG_*` de la tienda es una **función**, no un string

`design.md` §4 dice «un `MSG_*` nuevo en `MENSAJES_GESTION_DESDE_AYUDA`». **R32** dice que la
pantalla debe nombrar **el día desde el que podrá**. Las dos cosas no caben a la vez en un literal
congelado: o no diría el día, o mentiría (`fecha_reparto` es un `DATE` libre y un `UPDATE` a mano
puede dejar +2 — pasó en esta misma ficha, en producción).

**Resuelto así:** la entrada nueva es `reservadaParaOtroDia: avisoReservaParaOtroDia` — **la propia
función de `dia-reparto-textos.ts`, re-exportada**, no una copia. D7 se conserva: la pantalla y sus
tests siguen leyendo **de este objeto**, y lo que comparten es la fuente. El requisito manda sobre
la forma; queda declarado porque es una desviación de la letra del design.

### 3 · Desviación declarada — toqué **dos comentarios** de `app/(app)/mis-asignaciones/**`

**F4 no es mío** y no lo hice. Pero **B9 depende de F4** («dep. B8, y del F4 para el árbol del
portal») y su cláusula (a) censa el árbol del portal entero: escribir la guardia y dejarla roja
esperando al frontend habría sido entregar la suite en rojo.

Lo que hice es **sólo comentario, cero JSX y cero comportamiento**: los dos bloques que afirmaban D5
como vigente (`PosOrderCardMosaico.tsx`, `PosOrderCardDetalle.tsx`) se **sustituyen por la regla
nueva**, que es literalmente lo que F4 pide («se sustituyen por la regla nueva, no se borran a
secas»). El `frontend_dev` seguirá tocando esos archivos para F2/F3; que lea esta nota.

### 4 · Hallazgo del camino — la frase citada no la distingue ningún detector

Al escribir la reversión **cité el texto viejo entre comillas** («aquí se leía: …»), y la guardia se
puso roja: un detector de prosa **no puede distinguir una cita de una afirmación**. Resuelto
parafraseando la cita en el código, y dejando el **verbatim donde le corresponde** —el spec de la
246, que es el soporte cuyo trabajo es conservar la foto—. No se relajó ningún detector.

### 5 · Deuda que la ficha declara y **no** cierra (ya estaba en el design §3)

`GestionOrdenRepository.crearGestionYTransicionar` sigue haciendo `orden.update` **por PK y sin
re-comprobar nada** —ni el estatus de origen—. La guarda de gestionar del mensajero vive **sólo en
el servicio**, y está escrito ahí con todas sus letras, con el porqué (sería la única de siete
condiciones re-comprobada en la escritura, y `update`/`updateMany` no fallan igual dentro de la
transacción que crea la fila de dinero).

### 6 · Nota sobre el `conflict` de la carrera de la tienda

Si la reserva cambia **entre** la puerta A y la escritura, el repo sólo puede decir «0 filas» y el
servicio devuelve el motivo de «ya no está esperando tu respuesta». Es **impreciso a propósito** y
está comentado en el código: distinguirlo obligaría a releer la fila dentro de la transacción para
decidir qué mentira contar. El rechazo **previsible** —el que un humano ve— es el de la puerta A, y
ése sí nombra el día.

### 7 · Lo que NO entra en este bloque

FRONTEND (F1-F7) y CIERRE (C1-C4). **F6 / «ver la app»** no se hizo: es del bloque de frontend, y en
este repo mirar la app encontró siete textos rotos que doce mil tests daban por buenos.

## BLOQUE 0 · M3' y M4 — corridas por el leader contra PRODUCCIÓN (2026-08-22, 23:1x CR)

### M3' — distribución horaria de `por_recoger -> en_reparto` (30 días)

| hora CR | recogidas | de ellas, reservadas a futuro |
| --- | --- | --- |
| 08 | 1 | 0 |
| 09 | 4 | 0 |
| 12 | 6 | 0 |
| 13 | 5 | 0 |
| 14 | 6 | **1** |
| 15 | 6 | 0 |
| 16 | 2 | 0 |
| 17 | 3 | 0 |
| 18 | 1 | 0 |
| **22** | **9** | **2** |

**La medición M3 que cerró D5 decía «nadie carga la furgoneta después de las 18:00».** El dato la
contradice: **las 22:00 son la hora con MÁS recogidas de todo el día (9 de 43)**, y dos de ellas
sobre órdenes reservadas a futuro.

⚠️ **Honestidad sobre este número, porque cambia cuánto pesa:** buena parte de esas 9 son las
pruebas del propio humano de anoche. Con 43 recogidas en 30 días **no hay volumen para hablar de
un patrón de operación**. Lo que el dato SÍ sostiene, y basta para revertir D5, es que la premisa
«a esa hora no pasa nada» es falsa: pasó, y el sistema lo permitió.

### M4 — anulaciones de gestión (30 días)

- Anulaciones: **7** · sobre órdenes con día reservado: **1** · sobre reserva futura visible hoy: **1**.
- Ventana: 2026-07-28 → 2026-08-21.

⚠️ **M4 SUBESTIMA POR CONSTRUCCIÓN, y el propio backend lo avisó:** la consulta lee el
`fecha_reparto` ACTUAL, y el defecto que esta ficha arregla **pisaba justo esa columna al anular**.
Toda anulación anterior que hubiera borrado una reserva es hoy invisible para esta medida. **Un
cero aquí no absuelve**; el 1 que aparece es el caso del humano, que se reparó a mano.

---

## M1' — re-medición de B0.3 (2026-08-22, contra producción por MCP)

`M1' = 0`. Consulta deliberadamente **más ancha** que M1 y M2 juntas —órdenes con
`fecha_reparto > (now() AT TIME ZONE 'America/Costa_Rica')::date`, **sin filtrar por estado**—:
conjunto vacío. Si la 261 se despliega ahora, **ninguna orden heredada queda bloqueada de golpe**.

**P1 no se re-abre**: la condición era «si M1 creció respecto a las 2 del 2026-08-21». Bajó a 0.

**Por qué es 0, dicho entero para que no se lea como «el riesgo no existía».** Las dos órdenes que
M1 contó el 21 llegaron a su día:

| guía | fecha_reparto | estado | mensajero |
| --- | --- | --- | --- |
| 17496963 | 2026-08-22 | `en_reparto` | Jose |
| 57998428 | 2026-08-22 | `en_reparto` | Jose |

Mismo estado y mismo mensajero que tenían. Eso es **R7 comprobado contra la realidad y no contra un
doble**: la marca caducó sola al llegar el día, sin que ninguna escritura la desactivara. Y de paso
**R20**: el corte de esa noche no las barrió.

⚠️ **Este número caduca.** En cuanto alguien asigne una orden para mañana vuelve a haber heredadas.
Ver C3: la consulta debería ser un paso de la lista de release, que hoy el repo no tiene.
