# Feature 256 — Bitacora de implementacion

**Feature:** el evento `orden.estado_actualizado` del webhook viaja con el motivo tipificado
de la devolucion en `data.motivo`.
**Rama:** `feature/256-webhook-motivo-devolucion` (worktree `C:/w256`), desde `dev` = `021916ef`.
**Zona:** backend pura. **Sin migracion**: no se toca `db/schema.prisma` ni `db/migrations/`.

> Decisiones de la puerta humana del 2026-08-21 respetadas sin reabrir: el campo de cable se
> llama **`motivo`**, plano en `data`, con el **value crudo** del enum; **siempre presente**
> (`null` fuera de `devuelta` y en una `devuelta` sin causa); alcance **solo `devuelta`**; la
> causa es la **vigente al entregar**; el evento **se publica** en el OpenAPI; el aviso a
> integradores **no** es parte de la feature.
>
> ADVERTENCIA — doble nombre, a proposito: en el DTO interno el campo se llama
> `causaDevolucion`; `motivo` es SOLO el nombre de cable. No se unifican. Y `data.motivo`
> (enum de 3 valores) NO es `gestion_orden.motivo` (texto libre del mensajero), que no se
> emite jamas (R22).

---

## T0 — Baseline medido (no supuesto)

Medido en `C:/w256` ANTES de tocar nada, tras `pnpm db:generate` (sin el cliente generado,
`webhook-estado-service.test.ts` cae entero con "Cannot find module .prisma/client/default";
no es un rojo del repo).

| Comando | Baseline (antes) | Final (despues) |
| --- | --- | --- |
| `pnpm typecheck` | limpio, 0 errores | limpio, 0 errores |
| `pnpm lint` | 0 errores, 97 warnings | 0 errores, 97 warnings |
| `webhook-estado-service.test.ts` | verde | verde |
| `webhook-eventos.test.ts` | verde (sin editar) | verde (sin editar) |
| `openapi-contrato-en-reparto.test.ts` | verde | verde (sin editar) |
| `openapi-177-paths-pdf-y-carga-id.test.ts` | verde | verde (sin editar) |
| **Total de los 4 archivos del baseline** | **58 tests, 4 files passed** | vease abajo |

**Delta de rojos = 0.** Ningun rojo preexistente en el perimetro y ningun rojo nuevo.

Los dos rojos que el diseno (§5.1) PREDIJO aparecieron y se resolvieron en este mismo PR:

1. `DATOS_BASE` (`webhook-estado-service.test.ts:27`) dejo de typecheckear al hacerse el campo
   REQUERIDO — `TS2741: Property 'causaDevolucion' is missing`. Resuelto anadiendo
   `causaDevolucion: null` al literal base y completando cada fake derivado. Es el rojo que se
   queria: obliga a mirar fake por fake.
2. El `toEqual` de `:94` (congelador del cuerpo) se puso rojo al ganar `data` una clave.
   **Actualizado, no borrado**: ahora afirma `Object.keys(body.data)` exacto
   `["numGuia","numRemision","estado","motivo"]` MAS el `toEqual` de los cuatro valores.

**Rojo ajeno encontrado durante T10 y resuelto sin editar la guardia:**
`tests/unit/types/intentos-no-alcance.test.ts` (160/R31) serializa todo `openApiSpec` y prohibe
la subcadena "intentos" en cualquier sitio. La prosa del webhook decia «los **reintentos** son
parte del contrato» y la puso roja. Se reescribio la frase en singular («reintento») y se dejo
un comentario en ambos archivos avisando de la restriccion. La guardia NO se toco y quedo verde.

---

## Archivos creados / modificados

### Codigo de produccion (3 archivos, diff minimo)

**`lib/interfaces/repositories/IWebhookOrdenReader.ts`** (T1)
`DatosEntregaOrden` gana `causaDevolucion: CausaDevolucion | null` **requerido**, con el tipo
importado de `lib/types/causa-devolucion.ts` (no de `@prisma/client`), y el comentario que
explica los dos origenes del `null`.

**`lib/repositories/WebhookOrdenReader.ts`** (T2)
La causa se resuelve DENTRO del `orden.findUnique` que ya existia, como relacion anidada
`gestiones` con `where { resultado: RESULTADO_DEVUELTA, anuladaAt: null }`,
`orderBy createdAt desc`, `take: 1`, `select { causaDevolucion }`. El
`Pick<PrismaClient, "orden" | "orderStatus">` **NO cambia** y el metodo sigue haciendo
exactamente **2** llamadas a Prisma.

