## Mediciones del bloque M (leader, 2026-09-14, solo lectura contra producción vía MCP de Supabase)

> Se copian tal cual a `progress/impl_425.md` al abrir la implementación. Son FOTOS: M7 se
> re-mide el día del despliegue.

### M5 — ¿único bloqueo? (ya ejecutada antes)

3 órdenes en `rechazada` (NA-947 · NA-981 · NA-1103), las 3 con `mensajero_asignado_id` = Arnel
Guillen Arce. Sin segundo bloqueo.

### M6 — la tienda ya pagó

| estado del cobro | cobros | total |
| --- | ---: | ---: |
| aprobado | **24** | **₡65.088,00** |

Sobre gestiones `rechazada` **sin cierre**. Es el número que justifica R8: si el rechazo entrara al
cierre como gestión, esos 24 fletes de devolución se cobrarían **dos veces**. De los **46** rechazos
de tienda sin cierre, **22 no tienen cobro**: son anteriores al mecanismo de cobro de la 337. Eso es
la decisión que el humano dejó pendiente (los ingresos de bodega no emitidos) y esta ficha **no la
toca**.

### M7a — desglose a avisar (re-medido, sin cambios respecto de la mañana)

| Mensajero | Rechazos que aparecerán | Más antiguo | Más reciente |
| --- | ---: | --- | --- |
| Carlos Cambronero Cambronero | 19 | 2026-08-28 | 2026-09-10 |
| Andres Aguero Aguero | 7 | 2026-08-28 | 2026-09-03 |
| Andy Cortes Cortes | 7 | 2026-08-28 | 2026-09-03 |
| Kendall Hernandez Hernandez | 6 | 2026-08-28 | 2026-09-01 |
| Johel Hernandez Hernández | 4 | 2026-08-28 | 2026-09-10 |
| Arnel Guillen Arce | 3 | 2026-09-10 | 2026-09-10 |
| **Total** | **46** | | |

### M7b — cierres abiertos por mensajero (bloqueo 271 a partir de N ≥ 2)

| Mensajero | Cierres abiertos | Detalle |
| --- | ---: | --- |
| Arnel Guillen Arce | **1** | solicitado 2026-09-11 |

⚠️ **Arnel es el único con un cierre abierto, y es justo el que tiene las 3 órdenes atascadas.** Si
su cierre nuevo —el que traerá los 3 rechazos— nace **antes** de que se apruebe el del 11/09, queda
con **2 cierres abiertos** y la regla 271 lo **bloquea para recibir asignaciones**. Ningún otro de
los 6 está en riesgo: los demás tienen 0 abiertos.

### M1/M2 — ANTES: último cierre APROBADO de cada mensajero afectado

| Mensajero | Cierre | Solicitado | Efectivo | SINPE | Transf. | General | Pago mens. | Ingr. bodega rech. | Σ pago gestiones | Gestiones |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Andres Aguero Aguero | a079156f | 2026-09-12 | 133.980 | 140.780 | 0 | 274.760 | 30.000 | 0 | 30.000 | 35 |
| Andy Cortes Cortes | 7492eb71 | 2026-09-08 | 93.297 | 46.815 | 0 | 140.112 | 18.700 | 0 | 18.700 | 22 |
| Arnel Guillen Arce | cd99623f | 2026-09-09 | 104.343 | 11.899 | 0 | 116.242 | 11.900 | 0 | 11.900 | 17 |
| Carlos Cambronero Cambronero | 2be33f0c | 2026-09-12 | 145.736 | 120.248 | 39.345 | 305.329 | 34.000 | 0 | 34.000 | 38 |
| Johel Hernandez Hernández | 953bd91d | 2026-09-12 | 231.897 | 95.139 | 0 | 327.036 | 38.000 | 0 | 38.000 | 35 |
| Kendall Hernandez Hernandez | cc42c4d9 | 2026-09-12 | 120.765 | 63.496 | 0 | 184.261 | 22.000 | 0 | 22.000 | 40 |

**Invariante de partida, medida:** en los 6, `total_pago_mensajero` = `Σ pago_mensajero` de sus
gestiones con `cierre_id`. Es la igualdad que V5 exige que siga cumpliéndose en el primer cierre
que incorpore rechazos.

---

# 425 — Implementación del backend (bloque B, de B1 a B11) · `backend_dev`, 2026-09-14

> Rama `feat/425-salida-rechazo-tienda`, creada desde `dev` (`2ff69680`). No se ha tocado `app/` ni `feature_list.json`.
> Los símbolos se localizaron con el MCP `codebase-memory` (proyecto `R-job-singularis-projects-ordenex`), y cada uno se confirmó después en su archivo real.
> Todo lo que sigue a esta sección lo escribió el backend; lo de arriba son las mediciones del leader, copiadas tal cual.

