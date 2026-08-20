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

~~**⚠️ LA MIGRACIÓN NO SE HA APLICADO A NINGUNA BASE**, por instrucción del coordinador. Queda
pendiente el round-trip real (`db:migrate` → `db:rollback` → `db:migrate`) contra la base local.~~

> ⏳ **CORREGIDO el 2026-08-20 (§8.3).** La frase tachada **ya era falsa cuando se escribió**, y
> ahora se sabe la hora: la migración **se aplicó a las 11:12**, todavía con el nombre
> `…160000`, **antes** de que la renumerara. Se deja tachada y no borrada porque el error es del
> tipo que esta sesión lleva persiguiendo —una bitácora que afirma un estado que no es— y taparlo
> sería repetirlo. **El round-trip real está hecho y pegado en §8.3**, junto con la fila fantasma que
> esa renumeración dejó atrás y las dos lecciones que salieron de ella.

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

---

# 8. Segunda vuelta — los dos bloqueantes de la revisión (2026-08-20)

> Nada de lo anterior se reescribe. Lo único que se tocó de arriba es la frase de §0 que **afirmaba
> un estado falso de la base**: queda **tachada, con su nota**, porque borrarla sería repetir el
> error en vez de arreglarlo.
>
> **Rama:** la que había. **Ni un comando de git que mueva árbol o índice. Sin commit.**

## 8.1 · BLOQUEANTE 1 — R24 tenía un rojo accidental, no una aserción

**El diagnóstico de la revisión era exacto.** R24 estaba declarado «no cubierto aquí, es T8.3», y
T8.3 nunca se corrió. La mutación «el rechazo borra el ancla» **sí** moría, pero con un
`TypeError: prisma.ordenHistorialEstado.deleteMany is not a function`, porque el doble solo exponía
`createMany`. **Un requisito que se sostiene sobre una excepción accidental no está cubierto:** el
día que alguien añada `deleteMany` al doble por cualquier otro motivo, el rojo se apaga solo.

**Qué se hizo** (`tests/unit/repositories/gestion-orden-rechazar.test.ts`):

- El doble de `ordenHistorialEstado` pasa de **1 a 5 métodos** —`createMany`, `create`, `update`,
  `updateMany`, `deleteMany`—, y **los cuatro que el repo no debe usar quedan espiados**.
- El doble deja de ser mudo: mantiene una **tabla de historial de verdad**, sembrada con la fila de
  anclaje de la 239 (`origen_tipo = anclaje_devolucion`). Los cinco métodos **mutan esa tabla**, así
  que el efecto sobre el ancla se comprueba **sobre los datos**, no solo sobre el espía.
- La transacción falsa ahora **también revierte el historial** al abortar. Sin eso, el caso R10
  pasaría a mentir sobre lo que la base tiene.
- **Cuatro casos nuevos**, uno por cada cosa que R24 prohíbe, más la rama sin efectos:
  «la fila de anclaje sigue ahí, sin un solo campo cambiado» (contra la **foto** tomada al sembrar,
  no contra la fila viva) · «NO se borra — ninguno de los cuatro métodos se usa» · «NO se RE-ANCLA —
  la única fila nueva es la del rechazo» · «tampoco se toca cuando la orden ya salió de `devuelta`».

`Tests  17 passed (17)` (eran 13).

### Las dos mutaciones, con salida real

**M-R24-a — el rechazo BORRA el ancla** (`deleteMany` sobre `anclaje_devolucion` dentro de la tx):

```
SHA ANTES:   a7d0bf4e484c98244cbe30ce4c704a877cf96cee0f7aee5d479f39df6a466733
SHA MUTADO:  3a2d28fda4a3be1aea728b080c57f90255524362d21d80ee65ae2f28d5c05646
SHA DESPUES: a7d0bf4e484c98244cbe30ce4c704a877cf96cee0f7aee5d479f39df6a466733
```

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  … (R24) > R24: la fila de anclaje sigue ahi, sin un solo campo cambiado
AssertionError: expected [] to have a length of 1 but got +0
 FAIL  … (R24) > 💰 R24: NO se borra — ninguno de los cuatro metodos que podrian tocarla se usa
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
 FAIL  … (R24) > R24: NO se RE-ANCLA — la unica fila nueva es la del rechazo, no otro anclaje
AssertionError: expected [ { ordenId: 'o1', …(6) } ] to have a length of 2 but got 1
      Tests  3 failed | 14 passed (17)
