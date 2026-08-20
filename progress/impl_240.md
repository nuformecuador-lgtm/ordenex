# Feature 240 — Bitácora de implementación (BACKEND)

> **Alcance de esta bitácora: T1, T2, T3 y T4 de `tasks.md`, más las mutaciones T7.1-T7.3.**
> `tasks.md` reparte la ficha explícitamente («T1-T4 con el subagente de **backend**, T5-T6 con el de
> **frontend**, nunca a la vez sobre los mismos archivos»). **T5 (la pantalla) y T6 (la guardia
> anti-maqueta) NO están hechas** y son el siguiente turno. Lo que eso deja rojo, a propósito, está
> en §Rojos.
>
> **Rama:** `docs/240-246-247-specs` — **no se cambió de rama y no se creó ninguna**, por la
> corrección del coordinador: la **246** se está implementando **en el mismo árbol de trabajo** y las
> ramas comparten árbol. **Sin commit.**
>
> **Fecha:** 2026-08-20.

---

## 0. El timestamp de migración — coordinado con la 246

**`20260820190000_orden_historial_origen_rechazo_tienda`.**

Cómo se eligió, porque hubo que rehacerlo una vez:

1. Primero se creó como `20260820160000`, dejando libres 130000-150000 para la 246.
2. Al mirar el árbol, la 246 **ya había creado** `db/migrations/20260820180000_orden_fecha_reparto/`.
3. `design.md` §1.2 y `tasks.md` T1.1 exigen que el `<ts>` de la 240 sea posterior al último aplicado
   (`20260820120000`, la 237) **y también al que registre la 246**. Con la 246 en `…180000`, la 240
   se renumeró a **`20260820190000`**. No hay colisión y el orden es el que el spec pide.

**⚠️ LA MIGRACIÓN NO SE HA APLICADO A NINGUNA BASE**, por instrucción del coordinador. Queda
pendiente el round-trip real (`db:migrate` → `db:rollback` → `db:migrate`) contra la base local.
El test de integración de T1.2 es **estático** (lee `migration.sql` / `down.sql`), así que está verde
sin base — como el de la 237, que declara lo mismo en su cabecera. **Producción no se tocó.**

---

## 1. Qué se construyó, por tanda

### T1 — La familia y la arista *(inerte)*

| Archivo | Qué |
| --- | --- |
| `db/migrations/20260820190000_orden_historial_origen_rechazo_tienda/migration.sql` | **NUEVO.** `ALTER TYPE … ADD VALUE IF NOT EXISTS 'rechazo_tienda';`, sola (Postgres 55P04). |
| `…/down.sql` | **NUEVO.** Recrea el tipo con los **30** valores previos, con su precondición: si queda una fila usando el valor, el `USING` **falla ruidosamente** y el rollback aborta (R47). |
| `db/schema.prisma` | `rechazo_tienda` en `enum OrdenHistorialOrigenTipo`. **Solo esa línea** (la 246 toca otra región del mismo archivo). |
| `lib/types/orden-historial.ts` | El valor en el SEED, con su razón de **NO** entrar en `ORIGEN_TIPOS_VISITA_REAL` (R19) ni en `ORIGEN_TIPOS_CON_GESTION` ni en `ORIGENES_SIN_EVENTO_PUBLICO`. |
| `lib/types/order-status-transiciones.ts` | La arista **#67** `devuelta → rechazada` vía `rechazo_tienda`. Y **se reescribió** el comentario «las SIETE salidas de `devuelta` se conservan INTACTAS», que dejó de ser cierto. |
| `tests/fixtures/inventario-transiciones-140.ts` | Fila #67; `aristasFlujo` 61 → **62**; `paresUnicos` **59, sin cambio**; el comentario del recuento gana el **tercer duplicado histórico** (#21/#67). |
| `tests/integration/db/rechazo-tienda-migration.test.ts` | **NUEVO** (T1.2). |

**La aritmética que conviene mirar dos veces:** #67 es la **primera alta desde la 158 que no sube los
pares**, porque `devuelta → rechazada` ya lo tenía declarado #21 (el cron). La diferencia
`aristas − pares` pasa de **2 a 3**.

### T2 — La escritura

