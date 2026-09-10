# Feature 404 — design

El QUÉ está en `requirements.md`. Aquí van las decisiones técnicas, la verificación de la premisa
de privacidad, los contratos de entrada/salida y las alternativas descartadas.

---

## 1. Resumen de la decisión

Un **único campo nuevo**, `mensajero`, con **una sola forma** compartida por tres superficies:

```jsonc
"mensajero": { "id": "018f2c31-0000-4000-8000-0000000000aa", "nombre": "Carlos Jiménez Mora" }
// o
"mensajero": null
```

- **Aditivo:** no se retira ni se cambia de forma ningún campo existente.
- **Sin migración:** no hay tabla nueva, ni columna nueva, ni enum nuevo, ni RLS nueva. El dato ya
  está en `orden.mensajero_asignado_id` → `usuario`, y la relación ya está declarada en Prisma
  (`Orden.mensajeroAsignado`, `db/schema.prisma:718`), con su índice
  (`@@index([mensajeroAsignadoId])`, `db/schema.prisma:788`).
- **Sin consulta nueva:** en las tres superficies el mensajero entra como una relación más del
  `select` que ya se hace, no como una lectura aparte (R12/R15).

---

## 2. La premisa de privacidad, verificada en el código

La puerta está firmada por el humano el 2026-09-09 con este argumento: *«la tienda ya ve el nombre
del mensajero en la UI, así que la API no le expone nada que no tuviera ya»*. El encargo era
**verificar esa premisa y dejarla escrita**. Esto es lo que se comprobó, archivo por archivo.

### 2.1 Lo que se comprobó — SÍ lo ve

| Qué | Dónde | Qué dice |
|---|---|---|
| El rol tienda entra a `/ordenes` | `app/(app)/ordenes/page.tsx:27-31` | `ROLES_CON_FILTRO_ESTADO` = `maestro`, `admin`, **`adminTienda`** |
| …y con la tabla completa | `app/(app)/ordenes/page.tsx:158-160` | monta `OrdenesListado` para esos tres roles |
| La tabla tiene columna «Mensajero» | `app/(app)/ordenes/_components/ordenes-columns.tsx:205-209` | `render: (row) => row.relaciones?.mensajeroAsignado?.nombre ?? "—"` |
| El juego de columnas **no** se recorta por rol | `app/(app)/ordenes/_components/OrdenesListado.tsx:929` | `const columns = ordenesColumnsReprogramada;` — sin rama por rol |
| El servidor sí puebla ese nombre para la tienda | `lib/repositories/OrdenRepository.ts:762-764` | `{ id, nombre: nombreCompletoUsuario(row.mensajeroAsignado) }` |
| …acotado a SUS órdenes, no a las de otros | `lib/services/OrdenService.ts:252` | `if (actor.rol === "adminTienda") where.tiendaId = actor.usuarioId;` |
| Y además se lo puede **descargar** | `app/(app)/ordenes/_components/ordenes-descarga-columnas.ts:74,139` | columna `Mensajero` = `relaciones.mensajeroAsignado.nombre` |

**Conclusión:** la premisa es cierta, y con margen. La cuenta `adminTienda` no solo ve el nombre
completo del mensajero de cada una de sus órdenes en pantalla: se lo lleva en el XLSX. El nombre lo
compone **la misma función** que va a usar esta feature (`nombreCompletoUsuario`), así que la API no
publicará ni un carácter más de lo que la pantalla ya entrega. **No hay que devolverle la decisión
al humano.**

### 2.2 El matiz que sí hay que decir (no invalida la premisa, la acota)

El owner de las órdenes del canal se resuelve con `resolverOwnerApiKey(usuarioId, tiendaDestinoId)`
(`lib/utils/api-key-owner.ts`), y hay **dos modelos**:

- **Key apuntada a una tienda real** (feature 302, `api_key.tienda_destino_id`): el owner es una
  cuenta `adminTienda`. La premisa es **literalmente** cierta: esa misma cuenta entra a `/ordenes`
  y ve la columna.