## Veredicto

El backend de la 425 está hecho y verificado contra Postgres. Cada rechazo de tienda queda vinculado a su cierre en `cierre_rechazo_tienda` **sin recibir `cierre_id`**. El mensajero que solo tiene rechazos ya obtiene cierre, y al aprobarlo la orden sale de `rechazada`. **La igualdad del dinero de B6 se sostiene**: `total_pago_mensajero` es igual a la suma de `pago_mensajero` de las gestiones con `cierre_id`, tanto con el rechazo como sin él, y los seis totales coinciden al céntimo.

## Lo que hay que saber antes de revisar

1. **Hay un conflicto entre B8 y R5, y lo he resuelto a favor de R5.**
   - **Qué afirmaba.** El caso «Andy Cortes» de la 337 (`un mensajero cuyas UNICAS gestiones sueltas son de escritorio NO recibe cierre`) sembraba un rechazo y una reprogramación, y afirmaba `null`. Eso es **exactamente** lo que R5 revoca. Con esa semilla no se pueden cumplir a la vez «sin cambiar ni una aserción» y R5.
   - **Qué hice.** Cambié **solo la semilla**: el rechazo pasó a ser una segunda reprogramación. Sus tres aserciones siguen literales y ahora fijan D2. Añadí justo debajo el caso `425/R5` con el rechazo, que sí recibe cierre.
   - **Qué no cambió.** Ninguna otra aserción de la 337. Siguen en verde, incluido `porGestion[rechazoTienda] === null`.
2. **El mensajero no puede pedir él mismo un cierre que solo trae rechazos.**
   - **Por qué.** `CierreDiaService.solicitarCierre` responde «No tenes gestiones pendientes de cierre.» antes de llamar a `crearCierre`. El motivo es que `findGestionesPendientes` sigue excluyendo los rechazos, como manda la 337.
   - **Por dónde sale el caso Arnel.** Por el **corte diario**. Su selección (la rama a: `cierre_id IS NULL`, sin filtrar por origen) sí lo elige. Esto está medido contra Postgres en B5 y ejercido con el `CorteDiarioService` real en B6 y en B7. Coincide con el aviso («esa misma noche con el corte, o cuando él pida el siguiente»).
   - **Qué no se tocó.** El servicio, porque queda fuera del diseño. En B6 y B7 esto aparece como **sonda**, no como requisito.
3. **La mutación M4 sobrevive en SQL, y es por diseño.** Quitar `vinculoRechazoTienda: { is: null }` no pone B5 en rojo: la barrera real contra duplicados es `UNIQUE(gestion_id)` junto con `skipDuplicates`, y la guarda cuenta el `count` insertado, no las filas leídas. Esa condición la caza el test literal de B3. Detalle en la contraprueba de más abajo.
4. **Cada uno de los dos cerrojos de D2 solo se ve con una fila cruzada.**
   - **El problema.** Una `reprogramacion_tienda` real falla los dos cerrojos a la vez (`resultado` y el `some` por familia). Por eso, quitar solo uno de ellos no deja pasar ninguna fila real.
   - **Qué hace B5.** Siembra dos filas que ninguna vía de la app produce hoy: `rechazo_tienda` con resultado `reprogramada`, y `reprogramacion_tienda` con resultado `rechazada`. Así, quitar un solo cerrojo ya pone el archivo en rojo.
   - **Dónde está explicado.** En la cabecera del test.
5. **`pnpm run db:migrate` no se pudo usar.**
   - **Por qué.** Ejecuta `prisma migrate dev`, que exige terminal interactiva.
   - **Cómo se hizo el ida y vuelta.** `prisma migrate deploy`, luego `pnpm run db:rollback` y otra vez `prisma migrate deploy`. En cada paso se midió el drift con `prisma migrate diff --from-config-datasource --to-schema db/schema.prisma`.
   - **Estado final.** **La base local compartida (`localhost:5432`) queda con la migración aplicada** y el cliente Prisma regenerado.
6. **Dobles de test.** El DTO del detalle gana un campo obligatorio, y el typecheck marcó **71 dobles** que no lo traían (tests de servicios, de componentes y una acción).
   - **Los 71 dobles.** Se añadió `rechazosDeTienda: []` **solo en esos 71 puntos**, con un script guiado por el log del typecheck. No apareció ningún error ajeno a la ficha.
   - **Tres dobles que ahora responden por el `where`.** `buildSnapshotTx` (en el test unitario del repositorio) y los dobles de `convergencia-tarifa-listado-cierre` y de `asimetria-sin-tarifa`; este último lo destapó el `related` (ver las salidas). Hace falta porque la transacción lee `gestion_orden` dos veces.
   - **Una aserción de la 69.** Pasó de `mock.calls[0]` a `mock.lastCall`, con **el mismo literal** (`{ cierreId: "c1" }`).