| Archivo | Qué |
| --- | --- |
| `lib/repositories/GestionOrdenRepository.ts` | **T2.1:** helper privado de módulo `transicionarDesdeDevuelta` con los pasos 1, 2 y 4; `reprogramarDesdeDevuelta` pasa a usarlo **sin cambiar firma ni conducta**. **T2.2:** `rechazarDesdeDevuelta`. |
| `lib/interfaces/repositories/IGestionOrdenRepository.ts` | `RechazarDesdeDevueltaInput` (con `motivo: string`, **no** `string \| null`) + el método con su contrato. |
| `tests/unit/repositories/gestion-orden-rechazar.test.ts` | **NUEVO**, con un doble que **honra el `where`**. 13 casos. |
| `tests/unit/repositories/orden-historial-cobertura.test.ts` | **T2.3:** punto **#32** `GestionOrdenRepository.rechazarDesdeDevuelta / rechazo_tienda`; el censo pasa de 30 a **31** y la igualdad exacta contra el SEED sigue cumpliéndose. |
| `lib/notificaciones/emitir.ts` | **T2.4:** el párrafo de la 240 junto al de la 237 — la familia nueva **no** emite el aviso «rechazada por el destinatario» (R45). Solo comentario; el filtro no se toca. |
| `tests/unit/repositories/notificacion-orden-rechazada.test.ts` | 3 casos nuevos, con **control positivo**. |

**T2.1, comprobado y no afirmado:** `gestion-orden-reprogramar.test.ts` y
`resolver-novedad-reprograma-dinero.test.ts` quedaron verdes **sin cambiar una sola aserción**
(16 tests). Miraban conducta, no estructura.

### T3 — El servicio y el borde

| Archivo | Qué |
| --- | --- |
| `lib/types/rechazo-tienda.ts` | **NUEVO.** `rechazarNovedadSchema` = `{ ordenId: uuid, motivo: motivoSchema }`. |
| `lib/interfaces/services/IRechazoTiendaService.ts` | **NUEVO.** `RechazarNovedadResult` + el contrato. |
| `lib/services/RechazoTiendaService.ts` | **NUEVO.** Las cinco puertas de `design.md` §5, en ese orden. |
| `lib/actions/resolver-novedad.ts` | **T3.2:** `rechazarNovedad`, tercera acción del archivo, mismo `withErrorHandler` / `toResolverNovedadActionError` / `BorderError`. |
| `tests/unit/services/rechazo-tienda-service.test.ts` | **NUEVO.** 18 casos. |
| `tests/unit/actions/resolver-novedad.test.ts` | +11 casos del borde. |

### T4 — La guarda del deshacer

| Archivo | Qué |
| --- | --- |
| `lib/utils/gestion-de-la-tienda-flag.ts` | **NUEVO** (sustituye a `gestion-tienda-ayuda-flag.ts`, **borrado**). `ORIGENES_GESTION_DE_LA_TIENDA` (lista) y `esGestionDeLaTienda`. |
| `lib/repositories/CierreDiaRepository.ts` | El `where` de `marcarDesdeAyudaTienda` pasa de igualdad a `in`. Ninguna consulta nueva; `ordenId` sigue delante. |
| `lib/repositories/CierresAdminRepository.ts` | `FAMILIAS_DERIVADAS_DEL_HISTORIAL` se expande con la lista; `esGestionDeLaTienda`. |
| `lib/services/CierreDiaService.ts` | **El mensaje deja de nombrar la pantalla** (D10/R43). La guarda 3-bis **no cambia una línea**. |
| `lib/interfaces/repositories/ICierreDiaRepository.ts` | Doc del campo + la deuda del rename, declarada (ver §4). |
| `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` | **Una línea, y solo una:** la cita de la ruta del módulo renombrado, dentro de un comentario. No se tocó ni una línea de UI. |

**Un hallazgo que no estaba en el spec y que era un fallo silencioso en potencia:**
`GESTION_ADMIN_SELECT.historialEstados` tenía **`take: 2`** literal, con un comentario que decía por
qué no podía ser `1`. Al pasar las familias filtradas de 2 a **3**, ese `2` habría **truncado en
silencio** — el fallo exacto contra el que su propio comentario avisaba. Se ató a
`FAMILIAS_DERIVADAS_DEL_HISTORIAL.length`, así que no puede volver a desincronizarse. Es dinero: un
truncado dejaría `desdeAyudaTienda: false` sobre una gestión que **sí** registró la tienda, y con eso
**deshacible** por el mensajero.