- **Key con cuenta dedicada** (modelo original, feature 88): el owner es una cuenta de rol
  `apiKey`, descrita en el propio código como *«una cuenta de máquina que no navega»*
  (`lib/auth/menu-visibility.ts:152`). Esa cuenta no ve **nada** en ninguna pantalla, así que no
  hay una UI concreta que señalar; la premisa se sostiene por transitividad comercial —el
  integrador ES la tienda dueña de esas órdenes— y no por una pantalla.

**Decisión (D0):** la excepción se aplica igual a los dos modelos, porque el destinatario del dato
es en ambos casos **el dueño de la orden** y el alcance por owner no se toca (R20). Queda como
**Q3** en `requirements.md` por si el humano prefiere acotarla al owner `adminTienda`; sería una
condición extra en un solo sitio, y hay que decirlo antes de implementar, no después.

---

## 3. Decisiones de forma

### D1 — `nombre` = nombre completo, por la fuente única ya existente

`nombreCompletoUsuario` (`lib/utils/nombre-usuario.ts`) compone `nombre + primer_apellido +
segundo_apellido` filtrando vacíos. Existe precisamente porque componerlo a mano en cada
repositorio produjo dos «Carlos» indistinguibles en cierres y manifiestos. Se reutiliza tal cual
(R3). **No** se publica solo `usuario.nombre`: dos mensajeros con el mismo nombre de pila
arruinarían la agrupación que el integrador quiere hacer.

### D2 — `id` = `usuario.id` (UUID) publicado como string opaco

`Usuario.id` es `String @id @default(uuid())` (`db/schema.prisma:84`). Cumple R4 sin trabajo extra:
se asigna al crear la cuenta, no se regenera nunca, y no se recicla. La FK de la orden es
`onDelete: SetNull` (`db/schema.prisma:718`), de modo que borrar un usuario deja la orden sin
mensajero —nunca apuntando a otra persona.

Sobre la tensión con «sin ids internos» de la 106: la regla existe para no publicar la estructura
interna ni ofrecer superficie enumerable. Este id **no la ofrece**: es un UUID (no enumerable), y
**ningún endpoint del canal lo acepta como entrada** —`{id}` de `/orden/{id}` se resuelve solo por
`num_guia` o `num_remision` (`ApiOrdenResolucionService`)—, así que no abre ninguna puerta. Lo que
habilita es exactamente lo que el integrador pidió: una clave de agrupación estable. El ejemplo de
su petición usaba `123`; ese entero no existe en el modelo (Q1).

### D3 — Presencia: SIEMPRE la clave, `null` cuando no hay mensajero

`armarData` documenta dos convenciones de ausencia que conviven a propósito: `motivo` siempre
presente con `null`, `evidenciasUrl` omitido cuando no aplica. `mensajero` se suma al **primer**
grupo, y por la razón que distingue a los dos:

- En `evidenciasUrl`, la ausencia significa **«no aplica»**: no hay incidente, no hay nada que
  enlazar. Omitirlo es información.
- En `mensajero`, la ausencia significaría **«nadie la lleva»**, que es un hecho del negocio que el
  integrador necesita leer para su denominador. `null` lo dice; omitir la clave lo esconde detrás
  de una ramificación por presencia.

Además, es lo que el integrador pidió literalmente («`null` si la orden aún no tiene mensajero
asignado»). Consecuencia para el contrato: `data` pasa a tener **cinco claves siempre presentes**
(`numGuia`, `numRemision`, `estado`, `motivo`, `mensajero`) y **una opcional** (`evidenciasUrl`,
que sigue siendo la única).

### D4 — Semántica: «quién la lleva AHORA», y se dice en el contrato

El valor sale de `orden.mensajero_asignado_id`, la única fuente de verdad del mensajero de una
orden (feature 159, `db/schema.prisma:648`). Eso implica dos cosas que se publican, no se ocultan:

1. En un **reintento** de entrega del mismo `eventoId`, el mensajero puede haber cambiado. Es
   exactamente la regla ya publicada para `motivo` («es el motivo VIGENTE EN EL MOMENTO DE LA
   ENTREGA, no una foto del instante del cambio de estado»), y se redacta igual (R11).
