# Implementacion — feature 266: habilitar un pedido con novedad desde el canal por API key

Worktree `C:/w266`, rama `feature/266-habilitar-pedido-api-key`, base `origin/dev` = `39115008`
(ya incluye la 268). Spec: `specs/266-habilitar-pedido-api-key/{requirements,design,tasks}.md`,
puerta humana pasada el 2026-08-23 (D1..D6 firmadas).

---

## T0.1 — Verificaciones de la ficha, re-comprobadas en este worktree

Commit verificado: `39115008` (arbol limpio salvo `specs/266-.../`).

| Comprobacion | Resultado |
| --- | --- |
| (a) `ORIGENES_SIN_EVENTO_PUBLICO` esta VACIA y `ayuda_tienda`/`incidente` estan en `EVENTOS_PUBLICOS` (`lib/types/webhook-eventos.ts`) | **CIERTA**. La lista de exencion es `[] as const satisfies ...` (268/R5); `EVENTOS_PUBLICOS` incluye los dos values. Consecuencia: la rama A emite sin tocar el archivo. |
| (b) `transicionarAyuda` sigue siendo el punto UNICO de escritura de la arista de ayuda | **CIERTA**. Unica implementacion en `lib/repositories/OrdenRepository.ts:3415`, declarada en `IOrdenRepository.ts:1539`. Los unicos llamadores de produccion son `lib/services/rescate-ayuda.ts:84` y `lib/services/SolicitudAyudaService.ts:116`. No hay un segundo `updateMany` sobre `estatus_id` para esa arista. |
| (c) Los cuatro repos que ponen `mensajero_asignado_id` a NULL siguen haciendolo | **CIERTA**. `LiberacionReprogramadaRepository.ts:93`, `DevolucionSlaRepository.ts:136`, `RecuperacionBodegaRepository.ts:50`, `CierresAdminRepository.ts:1443`, los cuatro con el comentario «handoff limpio a la bodega». Sostiene el discriminador de design §1 y el hecho de que una `devuelta` esta SIEMPRE desasignada. |

Las tres ciertas → la implementacion procede.

## T0.2 — Baseline, medido por el leader en esta rama con el arbol limpio

- `pnpm typecheck`: **VERDE**.
- Superficie que esta feature toca (`tests/unit/api`, `tests/integration/api`,
  `tests/unit/services/rescate-ayuda.test.ts`, `tests/unit/services/webhook-estado-encolado.test.ts`,
  `tests/unit/types/orden-historial.test.ts`): **25 archivos / 282 tests / 0 rojos**.

Es decir: **la superficie que se toca arranca en verde**. Cualquier rojo ahi es de esta feature.

> ⚠️ `tasks.md` T0.2 pide `./init.sh` completo aqui. **Anulado por el leader**: el gate completo
> lo corre el leader al cerrar, no el implementer. Lo mismo con `pnpm db:migrate` /
> `pnpm db:rollback` de T1.1/T1.2 — ver la seccion de migracion.

---

## Bloques 1, 2 y 3 (+ T6.1) — backend_dev, 2026-08-23

> Continuacion de `progress/impl_266.md`. Alcance de esta tanda: T1.1, T1.2, T1.3, T2.1, T2.2,
> T2.3, T3.1, T3.2 y el assert de T6.1. **NO** se implementan el service (bloque 4), el route
> handler (bloque 5) ni el OpenAPI (bloque 7): otro agente los hara sobre estas interfaces.

### Archivos creados

| Archivo | Task |
| --- | --- |
| `db/migrations/20260823120000_orden_historial_origen_habilitacion_api/migration.sql` | T1.1 |
| `db/migrations/20260823120000_orden_historial_origen_habilitacion_api/down.sql` | T1.1 / R30 |
| `db/migrations/20260823130000_orden_habilitacion_api/migration.sql` | T1.2 / R29 |
| `db/migrations/20260823130000_orden_habilitacion_api/down.sql` | T1.2 |
| `lib/types/habilitacion-api.ts` | T2.1 |
| `lib/config/habilitacion-api.ts` (`TOPE_FILAS_HABILITAR = 100`) | D2 |
| `lib/interfaces/repositories/IOrdenHabilitacionApiRepository.ts` | T2.3 |
| `lib/interfaces/services/IApiHabilitacionService.ts` | T2.3 |
| `lib/repositories/OrdenHabilitacionApiRepository.ts` | T3.2 |
| `tests/unit/types/orden-historial-habilitacion-api.test.ts` | T1.3 + T6.1 |
| `tests/unit/types/habilitacion-api.test.ts` | T2.1 |
| `tests/unit/repositories/orden-repository-habilitacion-api.test.ts` | T3.1 |
| `tests/unit/repositories/orden-habilitacion-api-repository.test.ts` | T3.2 |

