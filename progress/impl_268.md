# impl 268 — el webhook avisa del ciclo de AYUDA y del INCIDENTE

> Spec: `specs/268-webhook-ayuda-incidente/` (requirements · design · tasks).
> Puerta humana pasada el 2026-08-22 («con causa y con el enlace de las evidencias»).
> Implementado el 2026-08-22 en el worktree `C:/w268`, rama `feature/268-webhook-ayuda-incidente`.

## T0 — qué aterrizó ya en `dev` (la task que bloquea todo)

**SHA de `origin/dev` usado: `3ce3eaa15ee3243787f620451b9ce00d0238c2c7`.** La rama parte de ahí y
HEAD coincide con él: no hizo falta rebasar.

```
$ git log --oneline origin/dev -- lib/types/webhook-eventos.ts lib/api/openapi-spec.ts docs/api/api-key-openapi.yaml
d30fc82f Merge remote-tracking branch 'origin/dev' into feature/256-webhook-motivo-devolucion
c7409cc1 docs(256): publica el webhook orden.estado_actualizado en el contrato
9219d124 merge: sincroniza con dev (255 mergeada por el PR 432)
626f0051 docs(257): publica los cuatro filtros nuevos en el OpenAPI del canal
2631d9dd feat(255): cotizar un lote por API key sin crear ninguna orden

$ git log --oneline origin/dev -- lib/services/WebhookEstadoService.ts lib/repositories/WebhookOrdenReader.ts
5dba8c66 feat(256): el evento de devuelta viaja con el motivo tipificado
313ce20d feat(webhook): renombra clave del payload de estado `orden` -> `data` (F112)
a837c2bd feat(99-webhooks-cambios-estado): emisión de webhooks de estado vía cola de jobs
```

Una línea por cada una de las tres decisiones que T0 exige:

1. **La rama `ux` NO mergeó su mitad.** Verificado leyendo el archivo, no solo el log: en
   `3ce3eaa1`, `EVENTOS_PUBLICOS` sigue teniendo **10** values (sin `ayuda_tienda` ni `incidente`) y
   `ORIGENES_SIN_EVENTO_PUBLICO` sigue conteniendo `rescate_ayuda_tienda`. **No hay recorte de
   T1/T4/T5**: se implementan enteras.
2. **El PR #434 (feature 256) SÍ mergeó** (`3ce3eaa1`, sobre `5dba8c66`). Se activa el **Caso A** de
   `design.md` §7.1: **T6a entra en esta rama**, colgada del punto de extensión de #434 y sin lector
   paralelo. R20/R21 NO se van a ninguna continuación.
3. **No se rebasa nada**: la rama ya nace de un `dev` que incluye #434, así que los cuatro archivos
   compartidos (`openapi-spec.ts`, el `.yaml`, `WebhookEstadoService`, `WebhookOrdenReader`) se
   escriben una sola vez y sobre la versión final de #434.

### Lo que #434 dejó decidido y que esta feature HEREDA (cierra la pregunta abierta 1)

- **Nombre de cable: `data.motivo`.** El spec decía «si #434 usa un nombre genérico reutilizable
  (`motivo`), esta feature lo reusa para las dos causas». Usó exactamente ese. **No se inventa
  `causaIncidente` en el cable**; en el código interno el concepto sí conserva su nombre propio.
- **Convención de ausencia: `null`, campo SIEMPRE PRESENTE.** #434 publicó en el OpenAPI la «forma
  ÚNICA: las cuatro claves están SIEMPRE presentes, sea cual sea el estado». R21 dice «con la misma
  convención de ausencia que fije la 256», así que `motivo` **no se omite nunca**: viaja `null`.
  `evidenciasUrl`, en cambio, **sí se omite** (R24/T6b lo dicen literalmente) porque nace aditivo y
  opcional, sin forma ya publicada que respetar.
- **La sección `webhooks:` del OpenAPI YA EXISTE** (`c7409cc1`): 268 la AMPLÍA, no la crea. T6d se
  reinterpreta en consecuencia (ver más abajo).

## Baseline, medido en ESTA rama y ANTES de tocar nada