2. Varios flujos **limpian** la asignación a `null`: generación de guía
   (`GuiaAsignacionService:290-296`), quitar mensajero (`OrdenRepository:3346`, `:3401`), devolución
   a bodega (`DevolucionSlaRepository:136`), liberación de reprogramada
   (`LiberacionReprogramadaRepository:223`), recuperación a bodega
   (`RecuperacionBodegaRepository:50`) y el barrido del corte
   (`CierresAdminRepository:2054`). Una orden entregada o devuelta **conserva** su mensajero, así
   que la métrica principal del integrador funciona; una barrida por el corte no (R23, Q2, §9).

### D5 — Una sola definición del tipo, para que la 405 no invente otra

El tipo se declara **una vez** en `lib/types/api-orden.ts` (el archivo de DTOs públicos del canal):

```ts
/** Feature 404 — el mensajero ASIGNADO de una orden, en el canal público. `null` = ninguno. */
export interface ApiMensajeroDTO {
  id: string;     // usuario.id (UUID). Estable; nunca se reasigna.
  nombre: string; // nombreCompletoUsuario(): nombre + apellidos, sin dobles espacios.
}
```

Lo importan las tres superficies, **incluida** `DataEvento` de `WebhookEstadoService.ts` (import de
tipo puro: no acopla el servicio a nada, y la dirección `services → types` es la de siempre). Si
alguien cambia la forma en un sitio, los otros dos dejan de compilar — que es la idea, y es lo que
convierte a R5 en algo más que una promesa.

---

## 4. Modelo de datos

**No hay cambios de esquema.** Se declara explícitamente para que nadie busque la migración:

- Tablas: ninguna nueva, ninguna alterada.
- Columnas: ninguna nueva. Se **leen** `orden.mensajero_asignado_id` y, de `usuario`, `id`,
  `nombre`, `primer_apellido`, `segundo_apellido` (la proyección `NOMBRE_USUARIO_SELECT`).
- Enums: ninguno. RLS: ninguna política nueva (no hay tabla nueva).
- Migración up/down: **no aplica**. Si una task acaba proponiendo una, es señal de que se salió del
  alcance.

Coste de lectura: un `LEFT JOIN` por PK sobre `usuario` en consultas que ya leen `orden`. El listado
lo hace en la misma `findMany` (una fila de `usuario` por orden de la página, tope 100); el webhook,
en el mismo `findUnique` de la orden. Ningún `N+1`, ningún índice nuevo (el join es por clave
primaria de `usuario`).

---

## 5. Cambios por superficie

### 5.1 Webhook (`orden.estado_actualizado`)

| Archivo | Cambio |
|---|---|
| `lib/interfaces/repositories/IWebhookOrdenReader.ts` | `DatosEntregaOrden` gana `mensajero: ApiMensajeroDTO \| null`. **Campo REQUERIDO, no opcional**, por la misma razón que `causaDevolucion`/`causaIncidente`: un `?` dejaría pasar en silencio a quien se olvide de proyectarlo. |
| `lib/repositories/WebhookOrdenReader.ts` | El `select` del `findUnique` gana `mensajeroAsignado: { select: { id: true, ...NOMBRE_USUARIO_SELECT } }`. Se mapea con `nombreCompletoUsuario` y `null` si la relación no está. **Sigue siendo 2 llamadas a Prisma** (la orden y el catálogo de estado): una relación anidada no añade consulta. |
| `lib/services/WebhookEstadoService.ts` | `DataEvento` gana `mensajero: ApiMensajeroDTO \| null`; `armarData` lo escribe **después de `motivo` y antes del bloque opcional de `evidenciasUrl`**. |

La posición es **normativa** (R10): la firma se calcula sobre el string ya serializado
(`cabecerasFirma(secret, timestampUnix, cuerpo)`), así que el orden de inserción de claves es parte
del cuerpo. Va tras `motivo` porque es el final del bloque de claves siempre presentes y deja
`evidenciasUrl` donde está, al final: así el diff del cuerpo respecto de hoy es una inserción, no un
reordenamiento.

**Política vs. dato (criterio heredado de la 256/268):** el reader responde siempre «cuál es el
mensajero asignado»; que se publique o no es política de contrato y vive en el service. Aquí la
política es trivial —se publica siempre— y por eso **no** se añade ningún método `mensajeroPublicado`
paralelo a `motivoPublicado`: sería una indirección sin decisión dentro.

### 5.2 Listado y detalle (`GET /api/ordenes/api-key`, `GET .../orden/{id}`)

