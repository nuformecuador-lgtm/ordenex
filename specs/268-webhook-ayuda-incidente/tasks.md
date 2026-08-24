# Feature 268 — tasks

> Regla de «hecho» en esta ficha: el criterio es **un aserto que se pone rojo si el código está
> mal**, nunca un `grep`. En la feature 257 se «cumplieron» criterios de grep reescribiendo
> comentarios y hubo que retractarlo. Si una task solo se puede comprobar leyendo, se dice
> explícitamente que su verificación es humana y se nombra quién firma.

Leyenda: `[P]` = paralelizable con las demás `[P]` de su bloque.

---

## T0 [x] — Comprobar qué aterrizó ya en `dev` (BLOQUEA TODO)

**Antes de escribir una sola línea de código.**

```
git fetch origin
git log --oneline origin/dev -- lib/types/webhook-eventos.ts lib/api/openapi-spec.ts docs/api/api-key-openapi.yaml
git log --oneline origin/dev -- lib/services/WebhookEstadoService.ts lib/repositories/WebhookOrdenReader.ts
```

Qué hacer con lo que salga:

- **Si la rama `ux` ya mergeó su mitad** (`ayuda_tienda` en `EVENTOS_PUBLICOS` y/o exención vacía):
  NO se re-aplica. Se rebasa la rama sobre `dev`, se recorta T1/T4/T5 a lo que falte (`incidente`,
  el comentario fechado, los values del OpenAPI que no estén) y se anota el recorte en
  `progress/impl_268.md`. Los requisitos R1/R5 siguen vigentes: se verifican, no se re-implementan.
- **Si el PR #434 (256) ya mergeó**: se activa el **Caso A** de `design.md` §7.1 y T6a entra en esta
  rama. Se rebasa ANTES de tocar `openapi-spec.ts`, el `.yaml`, `WebhookEstadoService` y
  `WebhookOrdenReader`: son los cuatro archivos que 268 y #434 comparten, y resolver el conflicto
  dos veces es la forma barata de perder una de las dos implementaciones.
- **Si #434 sigue abierto**: **Caso B2** de `design.md` §7.1 (recomendado y por defecto): 268 lleva
  política + enlace (T6b/T6c/T6d) y la causa (T6a) se implementa encima de #434 como continuación.
  B1 —esperar a #434— solo si el humano lo pide expresamente.

**Hecho cuando:** `progress/impl_268.md` abre con el SHA de `origin/dev` usado, la salida de los
dos `git log` pegada, y una línea por cada una de las tres decisiones de arriba. Verificación
humana (la firma el implementer y la revisa el reviewer).

---

## T1 [x] — La política: dos altas y el vaciado (depende de T0)

Editar **solo** `lib/types/webhook-eventos.ts`:

1. `EVENTOS_PUBLICOS` gana `"ayuda_tienda"` e `"incidente"` (10 -> 12). Sin reordenar ni retirar
   ninguno de los diez existentes.
2. `ORIGENES_SIN_EVENTO_PUBLICO` pasa a `[] as const satisfies readonly OrdenHistorialOrigenTipo[]`.
   La constante, el `Set` derivado, `esFamiliaSinEventoPublico` y `esTransicionEmitible` se
   conservan tal cual.
3. Comentario fechado (2026-08-22, feature 268) que: (a) declara que 235/P4 se revierte a propósito
   y por qué las dos mitades van juntas; (b) conserva el razonamiento «por familia y nunca por
   estado»; (c) conserva «por qué una lista de exclusión aquí es segura»; (d) acepta por escrito el
   coste de dos eventos más por orden con ayuda, incluido el `en_reparto` repetido, y remite a la
   clave por instante.

**Hecho cuando:** `pnpm exec tsc --noEmit` pasa y los tests de T2 (ya actualizados) están verdes.
El punto 3 es verificación humana del reviewer: **no** se acepta como criterio ningún `grep` sobre
el comentario.

**No hacer:** tocar el emisor, el service, el catálogo de estados o las transiciones.

---

## T2 [x] — Actualizar los tests congelados (depende de T1; se escriben junto con T1)

Estos archivos se ponen rojos **a propósito** y es su trabajo. Se actualizan con la decisión
escrita al lado; **nunca** se relajan a un aserto de tamaño.

### T2.1 [x] `tests/unit/types/webhook-eventos.test.ts`