---

## 2. Mapa `R<n> → test` — **cada archivo comprobado con `ls` en el árbol**

> Los marcados **(NUEVO)** son de esta ficha. Los demás existen y se ejecutaron.
> **Los R de T5/T6 (R27-R40) no están cubiertos: son del turno de frontend** y se listan al final.

| Req | Test | Caso |
| --- | --- | --- |
| R1 | `tests/unit/services/rechazo-tienda-service.test.ts` **(NUEVO)** | «R1: una orden en la devolución anclada pasa a `rechazada`» |
| R2 | ídem | «otra TIENDA → forbidden», «rol %s → forbidden» (×3), «`forbidden` NO revela el estado…» |
| R3 | `tests/unit/repositories/gestion-orden-rechazar.test.ts` **(NUEVO)** | «💰 R3: una orden que YA SALIÓ de `devuelta` no deja ni un efecto» (**mutación T7.1**) · `rechazo-tienda-service.test.ts` — «R3: una orden en `%s` → conflict SIN llamar al repositorio» (×5) |
| R4 | `gestion-orden-rechazar.test.ts` **(NUEVO)** | «R4: el UPDATE va guardado por el estatus de ORIGEN, en la misma sentencia que lo cambia» (doble que **honra el `where`**) |
| R5 | ídem | «💰 R5/R21: el SEGUNDO envío devuelve `false` y no duplica gestión ni historial» |
| R6 | `tests/integration/db/rechazo-tienda-migration.test.ts` **(NUEVO)** · `tests/unit/types/orden-historial-types.test.ts` · `tests/unit/domain/order-status-transiciones.guardia.test.ts` | «R6: la familia está en el enum Prisma y en el SEED», «240/R6: … sin drift en ninguna dirección» |
| R7 | `rechazo-tienda-migration.test.ts` **(NUEVO)** · `order-status-transiciones.guardia.test.ts` · `tests/fixtures/inventario-transiciones-140.ts` | «R7: la familia produce EXACTAMENTE una arista, y sale de `devuelta`» · «las OCHO salidas de `devuelta`» · `aristasFlujo: 62` / `paresUnicos: 59` |
| R8 | `gestion-orden-rechazar.test.ts` **(NUEVO)** | «💰 R8/R18: crea UNA gestión `rechazada` con `cierre_id` nulo y su motivo» |
| R9 | ídem | «💰 R9: la gestión se atribuye al MENSAJERO de la última `devuelta` vigente, no a la tienda» (**mutación T7.2**) |
| R10 | ídem | «R10: sin gestión `devuelta` vigente, ABORTA la tx y el estado NO queda cambiado» |
| R11 | ídem | «R11/R12: la fila de historial lleva a LA TIENDA como actor, la familia propia y el motivo» |
| R12 | `tests/unit/actions/resolver-novedad.test.ts` | «💰 R12: motivo %s → validation_error, SIN tocar el service» (×4: ausente / vacío / espacios / no-texto) · `gestion-orden-rechazar.test.ts` **(NUEVO)** — el motivo en gestión **e** historial |
| R13 | `resolver-novedad.test.ts` | «R13/D5: el borde acepta `{ordenId, motivo}` y NO admite evidencias en imagen» · `gestion-orden-rechazar.test.ts` **(NUEVO)** — «la gestión nace SIN … `evidenciaStoragePath`» |
| R14 | `gestion-orden-rechazar.test.ts` **(NUEVO)** | «💰 R14/R20: el `data` del UPDATE lleva EXACTAMENTE una clave, `estatusId`» · `rechazo-tienda-service.test.ts` — «R14: el service no toca mensajero, prioridad ni montos» |
| R15 | `gestion-orden-rechazar.test.ts` **(NUEVO)** | «R15: las tres escrituras van dentro de UNA sola transacción» |
| R16 | ídem | «💰 R16: la gestión nace SIN causa de devolución, SIN ubicación y SIN importes» · `tests/unit/repositories/gestion-ubicacion-solo-escritura.guardia.test.ts` verde **sin tocarse** (3 tests) |
| R17 | `tests/unit/services/devolucion-sla-dinero.test.ts` verde **sin tocarse** + los cuatro de idempotencia (§5) | la aritmética es la misma función, no se tocó |
| R18 | `gestion-orden-rechazar.test.ts` **(NUEVO)** | «`cierre_id` nulo: ningún movimiento en el instante del rechazo» |
| R19 | `tests/unit/types/orden-historial-types.test.ts` · `tests/unit/types/criterio-intento-entrega.test.ts` · `rechazo-tienda-migration.test.ts` **(NUEVO)** | el literal de `ORIGEN_TIPOS_VISITA_REAL` **sigue intacto** (**mutación T7.3**) |
| R20 | `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` · `tests/unit/guards/dinero-sin-centimos.guardia.test.ts`, verdes sin tocarse · `gestion-orden-rechazar.test.ts` **(NUEVO)** | el `data` con una sola clave; la gestión sin `montoRecibido`/`ingresoBodegaRechazo`/`pagoMensajero` |
| R21 | `gestion-orden-rechazar.test.ts` **(NUEVO)** — «segundo envío» · `tests/unit/repositories/devolucion-sla-repository.test.ts` verde **sin tocarse** | la carrera con el cron, por la misma guarda |
| R22 | `tests/unit/utils/ingreso-ordenex.test.ts` verde **sin tocarse** | ⚠️ su verde es *coherencia*, no evidencia de que el rechazo manual facture bien. La evidencia real son los cuatro feeds de §5 y **M3**, ya medido en la puerta humana |
| R23 | `tests/unit/repositories/devolucion-sla-repository.test.ts` verde **sin tocarse** | el predicado del cron es `estatus = devuelta`: la orden sale del conjunto sola. **Falta la comprobación contra Postgres (T8.3)** |
| R24 | — | **NO CUBIERTO AQUÍ.** Es T8.3 (contra Postgres, con la app corrida). Ver §6 |
| R25 | `rechazo-tienda-service.test.ts` **(NUEVO)** | «R25/D9: NO se exige que el plazo de la devolución haya vencido» |
| R26 | `tests/unit/repositories/orden-repository.rechazos-sla.test.ts` verde **sin tocarse** · `rechazo-tienda-migration.test.ts` **(NUEVO)** | «R26: comparte par con el cron pero NO su familia» |
| R27-R32 | — | **frontend (T5)** |
| R33-R36 | — | **frontend (T5)** |
| R35 | `tests/unit/services/habilitar-novedad-service.test.ts` verde **sin tocarse** + el typecheck | `HabilitarNovedadResult` **no se tocó** (D4) |
| R37-R40 | — | **frontend (T6)** |
| R41 | `tests/unit/services/devolucion-sla-service.test.ts` · `tests/unit/repositories/devolucion-sla-repository.test.ts` · `tests/unit/services/devolucion-sla-dinero.test.ts`, verdes **sin tocarse** | el cron no se tocó |
| R42 | `tests/components/RepartoModule.test.tsx` · `tests/components/RepartoAyuda.test.tsx`, verdes **sin tocarse** | 211 archivos de componentes verdes |
| R43 | `tests/unit/services/cierre-dia-service.test.ts` | «💰 R43: una gestión de familia `rechazo_tienda` → `conflict`, SIN escribir nada», con **control positivo** y el caso del **agujero hermano** · `tests/unit/services/gestion-desde-ayuda-rotulo-cierre.test.ts` — el censo cerrado de la lista |
| R44 | `tests/unit/types/webhook-eventos.test.ts` verde **sin tocarse** · las guardias de transiciones exhaustivas | |
| R45 | `tests/unit/repositories/notificacion-orden-rechazada.test.ts` | «R45 (240) — el rechazo MANUAL de la tienda NO emite el aviso del destinatario», con control positivo y el lote de las tres vías |
| R46 | `gestion-orden-rechazar.test.ts` **(NUEVO)** — «R10: el mensaje del abort NO lleva datos personales ni el motivo» + censo: **esta ficha no añade ningún `console.*`** | |
| R47 | `tests/integration/db/rechazo-tienda-migration.test.ts` **(NUEVO)** | «recrea el tipo con los 30 valores previos», «FALLA RUIDOSAMENTE si quedan filas con la familia nueva, y lo dice». ⚠️ **round-trip real pendiente** (§0) |