```

**Tres `AssertionError`. Cero `TypeError`.** Es exactamente lo que la revisión pedía ver.

**M-R24-b — el rechazo MODIFICA el ancla** (la «refresca» con `updateMany` en vez de borrarla). Es
la tercera prohibición de R24, la que un `deleteMany` no ejerce:

```
SHA ANTES:   a7d0bf4e484c98244cbe30ce4c704a877cf96cee0f7aee5d479f39df6a466733
SHA MUTADO:  55fe3a90aca43e060fa49b3670fac8b2d5c60fbfa8e3f753f5d2f7e58f5022b3
SHA DESPUES: a7d0bf4e484c98244cbe30ce4c704a877cf96cee0f7aee5d479f39df6a466733
```

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  … (R24) > R24: la fila de anclaje sigue ahi, sin un solo campo cambiado
AssertionError: expected { ordenId: 'o1', …(2) } to deeply equal { ordenId: 'o1', …(2) }
 FAIL  … (R24) > 💰 R24: NO se borra — ninguno de los cuatro metodos que podrian tocarla se usa
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
      Tests  2 failed | 15 passed (17)
```

Tras cada restauración: `Tests  17 passed (17)`.

**Fila del mapa que cambia:** R24 pasa de «— · **NO CUBIERTO AQUÍ**» a
`tests/unit/repositories/gestion-orden-rechazar.test.ts` **(NUEVO)** — el bloque
«el ancla de la devolución queda INTACTA (R24)», 4 casos, **mutaciones M-R24-a y M-R24-b**.

---

## 8.2 · BLOQUEANTE 2 — el frente 2 medía el `import`, no la llamada

**La quinta forma de replantar la maqueta existía y sobrevivía:** dejar el `import` en pie y borrar
la invocación. Las dos guardias, verdes. Y la variante ingenua —el import huérfano— también, porque
`"lint": "eslint"` **no lleva `--max-warnings=0`** y `no-unused-vars` sale como *warning*. Quien
mataba esa maqueta era un **test de componente**: justo la red que D3 declaró insuficiente, porque un
test de componente afirma que el botón llama a **lo que el test le pasa como doble**.

### La forma elegida, y por qué ésa

Se añade `invocaElSimbolo(codigo, simbolo)` y el frente 2 pasa a exigir **las dos cosas**: que la
pantalla la **importe** y que la **invoque**. Tres decisiones dentro, cada una por un falso positivo
concreto:

1. **se quitan los comentarios** — la prosa del catálogo nombra las seis acciones, varias con
   paréntesis detrás; sin esto, cualquier módulo pasaría por invocarlas solo con mencionarlas;
2. **se quitan los `import` enteros** antes de buscar — si no, esto volvería a ser un detector de
   importación con otro nombre;
3. se busca el símbolo seguido de un paréntesis de apertura.

**El mensaje del frente cambia con él**, y distingue los dos fallos porque se arreglan distinto:
«nadie la importa» es una celda que sobra o un modal que falta; «la importan … pero **NINGUNA la
llama**» es la maqueta exacta.

### Por qué exigir la invocación NO es frágil aquí — medido, no supuesto

La objeción legítima es el símbolo que viaja **por referencia** (`onConfirm={rechazarNovedad}`) o el
**re-export**: esta forma no los vería. Se censaron **las seis acciones de la tabla** en el árbol:

```
rechazarNovedad               → RechazarNovedadModal.tsx:187    await rechazarNovedad({ ordenId, motivo })
reprogramarNovedad            → ReprogramarNovedadModal.tsx:52  await reprogramarNovedad({ … })
habilitarNovedad              → NovedadesModule.tsx:373         await habilitarNovedad({ ordenId, nota })
listarNotasOrden              → HiloNotasNovedadModal.tsx:86    listarNotasOrden({ ordenId })
registrarIntentoContactoOrden → IntentoContactoAccion.tsx:51    await registrarIntentoContactoOrden({ … })
gestionarDesdeAyuda           → GestionarDesdeAyudaModal.tsx:278 await gestionarDesdeAyuda(buildFormData())
```

**Las seis se invocan directamente. Ninguna viaja como referencia y ninguna se re-exporta.** Si
algún día una lo hiciera, este frente se pondría rojo y el arreglo sería **enseñarle esa forma**, no
relajarlo a «la importa» — eso es el agujero que esto cierra. Queda escrito junto a la función.

### Autocomprobación nueva (R40), en las dos direcciones