### Archivos modificados

| Archivo | Que |
| --- | --- |
| `db/schema.prisma` | value `habilitacion_api` en `enum OrdenHistorialOrigenTipo`; modelo `OrdenHabilitacionApi` con `@@map`; relaciones inversas en `Orden` (`habilitacionesApi`) y `Usuario` (`habilitacionesApiPedidas`) |
| `lib/types/orden-historial.ts` | `habilitacion_api` en el SEED, con el comentario largo: familia propia (A3) y las TRES no-listas, incluida la de dinero |
| `lib/interfaces/repositories/IOrdenRepository.ts` | tercer miembro del `Extract` de `TransicionAyudaInput.origenTipo` (T2.2, aditivo); tipo `OrdenParaHabilitacionApi`; declaracion de `findParaHabilitacionApi` |
| `lib/repositories/OrdenRepository.ts` | `findParaHabilitacionApi` (T3.1) |
| `tests/unit/repositories/orden-historial-cobertura.test.ts` | punto **#33** (`OrdenRepository` / `transicionarAyuda` / `habilitacion_api`), con su razon; conteo 31 -> 32 |
| `tests/unit/types/orden-historial-types.test.ts` | censo `ESPERADOS` + conteo 31 -> 32 |
| 10 tests de `tests/integration/db/*-migration.test.ts` | el value nuevo entra en la lista de POSTERIORES de cada foto historica; **ningun `down.sql` previo se toca** — es el patron que esos mismos tests documentan por escrito |
| 4 fakes de `IOrdenRepository` en `tests/unit/services/` | ganan `findParaHabilitacionApi` (el tipo lo exige): `bulk-orden-service`, `bulk-orden-service.carga-api`, `orden-service`, `rol-admin-satelite-authz` |

### Como quedo la migracion aplicada

**No se corrio `pnpm db:migrate` ni `pnpm db:rollback`** (anulados por el leader: la base local
tiene historial divergente y `prisma migrate dev` la dropearia). Los `.sql` se escribieron a mano
con EOL **LF** verificado, y se aplicaron con:

```
pnpm exec prisma migrate deploy   -> aplico 6 pendientes; las 2 ultimas, las de esta ficha:
                                     20260823120000_orden_historial_origen_habilitacion_api
                                     20260823130000_orden_habilitacion_api
pnpm db:generate                  -> Generated Prisma Client (v7.8.0)
```

Dos migraciones SEPARADAS por el 55P04 de Postgres (un value de enum nuevo no se puede usar en la
misma transaccion en que se crea), mismo motivo que `20260721120000_job_tipo_webhook_estado` antes
de `20260721130000_webhook_suscripcion`. El `down.sql` del enum recrea el tipo con **31** valores
(los 30 previos a la 240 mas `rechazo_tienda`) y **aborta ruidosamente** por el `USING` si queda
alguna fila con `habilitacion_api` (R30); la precondicion esta documentada en el propio archivo.
El `down.sql` de la tabla es un `DROP TABLE IF EXISTS`, que arrastra PK, 2 indices, 2 FK y la RLS.

### Dinero — la no-accion declarada

`habilitacion_api` **NO** entra en `ORIGEN_TIPOS_VISITA_REAL` (lista de INCLUSION), **NO** entra en
`ORIGEN_TIPOS_CON_GESTION` y **NO** entra en `ORIGENES_SIN_EVENTO_PUBLICO`. Dicho explicitamente en
el comentario del SEED, en el `migration.sql` y en el punto #33 del mapa de cobertura, para que
nadie la agregue «por simetria» con `gestion_tienda_ayuda`: contar de mas ahi sube los intentos,
adelanta el escalado del cron SLA (99) y dispara `cobroRechazado` (56) — cobro real a la tienda.
**`lib/types/webhook-eventos.ts` NO se toco**, y esa es exactamente la accion correcta (268/R5).

Verificado invirtiendolo: metiendo `habilitacion_api` en `ORIGEN_TIPOS_VISITA_REAL`, el caso
`💰 R26: NO cuenta como visita real...` se pone **ROJO**; revertido, verde.

### Nombres de los `it(...)` por task

**T1.3 + T6.1** — `tests/unit/types/orden-historial-habilitacion-api.test.ts`