**R sin cubrir en este turno:** R24 (T8.3, contra Postgres) y R27-R40 (frontend).

---

## 3. Mutaciones — una a una, con vitest corrido y el error citado

> Arnés: `sed`/`perl` sobre el archivo, `sha256sum` antes / mutado / después, `vitest run` real.
> Copia del original en el scratchpad, restaurada y **re-verificada verde** al terminar cada una.

### T7.1 — 💰 La guarda del `updateMany`

`lib/repositories/GestionOrdenRepository.ts`, borrando la línea
`estatusId: input.estatusDevueltaId, // guarda de idempotencia/carrera con el cron 99`.

```
SHA ANTES:   f2f69bc94d380e9bf8de00636aa407590a2036c3c84f3932a5837404d57d5f8a
SHA MUTADO:  75511391b5d405cb21b944d01ee9c1923fdd876509b51f142b59412d055a637a
SHA DESPUES: f2f69bc94d380e9bf8de00636aa407590a2036c3c84f3932a5837404d57d5f8a
```

**Muerta por 3 casos** (`tests/unit/repositories/gestion-orden-rechazar.test.ts`):

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  … > R4: el UPDATE va guardado por el estatus de ORIGEN, en la misma sentencia que lo cambia
AssertionError: expected { id: 'o1', deletedAt: null } to deeply equal { id: 'o1', …(2) }
 FAIL  … > 💰 R3: una orden que YA SALIO de `devuelta` no deja ni un efecto