- La igualdad de contenido de `EVENTOS_PUBLICOS` pasa a listar los **12** values (R1/R2/R3).
- El caso `235/R39` («`ayuda_tienda` NO es evento público», con `size === 10`) se **invierte**, no
  se borra: pasa a afirmar que `ayuda_tienda` e `incidente` SÍ lo son, con un comentario que cita
  268 y la reversión de 235/P4.
- Se conserva el caso negativo de `devolucion_por_confirmar` intacto (R4).
- El bloque `235/P4` de la exención pasa a afirmar `toEqual([])` y `toHaveLength(0)` (R5), y se
  añade un caso que recorre `ORDEN_HISTORIAL_ORIGEN_TIPOS` entero comprobando
  `esTransicionEmitible(estado, familia) === esEventoPublico(estado)` para toda familia (R7).
- El caso «el rescate no se emite» se **invierte** a «el rescate SÍ se emite» (R9), y el `it.each`
  de reingresos legítimos se conserva tal cual (R12).
- Se conserva el caso «todos los values existen en `ORDER_STATUS_SEED`» (R17).

**Hecho cuando:** `pnpm vitest run tests/unit/types/webhook-eventos.test.ts` está verde; y al
revertir T1 localmente, este archivo vuelve a fallar en al menos un aserto de igualdad por cada
uno de R1, R2, R5.

### T2.2 [x] `tests/unit/services/webhook-estado-encolado.test.ts`

- El describe `235/P4 — el RESCATE de la ayuda no emite evento…` se reescribe: el rescate
  **encola** (R9) y los reingresos legítimos siguen encolando (R12).
- Alta: la IDA `en_reparto -> ayuda_tienda` vía `solicitud_ayuda_tienda` encola (R8).
- Alta: `-> incidente` encola, con al menos dos casos (vía `gestion` desde `en_reparto` y vía
  familia `incidente` desde `en_bodega_central`) (R11).
- Alta: `ayuda_tienda -> sin_gestionar` vía `corte_sin_gestionar` NO encola (R13).
- Alta (R10): dos invocaciones del emisor sobre la MISMA orden y el MISMO `estatusDestinoId` de
  `en_reparto`, con dos `now()` distintos, producen dos `enqueue` con `dedupeKey` **distinta**.

**Hecho cuando:** `pnpm vitest run tests/unit/services/webhook-estado-encolado.test.ts` está verde
y el caso de R10 falla si se le pasa el mismo instante a las dos invocaciones (comprobado a mano
una vez y anotado en `progress/impl_268.md`).

### T2.3 [x] `tests/unit/api/openapi-contrato-en-reparto.test.ts`

- El describe «eventos públicos de webhook» afirma **12** y añade los dos values nuevos junto a la
  lista de los previos que no pueden salir (R3).
- Los casos de espejo del `.yaml` no cambian de forma: se pondrán rojos solos hasta T4+T5.

**Hecho cuando:** el archivo está verde tras T4 y T5, y rojo si se aplica solo una de las dos.

---

## T3 [x] [P] — El comentario del emisor (depende de T1)

`lib/services/jobs/webhook-estado-encolado.ts` cita 235/P4 en dos comentarios que quedan falsos.
Se actualizan (solo prosa; **cero cambios de lógica**).

**Hecho cuando:** `git diff --stat lib/services/jobs/webhook-estado-encolado.ts` no muestra ningún
cambio fuera de líneas de comentario, y la suite de ese módulo sigue verde sin haber tocado sus
asertos.

---

## T4 [x] [P] — Vocabulario publicado en el objeto TS (depende de T0)

`lib/api/openapi-spec.ts`: `ORDER_STATUS_ENUM` gana `"ayuda_tienda"` e `"incidente"` **al final**,
tras `devuelta_a_tienda`, cada uno con su comentario `// feature 268`.

**Hecho cuando:** el caso «todo value del enum existe en `ORDER_STATUS_SEED`» sigue verde y los 4
enums del objeto contienen los dos values (R15).

## T5 [x] — Espejo YAML (depende de T4)

`docs/api/api-key-openapi.yaml`: los **cuatro** bloques `enum` de estados ganan los dos values en
la MISMA posición que en el objeto TS (el guard compara con `toEqual` posicional).

**Hecho cuando:** `pnpm vitest run tests/unit/api/openapi-contrato-en-reparto.test.ts` está verde,
incluido «el .yaml publicado sigue siendo espejo EXACTO (4 bloques idénticos)» (R16), y el test
falla si se omite uno de los cuatro bloques.

---

## T6c [x] — El detalle por API key expone las evidencias del incidente (R27/R31)

