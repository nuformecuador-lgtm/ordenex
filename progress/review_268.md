# review 268 — el webhook avisa del ciclo de AYUDA y del INCIDENTE

> Revisado el 2026-08-22 en el worktree `C:/w268`, rama `feature/268-webhook-ayuda-incidente`,
> 4 commits sobre `origin/dev` (`3ce3eaa1`). Material: los tres archivos de
> `specs/268-webhook-ayuda-incidente/`, `progress/impl_268.md`, `docs/` y `CHECKPOINTS.md`.
> El reviewer NO edita codigo. Todas las mutaciones de este informe se revirtieron y se
> verificaron por `sha256sum` mas `git status --porcelain` limpio.

## VEREDICTO: **OK (APROBADO)**

Cero bloqueantes. Siete hallazgos menores, ninguno del codigo de produccion de esta feature:
tres son bookkeeping del leader y cuatro son deuda declarada o precision de la bitacora.

---

## 1. Las CUATRO cosas que el implementer marco como discutibles

### (1) Revertir la decision de la 256 sobre `data.estado` — **JUSTIFICADA. Medicion reproducida.**

El temor de la 256 (enumerar `data.estado` anade un 5.o catalogo de estados y pone roja
`openapi-contrato-en-reparto.test.ts`) no se sostiene, y no por opinion: el predicado
`esEnumDeEstado` (`tests/unit/api/openapi-contrato-en-reparto.test.ts:29-36`) exige que la lista
contenga **`entregada` Y `por_recoger`**. El enum derivado de `EVENTOS_PUBLICOS` contiene el
primero y **no** el segundo, asi que no entra en el recuento.

Reproducido a mano, no leido:

- Baseline (`openapi-contrato-en-reparto` mas `openapi-webhook-contrato`): **2 files / 35 tests / 0 rojos**.
- Mutacion `const WEBHOOK_ESTADO_ENUM = [...EVENTOS_PUBLICOS, "por_recoger"].sort();`:
  **2 files failed / 11 rojos / 24 verdes**, incluido el `toHaveLength(4)` del guard hermano
  (pasa a 5 bloques) y `expect(enumsDeEstado(openApiSpec.webhooks)).toEqual([])`.
- Restaurado byte a byte: sha256 `9c3753d7...38dfec` antes y despues.

Ademas el cambio es correcto en el fondo, no solo en el conteo: el enum publicado es la POLITICA
(12 values, `EVENTOS_PUBLICOS`), un subconjunto estricto del catalogo de `OrdenListItem.estado`, y
se **deriva** (`WEBHOOK_ESTADO_ENUM = [...EVENTOS_PUBLICOS].sort()`), no se copia — R29 cumplido y
protegido por `openapi-webhook-contrato.test.ts:155-160`. La reversion cambia un contrato publico
en direccion **aditiva** (se documenta lo que ya se emitia; no se retira nada), asi que ningun
integrador se rompe. Se acepta.

- Nota de precision: la bitacora dice 6 rojos; yo medi **11** en los dos archivos de guardia.
  La direccion es la misma y la conclusion no cambia. Ver hallazgo menor M4.

### (2) Desviacion de T6d (causa **requerida**, no opcional) — **CORRECTA.**

Verificado en `dev` y no en la bitacora: `git show origin/dev:lib/api/openapi-spec.ts` linea 832
publica `required: ["numGuia", "numRemision", "estado", "motivo"]`, con la prosa «las cuatro
claves estan SIEMPRE presentes». Degradar `motivo` a opcional seria retirar una garantia ya
anunciada a integradores por el PR #434 — regresion de contrato vivo. T6d se escribio antes de
saber que #434 habia aterrizado; el implementer eligio el contrato sobre la task y lo anoto en el
codigo y en la bitacora. Coherente con lo que la 256 dejo en `dev`.

El resultado es consistente: `motivo` SIEMPRE presente con `null` (convencion 256) y
`evidenciasUrl` la unica opcional, que se OMITE (convencion 268/R24, campo nuevo sin forma
publicada previa). Las dos convenciones conviven a proposito y estan documentadas en la prosa del
OpenAPI y en `armarData`. Congelado por `openapi-webhook-contrato.test.ts:195-205` (`required`
exactamente las cuatro, `evidenciasUrl` fuera) y su espejo YAML (`:273-277`).

