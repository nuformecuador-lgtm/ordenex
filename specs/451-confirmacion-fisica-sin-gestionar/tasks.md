# Ficha 451 — Tareas

Zona `fullstack`. Se secuencia **backend → frontend**. `[P]` = paralelizable con las tareas que
comparten su mismo prefijo de dependencias y **no tocan sus mismos archivos**.

> **El gate de esta ficha es `./init.sh` COMPLETO, y no es opcional.** El diff toca
> `db/schema.prisma`, una migración nueva y `lib/types/**`: `--rapido` **se niega solo** ante las
> tres (`docs/verification.md` §«Cuándo `--rapido` se niega»). No es un aviso, es un `fail`.
> Además hay nombres de dinero (`cierre`) por todas partes en las rutas tocadas.

---

## Qué cubren HOY los tests de la 238, y qué falta

Medido leyendo las suites en el árbol, no el índice del grafo.

| Archivo | Qué cubre hoy | Qué le falta para la 451 |
| --- | --- | --- |
| `tests/unit/types/gestion-retorno.test.ts` | El `Record` exhaustivo sobre los **cinco resultados**, `vuelveABodega` uno a uno, `RESULTADOS_QUE_VUELVEN` derivada (incluido el caso que lee la FUENTE y exige el `Object.keys(RETORNA_A_BODEGA)`), `incidente: false` declarado y no omitido | **Todo el eje nuevo**: `RETORNO_POR_ORIGEN`, `vuelveABodegaElPaquete` para `barrida` y para los cinco resultados vía `{ origen: "gestion" }` |
| `tests/unit/guards/confirmacion-incidentes-excluidos.guardia.test.ts` | 7 casos: censo de listas sueltas de los tres resultados, registro sin entradas muertas, presencia del `satisfies`, y 4 de autocomprobación del detector | **Dos casos**: la red del eje nuevo (`satisfies Record<OrigenDelPaquete,`) y el censo de reglas de origen sueltas, **con su autocomprobación** (obligatoria, `docs/verification.md`) |
| `tests/unit/guards/confirmacion-sin-lectores.guardia.test.ts` | Censo de `confirmadaFisicaAt` / `confirmada_fisica_at` en producción, registro, proyección en `select`, aritmética de fechas, + autocomprobación | **Nada.** Reusar el nombre de columna hace que cubra la columna nueva sin tocar el registro. **Verificar que sigue verde es la prueba de que se reusó bien** |
| `tests/unit/repositories/cierres-admin-confirmacion-fisica.test.ts` | El `WHERE` de `findGestionesRetornablesDelCierre` (resultado, `anuladaAt`, alcance), la proyección de `orden.numGuia`, y el `updateMany` de la marca con su guardia y su fallo cerrado | `findBarridasDelCierre` (alcance, acotado al cierre) y el `updateMany` sobre `cierreSinGestion` con su `WHERE`, su `data` de una clave y su `count` corto |
| `tests/unit/services/cierres-admin-confirmacion-fisica.test.ts` | Cobertura exacta **de gestiones**: faltante, ajena, duplicada, incidente, guía distinta, sin guía, conjunto vacío, alcance | Los mismos ocho casos **para barridas**, + los **mixtos** (gestiones completas y barrida faltante, y al revés), + R19 (lista parcial nunca aprueba) |
| `tests/unit/types/cierres-admin-confirmacion-schema.test.ts` | Forma de `confirmacionFisicaSchema` (uuid, entero positivo) y el `.default([])` | La union discriminada: las dos ramas, `origen` ausente rechazado, campos cruzados rechazados |
| `tests/components/CierresAdminConfirmacionFisica.test.tsx` | Las tres secciones, el contador en paquetes, los cuatro desenlaces de lectura, la caja de incidentes, el aviso sin guía por fila, y el caso **PREMISA** (lee `db/schema.prisma` y se pone rojo si cae el `@unique` de `numGuia`) | Sección «Sin gestionar», badge propio, contador unificado, lectura de guía de barrida, aviso de sin-guía en la barra de estado, y que el botón siga bloqueado con una barrida pendiente |
| `tests/unit/repositories/cierres-admin-caja-cod.test.ts` | **Mide el orden de las llamadas** dentro de la transacción de aprobación | **Nada, y ahí está el valor**: tiene que quedar verde **sin tocarse**. Un rojo = el bloque nuevo aterrizó mal |
| `tests/integration/db/confirmacion-fisica-migration.test.ts` | La columna de la 238 contra Postgres real + su `down.sql` | Es el **molde** del archivo nuevo, no se toca |
| `tests/unit/services/cierres-admin-service.aprobar.sin-gestion.test.ts` | Que aprobar libera las barridas (109/276) | Que toda barrida liberada llega con su marca (R26) |