Opción **(a+)** de `design.md` §7.3. Va ANTES que T6b: sin ella el enlace apunta a un array vacío.

- `API_ORDEN_DETALLE_SELECT` (`lib/repositories/OrdenRepository.ts:122`): `resultado` admite además
  `incidente`, y se suma la relación de `orden_incidente` con sus evidencias.
- `toApiOrdenDetalleRow`: las DOS procedencias se mapean al mismo array con
  `resultado: "incidente"`, exponiendo la **portada** (índice 0) de cada registro. El tipo
  `ApiOrdenDetalleRow` amplía su union de `resultado`.
- `ApiOrdenLecturaService.toDetalleDTO` **no cambia**: ya junta todos los paths y los firma en UNA
  sola llamada.
- OpenAPI + YAML: `Evidencia.resultado` gana `incidente` (R31).

**Hecho cuando:** en `tests/unit/services/api-orden-lectura-service.test.ts` y en
`…api-orden-lectura-service.por-orden-id.test.ts` hay casos que afirman que el DTO trae la evidencia
del incidente del MENSAJERO y la del ADMIN, cada una con `resultado: "incidente"`, `url` firmada y
`expiraEnSegundos`, y que ningún DTO expone `storagePath` ni el bucket. El caso del ADMIN falla si
solo se amplió el `where` de gestiones.

**Válvula (declarada, no improvisada):** si al abrir el select aparece algo que este spec no vio
—reglas de alcance propias de `orden_incidente`, o que el mapeo obligue a reabrir la deuda 1..N de
la 119— se PARA, se propone ficha aparte con dependencia declarada de 268, y 268 sale sin T6b
(R24/R25 se van con la ficha nueva). No se manda el enlace a un recurso incompleto.

## T6a [x] — La causa tipificada en el evento de `incidente` (R20/R21)

**P1 está APROBADA (2026-08-22): esta task es firme.** Lo condicional es *cuándo*, no *si*: en Caso
A de `design.md` §7.1 entra en esta rama; en Caso B2 pasa a la continuación sobre #434, y así debe
constar en `progress/impl_268.md`.

- Reusar el punto de extensión de #434 (lectura al entregar en `WebhookOrdenReader`, armado del
  cuerpo en `WebhookEstadoService`). **No crear un lector paralelo.**
- Las **DOS procedencias** (`design.md` §7.3): `gestion_orden.causa_incidente` (mensajero) y
  `orden_incidente.causa` (admin, mismo enum). Resolver solo la primera deja sin causa 5 de las 6
  aristas de entrada a `incidente`.
- Nombre y convención de ausencia: los que fije #434 (pregunta abierta 1). Si #434 usa un nombre
  específico de devolución, **parar y preguntar** en vez de inventar el hermano.

**Hecho cuando:** en `tests/unit/services/webhook-estado-service.test.ts` hay cuatro casos que
afirman sobre el `JSON.parse` del cuerpo REAL que recibe el sender: (1) causa presente en un
incidente del mensajero; (2) causa presente en uno del admin; (3) campo ausente para `entregada`;
(4) campo ausente para un `incidente` sin causa resoluble. Los casos (1) y (2) fallan si solo se lee
una de las dos fuentes; el (3) falla si el campo se emite incondicionalmente.

## T6b [x] — El enlace estable a las evidencias (R22/R24/R25; depende de T6c)

- Añadir a `lib/config/webhook.ts` el origin del enlace con el patrón del propio archivo (default
  desde `NEXT_PUBLIC_APP_URL`; ausente o `""` -> `null`; **la función nunca lanza**, es invariante
  explícito de ese módulo).
- El cuerpo gana `evidenciasUrl = <base>/api/ordenes/api-key/orden/<ordenId>` **solo** con
  `data.estado === "incidente"`. Si el origin no se resuelve, el campo se OMITE (nunca una ruta
  relativa ni un `https://undefined/...`).
- Prohibido: firmar una URL de Storage en el emisor o en el handler, y meter el bucket o el
  `storage_path` en el cuerpo.

**Hecho cuando:**

1. un caso afirma el enlace exacto para `incidente` y su ausencia para `entregada` (R24);
2. un caso ejecuta el MISMO job dos veces con relojes distintos y afirma `expect(cuerpo1)
   .toBe(cuerpo2)` sobre el string entregado (R25) — falla si alguien firma la URL;
3. un caso afirma que el cuerpo entregado **no contiene** el nombre del bucket
   (`gestionConfig.EVIDENCIA_BUCKET`), ni `token=`, ni `X-Amz`, ni `storage_path` (R22).