### (3) `take: 1` retirado del bloque `gestiones` del reader — **COSTE ACEPTABLE, 256/R10 GARANTIZADO.**

- **Cuantas filas puede traer.** El `where` es
  `{ resultado: { in: ["devuelta","incidente"] }, anuladaAt: null }` **sobre una unica orden**
  (relacion anidada de un `findUnique` por `id`). El techo real es «gestiones vigentes de esos dos
  resultados de UNA orden»: 0-2 en la practica, y una gestion deja de ser vigente al deshacerse
  (67/R11). No hay riesgo de N+1 ni de lectura no acotada: sigue siendo **una** query
  (`webhook-orden-reader.test.ts` R12 afirma exactamente 2 llamadas a Prisma, como antes).
- **Orden determinista.** Si: `orderBy: { createdAt: "desc" }` en la base, y el codigo solo hace
  `find` del primero de cada `resultado`. La ordenacion y la vigencia las sigue haciendo la BASE,
  que es justo lo que la 256 protege con tests (el fake de Prisma del test **aplica de verdad** el
  `where`/`orderBy`, no devuelve la fila buena por cortesia).
- **256/R10 sigue garantizado, con test explicito**, no por argumento:
  `tests/unit/repositories/webhook-orden-reader.test.ts:210` — «una gestion `entregada`/`incidente`
  POSTERIOR no desplaza a la `devuelta` vigente»: con tres filas (`devuelta` vieja, `entregada`
  nueva, `incidente` posterior) afirma `causaDevolucion === "wrong_number"` **y**
  `causaIncidente === "danado"`. Ese caso es exactamente el que un `take: 1` compartido romperia.

La razon tecnica es real (Prisma no permite proyectar la misma relacion dos veces en un `select`;
no hay alias) y la alternativa elegida es la conservadora. Se acepta.

### (4) La valvula del spec — **CORRECTAMENTE NO DISPARADA. Sin fuga de datos entre tiendas.**

Verificado en el modelo y en el select, no en la bitacora:

- `db/schema.prisma:979-1003`: `OrdenIncidente` **no tiene `ownerId` ni `tiendaId`**. Su unico
  ancla es `ordenId` hacia `orden` por FK. No hay alcance propio que escribir.
- El scope lo fuerzan los dos lectores del detalle, sin excepcion:
  `OrdenRepository.ts:1803` `where: { numGuia, tiendaId: ownerId, deletedAt: null }` y
  `:1848` `where: { id: ordenId, tiendaId: ownerId, deletedAt: null }`. `incidentesAdmin` es una
  relacion **anidada** de esa orden ya acotada: no puede alcanzar la orden de otra tienda.
- El select del incidente del admin proyecta **solo** `evidencias { storagePath, contentType }`
  con `where: { indice: 0 }`. Ni `causa`, ni `motivo` (texto libre 158/R45), ni `indemnizacion`,
  ni `reportadoPor`, ni `estado`. El detalle publico no crece con datos internos.
- `@@unique([incidenteId, indice])` acota la portada a 0 o 1 filas: la deuda 1..N de la 119 no se
  reabre.

No hay fuga. La valvula habria sido ruido.

---

## 2. Trazabilidad R1-R31 (asertos abiertos, no la tabla de la bitacora)

- **R1 R2** — `webhook-eventos.test.ts`: igualdad de contenido de los 12 values, mas el caso
  235/R39 INVERTIDO; y `openapi-contrato-en-reparto.test.ts`. OK.
- **R3** — los 10 previos enumerados uno a uno en los dos archivos, con `toEqual` de contenido. OK.
- **R4** — caso negativo de `devolucion_por_confirmar` conservado, mas aserto adicional en
  `openapi-contrato-en-reparto.test.ts`. Confirmado ausente del enum derivado de 12 values. OK.
- **R5** — `toEqual([])` y `toHaveLength(0)`. OK.
- **R6** — caso propio: las dos funciones siguen exportadas, recorrido del SEED entero de familias,
  y `esTransicionEmitible` sigue `false` cuando el destino no es publico. OK.
- **R7** — doble bucle: cada familia del SEED por 10 estados muestra, comparando contra
  `esEventoPublico(estado)`. OK.