- `💰 R26: NO cuenta como visita real, asi que no altera el conteo de intentos de ninguna orden`
- ``no enlaza gestion: su fila nace con `gestion_orden_id` NULO``
- `R27: NO esta exceptuada de la politica de eventos publicos`
- ``D5: `habilitacion_api` esta declarada en el SEED y en el enum Prisma, sin drift``
- `A3: es una familia PROPIA, distinta de las dos del viaje de la ayuda de la 235`
- **T6.1** ``R17/R27: `esTransicionEmitible('en_reparto', 'habilitacion_api')` es true``
- **T6.1** `la emision se decide por la POLITICA, no por la familia: un destino no publico sigue sin emitir`

**T2.1** — `tests/unit/types/habilitacion-api.test.ts`

- ``D1: el conjunto es EXACTAMENTE `ayuda_tienda` y `devuelta`, por igualdad``
- ``R13-b: `reprogramada` NO es habilitable, aunque el integrador la llame novedad``
- ``R13/R31: `rechazada`, `incidente`, `sin_gestionar` y `en_reparto` quedan fuera``
- ``coincide con `Object.values(ESTATUS_POR_GRUPO)`: una sola verdad, no dos literales``
- `cada estado habilitable existe de verdad en el catalogo de estados`
- `es lista de INCLUSION: un estado cualquiera del catalogo NO es habilitable por defecto`

**T3.1** — `tests/unit/repositories/orden-repository-habilitacion-api.test.ts`

- `R3/R4: el where lleva las TRES claves — numGuia, tiendaId del owner y deletedAt null`
- ``R3: el owner viaja en el WHERE y no en un `if` posterior (no hay ventana entre leer y comprobar)``
- `R4: devuelve null cuando no hay orden viva del owner con esa guia, sin distinguir el motivo`
- `aplana la fila a los CUATRO campos del discriminador (R12), con el estatus.value resuelto`
- ``propaga `mensajeroAsignadoId: null` — es el discriminador de la rama B, no un dato opcional``
- `el select esta ACOTADO: no pide montos ni la fila entera`
- `es SOLO LECTURA: no invoca ningun metodo de escritura de Prisma`

**T3.2** — `tests/unit/repositories/orden-habilitacion-api-repository.test.ts`

- `R21: el create recibe los CINCO campos de la fila de la rama A`
- ``la rama B queda escrita como tal: `cambioDeEstado` false y el estado en el que se quedo``
- ``no lee ninguna fila previa antes de insertar: un solo `create` y nada mas``
- `R24: append-only — dos habilitaciones de la MISMA orden hacen DOS inserts, sin tocar la primera`
- `R24: la clase NO expone ningun metodo de actualizacion ni de borrado`

**T2.2 / T2.3** — sin `it` propio: el criterio de «hecho» que `tasks.md` fija para las dos es el
typecheck (union literal cerrada; `Extract` ampliado). La no-regresion de T2.2 la dan
`rescate-ayuda-service.test.ts`, `solicitud-ayuda-service.test.ts` y
`habilitar-novedad-service.test.ts`, verdes **sin cambios**.

### Verificacion (salida real)

```
pnpm exec prisma migrate deploy   All migrations have been successfully applied.
pnpm db:generate                  Generated Prisma Client (v7.8.0) in 875ms
pnpm typecheck                    (sin salida = VERDE)
pnpm lint                         99 problems (0 errors, 99 warnings) — 0 en archivos de esta ficha
```

Vitest, siempre con rutas explicitas (nunca la suite completa ni `--changed`):

```
14 archivos / 139 tests / 0 rojos   los 4 nuevos + cobertura + rescate/solicitud/habilitar
                                    + orden-historial-types/union + webhook-eventos
                                    + criterio-intento-entrega + origen-149 + censo-catalogo-v2
123 archivos / 1628 tests / 0 rojos tests/integration/db/
 52 archivos /  943 tests / 0 rojos tests/unit/types + tests/unit/domain
 70 archivos / 1032 tests / 0 rojos tests/unit/guards
112 archivos / 1641 tests / 0 rojos tests/unit/repositories
 27 archivos /  309 tests / 0 rojos tests/unit/api + tests/integration/api + rescate-ayuda-service
                                    + webhook-estado-encolado + orden-historial-types
  7 archivos /  156 tests / 0 rojos los 4 fakes de services tocados + los 3 de la ayuda
```

Delta respecto del baseline de T0.2: **0**.

### Notas para quien monte el bloque 4

- El `Pick` de design §4.4 ya compila tal cual:
  `Pick<IOrdenRepository, "findParaHabilitacionApi" | "findEstatusIdByValue" | "transicionarAyuda">`.