7. **Lo que no se hizo:**
   - El bloque F (la pantalla y la guardia de superficies F3) y el bloque V.
   - `feature_list.json`.
   - M6 no se siembra en los tests: ningún camino de creación o aprobación de cierre lee `rechazo_tienda_cobro`. La prueba de que no hay doble cobro es R8, emparejado, más la mutación M5, que enseña el ingreso de bodega a 328,00 en lugar de 164,00.

## Archivos

### Creados

| Archivo | Para qué |
| --- | --- |
| `db/migrations/20260917120200_cierre_rechazo_tienda/migration.sql` | La tabla, `UNIQUE(gestion_id)`, índices por `cierre_id` y `orden_id`, 3 FKs RESTRICT/CASCADE y RLS sin policies. Sin backfill ni enums. |
| `db/migrations/20260917120200_cierre_rechazo_tienda/down.sql` | `DROP TABLE IF EXISTS "cierre_rechazo_tienda";` y nada más. |
| `lib/utils/cierre-rechazo-tienda.ts` | El `select`, el orden (`rechazado_at` ASC y desempate por `gestion_id`) y el mapper, compartidos por los dos detalles. Molde de la 264. |
| `tests/integration/db/cierre-rechazo-tienda-migration.test.ts` | B2 |
| `tests/integration/db/cierre-rechazo-tienda-sql-real.test.ts` | B5 |
| `tests/integration/db/cierre-rechazo-tienda-totales.test.ts` | B6 |
| `tests/integration/db/cierre-rechazo-tienda-aprobacion.test.ts` | B7 |

### Modificados: producción

| Archivo | Cambio |
| --- | --- |
| `db/schema.prisma` | Modelo `CierreRechazoTienda` y sus relaciones inversas: `CierreDia.rechazosTienda`, `GestionOrden.vinculoRechazoTienda` (1 a 1) y `Orden.cierresRechazoTienda`. |
| `lib/repositories/CierreDiaRepository.ts` | Añade `rechazosDeTiendaDelCierreWhere` y el pre-SELECT de `crearCierre`, con su `createMany` (`skipDuplicates`) **dentro de la misma transacción**. La guarda «algo pasó» incluye `rechazosIncorporados`, y `findCierrePropioConGestiones` gana la lectura del vínculo. |
| `lib/repositories/CierresAdminRepository.ts` | Lectura del vínculo en `findCierreByIdEnAlcance`, y `cierreRechazoTienda` añadido al `Pick`. **La aprobación no se tocó.** |
| `lib/services/CierreDiaService.ts` y `lib/services/CierresAdminService.ts` | Pasan `rechazosDeTienda` tal cual. |
| `lib/interfaces/services/ICierreDiaService.ts` | Tipo `CierreRechazoDeTienda`, sin ningún importe, y el campo nuevo en `VerCierrePasadoServiceResult`. |
| `lib/interfaces/services/ICierresAdminService.ts` | Reexporta el tipo y añade el campo en `CierreDetalleAdminServiceResult`. |
| `lib/interfaces/repositories/ICierreDiaRepository.ts` y `ICierresAdminRepository.ts` | `rechazosDeTienda: CierreRechazoDeTienda[]` en el retorno de los dos detalles. |

**No se tocó:**

- **Lo que decide quién factura:** `gestionesDelCierreWhere`, el `updateMany` que vincula y `ORIGENES_GESTION_FUERA_DEL_CIERRE`.
- **El cálculo del dinero:** `derivarPagos`, `derivarIngresoBodega`, `computeTotales`, `derivarIngresoOrden` y el congelado de pago e ingreso.
- **Lo que ocurre al aprobar:** los feeds de wallet, la confirmación física y el bloque 139.
- **Los `down.sql` anteriores:** ninguno.

### Modificados: tests