- **R8 R9 R11 R13** — `webhook-estado-encolado.test.ts`: la IDA encola; el RESCATE encola (caso
  invertido, no borrado); `incidente` encola por las DOS aristas (#44 familia `gestion` desde
  `en_reparto` y #48 familia `incidente` desde `en_bodega_central`); `sin_gestionar` NO encola. OK.
- **R10** — dos `dedupeKey` distintas con dos instantes sobre la misma orden y el mismo estatus. OK.
- **R12** — el `it.each` de reingresos legitimos, conservado tal cual. OK.
- **R14** — el diff de `webhook-estado-encolado.ts` es SOLO comentarios; revisado linea a linea.
  Cero cambios de logica. OK.
- **R15 R16** — los 4 enums TS con los dos values en `slice(-2)`; los 4 bloques del YAML comparados
  con `toEqual` posicional contra los TS. OK.
- **R17** — recorrido de `EVENTOS_PUBLICOS` y del enum contra `ORDER_STATUS_SEED`. OK.
- **R18** — congelado por IGUALDAD DE CONTENIDO en los dos archivos; el conteo ACOMPANA dentro del
  mismo `it`, nunca sustituye. OK.
- **R19** — claves exactas y en orden del cuerpo y de `data` en un evento NO-incidente. OK.
- **R20** — servicio (procedencia mensajero y procedencia admin) Y repositorio real con Prisma
  mockeado; los tres values del SEED salen crudos. OK.
- **R21** — `motivo: null` en `entregada` y en un `incidente` sin causa resoluble, campo PRESENTE. OK.
- **R22** — el cuerpo no contiene el bucket, ni `token=`, ni `X-Amz`, ni `storage_path`, ni
  `storagePath`, ni `sign/`, ni `signed`; y el enlace parseado tiene `search` vacio y `pathname`
  exacto. OK.
- **R23** — comprobado por mi: el diff filtrado por rutas bajo `db/` sale VACIO. OK.
- **R24** — enlace exacto en `incidente`; ausencia por CLAVE en `entregada`; origin sin resolver da
  campo omitido. OK.
- **R25** — el mismo job con dos relojes entrega un cuerpo byte-identico; y el enlace no cambia
  aunque la causa leida cambie entre intentos. OK.
- **R26** — `tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts`: 401 sin Bearer,
  401 con key desconocida, 404 de orden ajena BYTE-IDENTICO al de inexistente, y la respuesta 200
  sin `storagePath` ni bucket. Preexistentes, verificados y vigentes. OK.
- **R27** — la evidencia del MENSAJERO y la del ADMIN con `resultado: "incidente"`, URL firmada y
  `expiraEnSegundos`, en los dos archivos de servicio y en el del repositorio. OK.
- **R28** — `enumsDeEstado(openApiSpec)` sigue devolviendo 4; sobre el subarbol `webhooks` devuelve
  vacio. OK.
- **R29** — el enum del webhook es `[...EVENTOS_PUBLICOS].sort()` en el codigo, y el test lo compara
  contra esa misma expresion: derivado, no copiado. OK.
- **R30** — paridad TS contra YAML del bloque `webhooks`: enum de `estado`, enum de `motivo` con su
  `null` explicito, y `evidenciasUrl` presente y fuera de `required`. OK.
- **R31** — `Evidencia.resultado` es exactamente los tres values en TS y en YAML, y ademas se
  afirma que NO es un catalogo de estados, para que no contamine el guard de los cuatro. OK.

**31/31 con aserto real.** Ninguno vacio, ninguno satisfecho por un `toBeDefined()`.

## 3. Las dos mitades de la ayuda, y el mecanismo

- `ayuda_tienda` **e** `incidente` en `EVENTOS_PUBLICOS` (12 values). **Y**
  `ORIGENES_SIN_EVENTO_PUBLICO = []`. Las dos mitades estan. No hay media feature.
- El **mecanismo** se conserva entero: la constante exportada, el
  `satisfies readonly OrdenHistorialOrigenTipo[]`, el `Set` derivado `SET_ORIGENES_SIN_EVENTO`,
  `esFamiliaSinEventoPublico` y `esTransicionEmitible` — misma firma, mismo comportamiento
  observable. Y el **razonamiento** no se borro: el bloque «POR QUE POR FAMILIA Y NO POR ESTADO»
  sigue intacto y se le suma «POR QUE EL MECANISMO SIGUE EXISTIENDO CON LA LISTA VACIA» (R6,
  alternativa A2 descartada). El emisor sigue preguntando y no re-deriva (R14).
- La prosa vieja no se borra: se cita entre comillas con «AQUI DECIA, y ya no es cierto», fechada.
  Es el patron correcto del repo y deja rastro de que 235/P4 se revirtio a proposito.

## 4. `devolucion_por_confirmar` (239/P2)

**Sigue fuera.** Caso negativo conservado intacto en `webhook-eventos.test.ts`, aserto adicional
en `openapi-contrato-en-reparto.test.ts`, ausente del enum derivado de 12 values y ausente del
YAML. Y `esTransicionEmitible("devolucion_por_confirmar", "gestion")` sigue siendo `false`.

## 5. `evidenciasUrl` nunca es firmada

Construccion unica y trivial en `WebhookEstadoService.evidenciasUrlDe`: el origin de config mas
`/api/ordenes/api-key/orden/` mas el `ordenId` del payload. Sin Storage, sin query, sin TTL, sin
token. El origin viene de `NEXT_PUBLIC_APP_URL` por `loadWebhookConfig` (sin hardcode,
`docs/architecture.md` principio 4) y `loadWebhookConfig` **sigue sin lanzar**. Si el origin es
`undefined` o cadena vacia da `null` y el campo se **OMITE**; nunca una ruta relativa ni un
`https://undefined/...`, con caso propio que lo afirma. Verificado que no existe ninguna otra
escritura de `data.evidenciasUrl` en el diff: es la unica ruta posible. El firmado de URLs vive
donde debe, en `ApiOrdenLecturaService.toDetalleDTO`, detras de la API key del integrador.

## 6. Las DOS procedencias de `incidente`, de verdad

- **Reader (causa):** `gestion_orden.causa_incidente` (mensajero) **y** `orden_incidente.causa`
  (admin), en el MISMO `findUnique`, con precedencia por `createdAt` sin privilegiar fuente.
- **Repositorio (fotos):** el `in` de `gestiones` gana `incidente` **y** se suma la relacion
  `incidentesAdmin` con su portada. Los DOS mapeos, concatenados al mismo `evidencias[]`.
- Comprobado que cubrir solo la primera no basta: ver las mordidas de la seccion 8.

## 7. Los tests que debian ponerse rojos

Los tres fichados (`webhook-eventos`, `webhook-estado-encolado`,
`openapi-contrato-en-reparto:166`) y los dos que aparecieron (`webhook-estado-service` 256/R17 y
`openapi-webhook-estado-actualizado`): **ninguno borrado, ninguno relajado a un conteo**, todos con
la decision fechada al lado y con la afirmacion vieja citada literalmente. Revisado test por test.

`openapi-contrato-en-reparto.test.ts` **sigue congelando por contenido**: el `toEqual` de los 12
values, los 10 previos enumerados uno a uno, `slice(-2)` posicional en los 4 enums y `toEqual`
posicional TS contra YAML. El `size === 12` esta en el mismo `it` que la igualdad y declarado
explicitamente como acompanante. No hay ningun numero suelto haciendo de guardia.

## 8. Mordidas reproducidas por el reviewer (2 de 5)

1. **Reader ignora `orden_incidente`** (`causaIncidenteVigente(gestionIncidente, undefined)`).
   Esperado por la bitacora: 4 rojos. Medido: **4 failed / 14 passed** en
   `webhook-orden-reader.test.ts`.
2. **Se cae el mapeo del ADMIN** (`evidencias: [...deGestiones]`). Esperado: 4 rojos en los dos
   archivos de servicio. Medido: **6 failed / 29 passed** corriendo los dos de servicio mas el del
   repositorio.

Las dos confirman que los tests **muerden**: el caso del admin no pasa «solo ampliando el `where`».
Restaurado y verificado por sha256 (`70b710b9...4542bde`, `b496742e...bfd7ff0`) y
`git status --porcelain` vacio.

## 9. Verificacion ejecutable

- Perimetro tocado, corrido por mi: **17 archivos / 245 tests / 0 rojos** (3,26 s). Coincide con la
  bitacora y con el baseline previo de 10 archivos / 123 tests / 0 rojos.
- Gate COMPLETO: corrido por el leader, delta 0 (24 rojos preexistentes de integracion con base,
  identicos en `origin/dev`, drift de `cierre_dia`). No re-medido, por instruccion expresa.
- `./init.sh` NO lo corri: el leader ya lo ejecuto completo en esta misma sesion.

## 10. CHECKPOINTS.md, punto por punto

**Especificacion**
- [x] `requirements.md` con R1-R31 en EARS numerados.
- [x] `design.md` con una seccion 8 «Alternativas descartadas» (A2, A6, la URL firmada con TTL
      largo, y mas).
- [ ] `tasks.md` **no** esta todo `[x]`: T7, T8 y T9 sin marcar (ver M1).

**Trazabilidad**
- [x] Cada `R<n>` mapea a un test concreto: los 31 abiertos y verificados en la seccion 2.
- [x] `progress/impl_268.md` contiene el mapa R hacia test, fiel salvo el conteo de M4.

**Calidad de codigo**
- [x] `pnpm typecheck` verde (leader).
- [x] `pnpm lint` con 0 errores (99 warnings preexistentes en archivos ajenos).
- [x] `pnpm test`: delta de rojos 0 contra `origin/dev`.
- [ ] E2E de flujo critico (webhooks): no existe (ver M2, deuda preexistente).

**Datos y seguridad**
- [x] Ninguna tabla nueva; el diff bajo `db/` esta **vacio** (R23). Las dos tablas leidas
      (`gestion_orden_evidencia` y `orden_incidente_evidencia`) ya tienen RLS habilitada sin
      policies (solo service role), documentado en `db/schema.prisma:1010`. Se LEEN, no se tocan.
- [x] Sin migracion, luego no hay `down.sql` que exigir.
- [x] Cero secretos hardcodeados; el origin sale de `NEXT_PUBLIC_APP_URL` por configuracion.
- [x] Webhook: la firma (`X-Ordenex-Signature` sobre timestamp + cuerpo) sigue intacta y se
      verifica **sobre el cuerpo YA ampliado** con la causa y con el enlace (dos casos).
      Idempotencia conservada: mismo `eventoId` y cuerpo byte-identico entre intentos (R25), y
      `dedupeKey` con instante para que los dos `en_reparto` del ciclo de ayuda no se traguen entre
      si por el `ON CONFLICT DO NOTHING` (R10).

**Patron de capas**
- [x] La POLITICA de contrato vive en el service; el repositorio solo responde «cual es la causa
      vigente». El reader no decide nada. Ningun controller gano queries. Las interfaces nuevas
      estan en `lib/interfaces/repositories/`.

**Permisos** — no aplica: no hay pagina ni Server Action nueva. El unico recurso enlazado exige
`Authorization: Bearer ordx_...`, fuerza el owner de la key y da 404 uniforme.

**Multi-pais / configuracion**
- [x] Sin pais, moneda ni cuenta hardcodeados. El unico dato de entorno nuevo es el origin.

**Verificacion final**
- [x] `./init.sh` verde con delta 0 (leader).
- [x] Este archivo existe y su veredicto es OK.
- [ ] Entrada en `progress/history.md` (ver M1).

---

## Hallazgos

**M1 — `menor` — bookkeeping pendiente, todo del leader.** `tasks.md` deja T7, T8 y T9 sin `[x]`;
`feature_list.json` no tiene ficha 268 (buscado, no aparece); no hay entrada en
`progress/history.md`. T9 declara expresamente que ese bookkeeping lo hace el leader, y T7 ya se
ejecuto (el gate completo esta corrido y verde con delta 0), asi que **T7 deberia marcarse `[x]`
citando esa corrida**. T8 (aviso a integradores) bloquea el DESPLIEGUE, no el codigo, y esta bien
que siga abierta: **no se puede liberar a `prod` sin ella**, y la pregunta abierta 5 (canal y
plazo del aviso) sigue sin respuesta en `docs/`. Nada de esto es imputable al implementer ni afecta
al diff.

**M2 — `menor` — no hay E2E de webhooks, y el checkpoint lo pide.** `CHECKPOINTS.md` exige al menos
un Playwright para flujos criticos y nombra `webhooks`. En `e2e/` no existe ningun spec de webhook:
es una **deuda preexistente**, no algo que esta feature introduzca (la 268 no crea el canal, cambia
su politica y su cuerpo, y los dos estan cubiertos por unitarios que muerden). Queda fichado para
que no se pierda, no como condicion de merge.

**M3 — `menor` — dos lecturas anidadas sin `take`.** El bloque `gestiones` del reader (retirada
deliberada y bien argumentada, ver 1.3) y `incidentesAdmin` en `API_ORDEN_DETALLE_SELECT` (que
nunca lo tuvo). Las dos estan acotadas por el `where` a **una sola orden**, con `orderBy`
determinista, y el techo real es de unidades de filas; el comentario del schema dice ademas «a lo
sumo UNO vivo» para los incidentes de admin. Riesgo practico nulo. Si algun dia una orden acumulara
muchos incidentes de admin, el detalle publico creceria en silencio: un `take` explicito ahi seria
barato. No bloquea.

**M4 — `menor` — la bitacora se queda corta en un conteo que cita como prueba.** Dice «6 rojos» al
meter `por_recoger` en el enum del webhook; yo medi **11** en los dos archivos de guardia. La
conclusion es identica y el sentido tambien, pero el numero de una medicion citada como evidencia
deberia ser el numero real. Mismo caso en la mordida del mapeo del admin: la bitacora dice 4 (2
archivos), yo medi 6 corriendo tambien el del repositorio — ahi la diferencia es de perimetro, no
de exactitud.

**M5 — `menor` — el `where` de `gestiones` del detalle sigue sin filtrar `anuladaAt`.** Una gestion
de `incidente` **anulada** con foto seguiria exponiendose en `evidencias[]`. Es exactamente la
regla que ya rige hoy a `entregada` y `rechazada`, y el implementer decidio a proposito no
«arreglarla» aqui porque cambiaria lo que ven las evidencias de entrega y rechazo, que hoy
funcionan. Decision de alcance correcta, pero **queda deuda declarada**: el detalle por API key
puede mostrar la foto de una gestion deshecha. Merece ficha propia, no un parche dentro de esta.

**M6 — `menor` — sin criterio de desempate si dos filas comparten `createdAt`.** Tanto
`causaIncidenteVigente` (usa `>` estricto, asi que un empate lo gana la gestion del mensajero) como
el `find` sobre `gestiones` dependen del `orderBy createdAt desc` de la base, que no es un orden
total. Escenario practicamente imposible (dos gestiones vigentes del mismo resultado en el mismo
instante) y sin impacto observable, porque las dos procedencias son disjuntas por diseno.

**M7 — `menor` — algunos asertos de `openapi-webhook-contrato.test.ts` son grep sobre la prosa.**
`toContain("SUBCONJUNTO")`, `toContain("NO es una URL firmada")`, `toContain("DELIBERADA")` y
similares. `tasks.md` abre diciendo que un `grep` no vale como criterio de «hecho» (la retractacion
de la 257). Aqui es aceptable porque **acompanan** a asertos estructurales que si muerden (el
`toEqual` del enum derivado, el `required` exacto, la paridad YAML) y porque lo que congelan es
literalmente el contrato que lee un humano. Pero son fragiles: un reescrito legitimo de la prosa
los pone rojos sin que nada este mal.

---

## Que NO encontre, y lo busque

- Ninguna URL firmada, token ni credencial en el cuerpo del webhook, por ninguna via.
- Ninguna fuga de datos entre tiendas por la lectura nueva de `orden_incidente`.
- Ningun test borrado, ninguno relajado a un conteo, ningun guard debilitado.
- Ningun cambio bajo `db/`, ninguna arista nueva, ningun value nuevo en el SEED.
- Ningun hardcode de contexto ni secreto.
- Ninguna capa cruzada: el service no ve HTTP, el repositorio no decide politica.

**Veredicto: OK.** Vuelve al leader para el bookkeeping de M1 y el merge.
**Recordatorio: T8 (aviso a integradores) bloquea la release a `prod`.**