Medido por el leader el 2026-08-22 sobre `3ce3eaa1`:

- `pnpm typecheck`: **verde**.
- `tests/unit/types/webhook-eventos.test.ts`, `tests/unit/services/webhook-estado-encolado.test.ts`,
  `tests/unit/api`, `tests/unit/services/webhook-estado-service.test.ts` y
  `tests/unit/repositories/webhook-orden-reader.test.ts`:
  **10 archivos · 123 tests · 0 rojos.**

La superficie tocada arranca **EN VERDE**: cualquier rojo posterior en ella es de esta feature y hay
que arreglarlo, no descartarlo como preexistente ni como flake.

### Los tres tests que se ponen rojos A PROPÓSITO

Fichados en el spec; se actualizan **con la decisión escrita al lado** y **jamás** se relajan a un
aserto de tamaño ni se borran (R18, alternativa A6 descartada):

1. `tests/unit/types/webhook-eventos.test.ts` — congela las dos listas por contenido.
2. `tests/unit/services/webhook-estado-encolado.test.ts` — afirma que el rescate NO encola.
3. `tests/unit/api/openapi-contrato-en-reparto.test.ts:166` — congela `EVENTOS_PUBLICOS.size === 10`.

Aparecieron **dos más** que el spec no había fichado, y que la 268 invalida por la misma razón:
`tests/unit/services/webhook-estado-service.test.ts` (256/R17, afirmaba `size === 10`) y
`tests/unit/api/openapi-webhook-estado-actualizado.test.ts` (la guardia entera que #434 dejó sobre la
sección `webhooks:`, con 4 asertos). Los dos se actualizaron con el mismo criterio: decisión fechada
al lado, nunca relajados ni borrados.

---

## Archivos tocados (23 modificados + 1 nuevo, cero bajo `db/`)

### Producción (11)

| archivo | qué |
| --- | --- |
| `lib/types/webhook-eventos.ts` | **T1.** `EVENTOS_PUBLICOS` 10 -> 12; `ORIGENES_SIN_EVENTO_PUBLICO` -> `[]`; comentario fechado que revierte 235/P4 conservando sus cuatro razonamientos. |
| `lib/services/jobs/webhook-estado-encolado.ts` | **T3.** Solo prosa; cero lógica. Sigue preguntando a `esTransicionEmitible` (R14). |
| `lib/config/webhook.ts` | **T6b.** `WEBHOOK_APP_ORIGIN: string \| null`, desde `NEXT_PUBLIC_APP_URL`, sin barra final; `loadWebhookConfig` sigue sin lanzar. |
| `lib/interfaces/repositories/IWebhookOrdenReader.ts` | **T6a.** `causaIncidente: CausaIncidente \| null`, REQUERIDO (no opcional, a propósito). |
| `lib/repositories/WebhookOrdenReader.ts` | **T6a.** Las DOS procedencias en el MISMO `findUnique`; siguen siendo 2 llamadas a Prisma. |
| `lib/services/WebhookEstadoService.ts` | **T6a/T6b.** `motivo` según estado; `evidenciasUrl` solo en `incidente` y con origin resuelto. |
| `lib/repositories/OrdenRepository.ts` | **T6c.** El `in` gana `incidente` + relación `incidentesAdmin` con la portada; los dos mapeos. |
| `lib/interfaces/repositories/IOrdenRepository.ts` | **T6c.** `ApiOrdenEvidenciaRow.resultado` amplía. |
| `lib/types/api-orden.ts` | **T6c.** `ApiOrdenEvidenciaDTO.resultado` amplía. Obligatorio: sin él, `toDetalleDTO` no compila. |
| `lib/api/openapi-spec.ts` | **T4/T6c/T6d.** `ORDER_STATUS_ENUM` +2; `Evidencia.resultado` +`incidente`; enum de `data.estado` derivado; `motivo` a 6+null; `evidenciasUrl`; segundo ejemplo. |
| `docs/api/api-key-openapi.yaml` | **T5/T6d.** Espejo exacto de todo lo anterior, en LF. |

### Tests (12 modificados + 1 nuevo)