**Archivos de test NUEVOS: 2.** `tests/integration/db/cierre-sin-gestion-confirmacion-migration.test.ts`
y `tests/integration/db/cierre-sin-gestion-confirmacion-sql-real.test.ts`. Todo lo demás se extiende.

> ⚠️ Los dos nuevos viven en `tests/integration/db/` y van envueltos en `HAY_BASE_DE_DATOS`: **sin
> `DATABASE_URL` se SALTAN y el gate sale verde igual**. Al cerrar cada tanda hay que mirar los
> `skipped`, no sólo el `INIT_EXIT`.

---

## T0 · Medir antes de tocar

- [ ] **T0.1 — Foto de la cola del despliegue.** Contra producción, **solo lectura**: cuántos cierres
      en estado `vencido` sin resolver hay hoy, cuántas filas de `cierre_sin_gestion` arrastran, y
      cuántas de ellas tienen `num_guia IS NULL`.
      **Hecho:** los tres números escritos en `progress/impl_451.md` con su fecha y la consulta
      ejecutada. Si `num_guia IS NULL` > 0, se escribe el detalle y **se avisa al humano antes de
      seguir** (Q4 de `requirements.md`).
      *Sin dependencias. Bloquea T7.3, no el resto.*

---

## T1 · El punto único (backend) — la pieza estructural

- [ ] **T1.1 — Extender `lib/types/gestion-retorno.ts`.** Añadir `OrigenDelPaquete`,
      `RETORNO_POR_ORIGEN` (con `as const satisfies Record<OrigenDelPaquete, "siempre" | "nunca" | "segun_resultado">`),
      `PaqueteDelCierre` y `vuelveABodegaElPaquete`, con sus comentarios de por qué. **No tocar** ni
      una línea de `RETORNA_A_BODEGA`, `RESULTADOS_QUE_VUELVEN` ni `vuelveABodega`. El módulo sigue
      puro (sin Prisma en runtime, sin servicios, sin `next/*`).
      **Hecho:** `pnpm run typecheck` verde; `git diff` sobre las líneas 33-61 del archivo, **vacío**.
      *Depende de: nada.*

- [ ] **T1.2 [P] — Tests del punto único.** Extender `tests/unit/types/gestion-retorno.test.ts`:
      `RETORNO_POR_ORIGEN` nombra los dos orígenes; `vuelveABodegaElPaquete({origen:"barrida"})` es
      `true`; para `gestion` devuelve lo mismo que `vuelveABodega` en los **cinco** resultados.
      **Hecho:** R1/R2/R3 cubiertos; los casos previos siguen verdes sin editarse.
      *Depende de: T1.1.*

- [ ] **T1.3 [P] — Extender la guardia del punto único.** Dos casos en
      `tests/unit/guards/confirmacion-incidentes-excluidos.guardia.test.ts` + su autocomprobación.
      **Hecho:** R4 cubierto, y el bloque de autocomprobación demuestra que el detector nuevo **se
      sabe romper** (se pone rojo ante una regla de origen plantada y no ladra ante el punto único).
      *Depende de: T1.1.*

---

## T2 · Lectura del conjunto esperado (backend)

- [ ] **T2.1 — `findBarridasDelCierre` en el repositorio.** Declararla en
      `lib/interfaces/repositories/ICierresAdminRepository.ts` (con su `BarridaDelCierre`) e
      implementarla en `CierresAdminRepository.ts`, molde literal de
      `findGestionesRetornablesDelCierre`: `where: { cierreId, cierre: alcanceWhere(alcance) }`,
      `select: { ordenId: true, numGuia: true }`. **Sin** rama sobre `sinGestionRegistrado`.
      **Hecho:** typecheck verde y **todos** los dobles de `ICierresAdminRepository` en tests
      actualizados (el typecheck los obliga).
      *Depende de: nada. Paralelizable con T1.*

- [ ] **T2.2 — Tests de la lectura.** Extender
      `tests/unit/repositories/cierres-admin-confirmacion-fisica.test.ts`: el `WHERE` lleva `cierreId`
      **y** el alcance por la relación; fuera de alcance → `[]`; no devuelve barridas de otro cierre.
      **Hecho:** R5/R6/R8/R9 cubiertos. **Mata el test con una mutación antes de creerlo**: quitar
      `cierreId` del `WHERE` tiene que ponerlo rojo.
      *Depende de: T2.1.*

---

## T3 · Contrato de entrada y guardia de cobertura (backend)