Fixture `IMPORT_SIN_LLAMADA` —la quinta maqueta, tal cual— y cuatro casos: ve la llamada real ·
**el `import` en pie sin la llamada NO cuenta** (y se afirma que el import **sí** está, que es lo que
hacía pasar al frente viejo) · nombrarla en un **comentario** no es llamarla · mencionarla **sin
paréntesis** tampoco (es literalmente `accionServidor: "rechazarNovedad"` en la tabla).

`Tests  19 passed (19)` (eran 15).

> ⚠️ **Dos veces mordió el escapado**, y se deja escrito porque es la lección de siempre: al escribir
> la expresión regular desde un script, la cadena perdió una capa y quedó un **backspace** en vez del
> `\b`; y un salto de línea escapado se convirtió en un salto real y rompió el fuente. Se arregló
> escribiendo la línea **por índice** y usando un template literal con el salto **literal**, sin
> ninguna secuencia de escape que pueda perder una capa por el camino.

### Las CINCO formas de replantar la maqueta — las cinco mueren

Catálogo: sha `53a98dd271a643f79f3c22a32f87b993ba98ebe2e5b43c408a361a237c6d968b` (antes y después).
Modal: sha `520cd779c8428827125034675a1c9425d8fbb523d6022aa834124d4e7b03716f` (antes y después).

| # | Forma | sha mutado | Quién la mata |
| --- | --- | --- | --- |
| M1 | `sinOperacion` con motivo de relleno (`TODO`) | `eaed04ca…` | **Frente 3** («es de relleno») + frente 4 + anti-vacuidad. **3 rojos** |
| M2 | productor **inventado** (`rechazarQueNadieEscribio`) | `d99d379c…` | **Frente 1** («cita un productor que no está donde dice») + frente 2 + anti-vacuidad. **4 rojos** |
| M3 | productor **real pero no cableado** (`recuperarABodega`) | `68607dbe…` | **Frente 2** («nadie la importa») + frente 4 + anti-vacuidad. **3 rojos** |
| M4 | `sinOperacion` con **motivo largo y creíble** | `acad38e6…` | **Frente 4, el censo inverso** («la pantalla dispara una operación que la tabla no declara») + anti-vacuidad. **2 rojos** |
| **M5** | **el `import` EN PIE y la invocación borrada** ← *la que sobrevivía* | `089019da…` | **Frente 2, ahora** («la importan … pero NINGUNA la llama») + anti-vacuidad. **2 rojos** |

Salida de M5, con el `import` todavía presente en el archivo (`RechazarNovedadModal.tsx:7`), que es
lo que prueba que es **esta** maqueta y no otra:

```
 FAIL  …sin-maqueta.guardia.test.ts > 240/R38 — y algún archivo de la pantalla la LLAMA
                                    > cada productor se importa Y se invoca dentro de `app/(app)/novedades/`
AssertionError: un botón de `/novedades` declara una operación que NINGÚN archivo de la pantalla
llama: … Ojo con el sabor sutil: dejar el `import` y borrar la invocación deja el botón igual de
muerto, y el linter no lo caza porque `no-unused-vars` es un *warning*. …
      Tests  2 failed | 25 passed (27)
```

Tras restaurar los dos archivos: **sha idénticos, `git status` de `app/(app)/novedades/` vacío**, y
`Tests  27 passed (27)`.

> **Lo que NO se tocó, y por qué se dice:** `"lint": "eslint"` sigue **sin** `--max-warnings=0`. Es
> un cambio de configuración global que afecta a **todo** el repo y a todas las features en vuelo, no
> a esta ficha. Se **nombra** aquí porque explica por qué el linter no era red para M5, y se propone
> como cambio aparte. La guardia ya no depende de él.

---

## 8.3 · La base: el round-trip que faltaba, y la fila fantasma que SÍ existía

### La fila fantasma — SÍ existía, y mi primera versión de este apartado era falsa

> ⏳ **CORREGIDO el 2026-08-20, con la evidencia del leader.** Aquí decía **«No hay ninguna fila
> fantasma… el `20260820160000` que renumeré nunca llegó a aplicarse»**. **Es falso**, y se deja
> escrito el error entero en vez de sustituirlo en silencio, porque el modo de fallo es justo el que
> esta bitácora ya tuvo una vez (§0).

**Lo que pasó de verdad, en orden:**

1. La migración se creó como `20260820160000_orden_historial_origen_rechazo_tienda` y **SÍ se
   aplicó** a la base local, a las **11:12**.
2. **Después** se renumeró a `…190000`, al descubrir que la 246 ya había tomado `…180000` y que el
   spec exigía ir detrás de ella (§0).