| Archivo | Cambio |
|---|---|
| `lib/interfaces/repositories/IOrdenRepository.ts` | `ApiOrdenRow` gana `mensajero: ApiMensajeroDTO \| null`. `ApiOrdenDetalleRow extends ApiOrdenRow` → lo hereda gratis. |
| `lib/repositories/OrdenRepository.ts` | `API_ORDEN_SELECT` gana `mensajeroAsignado: { select: { id: true, ...NOMBRE_USUARIO_SELECT } }`; `ApiOrdenSelectRow` gana el tipo; `toApiOrdenRow` mapea con `nombreCompletoUsuario`. Como `API_ORDEN_DETALLE_SELECT` hace `...API_ORDEN_SELECT`, el detalle lo hereda **sin tocar el detalle**. |
| `lib/types/api-orden.ts` | `ApiOrdenListItemDTO` gana `mensajero`. `ApiOrdenDetalleDTO extends ApiOrdenListItemDTO` → gratis. |
| `lib/services/ApiOrdenLecturaService.ts` | `toListItemDTO` copia el campo. Nada más: `toDetalleDTO` ya hace `...toListItemDTO(row)`. |

Los **controllers no se tocan**: ni `app/api/ordenes/api-key/route.ts` ni
`app/api/ordenes/api-key/orden/[id]/route.ts` construyen el DTO. El único cambio en el segundo es de
**comentario** (§7). El endpoint de cancelación, el de borrado, el de carga, el de cotización, el de
habilitar y los de PDF **no se tocan**.

---

## 6. Contratos de entrada/salida

**Entrada:** ninguna. No hay parámetro nuevo, ni header nuevo, ni cuerpo nuevo. R17 exige además
que un `mensajero=` en la query siga siendo una clave desconocida ignorada.

**Salida — webhook** (el ejemplo `incidente` del contrato, con la clave nueva en su sitio):

```json
{
  "evento": "orden.estado_actualizado",
  "eventoId": "webhook_estado:018f2c31-...-0002:21:2026-08-22T14:30:00.000Z",
  "ocurridoAt": "2026-08-22T14:30:00.000Z",
  "data": {
    "numGuia": 100235,
    "numRemision": "REM-0002",
    "estado": "incidente",
    "motivo": "robado",
    "mensajero": { "id": "018f2c31-0000-4000-8000-0000000000aa", "nombre": "Carlos Jiménez Mora" },
    "evidenciasUrl": "https://app.ordenex.co/api/ordenes/api-key/orden/018f2c31-...-0002"
  }
}
```

Un evento de una orden todavía en bodega, sin mensajero:

```json
"data": { "numGuia": null, "numRemision": "REM-0002", "estado": "en_preparacion",
          "motivo": null, "mensajero": null }
```

**Salida — listado** (un ítem; el resto de claves y `pagination` no cambian):

```json
{ "numGuia": 100234, "numRemision": "REM-0001", "estado": "en_reparto",
  "destinatario": "Ana Solís", "telefonoDest": "0991234567", "producto": "Caja",
  "direccion": "Calle 1", "montoCobrar": 25900, "createdAt": "2026-09-07T15:04:00.000Z",
  "mensajero": { "id": "018f2c31-0000-4000-8000-0000000000aa", "nombre": "Carlos Jiménez Mora" } }
```

**Salida — detalle:** lo mismo, más el `evidencias[]` de siempre.

**Códigos de estado:** sin cambios. 401/403/404/409/422 conservan su criterio exacto.

---

## 7. Cómo queda el contrato de la 106 tras la excepción

El texto vigente de 106/R16 dice: *«NUNCA DEBE exponer la ruta cruda del objeto en el bucket, ni el
nombre del bucket, ni datos personales de terceros (p. ej. el mensajero) en la respuesta»*. Esta
feature contradice **una parte** de esa frase, así que hay que dejarla acotada en los cuatro sitios
donde alguien puede tropezar con ella, y **en ninguno más**:

1. **`specs/106-api-lectura-ordenes/requirements.md` — ADDENDUM al final, no reescritura.** Se
   **añade** un bloque fechado `⏳ 2026-09-09 — R16 ACOTADO por la feature 404`, que dice qué parte
   sigue vigente (bucket, `storage_path`, ids internos, resto de la PII del mensajero) y qué parte
   queda acotada (el **nombre** del mensajero asignado, hacia el dueño de la orden, autorizado por
   el humano con el argumento de §2). **El texto de R16 no se toca**: es el registro de una decisión
   con fecha, igual que un `down.sql` es la foto de su rama; reescribirlo borraría el rastro de que
   hubo una excepción y de quién la firmó.
2. **Comentarios de código que hoy afirman lo contrario.** Tres, y se corrigen con el patrón fechado
   que ya usa el repo (`⏳ fecha — AQUÍ DECÍA, y ya no es cierto`):
   `app/api/ordenes/api-key/orden/[id]/route.ts` («sin PII del mensajero»),
   `lib/types/api-orden.ts` (cabecera: «sin datos del mensajero que gestionó la orden (R16)») y
   `lib/services/ApiOrdenLecturaService.ts` (cabecera de clase). Nota: el de `api-orden.ts` decía
   «el mensajero que **gestionó**» — y eso **sigue siendo verdad**: lo que se publica es el
   **asignado**, no el gestor (R7). La corrección tiene que decir esa diferencia, no borrar la
   frase.
3. **Contrato publicado (R24/R25).** La `description` de `OrdenListItem` dice hoy «sin ids internos
   ni PII de terceros»; pasa a declarar la excepción con su alcance, en `lib/api/openapi-spec.ts` y
   en su espejo `docs/api/api-key-openapi.yaml`.
4. **`docs/api/CHANGELOG.md`.** Entrada fechada, aditiva, antes de la release —la convención del
   propio archivo—, con el aviso a clientes de validación estricta y con el punto de Q1 (`id` es
   texto, no entero).

---

## 8. Alternativas descartadas

**A1 — Publicar solo `nombre`, sin `id`.** Menos dato expuesto y menos discusión sobre ids
internos. **Descartada:** el integrador va a **agrupar** por mensajero, y el nombre no es clave: dos
mensajeros pueden llamarse igual (es literalmente el problema que hizo nacer `nombreCompletoUsuario`)
y un nombre puede corregirse en cualquier momento, partiendo la serie histórica del dashboard en
dos. Sin `id`, la feature no cumple lo que la pidió.

**A2 — Publicar un id PSEUDÓNIMO (HMAC de `usuario.id` con sal por owner) en vez del UUID.**
Preservaría la agrupación sin publicar el identificador interno, y evitaría correlacionar el mismo
mensajero entre dos integradores. **Descartada:** el humano ya autorizó publicar el **nombre**, que
identifica a la persona mucho más que un UUID; pseudonimizar el id al lado del nombre es teatro, no
privacidad. Además obliga a llevar y rotar una sal —y una rotación rompería R4 en silencio, que es
justo lo que no puede pasar—, y le pondría a la 405 la carga de reproducir el mismo derivado.

**A3 — Derivar el mensajero del HISTORIAL de gestiones para que sobreviva al barrido del corte.**
Cerraría el hueco de Q2/R23. **Descartada:** es el rediseño que esta ficha no es. Una orden puede
tener varias gestiones de varios mensajeros, así que «el mensajero» dejaría de ser un dato y pasaría
a ser una regla de precedencia con sus propios casos de borde —exactamente la materia de la **405**,
que ya está fichada y depende de esta. Meterla aquí duplicaría esa decisión en dos sitios.

**A4 — Omitir la clave `mensajero` cuando no hay mensajero (patrón `evidenciasUrl`).** Consistente
con el precedente más reciente del payload. **Descartada:** las dos convenciones conviven a
propósito y significan cosas distintas (§D3). Aquí «nadie la lleva» es un hecho que el integrador
necesita contar, no un «no aplica»; y él pidió `null` explícitamente.

**A5 — Un recurso nuevo `GET /api/ordenes/api-key/mensajeros`.** Daría el catálogo para resolver
ids. **Descartada:** nadie lo pidió, publica el directorio del personal interno (mucho más de lo
autorizado) y multiplica la superficie del canal para un dato que ya viaja embebido.

---

## 9. Riesgos y huecos declarados