- [ ] **T3.1 — Borde zod.** `confirmacionFisicaSchema` pasa a `z.discriminatedUnion("origen", [...])`
      en `lib/types/cierres-admin.ts`, conservando el `.default([])` de `aprobarCierreSchema`.
      Propagar el tipo a `ConfirmacionFisicaInput` (`ICierresAdminService.ts`) y a la Server Action
      (`lib/actions/cierres-admin.ts:353`, passthrough).
      **Hecho:** typecheck verde; la action no gana lógica.
      *Depende de: T1.1.*

- [ ] **T3.2 — Tests del borde.** Extender `tests/unit/types/cierres-admin-confirmacion-schema.test.ts`.
      **Hecho:** R17 (forma) cubierto; `origen` ausente y campos cruzados **rechazados**.
      *Depende de: T3.1.*

- [ ] **T3.3 — Extender `validarConfirmacionFisica`.** En `CierresAdminService.ts`: leer las dos
      fuentes, montar **un** mapa por clave (`gestionId` | `ordenId`), reusar el bucle y los seis
      mensajes existentes, ampliar el atajo de R18 y mantener **perezosa** la lectura de barridas.
      La guardia sigue devolviendo **antes** de tocar el repo (R16).
      **Hecho:** typecheck verde; el camino «sin nada que devolver» no hace ni una consulta más que
      antes (se verifica **contando llamadas** al doble, no leyendo el código).
      *Depende de: T1.1, T2.1, T3.1.*

- [ ] **T3.4 — Tests de la guardia de cobertura.** Extender
      `tests/unit/services/cierres-admin-confirmacion-fisica.test.ts`: los ocho casos para barridas,
      los mixtos y R19. En todos, `repo.resolverCierre` **no llamado**.
      **Hecho:** R7, R10-R19 y R37 cubiertos.
      *Depende de: T3.3.*

---

## T4 · La marca: migración y escritura (backend)

- [ ] **T4.1 — Columna + migración.** `confirmadaFisicaAt DateTime? @map("confirmada_fisica_at")` en
      `model CierreSinGestion` (`db/schema.prisma`) con su comentario de por qué no contradice la
      inmutabilidad; `pnpm run db:migrate:create` → `db/migrations/<ts>_cierre_sin_gestion_confirmacion_fisica/migration.sql`;
      **`down.sql` escrito a mano** (`DROP COLUMN IF EXISTS`) con su pérdida de dato declarada.
      **Hecho:** `prisma migrate status` dice el host **antes** de aplicar; la migración aplica y
      `pnpm run db:rollback` la revierte sin error. **No se edita en sitio después de aplicarla.**
      *Depende de: nada. Paralelizable con T1-T3, pero **no** con el gate de otra feature sobre la
      misma base local.*

- [ ] **T4.2 — Escritura dentro de la transacción.** `ResolverCierreInput` (rama `aprobado`) gana
      `confirmacionBarridas` **obligatorio** y `?: never` en la rama `rechazado`. El `updateMany` sobre
      `tx.cierreSinGestion` va **pegado** al de la 238, mismo bloque, con su `WHERE` guardado por
      `cierreId`, `data` de **una sola clave** y fallo cerrado (`count !== ordenIds.length` → lanza).
      Cablear desde `CierresAdminService.aprobarCierre`.
      **Hecho:** typecheck verde **y** `tests/unit/repositories/cierres-admin-caja-cod.test.ts` verde
      **sin haberlo tocado**. Si está rojo, el bloque aterrizó mal: es regresión, no una aserción que
      actualizar.
      *Depende de: T3.3, T4.1.*

- [ ] **T4.3 — Tests de la escritura.** Extender
      `tests/unit/repositories/cierres-admin-confirmacion-fisica.test.ts`.
      **Hecho:** R20, R21, R22, R25, R27 y R28 cubiertos.
      *Depende de: T4.2.*

- [ ] **T4.4 [P] — Test de migración contra Postgres.** `[N]`
      `tests/integration/db/cierre-sin-gestion-confirmacion-migration.test.ts`, con el molde de
      `confirmacion-fisica-migration.test.ts`: la columna existe, nullable, sin default; el `down.sql`
      existe, la suelta y es idempotente.
      **Hecho:** R23 y R40 cubiertos, y el test **ejecutó** (no `skipped` por falta de `DATABASE_URL`).
      *Depende de: T4.1.*

- [ ] **T4.5 [P] — Test end-to-end de datos contra Postgres.** `[N]`
      `tests/integration/db/cierre-sin-gestion-confirmacion-sql-real.test.ts`: (a) aprobar con la lista
      incompleta deja el cierre `solicitado`, las órdenes **sin liberar** y cero marcas; (b) aprobar
      completo marca **todas** las barridas que la liberación movió, a bodega y a `rechazada`.
      **Hecho:** R11 (sin efectos parciales), R21 y R26 cubiertos. **Sin `if (!filas) return;`**: el
      test tiene que fallar si no hay datos, no reportar verde por vacío.
      *Depende de: T4.2.*