3. Eso dejó en `_prisma_migrations` **una fila sin carpeta en disco**: el nombre viejo seguía
   registrado como aplicado, pero su directorio ya no existía.
4. **El leader la borró** mientras esta segunda vuelta estaba en marcha.

**La evidencia, tomada por el leader ANTES de limpiar nada:**

```
20260820120000_orden_historial_origen_gestion_tienda_ayuda   2026-08-20 02:24
20260820160000_orden_historial_origen_rechazo_tienda         2026-08-20 11:12   ← SIN CARPETA
20260820180000_orden_fecha_reparto                           2026-08-20 12:20
20260820190000_orden_historial_origen_rechazo_tienda         2026-08-20 12:20
```

**Dos filas con el mismo nombre de migración y distinto timestamp**, y sólo `…190000` con carpeta.

### Las dos lecciones, que es lo que de verdad vale de esto

**1. Renumerar una migración YA APLICADA deja una fila fantasma que `prisma migrate status` NO
detecta.** No es un descuido de la herramienta: `migrate status` compara **lo que falta por
aplicar** —carpetas sin fila—, no **lo huérfano** —filas sin carpeta—. Por eso decía «Database
schema is up to date!» con la fila fantasma dentro, y por eso yo, que me apoyé en ese verde, no vi
nada. Quien renumere una migración tiene que comprobar el sentido contrario **a mano**: filas de
`_prisma_migrations` que ya no tengan directorio.

**2. 💰 Lo único que lo hizo INOCUO fue la guarda idempotente de mi propio SQL.** El `migration.sql`
lleva `ALTER TYPE … ADD VALUE **IF NOT EXISTS** 'rechazo_tienda'`, así que la segunda aplicación
—la de `…190000` sobre una base que ya tenía el valor— fue un **no-op**. El leader lo verificó antes
de borrar la fila: `rechazo_tienda` estaba en el enum **una sola vez**. **Con un `ALTER TABLE ADD
COLUMN` sin guarda, o con cualquier DDL no idempotente, esto habría petado** — y habría petado en la
re-aplicación, no en la renumeración, que es donde nadie estaría mirando. La convención de escribir
migraciones idempotentes dejó de ser una formalidad y pagó una factura concreta el mismo día.

### Y una lección de método, sobre cómo medí

**Medí un estado que otro había cambiado entre medias, y no lo dije.** El censo de abajo se tomó en
esta segunda vuelta —minutos antes del round-trip cuya re-aplicación queda sellada a las
`2026-08-20T14:16:42.117Z`—, es decir **DESPUÉS de la limpieza del leader**. Los números son
correctos **para ese instante**; la conclusión que saqué de ellos —«nunca hubo fila que dejar
atrás»— **no lo era**, porque una foto no puede decir nada sobre lo que había antes de tomarla.

**La regla que queda:** una medición se escribe con **cuándo** se tomó, no sólo con qué dio. «137 y
137» sin hora es un dato que parece más fuerte de lo que es. Aquí ya costó una afirmación falsa en
una bitácora que existe, precisamente, para que nadie tenga que fiarse de la memoria de nadie.

### El censo, con su hora

**Medido en la segunda vuelta, el 2026-08-20 hacia las 14:1x UTC — DESPUÉS de que el leader borrara
la fila fantasma.** Consulta de solo lectura sobre `_prisma_migrations`:

```
filas con '160000' en el nombre: 9
  20260710160000_vehiculos · 20260711160000_order_status_en_bodega_satelite
  20260712160000_wallet_movimiento · 20260714160000_gestion_orden_anulacion
  20260715160000_gestion_orden_causa_devolucion · 20260720160000_num_guia_no_secuencial
  20260731160000_orden_busqueda_trgm · 20260814160000_ruta_tramo_vivo_at
  20260819160000_orden_retiro_ayuda
filas con 'rechazo_tienda' en el nombre:
  [{"migration_name":"20260820190000_orden_historial_origen_rechazo_tienda"}]
filas SIN finished_at o con rolled_back_at: []
carpetas en disco: 137 | filas en tabla: 137
EN TABLA SIN CARPETA (fantasmas): []
EN CARPETA SIN TABLA (pendientes): []
```

Las nueve filas con `160000` son migraciones **legítimas de otras fechas** (julio y agosto): ninguna
es la del 20 de agosto, porque **esa ya la había borrado el leader**. La correspondencia
carpeta ↔ fila es 1:1 exacta **a esa hora**, que es exactamente lo que se espera **después** de una
limpieza — no la prueba de que nunca hiciera falta.