AssertionError: expected true to be false // Object.is equality
 FAIL  … > 💰 R5/R21: el SEGUNDO envio devuelve `false` y no duplica gestion ni historial
AssertionError: expected true to be false // Object.is equality
      Tests  3 failed | 10 passed (13)
```

Tras restaurar: `Tests  13 passed (13)`.

> **La lección del repo, confirmada aquí:** esta mutación la mata **solo** el test del repositorio.
> El de servicio (`rechazo-tienda-service.test.ts`) usa un doble y **no ve el SQL**: seguiría verde.
> Por eso el doble de este archivo mantiene una fila de orden y evalúa el `where` clave a clave.

### T7.2 — 💰 El mensajero atribuido

Misma línea 770: `mensajeroId` derivado → `input.actorUsuarioId` (la tienda).

```
SHA ANTES:   f2f69bc94d380e9bf8de00636aa407590a2036c3c84f3932a5837404d57d5f8a
SHA MUTADO:  7be6d09c9d1036f2b4c73fc1906a0ffeb36a59643788726dda9e7987fd19a1b3
SHA DESPUES: f2f69bc94d380e9bf8de00636aa407590a2036c3c84f3932a5837404d57d5f8a
```

**Muerta por 2 casos:**

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  … > 💰 R9: la gestion se atribuye al MENSAJERO de la ultima `devuelta` vigente, no a la tienda
AssertionError: expected 'tienda-1' to be 'm-ultima-devuelta' // Object.is equality
 FAIL  … > 💰 R8/R18: crea UNA gestion `rechazada` con `cierre_id` nulo y su motivo
AssertionError: expected { ordenId: 'o1', …(4) } to match object { ordenId: 'o1', …(4) }
      Tests  2 failed | 11 passed (13)
```

Tras restaurar: `Tests  13 passed (13)`.

### T7.3 — 💰 La familia y el intento

`lib/types/orden-historial.ts`, metiendo `"rechazo_tienda"` en `ORIGEN_TIPOS_VISITA_REAL`.

```
SHA ANTES:   e0389e05c2df64c2c14b7ed0af0d8a8658110eaf28dbc3ae7f0d776c81e3c81d
SHA MUTADO:  3d566a80ae2811251857806aff4e0a56ea3fcca48fd9e97220f7a3d40f2cd63f
SHA DESPUES: e0389e05c2df64c2c14b7ed0af0d8a8658110eaf28dbc3ae7f0d776c81e3c81d
```

**Muerta por 4 casos en 3 archivos** — incluidos los dos que el spec exigía:

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/integration/db/rechazo-tienda-migration.test.ts > … > R19: la familia NO esta en `ORIGEN_TIPOS_VISITA_REAL` — al reves que la de la 237
AssertionError: expected [ 'gestion', …(2) ] to not include 'rechazo_tienda'
 FAIL  tests/unit/types/criterio-intento-entrega.test.ts > … > R34-a: la lista es EXACTAMENTE `gestion` + `gestion_tienda_ayuda` (la visita y su desenlace)