- [ ] **T4.6 [P] — R26 en el servicio.** Extender
      `tests/unit/services/cierres-admin-service.aprobar.sin-gestion.test.ts`.
      **Hecho:** aprobar pasa al repo la lista de barridas y ninguna queda sin marca.
      *Depende de: T4.2.*

---

## T5 · La pantalla (frontend) — empieza cuando el backend está verde

- [ ] **T5.1 — Vista unificada.** En `cierre-confirmacion-fisica.tsx`: `FilaAConfirmar`,
      `filasAConfirmar(grupos, ordenesSinGestion)`, y migrar `clavePaquete`, `agruparPorPaquete`,
      `progresoDePaquetes` e `interpretarLectura` a ese tipo. **Borrar** `retornablesDelCierre` si
      queda sin uso; nada muerto.
      **Hecho:** typecheck verde; `textoFaltan` / `textoCompleta` / `textoProgreso` **sin cambios de
      lógica**.
      *Depende de: T1.1, T3.1.*

- [ ] **T5.2 — La sección «Sin gestionar».** Cuarta sección **al final** de la misma lista, misma fila,
      badge propio, dentro del mismo contenedor con desplazamiento acotado. La derivación del orden de
      las tres secciones desde `RESULTADOS_QUE_VUELVEN` **se conserva**; la nueva se concatena.
      **Hecho:** R29/R30 cubiertos.
      *Depende de: T5.1.*

- [ ] **T5.3 — Aviso de «sin guía» en la barra de estado.** Cuántas filas del conjunto esperado no se
      pueden confirmar y que ese cierre no se va a poder aprobar. La advertencia por fila de la 238
      **se conserva**.
      **Hecho:** R34 cubierto; el `role="note"` del bloqueo (R27 de la 238) sigue siendo el único.
      *Depende de: T5.1.*

- [ ] **T5.4 — Cablear el módulo.** En `CierresAdminModule.tsx`: `pedirAprobacion` abre la ventana con
      `filasAConfirmar.length > 0` (no `retornables.length > 0`); `confirmarAprobacion` envía las
      entradas con su `origen`; `repartirErroresDelServidor` reparte por `gestionIds ∪ ordenIds`.
      **Hecho:** un cierre **sólo** con barridas abre la ventana en vez de aprobarse de un click.
      *Depende de: T5.1, T3.1.*

- [ ] **T5.5 — Tests de componente.** Extender `tests/components/CierresAdminConfirmacionFisica.test.tsx`.
      **Hecho:** R29-R36 y la mitad cliente de R19 cubiertos; el caso **PREMISA** (el `@unique` de
      `numGuia`) sigue verde sin editarse.
      *Depende de: T5.2, T5.3, T5.4.*

---

## T6 · Verificación y cierre

- [ ] **T6.1 — Mapa `R<n> → test` completo.** Escribir en `progress/impl_451.md` el mapa de los 40
      requisitos contra el archivo **y el nombre del caso**.
      **Hecho:** ningún `R<n>` sin test. El reviewer rechaza si falta uno.
      *Depende de: T1-T5.*

- [ ] **T6.2 — Autocomprobación por mutación.** Sobre al menos cuatro puntos: quitar `cierreId` del
      `WHERE` de la lectura (T2.2), quitar el `WHERE` guardado de la escritura (T4.3), quitar una
      barrida del conjunto esperado del servicio (T3.4) y quitar la sección nueva de la pantalla
      (T5.5). Los cuatro tienen que **ponerse rojos**.
      **Hecho:** las cuatro mutaciones probadas **y revertidas**, con la salida pegada en
      `progress/impl_451.md`. Sin esta evidencia el mapa de T6.1 no vale.
      *Depende de: T6.1.*

- [ ] **T6.3 — Gate COMPLETO.** `./init.sh` (no `--rapido`: se niega solo). Escribir `INIT_EXIT=$?`
      **dentro** del log, en `progress/gate_451.log`, y **sin canalizar por `tail`**.
      **Hecho:** `INIT_EXIT=0`, y los `skipped` revisados: los dos tests de `integration/db` nuevos
      **ejecutaron**.
      *Depende de: T6.2.*

- [ ] **T6.4 — Aviso operativo antes de desplegar.** Con los números de T0.1 delante, avisar a bodega
      de que los cierres vencidos en cola pasarán a exigir escaneo.
      **Hecho:** el aviso dado y anotado, o la decisión del humano de drenar la cola primero.
      *Depende de: T0.1, T6.3.*