> ⭑ **La consulta que sí lo habría cazado**, y que es la que hay que correr al renumerar: la de
> `EN TABLA SIN CARPETA`. Estaba escrita en mi script de inspección y devolvió `[]` **porque llegué
> tarde**. Corrida a las 11:12, habría devuelto la fila.

### El round-trip completo, contra la base local

```
########## PASO 1 — ESTADO INICIAL ##########
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
137 migrations found · Database schema is up to date!
{"migration_name":"20260820190000_orden_historial_origen_rechazo_tienda",
 "finished_at":"2026-08-20T12:20:28.727Z","rolled_back_at":null,"applied_steps_count":1}
--- enum orden_historial_origen_tipo: 31 valores ---  (… gestion_tienda_ayuda, rechazo_tienda)
filas con origen_tipo = 'rechazo_tienda': 0

########## PASO 2 — ROLLBACK (pnpm run db:rollback) ##########
Aplicando rollback: 20260820190000_orden_historial_origen_rechazo_tienda
Script executed successfully.   (down.sql)
Script executed successfully.   (DELETE de _prisma_migrations)
Rollback completado: 20260820190000_orden_historial_origen_rechazo_tienda

########## PASO 3 — TRAS EL DOWN ##########
Following migration have not yet been applied:
20260820190000_orden_historial_origen_rechazo_tienda
--- enum orden_historial_origen_tipo: 30 valores ---
Raw query failed. Code: `22P02`. Message: `la sintaxis de entrada no es válida para el enum
orden_historial_origen_tipo: «rechazo_tienda»`

########## PASO 4 — RE-APLICAR (prisma migrate deploy) ##########
Applying migration `20260820190000_orden_historial_origen_rechazo_tienda`
All migrations have been successfully applied.

########## PASO 5 — ESTADO FINAL ##########
137 migrations found · Database schema is up to date!
{"migration_name":"20260820190000_orden_historial_origen_rechazo_tienda",
 "finished_at":"2026-08-20T14:16:42.117Z","rolled_back_at":null,"applied_steps_count":1}
--- enum orden_historial_origen_tipo: 31 valores ---
total filas en _prisma_migrations: 137
filas con origen_tipo = 'rechazo_tienda': 0
```

**Las tres cosas que el round-trip demuestra y que un test estático no puede:**
1. el `down.sql` **corre de verdad** contra Postgres y deja el enum en **30** valores;
2. el `22P02` del paso 3 es la **prueba positiva** de que el valor desapareció del tipo — la consulta
   ya no puede ni nombrarlo;
3. `migrate status` vuelve a verla como **pendiente** y `deploy` la **re-aplica** sin drift.

⚠️ **El `down.sql` no llegó a ejercer su precondición ruidosa**, y hay que decirlo: había **0 filas**
con la familia, así que el `USING` no tuvo nada que rechazar. Que aborte con filas vivas está
afirmado **estáticamente** en `rechazo-tienda-migration.test.ts` y sigue **sin comprobación contra
Postgres**. Comprobarlo exigiría insertar una fila a mano y volver a bajar; **no se hizo** para no
dejar basura en la base local sin pedirlo.

⚠️ **`rechazo_tienda` sigue con 0 filas**: el rechazo manual **nunca se ha ejecutado contra
Postgres**. Sigue pendiente el recorrido T8 (§4, punto 5), que es donde R24 se vería *en vivo* — pero
R24 **ya no depende de eso**: ahora tiene sus cuatro casos y sus dos mutaciones (§8.1).

**Los dos scripts de inspección eran de un solo uso y se borraron** (`scripts/_tmp_*`), como manda la
convención de este repo.

---

## 8.4 · Verificación de la segunda vuelta

```
$ pnpm exec tsc --noEmit -p tsconfig.json
(sin salida — 0 errores)

$ pnpm exec eslint tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts \
                   tests/unit/repositories/gestion-orden-rechazar.test.ts
(sin salida — 0 errores, 0 warnings)

$ pnpm run test:guardias
 Test Files  125 passed (125)
      Tests  1854 passed (1854)

$ pnpm exec vitest run tests/unit tests/integration
 Test Files  1027 passed (1027)
      Tests  13526 passed (13526)

$ pnpm exec vitest run tests/components
 Test Files  214 passed (214)
      Tests  2814 passed | 26 skipped (2840)
```

**Cero rojos, en todo el árbol.** Los tres que quedaban al cerrar la primera vuelta ya no están: el
de `superficie-de-uso` sobre `rechazarNovedad` lo apagó **el frontend cableando el botón** —que era
justo lo que ese rojo pedía—, y los dos de la 246 los cerró su propio agente.