- **B8:** `tests/integration/db/cierre-excluye-gestiones-de-escritorio.test.ts`. Cambia la cabecera, cambia la semilla del caso de reprogramaciones (ver el punto 1) y se añaden 2 casos.
- **B9:** `tests/unit/guards/origenes-admitidos-en-cierre.guardia.test.ts`, con un caso nuevo.
- **B3, B4 y B11 (repositorios):** `tests/unit/repositories/cierre-dia-repository.test.ts`, con 12 casos nuevos, y `tests/unit/repositories/cierres-admin-repository.test.ts`, con 4.
- **B11 (servicios):** `tests/unit/services/cierre-dia-service.test.ts` y `tests/unit/services/cierres-admin-service.test.ts`, con 4 casos cada uno.
- **Solo dobles** (`rechazosDeTienda: []`, `cierreRechazoTienda` o enrutado por `where`):
  - `tests/integration/asimetria-sin-tarifa.test.ts`: el doble de la transacción responde por el `where`.
  - `tests/unit/repositories/cierre-pagos-lectura.test.ts`
  - `tests/unit/repositories/convergencia-tarifa-listado-cierre.test.ts`
  - `tests/unit/services/cierres-admin-aviso-rechazo.test.ts`
  - `tests/unit/services/cierres-admin-pendiente.test.ts`
  - `tests/unit/services/liberacion-al-aprobar-cierre.test.ts`
  - `tests/integration/actions/cierre-dia-action.test.ts`
  - Doce archivos de `tests/components/`: `CierreDiaComprobanteMarcasDeOrigen`, `CierreDiaModule`, `CierreMensajeroDesglosePorTienda`, `CierreMensajeroDetalleCascadas`, `CierrePremioPendiente`, `CierresAdminConfirmacionFisica`, `CierresAdminDeepLink`, `CierresAdminIndemnizacion`, `CierresAdminModule`, `CierresAdminPage`, `CierresAdminPagoMensajero` y `CorregirResultadoCierre`.

## B1 — La migración, ida y vuelta medida en local

La base de destino, según `prisma migrate status`, es `PostgreSQL database "ordenex", schema "public" at "localhost:5432"`.

- **Antes de migrar**, con el esquema ya editado: `prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script` dio **36 líneas, todas de `cierre_rechazo_tienda`**. La base no tenía ningún otro drift.

```
== 1) prisma migrate deploy (aplica la pendiente)
Applying migration `20260917120200_cierre_rechazo_tienda`
All migrations have been successfully applied.
== 2) diff base->schema DESPUES de aplicar (esperado: vacio)
-- This is an empty migration.
== 3) pnpm run db:rollback
Aplicando rollback: 20260917120200_cierre_rechazo_tienda
Script executed successfully.
Script executed successfully.
Rollback completado: 20260917120200_cierre_rechazo_tienda
== 4) migrate status tras rollback
Following migration have not yet been applied:
20260917120200_cierre_rechazo_tienda
== 5) diff tras rollback: lineas que nombran la tabla (esperado: las mismas 8 del diff ANTES)
8
== 6) prisma migrate deploy (re-aplica)
Applying migration `20260917120200_cierre_rechazo_tienda`
All migrations have been successfully applied.
== 7) migrate status
199 migrations found in prisma/migrations
Database schema is up to date!
== 8) diff final (esperado: vacio)
-- This is an empty migration.
== 9) prisma generate
✔ Generated Prisma Client (v7.8.0)
```

- **Colisión de timestamp comprobada.** La última migración de `origin/dev` y de todas las ramas locales y remotas es `20260917120100_notificacion_evento_traspaso`, y ninguna usa un timestamp posterior.

## Mapa R<n> → test

Las rutas abreviadas:

- `…/migration`, `…/sql-real`, `…/totales` y `…/aprobacion` son `tests/integration/db/cierre-rechazo-tienda-*.test.ts`.
- `…/escritorio` es `tests/integration/db/cierre-excluye-gestiones-de-escritorio.test.ts`.