`tests/unit/types/webhook-eventos.test.ts` · `tests/unit/services/webhook-estado-encolado.test.ts` ·
`tests/unit/services/webhook-estado-service.test.ts` · `tests/unit/repositories/webhook-orden-reader.test.ts` ·
`tests/unit/api/openapi-contrato-en-reparto.test.ts` · `tests/unit/api/openapi-webhook-estado-actualizado.test.ts` ·
`tests/unit/api/openapi-webhook-contrato.test.ts` **(nuevo)** ·
`tests/unit/services/api-orden-lectura-service.test.ts` · `…por-orden-id.test.ts` ·
`tests/unit/repositories/orden-repository.api-lectura.test.ts` · `…no-regresion-106.test.ts` ·
`…api-consulta-pdf.test.ts` · `tests/unit/services/api-pdf-etiqueta-columna-intacta.test.ts`

## Mapa R -> test

| R | archivo | caso / aserto |
| --- | --- | --- |
| R1 | `webhook-eventos.test.ts` | igualdad de contenido de `EVENTOS_PUBLICOS` (12) + caso 235/R39 invertido: `ayuda_tienda` SÍ es público |
| R2 | `webhook-eventos.test.ts` | mismo bloque: `incidente` SÍ es público |
| R3 | `webhook-eventos.test.ts` + `openapi-contrato-en-reparto.test.ts` | los 10 previos siguen TODOS en la política (nadie deja de recibir) |
| R4 | `webhook-eventos.test.ts` | caso negativo de `devolucion_por_confirmar`, conservado intacto |
| R5 | `webhook-eventos.test.ts` | bloque 235/P4: `toEqual([])` **y** `toHaveLength(0)` |
| R6 | `webhook-eventos.test.ts` | `esFamiliaSinEventoPublico` / `esTransicionEmitible` siguen exportados y con el mismo comportamiento |
| R7 | `webhook-eventos.test.ts` | recorre `ORDEN_HISTORIAL_ORIGEN_TIPOS` entero: `esTransicionEmitible === esEventoPublico` para TODA familia |
| R8 | `webhook-estado-encolado.test.ts` | la IDA `en_reparto -> ayuda_tienda` vía `solicitud_ayuda_tienda` ENCOLA |
| R9 | `webhook-eventos.test.ts` + `webhook-estado-encolado.test.ts` | el rescate SÍ emite / SÍ encola (caso invertido, no borrado) |
| R10 | `webhook-estado-encolado.test.ts` | dos `en_reparto` sobre la misma orden con instantes distintos -> dos `dedupeKey` DISTINTAS |
| R11 | `webhook-estado-encolado.test.ts` | `-> incidente` encola, vía `gestion` desde `en_reparto` (#44) y vía familia `incidente` desde `en_bodega_central` (#48) |
| R12 | `webhook-eventos.test.ts` | `it.each` de reingresos legítimos, conservado tal cual |
| R13 | `webhook-estado-encolado.test.ts` | `ayuda_tienda -> sin_gestionar` vía `corte_sin_gestionar` NO encola |
| R14 | `webhook-estado-encolado.test.ts` | el emisor pregunta a la política y no re-deriva (diff de T3 = solo comentarios) |
| R15 | `openapi-contrato-en-reparto.test.ts` | los 4 enums del objeto TS contienen los dos values, en posición `slice(-2)` |
| R16 | `openapi-contrato-en-reparto.test.ts` | el `.yaml` sigue siendo espejo EXACTO (4 bloques idénticos), `toEqual` posicional |
| R17 | `openapi-contrato-en-reparto.test.ts` | todo value del enum y de `EVENTOS_PUBLICOS` existe en `ORDER_STATUS_SEED` |
| R18 | `webhook-eventos.test.ts` + `openapi-contrato-en-reparto.test.ts` | congelado **por igualdad de contenido**; el `size`/`length` solo ACOMPAÑA |
| R19 | `webhook-estado-service.test.ts` | claves exactas del cuerpo y de `data` en un evento NO-incidente |
| R20 | `webhook-estado-service.test.ts` + `webhook-orden-reader.test.ts` | causa presente por la procedencia MENSAJERO y por la ADMIN; los 3 values del SEED salen crudos |
| R21 | `webhook-estado-service.test.ts` | `motivo: null` en `entregada` y en un `incidente` sin causa resoluble (campo PRESENTE, convención de la 256) |
| R22 | `webhook-estado-service.test.ts` | el string entregado al sender no contiene el bucket, ni `token=`, ni `X-Amz`, ni `storage_path`; `url.search` vacío |
| R23 | — | `git status -- db/` = 0 archivos; sin migración, sin `schema.prisma` |
| R24 | `webhook-estado-service.test.ts` | enlace exacto en `incidente`; `Object.keys(data)` no contiene `evidenciasUrl` en `entregada`; origin sin resolver -> OMITIDO |
| R25 | `webhook-estado-service.test.ts` | mismo job con dos relojes -> `expect(cuerpo1).toBe(cuerpo2)` sobre el string entregado |
| R26 | tests ya existentes de `GET /api/ordenes/api-key/orden/{id}` | verificados, no reescritos (401 sin key, 404 uniforme ajeno) |
| R27 | `api-orden-lectura-service.test.ts` **y** `…por-orden-id.test.ts` | evidencia del MENSAJERO y del ADMIN con `resultado: "incidente"`, URL firmada y `expiraEnSegundos`; ningún DTO expone `storagePath` ni bucket |
| R28 | `openapi-webhook-contrato.test.ts` | `enumsDeEstado(openApiSpec)` sigue devolviendo **4**; sobre el subárbol `webhooks` devuelve vacío |
| R29 | `openapi-webhook-contrato.test.ts` + `openapi-webhook-estado-actualizado.test.ts` | enum de `data.estado` igual a `[...EVENTOS_PUBLICOS].sort()` — derivado, no copiado |
| R30 | `openapi-webhook-contrato.test.ts` + `openapi-webhook-estado-actualizado.test.ts` | paridad TS↔YAML del bloque `webhooks` |
| R31 | `openapi-contrato-en-reparto.test.ts` | `Evidencia.resultado` incluye `incidente`, en TS y en YAML |

## Decisiones tomadas durante la implementación (para el reviewer)

1. **Pregunta abierta 1 — resuelta por la regla del propio spec, no por invención.** #434 usó el
   nombre genérico `motivo`, que es literalmente el caso que el spec nombra como «se reusa para las
   dos causas». No se creó `causaIncidente` en el cable.
2. **Convención de ausencia de la causa: `null`, no omisión.** Es la que fijó la 256 y la que R21
   manda heredar. `evidenciasUrl` sí se OMITE, por R24/T6b, porque nace aditiva y opcional y no
   tiene forma ya publicada que respetar.
3. **DESVIACIÓN de `tasks.md` T6d, punto 2.** T6d pide declarar la causa **opcional** en el schema.
   #434 la publicó **requerida y nullable**. Degradarla sería una regresión de un contrato ya
   publicado, así que `motivo` **sigue `required`** y `evidenciasUrl` es la única opcional. T6d se
   escribió antes de saber que #434 había aterrizado. Anotado también en el código.
4. **La sección `webhooks:` del OpenAPI ya existía** (la creó #434): T6d la AMPLÍA, no la crea.
5. **Se revierte la decisión de #434 de NO enumerar `data.estado`.** #434 la justificó temiendo un
   quinto catálogo de estados; el design 268 §7.5 demuestra que el predicado `esEnumDeEstado` exige
   `entregada` **y** `por_recoger`, y el enum derivado de `EVENTOS_PUBLICOS` no lleva `por_recoger`.
   **Medido, no supuesto**: mutando el enum para incluir `por_recoger`, el guard hermano pasa a
   exigir 5 bloques y da 6 rojos; con el enum derivado, sigue en 4.
6. **`take: 1` retirado del bloque `gestiones` compartido del reader.** Prisma no permite proyectar
   la misma relación dos veces, así que «última devolución vigente» y «último incidente vigente»
   comparten sub-lectura; un `take: 1` común descartaría la devolución vigente cuando hay un
   incidente posterior, rompiendo 256/R10. La vigencia y el orden los sigue haciendo la base.
   **Ojo reviewer:** es el único punto donde la lectura deja de estar acotada a 1 fila.
7. **`orden_incidente` NO se filtra por su `estado`** (`solicitado`/`aprobado`/`rechazado`): ese
   estado es el trámite de INDEMNIZACIÓN, no si el incidente ocurrió. Con test.
8. **El `where` de `gestiones` del detalle conserva su forma** (incluido que no filtra `anuladaAt`):
   `incidente` sigue exactamente la misma regla que ya rige a `entregada`/`rechazada`.

## Válvula de T6c: NO se disparó

`OrdenIncidente` no tiene `ownerId` propio — cuelga de `orden` por FK, así que el scope sigue siendo
el `where` que ya fuerzan los dos `findDetalleBy*ForOwner`. Y la deuda 1..N de la 119 no se reabre:
`where: { indice: 0 }` sobre `orden_incidente_evidencia`, que con `@@unique([incidenteId, indice])`
devuelve 0 o 1 filas. Por tanto **R24/R25 se quedan en la 268** y no hay ficha aparte.

## Comprobaciones de MORDIDA (que el test falla si el código está mal)

No son grep: son mutaciones ejecutadas y revertidas.

- **R10** — pasar el MISMO instante a las dos invocaciones pone rojo el caso de las dos `dedupeKey`.
- **R20 (ADMIN)** — ignorar la fuente `orden_incidente` en el reader: **4 rojos**
  (`Tests 4 failed | 58 passed`). Restaurado y verificado.
- **R27 (ADMIN)** — revertir el mapeo del admin a solo gestiones: **4 rojos** en los dos archivos de
  servicio (`Tests 4 failed | 17 passed`). Confirma que ampliar solo el `where` no basta.
- **R16 (YAML)** — quitar uno de los cuatro bloques del `.yaml`: **2 rojos**
  (`expected [ …(3) ] to have a length of 4`).
- **Guard de #434** — cuatro mutaciones sobre `openapi-spec.ts` (renombrar `evidenciasUrl`, traducir
  `robado` a un value en inglés, meter `por_recoger` en el enum del webhook, meter `evidenciasUrl` en
  `required`): cada una pone rojo el aserto que le toca **y** la paridad YAML. `openapi-spec.ts`
  restaurado byte a byte (sha256 verificado antes y después).

Un detalle honesto que conviene que el reviewer sepa: en los tests de SERVICIO, los casos (1) y (2)
de R20 usan un reader falso, así que quien detecta de verdad «solo se lee una de las dos fuentes» es
el test del REPOSITORIO. Por eso los casos de R27 se montaron sobre el `OrdenRepository` real con
Prisma mockeado, y no sobre un repo falso: con un repo falso el caso del ADMIN pasaría aunque el
mapeo no existiera.

## Verificación ejecutada por el implementer

```
$ pnpm typecheck
> tsc --noEmit
(sin errores)

$ pnpm lint
✖ 99 problems (0 errors, 99 warnings)
```

Los 99 warnings son `no-unused-vars` PREEXISTENTES en archivos ajenos; ninguno de los 24 archivos de
esta feature aporta uno solo.

```
$ pnpm exec vitest run <las 17 suites de la superficie tocada>
 Test Files  17 passed (17)
      Tests  245 passed (245)
   Duration  3.67s
```

Contra el baseline (10 archivos · 123 tests · 0 rojos): **delta de rojos = 0**, y la cobertura sube a
245 tests. Los tests que debían ponerse rojos a propósito están actualizados con la decisión escrita
al lado; ninguno relajado a un conteo, ninguno borrado.

**El gate COMPLETO (`./init.sh`) lo corre el leader**, y es obligatorio: el diff toca `lib/types/`
(`webhook-eventos.ts`, `api-orden.ts`), donde el modo rápido se niega solo.

## Rojo AJENO detectado (no es de esta feature)

`tests/integration/db/analytics-daily-job.test.ts` > «primer intento vs entrega tras una devolucion
previa (R17)». Falla en `crearCierreAprobado` -> `tx.cierreDia.create` quejándose de una columna que
no existe en la base actual: **drift de la base local en `cierre_dia`**. Este diff no toca cierres ni
`db/`. Falla igual en aislado. Apareció al correr
`vitest related --run lib/repositories/OrdenRepository.ts` (1 failed | 238 passed de 239 archivos).

## Pendiente, y NO lo hace el implementer

- **T7 — gate completo `./init.sh`**: lo corre el leader.
- **T8 — aviso a integradores**: BLOQUEA EL DESPLIEGUE, no el código. Cubre las cuatro cosas: los dos
  values nuevos, el `en_reparto` que puede llegar dos veces (se deduplica por `eventoId`), la causa
  tipificada en español, y `evidenciasUrl`. El PR puede mergearse a `dev` sin esto; **la release a
  `prod`, no**. Sigue sin constar en `docs/` cuál es el canal ni el plazo (pregunta abierta 5).
  ⏳ **2026-08-22 — DESCARGADA POR MEDICIÓN por el leader.** 0 suscripciones de webhook y la
  única key sin usar: no hay a quién romperle nada. El aviso quedó escrito en
  `docs/api/CHANGELOG.md`. Detalle y consultas al final de esta bitácora.
- **T9 — `feature_list.json` y `progress/current.md`**: bookkeeping del leader, por instrucción
  expresa. Esta bitácora es la parte de T9 que sí me toca.

---

# T8 — aviso a integradores: DESCARGADA POR MEDICIÓN (2026-08-22, leader)

La task decía «el aviso está enviado y su envío consta con fecha». Antes de mandar nada, el leader
midió **a quién**. Las dos consultas, contra **producción y en sólo lectura**, con su resultado:

### ¿Cuántos integradores reciben webhooks hoy?

```sql
SELECT ws.id, ws.activa, ws.created_at, u.email
FROM webhook_suscripcion ws
JOIN usuario u ON u.id = ws.owner_usuario_id
LEFT JOIN api_key ak ON ak.usuario_id = u.id;
```

**Resultado: 0 filas.** No existe ni una suscripción de webhook en producción — ni activa ni de
baja. Hoy **nadie recibe un solo evento**.

### ¿Cuántas API keys hay, y se han usado?

```sql
SELECT ak.estado, count(*) FROM api_key ak GROUP BY ak.estado;
```

**Resultado: 1 fila — `activa: 1`.** Una única key, `Dropi` (`ordx_H6-YSbM`), creada el
**2026-08-20 19:31 UTC**, es decir dos días antes de esta release. Y no ha llegado a usarse:

```sql
SELECT count(*), max(created_at) FROM orden WHERE tienda_id = '<usuario dedicado de la key>';
```

**Resultado: 0 órdenes, `max = null`.**

### Por qué eso descarga la puerta, y qué NO significa

T8 existe para que un integrador **no se entere por una rotura** de que el contrato cambió. Está
medido que ese integrador no existe todavía: 0 suscripciones consumiendo el webhook, y la única key
dada de alta sin una sola orden. **No hay a quién romperle nada**, y los cuatro cambios son además
aditivos.

Lo que **no** significa: que el aviso sobre. Significa que deja de ser una puerta de despliegue y
pasa a ser **material de onboarding** de Dropi, que debe tenerlo **antes de conectar**, no después.

Decisión humana del 2026-08-22: cerrar T8 por medición y desplegar.

### Dónde vive el aviso

En **`docs/api/CHANGELOG.md`**, entrada `2026-08-22`, redactado cubriendo las cuatro cosas que T8
enumera. Es un archivo nuevo y una **convención nueva**, decidida en la misma sesión: el aviso de un
cambio de contrato se escribe ahí **antes de la release**, versionado junto al contrato que
describe. El ejemplo JSON de la entrada es el `examples.incidente` del contrato publicado copiado
literal, para que aviso y contrato no puedan derivar.

Eso cierra de paso el agujero que esta misma task heredó: **239/T0.3 pedía este mismo aviso y nunca
se marcó** —la feature salió a producción con la casilla abierta— porque no había dónde escribirlo
ni a qué canal mandarlo. La pregunta abierta 5 (canal y plazo) **sigue sin respuesta** y es la única
parte de T8 que queda viva: cuando Dropi conecte, alguien tiene que entregarle esa entrada.