## Veredicto de la segunda vuelta

Los dos bloqueantes, cerrados con evidencia: **R24 pasa de un rojo accidental por `TypeError` a
cuatro casos y dos mutaciones que mueren por aserción**, y **el frente 2 pasa de medir el `import` a
exigir la invocación, con las cinco formas de la maqueta muertas** —incluida la que sobrevivía—.
La base tiene su **round-trip real** y la frase falsa de §0 está corregida en su sitio.

⚠️ **Y una tercera corrección, que no es de código sino de rigor:** este apartado llegó a afirmar que
**no había fila fantasma**. **La había** — renumerar una migración ya aplicada la dejó, y
`prisma migrate status` no la ve. Lo único que la hizo inocua fue el `ADD VALUE IF NOT EXISTS` del
propio SQL. Medí **después** de que el leader la limpiara y no dije a qué hora medía: la foto era
correcta, la conclusión no. Está corregido con su evidencia en §8.3.

---

# 9. Tercera vuelta — el botón mudo que el recorrido destapó (2026-08-20)

> El leader cerró T8.1 y T8.3 ejecutando el rechazo **de verdad** contra Postgres, y funciona: 1 fila
> de historial con `rechazo_tienda`, orden a `rechazada`, **actor = la tienda**, y la gestión
> sintética con `mensajero_id` puesto y `cierre_id` NULL. **La paridad con el cron, verificada en
> datos y no en dobles.** Por el camino apareció esto.

## 9.1 · El fallo, tal como salió

Sobre una orden puesta en `devuelta` **a mano, sin gestión**, el servidor devolvió:

```
[AppError:INTERNAL] Error: rechazarDesdeDevuelta: sin gestion `devuelta` vigente
                    para derivar el mensajero
⨯ Error: resolver-novedad: AppErrorCode inesperado INTERNAL
```

**Y la tienda no vio absolutamente nada.** Botón habilitado, motivo escrito, pulsó, y no pasó nada:
ni la orden cambió, ni salió un aviso. **Un botón mudo — el defecto que esta ficha vino a cerrar,
una capa más abajo.**

La cadena, entera: el repo lanza un `Error` pelado → `withErrorHandler` lo normaliza a `INTERNAL` →
`toResolverNovedadActionError` **no reconoce ese código y lanza** (`default: throw`) →
`RechazarNovedadModal` llama a la acción **sin `try/catch`**, así que `onResuelto` nunca se ejecuta y
no hay nada que pintar.

## 9.2 · Lo que NO se hizo, y por qué

**No se inventó ningún camino de recuperación**, ni se derivó el mensajero de otra parte. El estado
**no es alcanzable hoy** y está medido antes de tocar nada: en producción, **11 órdenes han pasado
por `devuelta` y las 11 tienen su gestión** — 0 sin ella, ni siquiera anulada. A `devuelta` sólo se
llega aprobando el cierre que **contiene** esa gestión (239).

**El `throw` del repositorio se queda**, y es lo correcto: cuando se descubre, el `updateMany` ya
está escrito. Un `return` dejaría la orden en `rechazada` **sin gestión y sin historial**, peor que
el estado del que venimos. Lanzar **aborta la transacción** y lo revierte todo. Fallo cerrado.

**Lo que estaba mal era cómo salía**, y eso es lo único que se tocó.

## 9.3 · La forma elegida — y por qué NO es un `conflict`

El encargo decía «conviértelo en un `conflict` con motivo accionable, para que la pantalla lo
pinte». **Al mirarlo, esa forma habría mentido, y se cambió a propósito:**

**La pantalla NO pinta el `motivo` de un `conflict`.** Lo dice su propio código, con su razón
escrita desde que se montó (`RechazarNovedadModal.tsx`, sobre `RECHAZO_CONFLICTO`): ese `motivo` es
una cadena técnica —«la orden ya no esta en devuelta», sin tildes y con el nombre interno del estado
dentro— pensada para un registro. Así que `conflict` se pinta con un **texto fijo**:

> «Esta orden ya no estaba en devolución, así que no se rechazó. Actualizá la pantalla.»

Sobre este caso eso es **FALSO**: la orden **sí sigue en devolución**; lo que falta es su gestión.
Habría cambiado un botón mudo por **un mensaje que miente**, que es la misma familia de defecto.