AssertionError: expected [ 'gestion', …(2) ] to deeply equal [ 'gestion', 'gestion_tienda_ayuda' ]
 FAIL  tests/unit/types/orden-historial-types.test.ts > … > 235/R11: NINGUNA de las dos es VISITA REAL — pedir ayuda no es un intento de entrega
AssertionError: expected [ 'gestion', …(2) ] to deeply equal [ 'gestion', 'gestion_tienda_ayuda' ]
 FAIL  tests/unit/types/orden-historial-types.test.ts > … > 240/R19: NO es visita real — la orden ya tiene contada su `devuelta`
AssertionError: expected [ 'gestion', …(2) ] to not include 'rechazo_tienda'
      Tests  4 failed | 37 passed (41)
```

Tras restaurar: `Tests  41 passed (41)`.

### Mutaciones que NO se corrieron, y por qué

- **T7.4** (reponer `"habilitar"` en `ACCIONES_POR_GRUPO.devolucion`): la celda todavía **no se ha
  borrado**. Es T5.1, del turno de frontend.
- **T6.3** (replantar la maqueta y ver la guardia roja): la guardia **no existe todavía**. Es T6.

---

## 4. Lo que queda abierto — con su razón, no como olvido

1. **T5 y T6 enteras: la pantalla y la guardia anti-maqueta.** Son del subagente de frontend, por el
   reparto que `tasks.md` fija. **Ir con esto, y no sin ello:** mientras T5/T6 no aterricen,
   `superficie-de-uso.guardia.test.ts` está **roja a propósito** sobre `rechazarNovedad` (§5). Ese
   rojo **es la señal de que el cable falta**, no un fallo: **no se silencia con una anotación
   `@sin-superficie`** — eso sería exactamente la maqueta que esta ficha viene a cerrar.
2. **El round-trip real de la migración** (§0). No se aplicó a ninguna base por instrucción del
   coordinador, para no colisionar con la de la 246.
3. **El rename `desdeAyudaTienda` → `registradaPorLaTienda`** (`design.md` §12). **NO se hizo**, y la
   razón está escrita junto al campo, en `lib/interfaces/repositories/ICierreDiaRepository.ts`: toca
   **~40 archivos**, casi todos fixtures de suites ajenas a esta ficha, y **varias de ellas las está
   modificando la 246 ahora mismo** (`corte-diario-service.test.ts`, `cierre-dia-repository.test.ts`,
   `CierreDiaModule.tsx`). Es un rename de **lectura** —sin cambio de forma, de dato ni de
   conducta—, así que se puede hacer solo, guiado por el typecheck, con el árbol quieto. Lo
   **funcional** de T4.1 sí está hecho: la lista, el predicado, los dos `in` y el mensaje.
4. **T4.3 no se hizo, y el spec cita un archivo que no dice lo que el spec dice.** `tasks.md` T4.3
   manda añadir el caso del badge «La tienda» a `tests/components/RepartoAyudaResueltaPorLaTienda.test.tsx`.
   Ese archivo **existe**, pero es sobre `RepartoModule` —el **portal del mensajero**, feature 235—,
   no sobre el badge del cierre. El badge vive en `CierreDiaModule.tsx` y se pinta desde el **booleano**
   `desdeAyudaTienda`, no desde la familia: un caso de componente con `desdeAyudaTienda: true` no
   probaría nada que no esté ya probado. **El eslabón familia → booleano sí está cubierto**, en los
   dos únicos niveles donde es decidible: `gestion-desde-ayuda-rotulo-cierre.test.ts` (el predicado y
   el censo cerrado de la lista) y `cierre-dia-repository.test.ts` (el `in` de la consulta).
5. **R24 (el ancla intacta) sigue sin comprobarse contra Postgres.** Es T8.3 y necesita la app.
6. **El agujero hermano de D6 queda abierto, medido y con un test que lo afirma.** La sintética de la
   reprogramación de escritorio (100, `reprogramacion_tienda`) **sí se puede deshacer hoy**. Está
   declarado en tres sitios —la lista, la guarda y un caso de test que se pondrá **rojo** el día que
   otra ficha lo cierre, y ese rojo será la señal de que se cerró—. **Ficha aparte**, como firma D6.
7. **El doble cobro del flete de devolución NO se tocó** (D2, ficha **247**).

---

## 5. Salidas reales

### `tsc --noEmit`

```
$ pnpm exec tsc --noEmit -p tsconfig.json
(sin salida — 0 errores)
```

> Durante el trabajo hubo errores de tipos **de la 246** en el mismo árbol
> (`corte-diario-repository.test.ts`, `cierre-dia-repository.test.ts`,
> `orden-repository.asignacion-satelite.test.ts`, `AsignacionSateliteService.ts`,
> `GuiaAsignacionService.ts`, `incidente-admin-aislamiento.test.ts`,
> `orden-historial-atomicidad.test.ts`). **No se tocó ninguno**; su agente los resolvió y el
> typecheck final sale limpio.
>
> Lo que **sí** obligó mi cambio: añadir `rechazarDesdeDevuelta` a los **6 dobles completos** de
> `IGestionOrdenRepository` en `tests/unit/services/mis-asignaciones-*.test.ts`. Es una línea por
> archivo, junto a la que la 237 dejó, y es inevitable: la interfaz gana un método.

### `eslint`

```
$ pnpm exec eslint <los 23 archivos tocados>
(sin salida — 0 errores, 0 warnings)
```

### Tests

```
$ pnpm exec vitest run tests/unit
 Test Files  2 failed | 829 passed (831)
      Tests  2 failed | 11225 passed (11227)