| R | Test |
| --- | --- |
| R1 | `…/sql-real` › «R1/R18: incorpora el rechazo suelto como VINCULO…»; `…/escritorio` › «425/B8…» |
| R2 | `…/sql-real` › «R2/R15: el detalle lee lo CONGELADO…»; `…/aprobacion` › «R2/R9: el vinculo sobrevive a la aprobacion…» y «R2: los dos vinculos siguen apuntando al cierre despues de aprobarlo» |
| R3 | `…/sql-real` › «R3: un rechazo ya vinculado no lo recoge un cierre posterior, y la base impide…»; `…/aprobacion` › «R20/R3…»; unitario del repositorio › «R3/R4: si el `createMany` no inserta nada…» |
| R4 | `…/sql-real` › «R4: una segunda corrida no duplica el vinculo ni crea un segundo cierre» |
| R5 | `…/sql-real` › «R5: … (caso Arnel)», con la sonda de selección del corte; `…/totales` › «R5/R6/R7: el cierre que el corte crea SOLO con rechazos…»; `…/escritorio` › «425/R5…»; unitario del repositorio › «R5: … BASTA para crear el cierre» |
| R6 | `…/totales` › «R6/R7/R19: los SEIS totales son identicos al centimo…» y «R6 (M1/M2): total_pago_mensajero = Σ pago_mensajero de las gestiones CON cierre_id…» |
| R7 | `…/totales` › «R6/R7/R19…» |
| R8 | `…/aprobacion` › «R8: los apuntes de la aprobacion son EL MISMO conjunto con y sin los rechazos de tienda, y no vacio» y «R8: aprobar un cierre SOLO de rechazos no emite un solo apunte» |
| R9 | `…/totales` › «R9: la gestion del rechazo sigue con cierre_id, pago_mensajero e ingreso_bodega_rechazo en NULL»; `…/aprobacion` › «R2/R9…» |
| R10 | `…/aprobacion` › «R10: la confirmacion fisica exige SOLO la rechazada de calle…» y «R13…» (aprobado sin confirmar nada) |
| R11 | `…/aprobacion` › «R11: el rechazo de zona CENTRAL va a `por_devolver_a_tienda` y el de SATELITE a `por_devolver`» y «R13…» |
| R12 | `…/aprobacion` › los dos «R12…» (historial con el admin como actor; ni mensajero, ni prioridad, ni importe) |
| R13 | `…/aprobacion` › «R13: NA-947, NA-981 y NA-1103 salen de `rechazada` sin edicion manual (via real + corte + aprobacion)». Falta V5 en producción, que es del leader. |
| R14 | Datos: `…/aprobacion` › «R14 (datos)…» y los unitarios B11 de los dos repositorios y los dos servicios. La guardia de superficies (F3) es del frontend. |
| R15 | Datos: `…/sql-real` › «R2/R15…» y los unitarios B11 «R15». La pantalla (F4) es del frontend. |
| R16 | Datos: los unitarios de servicio B11 «R16: … no se cuelan en ningun grupo…». La pantalla (F4) es del frontend. |
| R17 | `…/sql-real` › «R17: SOLO reprogramaciones…», «D2, primer cerrojo…», «D2, segundo cerrojo…» y «R1/R18…»; `…/escritorio` › «425/B8…» y el caso de reprogramaciones; la guardia B9 |
| R18 | `…/sql-real` › «R1/R18…»; `…/escritorio`, casos de la 337 intactos |
| R19 | `…/totales` › «R19: sin rechazos no se escribe ni un vinculo de revision» y «R6/R7/R19…»; `…/escritorio` › «un cierre SOLO de calle vincula lo mismo y con los MISMOS totales…»; unitario del repositorio › «R19…» |
| R20 | `…/aprobacion` › «R20: rechazar el cierre conserva su vinculo y NO saca la orden de `rechazada`» y «R20/R3: el cierre posterior se lleva SOLO el rechazo nuevo…» |
| R21 | `…/migration`: tres casos contra el catálogo real (índices, FKs, RLS y policies, tipos desde `information_schema`) y seis estáticos; unitario del repositorio › «R21: la fila del vinculo no lleva ni un campo de dinero» |

## B6 — La igualdad del dinero, con números

- **Cómo se calculan.** Los totales los calcula `CierreDiaService.solicitarCierre` real sobre Postgres; el test no los pasa a mano.
- **El escenario.**
  - Una entrega de calle de 12.500,00 en efectivo.
  - Un rechazo de calle del propio mensajero.
  - Una tarifa sembrada de 1.500,00 por entrega y 164,00 por rechazo.
  - El rechazo de tienda, solo en la variante «con».
- **Con el rechazo y sin él**, lo que se obtiene es literalmente `{ efectivo: "12500.00", simpe: "0.00", transferencia: "0.00", general: "12500.00", pagoMensajero: "1500.00", ingresoBodegaRechazos: "164.00" }`.
- **La suma desde Postgres.** `Σ pago_mensajero` de las gestiones con `cierre_id` da `"1500.00"`, igual que `total_pago_mensajero`, en los dos casos. Las gestiones con `cierre_id` son 2, las de calle; el rechazo no está entre ellas.
- **La consulta de contaminación** de design §8 devuelve 0, con el vínculo presente (1 fila).
- **El caso Arnel,** creado por el corte real con 3 rechazos: los seis totales en `"0.00"`, 3 vínculos y 0 gestiones con `cierre_id`.
- **Bajo el arreglo obvio** (la mutación M5, abajo), este mismo archivo recibe `ingresoBodegaRechazos: "328.00"`, y la gestión del rechazo recibe `cierreId`, `ingresoBodegaRechazo: "164.00"` y `pagoMensajero: "0.00"`. Es el cobro de más que la ficha impide.

## B5 — Contraprueba de mutación

- **Arnés:** `scratchpad/mut/mutar.sh`.
- **Cómo se protege de mentir.** Cada mutación comprueba que el sha256 del archivo cambió. Después de correr los tests restaura desde una copia y compara el sha256 con el original. Al final hay una corrida de control **sin mutar**.
- **Cómo se corrió.** Sin nada más en paralelo y con `pnpm exec vitest run --no-file-parallelism <archivos>`.