- El tope del envoltorio se consume de `lib/config/habilitacion-api.ts`
  (`TOPE_FILAS_HABILITAR`, y `TOPE_CARACTERES_NOTA_HABILITAR` para el tope por fila de R7).
- La guarda de estado se hace con `esEstadoHabilitableApi` / `ESTADOS_HABILITABLES_API` de
  `lib/types/habilitacion-api.ts`, **en el service** (R14), no en el repo.

### Veredicto

Bloques 1, 2 y 3 (+ T6.1) implementados y verdes, sin regresiones: las interfaces del bloque 4
quedan listas para que el service se monte encima sin tocar nada de esto.

---

## Bloques 4, 5, 6.2 y 7 — 2026-08-23

Alcance: T4.1, T4.2, T4.3, T5.1, T5.2, T6.2, T7.1, T7.2. No se toco la capa de datos, ni
`middleware.ts`, ni `lib/types/webhook-eventos.ts`, ni la seccion de webhooks del OpenAPI.

### Creados

| Ruta | Task |
| --- | --- |
| `lib/services/ApiHabilitacionService.ts` | T4.1 |
| `tests/unit/services/api-habilitacion-service.test.ts` | T4.2 + T4.3 |
| `app/api/ordenes/api-key/habilitar/route.ts` | T5.1 |
| `tests/integration/api/ordenes-api-key-habilitar.route.test.ts` | T5.2 |
| `tests/unit/services/jobs/webhook-habilitacion-api-emision.test.ts` | T6.2 |
| `tests/unit/api/openapi-266-habilitar.test.ts` | T7.1 + T7.2 |

### Modificados

| Ruta | Que |
| --- | --- |
| `lib/api/openapi-spec.ts` | path nuevo + 5 schemas; importa `TOPE_FILAS_HABILITAR` |
| `docs/api/api-key-openapi.yaml` | espejo textual, LF, 0 CR |
| `docs/api/ordenex-api-key.postman_collection.json` | carpeta 9, habilitar en lote |
| `docs/api/CHANGELOG.md` | entrada del 2026-08-23 |
| `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` | censo de paths de OCHO a NUEVE, con dos asserts NUEVOS |

---

## Los cinco puntos de rotura que la ficha senalo — como quedaron

1. **La escritura no se duplica; la puerta si.** El service recibe el `Pick` EXACTO de design 4.4
   (`findParaHabilitacionApi` | `findEstatusIdByValue` | `transicionarAyuda`) y **no** recibe
   `prisma`. Un segundo `updateMany` sobre `orden.estatus_id` no compila. Comprobado sobre el
   arbol final: buscar `updateMany|prisma` en `ApiHabilitacionService.ts` solo devuelve dos lineas
   de COMENTARIO explicando la prohibicion. El assert de llamada esta en T4.3.
2. **La guarda de estado viaja con el llamador (R14).** Vive en el service, antes de cualquier
   escritura, y se ataca DIRECTAMENTE con un `it.each` de cinco estados fuera de conjunto
   (`entregada`, `rechazada`, `en_reparto`, `incidente`, `sin_gestionar`).
3. **La rama A si notifica, y se AFIRMA.** T6.2 invoca el choke point real con el emisor real y un
   `JobRepository` falso, y comprueba que se encola UN job `webhook_estado`. No se asume.
4. **Dinero.** `habilitacion_api` NO entra en `ORIGEN_TIPOS_VISITA_REAL`, y esta dicho por escrito
   en el SEED. El assert se verifico **invirtiendolo**: metiendo la familia en la lista, el caso
   de R26 se pone ROJO; revertido, verde. No es un grep.
5. **La verdad fisica del paquete.** Ningun test espera que una `devuelta` transicione: el `it` que
   la cubre se llama «una devuelta cae SIEMPRE en rama B y NUNCA se manda a en_reparto», y el
   OpenAPI lo declara en su description, con assert de paridad objeto-espejo.

Y los dos de la ronda anterior: **`lib/types/webhook-eventos.ts` NO se toco** (con
`ORIGENES_SIN_EVENTO_PUBLICO` vacia, la accion correcta es no hacer nada) y **la rama B no
notifica**: no hay evento nuevo, no hay gancho, y un `it` afirma que la seccion de webhooks sigue
teniendo un unico evento.

---

## Mapa de trazabilidad R -> test -> it(...)

Las **33** filas (R1..R31 mas R13-b y R14-b). Abreviaturas:

- **SVC** = `tests/unit/services/api-habilitacion-service.test.ts`
- **RTE** = `tests/integration/api/ordenes-api-key-habilitar.route.test.ts`
- **EMI** = `tests/unit/services/jobs/webhook-habilitacion-api-emision.test.ts`
- **OAS** = `tests/unit/api/openapi-266-habilitar.test.ts`
- **FAM** = `tests/unit/types/orden-historial-habilitacion-api.test.ts`
- **EST** = `tests/unit/types/habilitacion-api.test.ts`
- **RD1** = `tests/unit/repositories/orden-repository-habilitacion-api.test.ts`
- **RD2** = `tests/unit/repositories/orden-habilitacion-api-repository.test.ts`

| R | Archivo | it(...) |
| --- | --- | --- |
| R1 | RTE | «sin cabecera Authorization responde 401 y el service no llega a llamarse» |
| R2 | RTE | «una key que autentica pero no esta habilitada para el canal responde 403 sin procesar el lote» |
| R3 | SVC / RD1 | «busca la orden con el usuario de la key como owner, y no con ningun id del cuerpo» / «el where lleva las tres claves: numGuia, tiendaId del owner y deletedAt null» |
| R4 | SVC / RD1 | «cuando no hay orden viva del owner con esa guia, la fila falla y no se escribe nada» / idem where |
| R5 | RTE | it.each x3 «en la respuesta 401/403/200 ni el cuerpo ni console.error contienen la key» + «un error inesperado del service tampoco arrastra la key al log ni al cuerpo» (espia real con vi.spyOn) |
| R6 | RTE | it.each x6 (no-JSON, sin ordenes, no-array, vacio, elemento no-objeto, elemento nulo) «-> 422 y el service no se llama» + «un lote de 101 filas excede el tope: 422 sin procesar ninguna fila» |
| R7 | SVC | it.each x7 «num_guia no entero / negativo / como texto / ausente, nota vacia tras recortar / que no es texto / de 201 caracteres -> error/fila_invalida sin tocar la base»; «una nota de exactamente 200 caracteres SI se acepta»; «la nota se persiste RECORTADA» |
| R8 | SVC | «la segunda aparicion devuelve duplicada_en_lote y no vuelve a registrar nada» |
| R9 | SVC / RTE | «las filas SANAS del mismo lote se procesan igual que si la mala no existiera» / «un lote con una fila OK y una fila en error responde 200 con los dos resultados» |
| R10 | SVC / RTE / OAS | «total = habilitadas + habilitadasSinCambioDeEstado + conError»; «las dos filas de exito llevan estado poblado y la fila con error lo lleva en null» / «cada fila trae un resultado del conjunto cerrado» / «el enum de resultado publica los TRES desenlaces» |
| R11 | SVC / RTE | «tres filas de entrada devuelven tres resultados, en el mismo orden y con su guia» / «el service recibe el actor de la key y las filas en el mismo orden que llegaron» |
| R12 | SVC | «transiciona una sola vez, por el punto unico, con la familia propia de esta feature»; «ayuda_tienda SIN mensajero asignado no transiciona: es rama B (defensa)»; «una devuelta cae SIEMPRE en rama B» |
| R13 | SVC / EST | it.each x5 «una orden en entregada/rechazada/en_reparto/incidente/sin_gestionar devuelve estado_no_habilitable sin escribir ni estado ni bitacora» / «rechazada, incidente, sin_gestionar y en_reparto no son habilitables» |
| **R13-b** | SVC / EST / OAS | «reprogramada NO es habilitable — ni transiciona ni deja registro» / «reprogramada no esta en el conjunto» / «nombra los DOS estados habilitables y deja fuera reprogramada por su nombre» |
| R14 | SVC | el mismo it.each x5 de R13: **ataca la guarda directamente**, con el repo devolviendo una orden fuera de estado |
| **R14-b** | SVC | «una devuelta cae SIEMPRE en rama B y NUNCA se manda a en_reparto»; «la rama B no consulta siquiera el catalogo de estados» |
| R15 | SVC (T4.3) | «transiciona una sola vez, por el punto unico»; «un lote de 3 filas de rama A invoca transicionarAyuda exactamente 3 veces»; «el repo que el service recibe NO expone ningun otro metodo: solo los tres del Pick» |
| R16 | SVC | «transiciona una sola vez, por el punto unico, con la familia propia de esta feature» (origenTipo habilitacion_api) |
| R17 | EMI / FAM | «una entrada habilitacion_api hacia en_reparto encola UN job webhook_estado para esa orden»; «la familia habilitacion_api no esta exceptuada: emite igual que el rescate del boton» / esTransicionEmitible(en_reparto, habilitacion_api) === true |
| R18 | SVC | «transicionarAyuda que devuelve false da estado_no_habilitable y NO deja bitacora» |
| R19 | SVC | it.each x2 «cuando ayuda_tienda/en_reparto no resuelve, no se transiciona ni se registra» |
| R20 | SVC | «ayuda_tienda SIN mensajero asignado no transiciona: es rama B (defensa)»; «una devuelta cae SIEMPRE en rama B» |
| R21 | SVC | «una devuelta cae SIEMPRE en rama B» (registrar con cambioDeEstado false y estadoResultante devuelta) |
| R22 | SVC / EMI / OAS | «la rama B no consulta siquiera el catalogo de estados» (sin transicion, el choke point no se invoca) / «sin integrador suscrito no se encola nada, aunque la transicion se registre» / «la seccion webhooks sigue teniendo un unico evento y no menciona la habilitacion» |
| R23 | SVC | «en la rama A, registrar ocurre despues de transicionarAyuda y con cambioDeEstado true» |
| R24 | RD2 | «el create recibe los cinco campos»; «la clase no expone ningun metodo de actualizacion ni de borrado» |
| R25 | SVC | «transicionarAyuda que devuelve false da estado_no_habilitable y NO deja bitacora»; «registrar ocurre DESPUES de transicionarAyuda» |
| R26 | FAM | «R26: habilitacion_api NO cuenta como visita real» — verificado invirtiendolo: se pone rojo si alguien la anade a ORIGEN_TIPOS_VISITA_REAL |
| R27 | FAM | «esFamiliaSinEventoPublico(habilitacion_api) === false» + el de esTransicionEmitible |
| R28 | OAS | «el path se publica como POST en los dos artefactos»; «el yaml declara los MISMOS dos enums, en el mismo orden (paridad objeto-espejo)»; «responde 200 con HabilitacionResponse y reutiliza los errores globales 401/403/422»; y el censo de NUEVE paths en openapi-177-paths-pdf-y-carga-id.test.ts |
| R29 | migracion | `ENABLE ROW LEVEL SECURITY` en `db/migrations/20260823130000_orden_habilitacion_api/migration.sql`, cubierto por la guardia de RLS del repo (tests/unit/guards, verde) |
| R30 | migracion | el `down.sql` de `20260823120000_orden_historial_origen_habilitacion_api` recrea el tipo con los 31 valores previos y su `ALTER COLUMN ... USING` **aborta ruidosamente** si queda alguna fila con el value nuevo; la precondicion esta escrita en el archivo |
| R31 | SVC | «habilitar por segunda vez una orden ya en en_reparto devuelve error, JAMAS habilitada» (assert explicito sobre el resultado, ademas del cero-escrituras) |