**`lib/services/WebhookEstadoService.ts`** (T3)
`motivo` como CUARTA clave de `data`, detras de `estado`:
`motivo: datos.estado === "devuelta" ? datos.causaDevolucion : null`. La POLITICA de contrato
vive en el service; el repositorio siempre responde «cual es la causa vigente de la orden».
Comentario obligatorio sobre los dos `motivo`.

### Documentacion del contrato publico (2 archivos)

**`lib/api/openapi-spec.ts`** (T10) — seccion `webhooks:` de OpenAPI 3.1 a **NIVEL SUPERIOR**
(entre `paths:` y `components:`) con el evento completo: `evento`, `eventoId`, `ocurridoAt` y
`data` con las cuatro claves en `required`; enum de los tres valores de `motivo`; cabeceras de
firma. El campo `estado` va como `type: string` con prosa y **sin `enum`** (design §5.2).

**`docs/api/api-key-openapi.yaml`** (T10) — espejo textual exacto, `webhooks:` a indentacion 0,
en el MISMO cambio. Paridad verificada estructuralmente, no a ojo.

### Tests (1 modificado, 2 nuevos)

- `tests/unit/services/webhook-estado-service.test.ts` — modificado y ampliado (T5-T9)
- `tests/unit/repositories/webhook-orden-reader.test.ts` — **nuevo** (T4; no existia ninguno)
- `tests/unit/api/openapi-webhook-estado-actualizado.test.ts` — **nuevo** (T10 / R24)

### Lo que NO se toco (verificado por `git status`)

`lib/services/jobs/webhook-estado-encolado.ts`, `lib/types/webhook-eventos.ts`,
`lib/services/jobs/webhook-estado-handler.ts`, `lib/crypto/webhook-firma.ts`,
`db/schema.prisma`, `db/migrations/`, `feature_list.json`, `progress/current.md`,
`tests/unit/types/webhook-eventos.test.ts`, `tests/unit/services/webhook-estado-encolado.test.ts`,
`tests/unit/api/openapi-contrato-en-reparto.test.ts`,
`tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts`,
`tests/unit/types/intentos-no-alcance.test.ts`.

---

## Trazabilidad R1..R24 -> test (sin huecos)

Abreviaturas de archivo:

- **S** = `tests/unit/services/webhook-estado-service.test.ts`
- **RD** = `tests/unit/repositories/webhook-orden-reader.test.ts`
- **OA** = `tests/unit/api/openapi-webhook-estado-actualizado.test.ts`
- **ENC** = `tests/unit/services/webhook-estado-encolado.test.ts` (verde SIN editarlo)