**La forma que sí sirve:** un estado propio en la máquina de resultados,
`{ status: "sin_gestion_origen" }`. Y no es sólo corrección semántica — es que **la pantalla no
puede olvidarlo**: su mapa de mensajes es
`Record<Exclude<DesenlaceRechazo["status"], "ok" | "conflict">, string>`, así que añadir el estado
**rompe el typecheck** hasta que alguien le escriba su texto. Ese mecanismo ya estaba montado ahí
para exactamente esto, con su comentario puesto. **El rojo salió, como debía:**

```
app/(app)/novedades/_components/NovedadesModule.tsx(203,7): error TS2741:
Property 'sin_gestion_origen' is missing in type
'{ forbidden: string; not_found: string; config_error: string; unauthenticated: string; }'
but required in type 'Record<"not_found" | "forbidden" | "sin_gestion_origen" | …, string>'
```

## 9.4 · Qué se escribió

| Archivo | Qué |
| --- | --- |
| `lib/interfaces/repositories/IGestionOrdenRepository.ts` | **`SinGestionDevueltaError`**, clase propia. Precedente exacto en este repo: `DeshacerAsignacionConflictoError` en `IOrdenRepository.ts`. Su mensaje es **para el registro**: sin datos personales, sin el motivo escrito por la tienda y sin el id de la orden (R46) |
| `lib/repositories/GestionOrdenRepository.ts` | El helper lanza la clase en vez de un `Error` pelado. **El `throw` no se mueve de sitio**: sigue abortando la transacción |
| `lib/interfaces/services/IRechazoTiendaService.ts` | La unión gana `{ status: "sin_gestion_origen" }`, con el porqué de no ser `conflict` escrito al lado |
| `lib/services/RechazoTiendaService.ts` | `try/catch` que captura **sólo esa clase** y devuelve el estado. **Todo lo demás se re-lanza**: una caída de base tiene que seguir siendo `INTERNAL`, porque no es un desenlace de negocio. Mismo patrón que `DeshacerAsignacionService` |
| `app/(app)/novedades/_components/RechazarNovedadModal.tsx` | El texto `RECHAZO_SIN_GESTION_ORIGEN` |
| `app/(app)/novedades/_components/NovedadesModule.tsx` | Una entrada en el `Record` — la que el typecheck exigía |

**El texto, y las tres cosas que dice a propósito:**

> «No se pudo rechazar: a esta orden le falta el registro de su devolución. No es algo que hayas
> hecho mal —avisá a un administrador con el número de guía para que la revisen.»

**qué pasa** (le falta un registro, no «error interno») · **que no es culpa suya** —el botón estaba
habilitado y ella hizo todo bien— · **qué hacer**, con el dato que le van a pedir. **Ningún nombre de
función:** el `SinGestionDevueltaError` va al registro, no a la pantalla.

> ⚠️ **Se tocaron dos archivos de pantalla**, y se dice porque está fuera de mi superficie habitual:
> una constante de texto y una entrada del `Record`. Sin la segunda **el árbol no compila** —es el
> rojo que este cambio provoca a propósito—, así que dejarla para otro turno habría sido dejar el
> árbol roto.

## 9.5 · Los casos, y la mutación

**Servicio** (`tests/unit/services/rechazo-tienda-service.test.ts`, 18 → **21**):
«sin gestión `devuelta` vigente → `sin_gestion_origen`, **no una excepción**» · «y **NO se disfraza
de `conflict`** — el texto de la carrera perdida sería FALSO» · **el contraste obligatorio**: «una
caída de base NO se captura: sigue subiendo como excepción». Sin ese tercero, un `catch` a ciegas
haría que la tienda leyera «le falta el registro de su devolución» sobre una base caída — un
diagnóstico inventado.

**Repositorio** (`gestion-orden-rechazar.test.ts`): el caso R10 pasa a afirmar **la clase**
(`rejects.toThrow(SinGestionDevueltaError)`), no sólo el texto. Es lo que hace que el `instanceof`
del servicio signifique algo: si alguien volviera a lanzar un `Error` pelado, aquel `instanceof`
fallaría **en silencio** y la tienda volvería a pulsar un botón mudo.

**Borde** (`resolver-novedad.test.ts`, 29 → **30**): `sin_gestion_origen` cruza la Server Action
**tal cual**, junto a `forbidden` / `not_found` / `config_error`.

### La mutación pedida — devolver el `throw` a la superficie