### Mapa D -> test

| D | it(...) |
| --- | --- |
| D1 | EST «el conjunto es exactamente [ayuda_tienda, devuelta]» y «coincide con Object.values(ESTATUS_POR_GRUPO)»; SVC «reprogramada NO es habilitable»; OAS «nombra los DOS estados habilitables y deja fuera reprogramada por su nombre» |
| D2 | RTE «un lote de 101 filas -> 422» + «un lote de exactamente 100 filas SI pasa el envoltorio (el tope es inclusivo)»; OAS «declara el tope de 100 filas por lote, y el schema lo aplica» |
| D3 | SVC «habilitar por segunda vez una orden ya en en_reparto devuelve error, JAMAS habilitada» |
| D4 | **no-accion declarada**: no se anadio ninguna superficie de lectura de orden_habilitacion_api. La interfaz declara UN solo metodo, `registrar` — no hay ningun `find` |
| D5 | FAM «el SEED incluye habilitacion_api» + el censo de 32 en orden-historial-types.test.ts |
| D6 | SVC «la entrada de la transicion NO lleva motivo — la nota vive SOLO en la bitacora» |

---

## La migracion: como se aplico en esta maquina

Esto es lo que la proxima persona va a necesitar, porque **el camino normal esta prohibido aqui**.

`pnpm db:migrate` (que es `prisma migrate dev`) **NO se corrio ni una vez**, ni tampoco
`pnpm db:rollback`: la base local tiene **historial divergente** —una migracion aplicada que no
existe en el repo— y la salida natural de `migrate dev` habria sido **dropear la base**. La
instruccion de tasks.md T1.1/T1.2 en ese punto quedo anulada por el leader.

En su lugar:

1. Las dos carpetas se escribieron **a mano**, con su `migration.sql` **y su `down.sql`** (hay un
   chequeo que reclama el down.sql), copiando el formato de las migraciones vecinas:
   `20260820190000_orden_historial_origen_rechazo_tienda` para el enum y
   `20260815120000_orden_nota` para la tabla con FKs y RLS.