| R | Archivo | Nombre del `it(...)` |
| --- | --- | --- |
| R1 | S | `256/R1+R2: un evento devuelta con causa %s la emite CRUDA, sin traducir ni normalizar` (`it.each(CAUSA_DEVOLUCION_SEED)`) |
| R2 | S | idem R1, mas `256/R2: no se emite ninguna etiqueta en espanol junto al enum (contrato de maquina)` |
| R3 | S | `256/R3: recorriendo el SEED como fuente de verdad, ningun valor fuera de los tres puede salir` y `256/R3: una causa de INCIDENTE (enum hermano de la 158) nunca aparece en data.motivo` |
| R4 | S | `256/R4: una devolucion VIGENTE sin causa registrada (historico previo a la 73, que no se backfilleo) emite null y entrega con normalidad` |
| R4 | RD | `R4: gestion devuelta VIGENTE con la causa sin registrar (historico previo a la 73) -> null, sin inventar un valor por defecto` |
| R5 | S | `256/R5: una orden sin ninguna gestion devuelta vigente (nunca la tuvo, o esta anulada) emite null y entrega con normalidad` |
| R5 | RD | `R5: orden sin ninguna gestion devuelta vigente -> null (la relacion viene vacia)` |
| R6 | S | `256/R6: en un evento en_reparto el campo EXISTE y vale null (el consumidor no ramifica por estado)` y `256/R6: una orden con devolucion vigente que hoy transiciona a OTRO estado emite null igualmente` |
| R7 | S | `256/R7: data tiene EXACTAMENTE las cuatro claves, en orden, tambien en un evento de devolucion` y `con suscripcion activa hace POST a la URL del owner con el cuerpo del evento` (el congelador de `:94`, actualizado) |
| R8 | RD | `R8: con dos gestiones devuelta vigentes emite la causa de la de createdAt MAYOR` |
| R9 | RD | `R9: una gestion devuelta ANULADA no se considera aunque sea la mas reciente` |
| R10 | RD | `R10: una gestion entregada/incidente POSTERIOR no desplaza a la devuelta vigente y su causa de incidente nunca aparece` |
| R11 | RD | `R11: la relacion cuelga de la orden PEDIDA; no hay consulta libre a gestionOrden` |
| R12 | RD | `R12: el reader hace exactamente 2 llamadas a Prisma, las mismas que antes de la feature` |
| R13 | S | `256/R13: reejecutar con el mismo estado leido produce un cuerpo BYTE-IDENTICO con el motivo informado` (amplia `reejecutar el job produce el mismo eventoId y el mismo cuerpo`, que sigue intacto) |
| R14 | S | `256/R14: con un reloj distinto en cada ejecucion, data es identico y el eventoId no cambia` |
| R15 | S | `256/R15: si la gestion se anula entre dos intentos, el motivo es el VIGENTE AL ENTREGAR: el 2.o cuerpo lleva null, con el MISMO eventoId, sin error y sin evento adicional` |
| R15 | OA | `256/R24 (+R15): la prosa de motivo documenta el caso null y que la causa es la VIGENTE al entregar` |
| R16 | S | `256/R16: la firma verifica contra ${ts}.${cuerpo} con el cuerpo YA ampliado` |
| R17 | S | `256/R17: esta feature no anade ni quita eventos publicos ni familias exceptuadas`, mas `tests/unit/types/webhook-eventos.test.ts` verde SIN editarlo |
| R18 | ENC | los 11 tests de `webhook-estado-encolado.test.ts`, verdes SIN editar el archivo (payload y dedupeKey del job intactos) |
| R19 | S | `256/R19: los tres campos viejos y la ausencia de orden se conservan en un evento de devolucion` |
| R19 | RD | `R19: los campos que ya viajaban (tiendaId, numGuia, numRemision, deletedAt, estado) siguen igual` |
| R20 | S | `256/R20: los cinco desenlaces del job siguen siendo los mismos con una devolucion con causa`, mas los cinco desenlaces originales intactos |
| R21 | S | `256/R21: el destino sigue derivandose del tiendaId de la orden, tambien en un evento con motivo`, mas `el evento de la orden de un owner nunca se envia al callback de otro owner` |
| R22 | S | `256/R22: con una gestion que tiene causa tipificada Y texto libre, el cuerpo lleva el enum y el texto libre no aparece por ningun lado` |
| R22 | RD | `R22: el TEXTO LIBRE gestion_orden.motivo no se proyecta siquiera: solo viaja el enum` |
| R23 | S | `ningun log emitido contiene secreto, URL ni datos del destinatario` (ampliado: ninguna causa del SEED ni la palabra motivo llegan al logger) |
| R24 | OA | los siete `it(...)` del archivo: existencia de `webhooks[orden.estado_actualizado]` a nivel superior; las cuatro claves de `data` y su `required`; el enum de `motivo` contra `CAUSA_DEVOLUCION_SEED`; `estado` SIN enum; la prosa del `null` y del vigente-al-entregar; las cabeceras de firma; y la paridad TS-YAML |

**24 de 24 requisitos mapeados a un test que existe y corre.** Ninguna fila apunta a un
comentario ni a una parafrasis.

---

## Los asserts MUERDEN (comprobacion de mutacion, no de lectura)

El criterio de «hecho» de varias tasks esta escrito como un `grep`; no se dio por cumplido
editando comentarios. Cada mutacion se aplico, se comprobo el rojo y se revirtio (la reversion
del OpenAPI se verifico por hash, no a ojo):