## T6d [x] [P] — Publicar el contrato del cuerpo en el OpenAPI (R28/R29/R30)

Crear la sección `webhooks:` de OpenAPI 3.1 en `lib/api/openapi-spec.ts` con el evento
`orden.estado_actualizado` y su cuerpo completo, y espejarla en el `.yaml`. El enum de
`data.estado` se **deriva de `EVENTOS_PUBLICOS`** con orden determinista, nunca copiado.

**Hecho cuando:** existe `tests/unit/api/openapi-webhook-contrato.test.ts` con cuatro asertos:
(1) el enum del webhook `toEqual([...EVENTOS_PUBLICOS].sort())` —falla si alguien lo copia y la
política cambia—; (2) el schema declara la causa y `evidenciasUrl` como OPCIONALES y el resto como
requeridos; (3) el bloque del YAML es idéntico al del objeto TS; (4) `enumsDeEstado(openApiSpec)`
sigue devolviendo **4** —falla si el enum del webhook se documentó con el catálogo completo en vez
de con la política—.

---

## T7 — Gate COMPLETO (depende de T1–T5 y de T6a–T6d)

**`./init.sh` completo. El modo rápido NO vale y se niega solo**: el diff toca `lib/types/`.
Intentar `--rapido` es un `fail`, no un aviso.

Además, en el mismo paso:

- `git diff --name-only origin/dev...HEAD | grep '^db/'` debe salir **vacío** (R23): sin migración,
  sin `schema.prisma`.
- Comparar el conteo de rojos contra el baseline de `dev` MEDIDO en esta misma sesión (los
  baselines citados en `progress/current.md` caducan con cualquier PR ajeno). Delta esperado: **0**.

**Hecho cuando:** `./init.sh` termina en verde, o con un delta de 0 rojos contra un baseline medido
y pegado en `progress/impl_268.md` con su fecha y su SHA.

---

## T8 — Aviso a integradores (BLOQUEA EL DESPLIEGUE, no el código)

Misma política que 239/T0.3. El aviso se redacta UNA sola vez y cubre las cuatro cosas:

1. llegan **dos values nuevos** en `data.estado`: `ayuda_tienda` e `incidente`;
2. un integrador puede recibir `en_reparto` **dos veces** sobre la misma orden: se deduplica por
   `eventoId`, que es único por instante;
3. el evento de `incidente` trae la **causa tipificada** en español (`danado`/`perdido`/`robado`) —
   también en Caso B2, donde el campo llega poco después con la continuación;
4. el evento de `incidente` trae `evidenciasUrl`, un enlace **estable** (sin token, no caduca) que
   se invoca con la propia API key y devuelve el detalle con las URLs firmadas frescas; y que el
   detalle por API key pasa a mostrar evidencias con `resultado: "incidente"`.

**Hecho cuando:** el aviso está enviado y su envío consta con fecha en `progress/impl_268.md`.
Verificación humana; **el PR puede mergearse a `dev` sin esto, la release a `prod` no**.

---

## T9 — Bookkeeping (depende de T7)

- `progress/impl_268.md` con el mapa R -> test completo (R1–R31), incluido qué se hizo con
  R20/R21 según el aterrizaje de #434 (Caso A o B2) y, si se activó la válvula de T6c, qué se fue a
  la ficha aparte.
- `feature_list.json`: alta/actualización de la ficha 268 (escribir en LF; el diff debe ser SOLO la
  ficha 268 — otras sesiones dejan altas sin commitear en ese archivo y `git checkout` las borra).
- `progress/current.md` al día.

**Hecho cuando:** el reviewer encuentra los 31 requisitos con un test nombrado y ejecutable, y
`git diff feature_list.json` no toca ninguna ficha ajena.

---

## Orden y paralelismo

```
T0 ─┬─> T1 ──> T2.1, T2.2 ─────────────┐
    │     └──> T3 [P]                  │
    ├─> T4 [P] ──> T5 ──> T2.3 ────────┤
    ├─> T6c ──> T6b ──> T6a ───────────┼──> T7 ──> T9
    └─> T6d [P] ───────────────────────┘      └──> T8 (puerta de despliegue)
```

Notas de dependencia: **T6c antes que T6b** (el enlace no se manda a un recurso vacío) y **T6d
después de T1** (el enum del webhook se deriva de `EVENTOS_PUBLICOS` ya ampliada). T6a es la última
del bloque porque es la que puede irse a la continuación sobre #434 sin arrastrar a las otras.