2. Van **SEPARADAS y en este orden**, por el **55P04** de Postgres —un value nuevo de enum no se
   puede usar en la misma transaccion en que se crea, y Prisma Migrate corre cada `migration.sql`
   en una—. Es el mismo motivo por el que `20260721120000_job_tipo_webhook_estado` va antes que
   `20260721130000_webhook_suscripcion`:
   - `20260823120000_orden_historial_origen_habilitacion_api` — SOLO el ALTER TYPE ADD VALUE IF
     NOT EXISTS del value nuevo, y nada mas.
   - `20260823130000_orden_habilitacion_api` — CREATE TABLE + 2 indices + ENABLE ROW LEVEL SECURITY.
3. **EOL LF verificado**: escribirlas con Python en Windows mete CRLF y tumba la guardia de
   schema-drift.
4. Aplicadas con **`pnpm exec prisma migrate deploy`**, que solo aplica lo pendiente y **nunca
   resetea**. Despues `pnpm db:generate`. Estado final comprobado con
   `pnpm exec prisma migrate status`: «Database schema is up to date!», 145 migraciones.

---

## Verificacion — salida real sobre el arbol final

```
$ pnpm typecheck
> tsc --noEmit
(sin salida)                                              VERDE

$ pnpm lint
99 problems (0 errors, 99 warnings)                       0 ERRORES
   los 99 warnings son preexistentes en suites ajenas; ninguno en un archivo de esta ficha
```

```
$ pnpm exec vitest run <los 8 archivos de test NUEVOS de la ficha>
 Test Files  8 passed (8)
      Tests  97 passed (97)

$ pnpm exec vitest run tests/unit/api tests/integration/api \
    tests/unit/services/rescate-ayuda-service.test.ts \
    tests/unit/services/webhook-estado-encolado.test.ts \
    tests/unit/types/orden-historial-types.test.ts
 Test Files  29 passed (29)
      Tests  344 passed (344)

$ pnpm exec vitest run tests/unit/guards tests/unit/repositories tests/unit/types
 Test Files  231 passed (231)
      Tests  3431 passed (3431)

$ pnpm exec vitest run tests/integration/db tests/unit/services
 Test Files  322 passed (322)
      Tests  5139 passed (5139)
```

**Delta vs baseline: 0.** La superficie del baseline (T0.2) crecio de 27 archivos / 309 tests a
29 / 344 porque esta ficha le anade dos archivos; los rojos siguen en **cero**.

### Un rojo que NO es una regresion, anotado a proposito

La **primera** corrida de `tests/integration/db + tests/unit/services` dio 3 failed / 319 passed
(2 tests), con trazas de `@prisma/client-engine-runtime`. La **misma orden, repetida sin cambiar
una linea, dio 322 passed / 5139 passed**. Es el patron conocido de **flakes por saturacion**: la
suite grande tira 2-4 rojos que cambian de archivo entre corridas y pasan al reintentar. Se deja
escrito para que el gate completo del leader no lo confunda con deuda de esta ficha.

### Correccion al baseline que traia la ficha

El baseline citado era «25 archivos / 282 tests / 0 rojos», pero dos de sus cinco rutas no existen
con ese nombre: es `tests/unit/services/rescate-ayuda-service.test.ts` (no `rescate-ayuda.test.ts`)
y `tests/unit/types/orden-historial-types.test.ts` (no `orden-historial.test.ts`). Con las rutas
reales el baseline era **27 archivos / 309 tests / 0 rojos**. En lo que importa no cambia nada: la
superficie arrancaba en **0 rojos** y sigue en 0.

---

## Guardias colaterales que este cambio ponia rojas, y como se atendieron

**Auditado archivo por archivo sobre el diff**, porque convertir una guardia de contenido en un
conteo es exactamente el atajo que hubo que retractar en la 257. Resultado: **ninguna asercion se
relajo, ninguna se sustituyo por un conteo, y ningun `down.sql` previo se toco** (verificado:
`git status db/migrations/` no lista mas carpetas que las dos nuevas). En dos casos se **anadieron**
asserts.

### Los once tests de migracion — el patron, y por que sigue congelando por contenido

Cada uno de esos once compara la lista de valores de SU `down.sql` —una **foto historica** del enum
en el momento de esa migracion— contra el SEED vigente. Cuando el SEED gana un valor, se ponen
rojos por diseno. El remedio **lo documentan ellos mismos por escrito**, y es el que se siguio:

> «el dia que otra ficha anada un valor mas, este caso se pone rojo y lo que hay que hacer NO es
> editar este `down.sql` sino nombrar el valor nuevo en una lista de POSTERIORES aqui»