| Mutación (en `lib/repositories/CierreDiaRepository.ts` salvo M5) | Archivos corridos | Resultado |
| --- | --- | --- |
| **M1** — quitar `resultado: "rechazada"` del predicado | B5 | **ROJO**: 1 fallido y 7 pasados («D2, primer cerrojo») |
| **M2** — quitar `historialEstados: { some: { origenTipo: "rechazo_tienda" } }` | B5 | **ROJO**: 1 fallido y 7 pasados («D2, segundo cerrojo») |
| **M3** — quitar `rechazosIncorporados === 0` de la guarda «algo pasó» | B5 | **ROJO**: 4 fallidos y 4 pasados (R2/R15, R3, R4 y R5 caso Arnel) |
| **M4** — quitar `vinculoRechazoTienda: { is: null }` | B5 y el unitario del repositorio | B5 **sigue verde** (8 de 8) y el unitario sale **ROJO** («B3: … `where` LITERAL…»). Se esperaba así: la barrera real es `UNIQUE(gestion_id)` más `skipDuplicates` y el `count` del `createMany` |
| **M5** — el «arreglo obvio» de design §7.1: quitar `"rechazo_tienda"` de `ORIGENES_GESTION_FUERA_DEL_CIERRE` (`lib/types/orden-historial.ts`) | B6, B8, B7 y B9 | **ROJO en los cuatro**: 13 fallidos. Además los 12 casos de B7 quedan saltados porque falla su `beforeAll`. Detalle abajo |
| **Control** — B5 sin mutar | B5 | **VERDE**: 8 de 8 |

Salida del arnés (`scratchpad/mut/mutaciones_resumen.log`):

```
[M1_sin_resultado_rechazada] mutacion aplicada en lib/repositories/CierreDiaRepository.ts (sha d54e1d8d…9968 -> b0a5cc47…3138)
[M1_sin_resultado_rechazada] exit=1 |  Test Files 1 failed (1)  Tests 1 failed | 7 passed (8) | restaurado=SI
FAIL  tests/integration/db/cierre-rechazo-tienda-sql-real.test.ts > 425/B5 — … > D2, primer cerrojo: una suelta con historial `rechazo_tienda` pero resultado `reprogramada` NO se incorpora
    AssertionError: expected [ Array(1) ] to deeply equal []
    - []
    + [ "75db26bf-3ae4-4400-9f75-4f32b111b7da" ]

[M2_sin_some_rechazo_tienda] mutacion aplicada en lib/repositories/CierreDiaRepository.ts (sha d54e1d8d…9968 -> fe5273ab…357d)
[M2_sin_some_rechazo_tienda] exit=1 |  Test Files 1 failed (1)  Tests 1 failed | 7 passed (8) | restaurado=SI
FAIL  tests/integration/db/cierre-rechazo-tienda-sql-real.test.ts > 425/B5 — … > D2, segundo cerrojo: una suelta `rechazada` con historial `reprogramacion_tienda` NO se incorpora
    AssertionError: expected [ Array(1) ] to deeply equal []
    - []
    + [ "04747284-e883-42c0-bf4e-12fa1a8df41d" ]

[M3_guarda_sin_rechazosIncorporados] mutacion aplicada en lib/repositories/CierreDiaRepository.ts (sha d54e1d8d…9968 -> 21075d48…b158)
[M3_guarda_sin_rechazosIncorporados] exit=1 |  Test Files 1 failed (1)  Tests 4 failed | 4 passed (8) | restaurado=SI
FAIL  … > R2/R15: el detalle lee lo CONGELADO, del rechazo mas viejo al mas reciente, aunque la orden cambie despues
FAIL  … > R3: un rechazo ya vinculado no lo recoge un cierre posterior, y la base impide que otro cierre se lo lleve
FAIL  … > R4: una segunda corrida no duplica el vinculo ni crea un segundo cierre
FAIL  … > R5: el mensajero SOLO con rechazos de tienda ahora SI obtiene cierre, y el corte lo selecciona (caso Arnel)
    (R5) AssertionError: expected null not to be null

[M4_sin_vinculo_is_null] mutacion aplicada en lib/repositories/CierreDiaRepository.ts (sha d54e1d8d…9968 -> 6e38fc79…26d1)
[M4_sin_vinculo_is_null] exit=1 |  Test Files 1 failed | 1 passed (2)  Tests 1 failed | 123 passed (124) | restaurado=SI
FAIL  tests/unit/repositories/cierre-dia-repository.test.ts > 425/B3-B4 — … > B3: la lectura de rechazos lleva el `where` LITERAL de las seis condiciones (contrato)
    -   "vinculoRechazoTienda": { "is": null },

[M5_arreglo_obvio_sacar_rechazo_de_la_lista] mutacion aplicada en lib/types/orden-historial.ts (sha 4c256541…1cde -> c93f2b5b…2baa)
[M5_arreglo_obvio_sacar_rechazo_de_la_lista] exit=1 |  Test Files 4 failed (4)  Tests 13 failed | 7 passed | 12 skipped (32) | restaurado=SI
FAIL  …/cierre-excluye-gestiones-de-escritorio.test.ts > 425/B8 … ; > 425/R5 … ; > `crearCierre` VINCULA solo la de calle y la de ayuda… ; > `findGestionesPendientes` devuelve la de CALLE y la de AYUDA…
FAIL  …/cierre-rechazo-tienda-aprobacion.test.ts > 425/B7   (beforeAll) Error: el corte no creo el cierre: {"mensajerosEvaluados":0,"vencidosCreados":0,"mensajerosSinZona":0}
FAIL  …/cierre-rechazo-tienda-totales.test.ts > R6/R7/R19 ; R6 (M1/M2) ; R9 ; design §8 ; R5/R6/R7
    (R6/R7/R19)  -  "ingresoBodegaRechazos": "164.00",   +  "ingresoBodegaRechazos": "328.00",
    (R9)         -  "cierreId": null, "ingresoBodegaRechazo": null, "pagoMensajero": null
                 +  "cierreId": "2968136b-…", "ingresoBodegaRechazo": "164.00", "pagoMensajero": "0.00"
FAIL  …/origenes-admitidos-en-cierre.guardia.test.ts > 425: la lista de exclusion sigue siendo EXACTAMENTE… ; ADMITIDOS ∪ FUERA… ; las que NO entran… ; las dos listas de la tienda…

== CONTROL: el mismo archivo B5 SIN mutar
[control] exit=0 |  Test Files 1 passed (1)  Tests 8 passed (8)
== tras restaurar: `git diff --stat -- lib/types/orden-historial.ts` vacio; en el repositorio, 1 aparicion de cada condicion mutada
```