1. **Órdenes que no emiten evento.** El emisor exige **suscripción activa colgada del owner de la
   orden** (`webhook-estado-encolado.ts`, tras la corrección de la 302 medida contra producción el
   2026-09-04). El criterio ya **no** es «el dueño es un usuario de API key». Una orden del
   integrador cuyo owner no tenga suscripción activa no emite nada, y esta feature no lo cambia.
2. **`mensajero: null` en el histórico barrido** (R23, Q2). Es el hueco que el integrador notará en
   su «censo diario» sobre órdenes viejas. Se declara; se cierra en la 405, no aquí.
3. **Clientes con validación estricta de esquema.** Un cliente generado con
   `additionalProperties: false` puede romper con una clave nueva. Mismo riesgo que asumió la 268 con
   `evidenciasUrl` y la del 2026-08-25 al retirar `generado`: se avisa en el CHANGELOG.
4. **El cuerpo del webhook crece.** No afecta a la firma (se calcula por entrega) ni a la
   idempotencia (el `eventoId` no depende del cuerpo), pero **sí** cambia los dos ejemplos publicados
   y los cuerpos que los tests congelan (§10).
5. **Observación colateral, FUERA DE ALCANCE y no se toca aquí:** `evidenciasUrl` se construye con
   `orden.id` (`WebhookEstadoService.evidenciasUrlDe`), mientras que
   `ApiOrdenResolucionService.resolver` solo casa por `num_guia` o `num_remision`. Un `GET` a ese
   enlace parece devolver 404. No se investiga ni se corrige en esta ficha —no es lo que se pidió—;
   se anota para que quien lo mire mañana no crea que lo rompió la 404.

---

## 10. Tests congelados que se pondrán ROJOS a propósito

No son daños colaterales: son contratos escritos como literal, y hay que **actualizarlos con la
decisión escrita al lado**, nunca relajarlos a un aserto de tamaño. Antes de tocar cada uno, decidir
si el literal ES el contrato (entonces se enmienda con fecha y motivo) o si era un polizón.

| Test | Qué congela | Qué hay que hacer |
|---|---|---|
| `tests/unit/services/webhook-estado-service.test.ts:149,353,617-618` | `Object.keys(body.data)` **exacto** = 4 claves | Pasa a 5, en el ORDEN nuevo. El orden es load-bearing (firma). |
| `tests/unit/services/webhook-estado-service.test.ts:596` | claves del evento `incidente` (5, con `evidenciasUrl`) | Pasa a 6, con `mensajero` antes de `evidenciasUrl`. |
| `tests/unit/repositories/orden-repository.no-regresion-106.test.ts` | `SELECT_DETALLE_106`, literal congelado comparado con `toEqual` | Se **enmienda** con un bloque fechado, siguiendo exactamente el precedente que la 268 dejó ahí (líneas 25-34). |
| `tests/unit/repositories/orden-repository.api-lectura.test.ts:81` | `toEqual` de la fila pública completa | Gana `mensajero`. |
| Tests de `ApiOrdenLecturaService` y de las rutas de listado/detalle | forma del DTO | Ganan el campo donde comparan objetos completos. |
| `tests/unit/api/openapi-webhook-*.test.ts` | schema publicado del webhook | Ganan la propiedad y su `required`. |

---

## 11. Frontera con la feature 405 (explícita)

La **405** (historial de gestiones por API, `depends_on: 404`) **reutiliza la forma que aquí se
define**:

- Importa `ApiMensajeroDTO` de `lib/types/api-orden.ts`. **No** define un segundo tipo de mensajero,
  ni «mejora» éste con campos nuevos.
- Su mensajero es **otro dato con la misma forma**: el de cada gestión sale de
  `gestion_orden.mensajero_id` (NOT NULL, nunca se limpia) y responde «quién la gestionó»; el de
  esta feature sale de `orden.mensajero_asignado_id` y responde «quién la lleva». Los dos pueden
  diferir sobre la misma orden, y eso **no es una inconsistencia**: son dos preguntas distintas. La
  405 tendrá que decirlo en su contrato tan explícitamente como lo dice aquí R7.
- Si la 405 necesitara cambiar la forma del campo, es un cambio del contrato público con entrada de
  CHANGELOG propia — no un ajuste interno.