$ pnpm exec vitest run tests/components
 Test Files  211 passed (211)
      Tests  2753 passed | 26 skipped (2779)

$ pnpm exec vitest run tests/integration
 Test Files  1 failed | 193 passed (194)
      Tests  2 failed | 2240 passed (2242)

$ pnpm run test:guardias
 Test Files  2 failed | 121 passed (123)
      Tests  2 failed | 1815 passed (1817)
```

### Los rojos, uno a uno

| Rojo | ¿De quién? | Qué es |
| --- | --- | --- |
| `tests/unit/guards/superficie-de-uso.guardia.test.ts` → `lib/actions/resolver-novedad.ts:162 rechazarNovedad` | **MÍO, POR DISEÑO** | La acción existe y **ninguna pantalla la llama todavía**. Es el handoff a frontend (T5.3/T6.1). `tasks.md` lo anticipa: «si la operación existe y la pantalla no la llama, la guardia se pone roja a propósito». **Se apaga cableando el botón, no anotando el export.** |
| `tests/unit/guards/nota-privada-retirada.guardia.test.ts` | **de la 246** | `notaPrivada` / `findNotasByMensajero` en `IMisAsignacionesService.ts` y `MisAsignacionesService.ts`. No lo toqué. |
| `tests/integration/repositories/deshacer-asignacion.trazabilidad-carga.test.ts` (2 casos) | **de la 246** | El error lo dice literalmente: `base en memoria: asignacion SET no soportada -> -- Feature 246 (T3.5`. No lo toqué. |

### Los rojos POR DISEÑO que se repararon a mano (todos verdes ya)

| Suite | Qué se puso rojo | Cómo se reparó |
| --- | --- | --- |
| `order-status-transiciones.guardia.test.ts` | 3 aserciones: los dos recuentos y «las SIETE salidas de `devuelta`» | Literales actualizados **a mano**, con nota fechada. El de las salidas **es el contrato** (R7) y se conservó como literal enumerado, no como derivación |
| `orden-historial-types.test.ts` | el censo del SEED (30 → 31) | Literal a mano. ⚠️ **`ORIGEN_TIPOS_VISITA_REAL` NO cambió** — es la mutación T7.3 |
| `orden-historial-cobertura.test.ts` | `PUNTOS_DE_ESCRITURA` (30 → 31) | Entrada `#32`, sin debilitar la igualdad contra el SEED |
| `gestion-tienda-ayuda-migration.test.ts` (237) | «la carpeta va DESPUÉS de la última migración aplicada» y la lista del down | **La primera aserción era demasiado fuerte**: afirmaba «es la ÚLTIMA carpeta del árbol», cierto solo mientras la 237 fuera la más reciente. Se reescribió a lo que de verdad exige —posterior a todas las que ya existían— y sigue roja ante el fallo que vigilaba. La segunda se reparó como su propio comentario mandaba: nombrando el valor nuevo en una lista de POSTERIORES, **sin tocar el `down.sql`** |
| **9 tests más de migraciones del mismo enum** (67, 99, 100, 106, 138, 149, 154, 235, 239) | sus listas de «valores añadidos después de esta foto» | `rechazo_tienda` añadido a cada lista, con su comentario. **Ningún `down.sql` histórico se tocó** — es el punto entero del patrón |
| `cierres-admin-repository.test.ts` · `cierre-dia-repository.test.ts` | el `in` de familias y el `take` | Literales a mano: 3 familias, `take: 3` |
| `cierre-dia-service.test.ts` | el mensaje del deshacer | Literal a mano (D10): pierde «desde su pantalla de ayuda» |

### Los rojos que serían REGRESIÓN — comprobados uno a uno, todos VERDES

`devolucion-sla-service.test.ts` · `devolucion-sla-repository.test.ts` · `devolucion-sla-dinero.test.ts`
(el cron, R41) · `cierres-admin-caja-cod.test.ts` (el orden de las llamadas en la aprobación) ·
`cierres-admin-anclaje-devolucion.test.ts` · `cierres-admin-confirmacion-fisica.test.ts` ·
`cierres-admin-indemnizacion.test.ts` · los cuatro de idempotencia
(`wallet-idempotencia`, `wallet-tienda-idempotencia`, `pago-mensajero-idempotencia`,
`caja-tesoreria-idempotencia`) · `intentos-entrega-criterio-unico.test.ts` ·
`criterio-intento-entrega.test.ts` · `anclaje-vs-intentos.guardia.test.ts` ·
`deriva-primer-intento.guardia.test.ts` · `ordenes-columnas-money-safe.guardia.test.ts` ·
`dinero-sin-centimos.guardia.test.ts` · `webhook-eventos.test.ts` ·
`novedad-acciones-una-tabla.guardia.test.ts` · `habilitar-novedad-service.test.ts` ·
`rescate-ayuda-service.test.ts` · `RepartoAyuda.test.tsx` · `RepartoModule.test.tsx` ·
`orden-repository.novedades.test.ts` · `orden-repository.rechazos-sla.test.ts` ·
`gestion-ubicacion-solo-escritura.guardia.test.ts` · `ingreso-ordenex.test.ts` ·
`gestion-orden-reprogramar.test.ts` · `resolver-novedad-reprograma-dinero.test.ts`.

Todos entraron en las corridas de arriba y **ninguno falló**.

---

## 6. Convivencia con la 246 — lo que se hizo para no pisarla

- **Ni un comando de git que mueva árbol o índice.** Solo `git status` / `git log` / `git branch -a`.
- **`db/schema.prisma`:** una sola línea, en el `enum OrdenHistorialOrigenTipo`. La 246 toca `orden`.
- **`db/migrations/`:** timestamp renumerado a `…190000` **después** de ver el suyo (`…180000`).
- **`CierreDiaRepository` / `CierresAdminRepository`:** los dos están en la lista de la 246, pero mis
  ediciones son de **una a tres líneas cada una**, en regiones distintas (el filtro por familia de
  historial), hechas con reemplazo de cadena exacta y nunca reescribiendo el archivo.
- **Sus 6 dobles de `mis-asignaciones-*`:** una línea añadida por archivo, junto a la de la 237.
  Inevitable —la interfaz gana un método—, y se avisa aquí.
- **`tests/unit/services/corte-diario-service.test.ts`, `MisAsignacionesService`, ranking,
  asignación:** **no se tocó nada.** Es lo que habría exigido el rename del punto 4 de §4, y es la
  razón principal de haberlo diferido.

---

## 7. Veredicto

**T1-T4 completas y verdes** (typecheck limpio, lint limpio, 11.225 + 2.753 + 2.240 tests en verde,
3 mutaciones de dinero muertas con salida citada); **T5, T6 y T8 pendientes del turno de frontend**,
y la única roja mía —`superficie-de-uso` sobre `rechazarNovedad`— **es exactamente la señal de que
falta cablear el botón**: no se apaga con una anotación.