**Cómo se lee M5.** Con el «arreglo de una línea»:

- **B6 se pone rojo.** Enseña el doble cobro con números: el ingreso de bodega pasa de 164,00 a 328,00, y la gestión del rechazo recibe `cierre_id` y un `ingreso_bodega_rechazo` congelado.
- **B7 cae en su `beforeAll`.** La sonda `solicitarCierre` ya se lleva los rechazos como gestiones FACTURABLES, así que el corte no encuentra nada que cerrar y el escenario de NA-981 ni siquiera se puede montar.
- **B8 y la guardia B9 se ponen rojos.** B8 incluye dos casos originales de la 337.

## Salida real de las comprobaciones

### `pnpm run typecheck`, con todos los cambios dentro

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit

TYPECHECK_EXIT=0
```

La primera corrida, recién cambiados los contratos, dio 71 errores, todos «Property 'rechazosDeTienda' is missing» en dobles de test; están descritos en el punto 6. La segunda dio 5 errores `string | undefined` en `cierreId` de B6 y B7, corregidos lanzando un error si falta. La tercera, la de arriba, da 0.

### Tests directos de la ficha

```
pnpm exec vitest run --no-file-parallelism \
  tests/integration/db/cierre-rechazo-tienda-migration.test.ts \
  tests/integration/db/cierre-rechazo-tienda-sql-real.test.ts \
  tests/integration/db/cierre-rechazo-tienda-totales.test.ts \
  tests/integration/db/cierre-rechazo-tienda-aprobacion.test.ts \
  tests/integration/db/cierre-excluye-gestiones-de-escritorio.test.ts \
  tests/unit/guards/origenes-admitidos-en-cierre.guardia.test.ts \
  tests/unit/repositories/cierre-dia-repository.test.ts \
  tests/unit/repositories/cierres-admin-repository.test.ts \
  tests/unit/repositories/cierre-pagos-lectura.test.ts \
  tests/unit/repositories/convergencia-tarifa-listado-cierre.test.ts \
  tests/unit/services/cierre-dia-service.test.ts \
  tests/unit/services/cierres-admin-service.test.ts

 Test Files  12 passed (12)
      Tests  472 passed (472)
   Duration  10.51s