Diez de los once ganan **exclusivamente** el literal `"habilitacion_api"` **nombrado**, en su lista
de valores posteriores, con el comentario de por que. Siguen comparando conjuntos por contenido
(`toEqual(new Set(...))`): si manana alguien renombra o borra un valor, siguen rojos. En
`rechazo-tienda-migration.test.ts` el caso no tenia todavia lista de POSTERIORES y se le creo una,
con el filtro `!POSTERIORES.includes(v)` — misma tecnica que ya usaban sus vecinos.

**Un solo `toHaveLength` se movio** (31 -> 32), en
`orden-historial-origen-recoleccion-tienda-incidente-migration.test.ts`. No es una relajacion: en
ese mismo `it`, tres lineas mas arriba, sigue intacto el
`expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED].sort()).toEqual([...ESPERADOS].sort())`, que es el
assert que manda. El conteo lo acompana, no lo sustituye.

### Tabla completa

| Guardia | Que pedia | Que se hizo |
| --- | --- | --- |
| **10** `tests/integration/db/*-migration.test.ts` | comparar la lista de SU `down.sql` contra el SEED vigente | `habilitacion_api` nombrado en la lista de POSTERIORES de cada uno. Comparacion **por contenido** intacta |
| `tests/integration/db/rechazo-tienda-migration.test.ts` | idem, pero sin lista de POSTERIORES todavia | se le creo la lista, con el filtro que ya usaban sus vecinos. Su `down.sql` no se toco |
| `tests/unit/repositories/orden-historial-cobertura.test.ts` | censo de familias del SEED contra sus productores, exhaustivo **por igualdad** | punto **#33** (OrdenRepository / transicionarAyuda / habilitacion_api) con su comentario de por que es familia propia y no reuso de `rescate_ayuda_tienda` |
| `tests/unit/types/orden-historial-types.test.ts` | conjunto cerrado de valores del SEED | valor anadido a `ESPERADOS` **por contenido**; el `toHaveLength` 31->32 convive con el `toEqual` |
| `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` | censo de paths del canal firmado en OCHO | sube a NUEVE en el mismo commit que publica el endpoint (precedente de la 255), con **dos asserts nuevos** (`clavesTs[8]` / `clavesYaml[8]`) y conservando el `toEqual(PATHS_ESPERADOS)` |
| `tests/unit/types/intentos-no-alcance.test.ts` (160/R31) | prohibe una subcadena concreta en todo el contrato serializado | la descripcion del OpenAPI decia «Reintentos:», que la contiene. Reescrita como «Repetir la llamada:» en el objeto TS y en el YAML. **La guardia no se toco** |
| guardia 229 (PUBLIC_ROUTES) | congela las tres listas del middleware posicionalmente | **`middleware.ts` NO se toco**: `SELF_AUTH_ROUTES` ya cubre el prefijo `/api/ordenes/api-key`. Afirmado con un `it` y con `tests/unit/auth/middleware.test.ts` verde |

Y 4 fakes de `IOrdenRepository` en `tests/unit/services/` ganaron `findParaHabilitacionApi` porque
el tipo lo exige (bulk-orden-service, bulk-orden-service.carga-api, orden-service,
rol-admin-satelite-authz).

---

## Decision de implementacion que conviene que el reviewer vea

**`num_guia` se valida SIN coercion.** Un `"100234"` de tipo texto es `fila_invalida`, no la guia
100234. El requisito pide «entero positivo», y coaccionar el tipo del integrador es como se cuela
una guia que en la base no existe. Esta afirmado en un `it` y documentado en el OpenAPI. Se senala
aqui porque es la clase de decision que el reviewer debe poder juzgar, no descubrir.

---

## Lo que NO se hizo, a proposito

- **`./init.sh` no se corrio.** El gate es del leader, y es el **COMPLETO**: el diff toca
  `db/migrations/` y `db/schema.prisma`, asi que `--rapido` se niega solo (design 9).
- **No se abrio PR.**
- **No se toco `feature_list.json` ni `progress/current.md`**: el bookkeeping es del leader.
- **T8.2** (gate completo) queda pendiente, y es la unica task sin marcar en `tasks.md`.

---

## Veredicto

Feature 266 implementada completa: T0.1 a T8.1 marcadas en `tasks.md`, las 33 filas de
trazabilidad mapeadas a un `it` nombrado, typecheck verde, lint sin errores y **delta 0** de tests
en toda la superficie tocada. Falta solo T8.2, el gate completo, que corre el leader.