```
SHA ANTES:   780e3d8625d07bd28d1fbd811c8693f16e413d98fd398999b7086cae4b900458
SHA MUTADO:  87ad8035d4792fd416db2a4d134c99123b2070cd9f9c221d24fed0180447f6a0
SHA DESPUES: 780e3d8625d07bd28d1fbd811c8693f16e413d98fd398999b7086cae4b900458
```

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  … > R10: sin gestion `devuelta` vigente -> `sin_gestion_origen`, no una excepcion
AssertionError: promise rejected "SinGestionDevueltaError: rechazarDesdeDev…" instead of resolving
 FAIL  … > R10: y NO se disfraza de `conflict` — el texto de la carrera perdida seria FALSO
      Tests  2 failed | 19 passed (21)
```

Tras restaurar: `Tests  21 passed (21)`.

## 9.6 · El censo que pediste: qué más puede salir mudo

**El agujero de fondo no es de esta ficha y sigue abierto.** `toResolverNovedadActionError`
(`lib/actions/resolver-novedad.ts:126`) sólo traduce `VALIDATION_ERROR` y `UNAUTHORIZED`; **cualquier
otro código cae en un `default: throw`**. Y `RechazarNovedadModal` / `ReprogramarNovedadModal` llaman
a su acción **sin `try/catch`** (verificado: 0 en los dos). Así que **todo lo que llegue como
`INTERNAL` deja la ventana muda**, no sólo lo de R10.

**Lo que puede llegar por ahí en el camino del rechazo, censado en el árbol:**

| Origen | Qué lo lanza | ¿Arreglado? |
| --- | --- | --- |
| `SinGestionDevueltaError` | el helper, cuando falta la gestión de origen | **SÍ, en §9.4** |
| `TransicionNoValidableError` (**4** sitios en `registrar-cambio-estado.ts`) | catálogo no disponible / estatus desconocido — el fallo cerrado de la 140 | **No.** Sube como `INTERNAL` → ventana muda |
| `TransicionIlegalError` | si el par `devuelta → rechazada` dejara de ser legal | **No.** Ídem |
| Errores de Prisma (base caída, timeout, constraint) | la transacción | **No**, y aquí es discutible que deba serlo: no es un desenlace de negocio. Pero la persona **sigue sin ver nada** |

**Y no es sólo del rechazo:** las otras **dos** acciones del mismo archivo —`reprogramarNovedad` y
`recuperarABodega`, feature **100**— comparten ese `toResolverNovedadActionError` y tienen **el mismo
agujero, idéntico**. `NovedadesModule` y `GestionarDesdeAyudaModal` sí tienen `try/catch` (1 cada
uno), así que «Habilitar» y la gestión desde ayuda están mejor cubiertos que estas dos ventanas.

**No se tocó, y es deliberado:** arreglarlo bien es o un `default` que devuelva un desenlace genérico
en vez de lanzar, o un `try/catch` en cada ventana. Las dos cosas **cambian la conducta de la feature
100**, que es dinero vivo y ficha ajena. **Se propone como ficha aparte**, con este censo delante.

## 9.7 · La lección, y dónde quedó escrita

**Un estado inalcanzable no exime de tener salida.** La invariante se cumple hoy —11 de 11, medido—
pero el día que un dato se tuerza, quien está delante de la pantalla **merece un mensaje, no un botón
mudo**. Y la forma de que eso no dependa de que alguien se acuerde es que **el typecheck lo exija**:
por eso el desenlace es un estado propio y no un `conflict` reutilizado.

Queda **junto al código**, no sólo aquí: en el JSDoc de `SinGestionDevueltaError` (por qué es un
`throw` y por qué tiene clase), en el de `RechazarNovedadResult` (por qué no es un `conflict`), y
sobre todo en el del texto `RECHAZO_SIN_GESTION_ORIGEN`, que es donde lo va a leer quien se pregunte
por qué existe un mensaje para algo que «no puede pasar».

## 9.8 · Verificación

```
$ pnpm exec tsc --noEmit -p tsconfig.json
(sin salida — 0 errores)

$ pnpm exec eslint <los 9 archivos tocados>
(sin salida — 0 errores, 0 warnings)

$ pnpm exec vitest run tests/unit/services/rechazo-tienda-service.test.ts
      Tests  21 passed (21)

$ pnpm exec vitest run tests/unit/repositories/gestion-orden-rechazar.test.ts
      Tests  17 passed (17)

$ pnpm exec vitest run tests/unit/actions/resolver-novedad.test.ts
      Tests  30 passed (30)

$ pnpm exec vitest run tests/unit tests/integration tests/components
 Test Files  1241 passed (1241)
      Tests  16344 passed | 26 skipped (16370)
```

**Cero rojos en todo el árbol**, con el estado nuevo dentro y la pantalla ya cableada.