VITEST_EXIT=0
```

Ningún caso quedó `skipped`: los archivos de `tests/integration/db` **corrieron** contra `localhost:5432`, y el control de M5 (con 12 saltados por su `beforeAll`) demuestra que esos archivos se ejecutan de verdad.

### `pnpm exec vitest related --run --no-file-parallelism`, sobre los archivos de la ficha

```
pnpm exec vitest related --run --no-file-parallelism \
  lib/repositories/CierreDiaRepository.ts lib/repositories/CierresAdminRepository.ts \
  lib/services/CierreDiaService.ts lib/services/CierresAdminService.ts lib/utils/cierre-rechazo-tienda.ts \
  tests/integration/db/cierre-rechazo-tienda-migration.test.ts tests/integration/db/cierre-rechazo-tienda-sql-real.test.ts \
  tests/integration/db/cierre-rechazo-tienda-totales.test.ts tests/integration/db/cierre-rechazo-tienda-aprobacion.test.ts \
  tests/integration/db/cierre-excluye-gestiones-de-escritorio.test.ts tests/unit/guards/origenes-admitidos-en-cierre.guardia.test.ts

 FAIL  tests/integration/asimetria-sin-tarifa.test.ts > 274/R39 — las superficies INTERNAS no bloquean ante el hueco de tarifa > el cierre de dia SE CREA, con las 9 columnas de tarifa en NULL (R23)
 FAIL  tests/integration/asimetria-sin-tarifa.test.ts > 274/R39 — la asimetria, afirmada de una sola vez sobre el MISMO estado > mismo hueco, CINCO respuestas: '0.00' / NULL / 409 / 409 / null
 FAIL  tests/integration/asimetria-sin-tarifa.test.ts > 274/R39 — la asimetria, afirmada de una sola vez sobre el MISMO estado > CONTRAPRUEBA: anadida la fila del par, las CINCO responden bien (el montaje no miente)
TypeError: Cannot read properties of undefined (reading 'createMany')
 ❯ lib/repositories/CierreDiaRepository.ts:966:61
 Test Files  1 failed | 128 passed (129)
      Tests  3 failed | 2032 passed (2035)
RELATED_EXIT=1
```

**Ese rojo lo causó esta ficha, y está corregido.**

- **Por qué no es ajeno.** `tests/integration/asimetria-sin-tarifa.test.ts` **no** está en `tests/baseline-rojos.json`.
- **La causa.** Su doble de la transacción devolvía `[snapshotRow()]` en *cualquier* `gestionOrden.findMany`. La lectura nueva de rechazos recibía una fila de snapshot y llamaba a `tx.cierreRechazoTienda.createMany`, que el doble no tiene. Es el mismo patrón que `convergencia-tarifa-listado-cierre`.
- **El arreglo.** El doble ahora responde por el `where`: devuelve el snapshot si `cierreId` es un id, y `[]` si es `null`. No cambia ninguna aserción.
- **La nueva corrida:**

```
pnpm exec vitest run --no-file-parallelism tests/integration/asimetria-sin-tarifa.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)
VITEST_EXIT=0
```

Los otros 128 archivos del `related` pasaron. Entre ellos están todos los que construyen `CierreDiaRepository` o `CierresAdminRepository` con dobles o contra Postgres: `gestion-desde-ayuda-cierre`, `dinero-productos.int`, `devolucion-rechazadas-flow`, `cierre-sin-gestion-sql-real`, `cierre-desglose-por-tienda-sql-real` y los de corte y aprobación. El único cambio posterior a esa corrida es el doble de `asimetria-sin-tarifa`, que no puede afectar a otro archivo. Por eso **no se repitió el `related` entero**.

### `pnpm run test:guardias`

```
 Test Files  225 passed (225)
      Tests  3296 passed (3296)
GUARDIAS_EXIT=0
```

### `pnpm run lint` final, con todos los cambios dentro

```
> ordenex@0.1.0 lint R:\job\singularis\projects\ordenex
> eslint

✖ 199 problems (0 errors, 199 warnings)
  0 errors and 2 warnings potentially fixable with the `--fix` option.

LINT_EXIT=0
```

Ninguno de los 199 avisos está en un archivo tocado por la ficha: la búsqueda de sus rutas en el log devuelve 0.

### `pnpm run typecheck` final, después del último cambio de doble

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit

TYPECHECK_EXIT=0
```

### Lo que no corrí, a propósito

- **La suite completa y `./init.sh`,** porque las corre el leader. Al tocar `db/schema.prisma` y una migración, `--rapido` se niega solo, así que corresponde el gate completo (V1). La base local ya tiene la migración aplicada, y esos 5 archivos de `tests/integration/db` necesitan `DATABASE_URL` para no quedar saltados.

## Pendiente para el leader

1. **V1:** el gate completo. **V3:** el PR. **V4:** entregar `progress/aviso_425_desglose.md` antes de desplegar. **V5:** medir el «después» sobre el primer cierre de producción que incorpore rechazos.
2. **El bloque F** (frontend). Los datos ya viajan: `rechazosDeTienda` en `VerCierrePasadoServiceResult` y en `CierreDetalleAdminServiceResult`, ordenados del más viejo al más reciente y con `rechazadoAt` en ISO.
3. **Decidir si hace falta decir más** sobre que el mensajero no puede solicitar él mismo un cierre de solo rechazos: la vía es el corte nocturno (punto 2 de arriba). El aviso de despliegue ya lo contempla.