| Mutacion temporal | Rojo que produce |
| --- | --- |
| Quitar la ramificacion del service (`motivo: datos.causaDevolucion` a secas) | `256/R6: una orden con devolucion vigente que hoy transiciona a OTRO estado emite null igualmente` |
| Quitar `anuladaAt: null` del `where` de la relacion | `R8`/`R9` del reader |
| Quitar `orderBy: { createdAt: "desc" }` | `R8` del reader |
| Quitar `motivo` del `required` de `data` en el OpenAPI | el `it` del schema y el de paridad TS-YAML |
| Anadir un `enum` de estados a `data.estado` («mejorar» la doc) | el `it` de «sin enum» y el de paridad, **y ademas 5 rojos en `openapi-contrato-en-reparto`**: confirma empiricamente la trampa de design §5.2 |
| Borrar la seccion `webhooks:` entera del `.yaml` | `Error: el .yaml no declara la seccion de NIVEL SUPERIOR webhooks:` |
| Quitar el parametro `X-Ordenex-Timestamp` del `.yaml` | el `it` de cabeceras y el de paridad |

Esto es posible porque el fake de Prisma de T4 **no devuelve filas fijas**: aplica de verdad el
`where` / `orderBy` / `take` / `select` que el repositorio le pasa, sobre un conjunto de
gestiones crudas. Un fake que devolviera siempre la fila correcta habria dado verde con el
codigo roto.

---

## Salida REAL de los tests

```
$ pnpm typecheck
> ordenex@0.1.0 typecheck C:\w256
> tsc --noEmit
(sin errores)

$ pnpm lint
✖ 97 problems (0 errors, 97 warnings)
  0 errors and 1 warning potentially fixable with the --fix option.
```

Los 97 warnings son PREEXISTENTES (`no-unused-vars` de `_input`/`_err` en tests ajenos):
identico al baseline, y ninguno cae en un archivo de esta feature.

```
$ pnpm exec vitest run \
    tests/unit/services/webhook-estado-service.test.ts \
    tests/unit/repositories/webhook-orden-reader.test.ts \
    tests/unit/services/webhook-estado-encolado.test.ts \
    tests/unit/types/webhook-eventos.test.ts \
    tests/unit/api/openapi-webhook-estado-actualizado.test.ts \
    tests/unit/api/openapi-contrato-en-reparto.test.ts \
    tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts \
    tests/unit/types/intentos-no-alcance.test.ts \
    tests/unit/types/causa-devolucion.test.ts

 RUN  v4.1.10 C:/w256

 Test Files  9 passed (9)
      Tests  113 passed (113)
   Start at  14:08:15
   Duration  1.06s
```

De los 4 archivos del baseline (58 tests) a 9 archivos y 113 tests, **todos verdes**.
El service pasa de 20 a 31 tests; el reader de webhooks estrena su primer test (9 casos); el
contrato OpenAPI del webhook estrena el suyo (7 casos).

---

## Notas para el reviewer y para el leader

1. **Ningun gate se corrio desde aqui.** `./init.sh` no se ejecuto: lo corre el leader. Lo de
   arriba es typecheck + lint + los tests del perimetro.
2. **`design.md` §5.2 cita un numero caduco:** dice que la lista de `paths` esta congelada en
   **7**; en el arbol real son **8** (la feature 255 dio de alta
   `/api/ordenes/api-key/cotizacion`). No cambia nada de T10 —la seccion `webhooks:` es de nivel
   superior y no toca `paths`— pero conviene no fiarse del numero al releer el spec.
3. **`RESULTADO_DEVUELTA` lleva anotacion de tipo**
   (`const RESULTADO_DEVUELTA: GestionResultado = "devuelta"`). El molde de
   `OrdenRepository.ts:318` es un literal sin anotar; se siguio el diseno (§2.2 pide «tipada
   contra `GestionResultado`»), que es estrictamente mas fuerte y no cambia el `Pick` del
   cliente Prisma.
4. **`js-yaml` no es resoluble en este repo** (existe en el store de pnpm pero no como
   dependencia declarada, y ningun test lo importa). El test de paridad TS-YAML lee el `.yaml`
   como texto —el molde real de los tests de OpenAPI del repo— e incluye un lector del
   subconjunto YAML que ese bloque usa, acotado a la seccion `webhooks:`; ante cualquier
   construccion fuera del subconjunto **lanza**, en vez de devolver un objeto a medias.
5. **El aviso a integradores NO es parte de esta feature** (decision (g), 2026-08-21). El cambio
   es aditivo y no bloquea el despliegue.
