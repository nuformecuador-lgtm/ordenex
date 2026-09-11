# Feature 415 — design

El QUÉ está en `requirements.md`. Aquí van las decisiones técnicas, los contratos de salida, el
coste de consulta y las alternativas descartadas.

**Las cinco decisiones abiertas por la primera revisión las cerró el humano el 2026-09-10.** Están
en §3 como **D2–D6**, cada una con quién la firmó y por qué. **Dos se cerraron contra la propuesta
original de este spec** (D2 y D5) y se dice en cuál dirección y con qué argumento: un spec que
borra el rastro de haber sido corregido enseña una decisión sin su motivo.

---

## 1. Resumen de la decisión

**Tres campos nuevos**, aditivos, sobre el ítem del listado (que el detalle hereda), **sin
migración, sin endpoint nuevo y sin tocar los controllers**:

```jsonc
"zona": { "id": "018f2c31-0000-4000-8000-00000000za01", "nombre": "FGAM Zona Sur" },
"costoEstimado": { "flete": "2500.00", "iva": "325.00", "comision": "906.50",
                   "ivaComision": "117.85", "fulfillment": "696.00" },
"costoReal":     { "flete": "2500.00", "iva": "325.00", "comision": "906.50",
                   "ivaComision": "117.85", "fulfillment": "692.00" }
```

- `zona` — objeto `{ id, nombre }`, **la misma forma que `mensajero`**. Siempre presente, nunca
  `null` (R1/R2).
- `costoEstimado` — los cinco conceptos derivados de la tarifa **VIGENTE**; `null` sólo si no hay
  tarifa que resuelva para el par (tienda, zona) (R22).
- `costoReal` — los cinco conceptos derivados de la tarifa **CONGELADA** en `cierre_detail`; `null`
  mientras la orden no haya entrado en un cierre aprobado (R26).

**Sin migración.** Ninguna tabla, columna, enum ni política de RLS nueva. Todo el dato ya existe:
`orden.zona_id → zona.{id,nombre}`, `orden.distrito_id → distrito.zona_especial`, `tarifas` (vía la
cascada ya existente) y `cierre_detail`. **Si una task acaba proponiendo una migración, está fuera
de alcance: parar y preguntar.**

**Sólo lectura.** Esta feature no escribe una fila. `cierre_detail` es INMUTABLE (69/R10) y ya hay
una guardia que prohíbe escribirla desde `lib/`; aquí sólo se le hace `select`.

---

## 2. La trampa de lectura: hay DOS «zona», y se dice en cuatro sitios

| «zona» | Columna | Qué es | Esta ficha |
|---|---|---|---|
| del **MENSAJERO** | `usuario.zona_id` | en qué zona trabaja esa persona — **dato personal suyo** | **NO la toca.** Sigue excluida |
| de la **ORDEN** | `orden.zona_id` | a dónde va el paquete — **dato operativo del envío** | **La publica** |

El comentario de `API_ORDEN_SELECT` que excluye «zona» está **dentro de la proyección de
`mensajeroAsignado`** y habla de la primera. La `description` publicada de `OrdenListItem.mensajero`
repite la misma lista («teléfono, email, cédula, foto, **zona**, vehículo»), y esa frase **sigue
siendo verdad palabra por palabra**.

Se deja escrito en **cuatro** sitios, y en ninguno más (R39):

1. El comentario de `API_ORDEN_SELECT`, junto al campo nuevo.
2. La cabecera de `lib/types/api-orden.ts`.
3. La `description` de `OrdenListItem.mensajero` en `lib/api/openapi-spec.ts` y su espejo `.yaml`:
   se le añade la cláusula «(la zona **del mensajero**; no confundir con el campo `zona` de la
   orden, que sí se publica)». **No se retira la palabra de la lista de exclusión.**
4. La `description` del campo `zona` nuevo, que dice de qué zona habla.

Sin esto, el siguiente que lea una sola de esas frases concluirá que la ficha contradice la decisión
de privacidad que el humano firmó el 2026-09-09 para la 404.

---

## 3. Decisiones de forma

### D1 — `zona.nombre` es el del catálogo, y no se deriva nada de él

Medido por el humano: `GAM` (1.090 órdenes) y siete `FGAM …` (Zona Sur 204, San Ramón 132, El Coco
103, Guanacaste 55, Puntarenas 47, Limón 21, San Carlos 0). El «GAM / fuera de GAM y su subzona»
que el integrador pidió **ya está en el nombre**. Por tanto:

- **No** se publica un booleano `esGam` derivado de `zona.es_central`. Sería un **segundo** sitio
  donde se responde «¿es GAM?», y los dos pueden discrepar: `es_central` es una columna **mutable**
  del catálogo. Un campo que a veces contradice a otro es peor que no tenerlo.
- **No** se publica `subzona`. Partir `"FGAM Zona Sur"` por un espacio es una regla de parsing sobre
  un texto libre que nadie garantiza.
- **No** se publica la geografía (provincia/cantón/distrito): nadie la pidió.

### D2 — `zona` es `{ id, nombre }` — decisión del humano, 2026-09-10, **contra** la propuesta de este spec

**Este spec proponía una cadena**, con el argumento de que `zona.nombre` es `@unique` en el esquema
—a diferencia de `usuario.nombre`, cuya colisión fue lo que obligó a la 404 a publicar `{id,
nombre}`— y de que `zona.id` es un UUID que ningún endpoint acepta como entrada. **El humano lo
rechazó, y el motivo deja el argumento sin pie:**

> `@unique` protege contra **duplicados**, no contra **renombrados**. El día que «FGAM El Coco» pase
> a «FGAM Coco», la serie histórica del integrador se parte en dos y él no se entera.

Y hay un segundo motivo, de coherencia del payload, que es el decisivo: **hoy mismo publicamos
`mensajero` como `{ id, nombre }` y le decimos al integrador por escrito, en el manual, «agrupá por
`id`, nunca por `nombre`»**. Dos entidades con nombre en el mismo objeto, con formas distintas,
obligan a recordar cuál es cuál y a aplicar dos reglas opuestas. El molde de la 404 ya está escrito
y el coste es una línea.

Consecuencias, y son las que hacen que esto sea barato:

- `zona.id` es `zona.id` (`String @id @default(uuid())`): estable, no se regenera y no se recicla
  (R3). `orden.zona_id` es **NOT NULL**, así que `zona` nunca es `null` — a diferencia de
  `mensajero`, que sí puede serlo. **Esa diferencia se declara en el contrato**, porque es la única
  que hay entre los dos campos.
- `zona.nombre` se publica como **texto para mostrar**, con la misma advertencia que `mensajero.
  nombre`: puede cambiar, no lo uses como clave (R4).
- `zona.id` **no lo acepta ningún endpoint del canal como entrada** (R35), igual que el `id` del
  mensajero: no abre superficie.

### D3 — Los dos costos son el escenario ENTREGADA, y el contrato lo dice — cerrada por el humano

Los cinco conceptos son los mismos que `CotizacionEscenarioEntregado` menos su `total`. Los dos
campos responden a la misma pregunta —«¿cuánto cuesta este paquete si se entrega?»— y **difieren
sólo en QUÉ tarifa y QUÉ entradas los alimentan**:

| | tarifa | `esCentral` / `esZonaEspecial` | `montoCobrar` / `cobraComision` | `fulfillment` |
|---|---|---|---|---|
| `costoEstimado` | la **VIGENTE** del par (tienda, zona) | **vivos** de la orden | **vivos** de la orden | de la tarifa vigente |
| `costoReal` | la **CONGELADA** en `cierre_detail` | **congelados** | **congelados** | `cierre_detail.tarifa_fulfillment` |

`cierre_detail` **no congela el `resultado` de la gestión** (eso vive en `gestion_orden`, y una
orden puede tener varias gestiones vigentes en el mismo cierre — el propio `CierreDiaRepository`
deduplica por orden y se queda con la primera). Por eso `costoReal` afirma **«con qué tarifa quedó
congelada esta orden al cerrarse»** y **no** «qué línea entró en tu wallet». Una orden RECHAZADA
pagó flete de devolución + IVA, que son conceptos distintos.

**El humano exigió que el contrato lo diga con esas palabras** (R15), y su razón es la correcta:
*es justo lo que un integrador asumiría al revés*.

### D4 — Cinco conceptos, NINGÚN `total`, y tampoco con otro nombre — cerrada por el humano

El único `total` que este canal publica hoy es el de `CotizacionEscenarioEntregado`, y significa
**«lo que RECIBE la tienda»** = monto a cobrar − los cinco conceptos. Un `costoEstimado.total` que
fuera «la suma de los cinco» le daría al canal **dos `total` de signo opuesto**.

Este spec dejó abierto si el humano querría un sexto campo **con otro nombre**. Lo cerró en **no**,
y con el argumento del propio spec llevado hasta el final: *si no publicamos `total` porque el único
`total` del canal significa lo contrario, añadir un total sumado por otro nombre reintroduce la
misma ambigüedad con disfraz*. El integrador suma los cinco: son suyos y sabe qué está sumando.
R11 lo escribe como prohibición, no como omisión, para que no vuelva de paso en otra ficha.

### D5 — `costoReal` sólo de un cierre APROBADO, y el filtro es EXPLÍCITO aunque hoy no recorte nada

**Lo medido (humano, contra producción, 2026-09-10):** de 1.652 órdenes vivas, 1.182 tienen fila en
`cierre_detail`, y **las 1.182 son de cierres `aprobado`**; cero en `solicitado`, `rechazado` o
`vencido`. La sospecha de la primera revisión —que este filtro recortaría la cobertura por debajo
del 72 %— **no se confirma**.

**⚠️ Corrección al mecanismo, verificada en el archivo real.** La explicación que acompañó a la
medición fue «ese snapshot sólo se escribe al aprobar», y **el código dice otra cosa**: el
`tx.cierreDetail.createMany` vive dentro de **`CierreDiaRepository.crearCierre`**, o sea **al
SOLICITAR** el cierre, en la misma `$transaction` que vincula las gestiones. El esquema lo
corrobora al documentar `tarifa_id`: *«NULL = la tienda no tenía tarifa vigente al **solicitar**»*.
Y la fila es **INMUTABLE** (69/R10, con guardia que prohíbe borrarla desde `lib/`), así que un
cierre rechazado **conserva** la suya.

**Por qué importa la corrección, y no es pedantería:** si el 100 % viniera de que la fila sólo nace
al aprobar, el filtro sería redundante por construcción y el primero que lo leyera lo borraría como
ruido. Como viene de un **estado contingente de los datos** —hoy no quedan cierres sin resolver con
órdenes vivas—, el filtro es **load-bearing**: es lo único que impide que `costoReal` cambie **hacia
atrás** al leer una orden mientras su cierre está solicitado, o después de que ese cierre se
rechace. Cambiar hacia atrás es exactamente el defecto que esta ficha existe para evitar.

Va escrito así junto al `where`, con el número y con la fecha. **La instrucción del humano —«que hoy
no haya diferencia no es razón para depender de ello»— se cumple, y ahora además se sostiene sola.**

### D6 — Con varias filas elegibles gana la ÚLTIMA, con desempate total — cerrada por el humano

`cierre_detail` es `@@unique([cierreId, ordenId])` con `@@index([ordenId])`, y el comentario del
esquema lo dice: *«trazar en qué cierres apareció una orden»*. Una orden `devuelta` sigue viva y
puede entrar en un segundo cierre. El criterio es **`created_at` DESC, desempate `id` DESC**, y
`take: 1`: un orden **total**, para que dos lecturas den lo mismo (R27).

El humano lo confirmó y lo ancló a un precedente del mismo día: **es el mismo criterio que la 411
acaba de fijar para su desenlace** —la ÚLTIMA, no la primera, porque una orden puede entrar,
deshacerse y volver a entrar—. Que dos fichas del mismo día elijan la misma regla para el mismo
problema no es casualidad: es la regla del repo.

La memoria sobre «dos gestiones vivas de la misma orden» dice por qué un criterio **parcial** no
basta: deja la segunda fila inalcanzable y el resultado depende del orden en que Postgres las
devuelva.

### D7 — `costoEstimado: null` cuando no hay tarifa, y NO cinco ceros (R22)

**Esto no se inventa aquí: es la decisión que el humano ya firmó el 2026-08-24** para este mismo
canal, y está escrita en la cabecera de `tests/integration/asimetria-sin-tarifa.test.ts` (274/R39):

> *Los dos bordes de API los consume un INTEGRADOR que sí controla su configuración y que toma
> decisiones de dinero con la respuesta. Ahí un `"0.00"` no es un dato faltante: es una MENTIRA
> sobre dinero servida como precio.*

Ante el mismo hueco, las cuatro superficies ya responden distinto a propósito: listado interno
`"0.00"`, cierre de día columnas NULL, carga por key **409**, cotización por key **409**. Esta
feature añade **la quinta**, y necesita un comportamiento propio porque **no puede devolver 409**:
la orden existe y hay que listarla. La respuesta es `null` — el hueco declarado, sin mentir sobre el
precio. **Ese archivo se amplía con la quinta fila y su caso** (T8); si se pone rojo, se lee su
cabecera antes de «arreglarlo».

### D8 — `costoReal` con tarifa congelada NULA sí son cinco ceros (R28)

Asimetría deliberada respecto de D7, **y las dos mitades van juntas porque es donde se ve que no es
una inconsistencia**: ahí el cero es **verdad**. `cierre_detail.tarifa_id IS NULL` significa «la
tienda no tenía tarifa vigente al solicitar» (gap 69/R9, decisión (c)) y ese cierre **liquidó cero**
por esos conceptos. `tarifaDe()` ya devuelve `null` en ese caso y `derivarIngresoOrden(input, null)`
ya responde sin conceptos.

- En `costoEstimado`, un cero **mentiría**: prometería envío gratis sobre algo que todavía no se ha
  cobrado y que sí se cobrará en cuanto haya tarifa.
- En `costoReal`, un cero **describe lo que pasó**; un `null` diría «no se sabe», que sería falso —
  sí se sabe: se liquidó cero.

Mismo hueco de datos, dos significados, dos respuestas. La regla que las une es una sola: **decir la
verdad sobre dinero**.

### D9 — El dinero cruza como STRING, nunca como `number` (R17)

`ApiOrdenRow.montoCobrar` es un `number` (`Decimal.toNumber()`, feature 106). **No se usa como
entrada del cálculo.** El bundle de costeo lleva su propio `montoCobrar: string | null`
(`Decimal.toFixed(2)`). El motivo está medido en el repo: la feature 204 midió **14 de 66** órdenes
con un céntimo de desviación por calcular sobre `number`, por dos mecanismos distintos (el medio
exacto irrepresentable en binario y un redondeo intermedio ausente). La serialización final es
`serializarMontoCotizacion(Prisma.Decimal)`, que **recibe un `Decimal` y nunca un string** a
propósito, para que no se pueda encadenar una segunda serialización.

---

## 4. Modelo de datos

**No hay cambios de esquema.** Se declara explícitamente para que nadie busque la migración.

- Tablas: ninguna nueva, ninguna alterada. RLS: ninguna política nueva.
- Columnas **leídas** y no publicadas hoy: `orden.zona_id`, `orden.cobra_comision`,
  `zona.id`, `zona.nombre`, `zona.es_central`, `distrito.zona_especial`; de `cierre_detail`:
  `monto_cobrar`, `cobra_comision`, `es_central`, `es_zona_especial`, `tienda_id`, `tarifa_id`, las
  siete columnas de tarifa congelada, `tarifa_especial`, `tarifa_especial_devuelta`,
  `tarifa_fulfillment`, `created_at`, `id`; de `cierre_dia`: `estado`.
- Columnas leídas de `tarifas`: las que ya lee `TarifaVigenteRepository.resolveTarifas`.
- Migración up/down: **no aplica**.

**De las anteriores, sólo se PUBLICAN `zona.id` y `zona.nombre`.** El resto entra en el bundle
`costeo`, que no cruza al DTO.

**Índices:** ninguno nuevo. El acceso a `cierre_detail` entra por `@@index([ordenId])` y el filtro
por estado del cierre entra por `cierre_dia.@@index([estado])`. **Si la medición de T0.3 dijera lo
contrario, se abre una ficha propia: aquí no se crea un índice a ojo.**

---

## 5. Cambios por artefacto

| Archivo | Cambio |
|---|---|
| `lib/types/api-orden.ts` | **Dos tipos nuevos**: `ApiZonaDTO` (`{ id, nombre }`) y `ApiOrdenCostoDTO` (las cinco claves string). `ApiOrdenListItemDTO` gana `zona: ApiZonaDTO`, `costoEstimado: ApiOrdenCostoDTO \| null`, `costoReal: ApiOrdenCostoDTO \| null`. `ApiOrdenDetalleDTO extends` → lo hereda gratis. |
| `lib/interfaces/repositories/IOrdenRepository.ts` | `ApiOrdenRow` gana `zona: ApiZonaDTO` (**publicable**) y `costeo: ApiOrdenCosteoRow` (**NO publicable**, con el comentario que lo dice). `ApiOrdenCosteoRow` y `ApiOrdenCongeladoRow` son tipos nuevos aquí. |
| `lib/repositories/OrdenRepository.ts` | `API_ORDEN_SELECT` pasa de constante a **función `apiOrdenSelect(ownerId)`** (§5.1); gana `zonaId`, `cobraComision`, `zona{id,nombre,esCentral}`, `distrito{zonaEspecial}` y `cierreDetalles` acotada. `ApiOrdenSelectRow` gana los tipos. `toApiOrdenRow` mapea `zona` y arma `costeo` (money-safe, D9) reutilizando `tarifaDe` de `lib/utils/cierre-detalle.ts`. |
| `lib/services/ApiOrdenLecturaService.ts` | Gana una dependencia: `Pick<ITarifaVigenteRepository, "resolveTarifas">`. `listar` resuelve los pares DISTINTOS de la página en UNA llamada y deriva los dos costos; `toListItemDTO` pasa a recibir la tarifa resuelta. `toDetalleDTO` sigue haciendo `...toListItemDTO(row)` y hereda los tres campos. |
| `lib/utils/api-orden-costo.ts` (**nuevo**) | Módulo PURO: `costoEstimadoDe` / `costoRealDe`. Llaman a `derivarIngresoOrden` con `resultado: "entregada"` y serializan con `serializarMontoCotizacion`. **Cero fórmulas propias.** |
| `app/api/ordenes/api-key/route.ts` | Sólo el **composition root**: `buildLecturaService()` construye y **pasa** el `TarifaVigenteRepository`. |
| `app/api/ordenes/api-key/orden/[id]/route.ts` | Ídem en `buildDetallePorOrdenId()`. |
| `lib/api/openapi-spec.ts` + `docs/api/api-key-openapi.yaml` | Schemas nuevos `Zona` y `OrdenCosto`; `OrdenListItem` gana las tres propiedades y sus `required`; la `description` de `mensajero` gana la cláusula de la zona del mensajero. |
| `docs/api/CHANGELOG.md` | **Una** entrada fechada para las dos partes. |
| `docs/api/manual-metricas-por-mensajero.md` | Reescribir la «Corrección del 2026-09-10» + caso de uso nuevo. |

**Los controllers no construyen DTOs y no se tocan más allá del composition root.** La cotización,
la carga, la cancelación, el borrado, la habilitación, los PDF y el **webhook** no se tocan.

### 5.1 Por qué `API_ORDEN_SELECT` pasa a ser una función

Hoy es una constante compartida, **y esa es la razón por la que existe**: el detalle hace
`...API_ORDEN_SELECT`, así que el listado y el detalle **no pueden divergir**. R33 exige acotar la
fila congelada por su `tienda_id` **congelado**, y eso es un valor de la petición.

Pasa a `apiOrdenSelect(ownerId)` y `apiOrdenDetalleSelect(ownerId)`. **La propiedad que importa se
conserva**: los dos llamadores pasan por la misma función, así que siguen sin poder divergir. La
alternativa —dejar la constante y filtrar el `tienda_id` congelado en memoria— se descarta en §10
(A6).

El `where` de la relación queda:

```ts
cierreDetalles: {
  // ⏳ 2026-09-10 (415/R26 · D5). El filtro por `aprobado` NO es redundante aunque hoy no recorte
  // ninguna fila (medido contra produccion: 1.182 de 1.182 filas son de cierres aprobados). La
  // fila se escribe al SOLICITAR el cierre (`crearCierre`), no al aprobarlo, y es INMUTABLE: un
  // cierre `solicitado` ya tiene la suya y un `rechazado` la conserva. Sin este filtro,
  // `costoReal` cambiaria HACIA ATRAS en cuanto vuelva a haber un cierre sin resolver.
  where: { tiendaId: ownerId, cierre: { estado: "aprobado" } },  // R26/R33
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],              // R27 (orden TOTAL)
  take: 1,
  select: { /* las 15 columnas congeladas del §4, ni una mas */ },
}
```

`take: 1` en una relación anidada lo aplica Prisma **por fila padre**: no hay N+1 y no depende de en
cuántos cierres apareciera la orden (R31).

---

## 6. Contratos de entrada/salida

**Entrada:** ninguna. Ni parámetro, ni header, ni cuerpo nuevos. R7/R18 exigen además que
`?zona=`, `?zona_id=`, `?costo=` y similares sigan siendo claves desconocidas ignoradas.

**Salida — un ítem del listado** (las diez claves de hoy, intactas, más las tres nuevas):

```json
{
  "numGuia": 100234, "numRemision": "REM-0001", "estado": "en_reparto",
  "destinatario": "Ana Solís", "telefonoDest": "0991234567", "producto": "Caja",
  "direccion": "Calle 1", "montoCobrar": 25900, "createdAt": "2026-09-07T15:04:00.000Z",
  "mensajero": { "id": "018f2c31-0000-4000-8000-0000000000aa", "nombre": "Carlos Jiménez Mora" },
  "zona": { "id": "018f2c31-0000-4000-8000-00000000za01", "nombre": "GAM" },
  "costoEstimado": { "flete": "2500.00", "iva": "325.00", "comision": "906.50",
                     "ivaComision": "117.85", "fulfillment": "696.00" },
  "costoReal": null
}
```

Los dos campos con nombre viajan **con la misma forma y la misma regla**: se agrupa por `id`, nunca
por `nombre` (R38). La única diferencia entre ellos es que `mensajero` puede ser `null` y `zona`
nunca lo es — y se declara.

Una orden ya cerrada, con el fulfillment congelado en el valor viejo (el caso medido: 1 de cada 6):

```json
"costoEstimado": { "flete": "2500.00", "iva": "325.00", "comision": "906.50",
                   "ivaComision": "117.85", "fulfillment": "696.00" },
"costoReal":     { "flete": "2500.00", "iva": "325.00", "comision": "906.50",
                   "ivaComision": "117.85", "fulfillment": "692.00" }
```

Una orden de una tienda sin tarifa configurada para esa zona (D7):

```json
"zona": { "id": "018f2c31-0000-4000-8000-00000000za07", "nombre": "FGAM Limón" },
"costoEstimado": null, "costoReal": null
```

Una orden cuyo cierre se aprobó SIN tarifa vigente (D8) — el cero afirmado:

```json
"costoReal": { "flete": "0.00", "iva": "0.00", "comision": "0.00",
               "ivaComision": "0.00", "fulfillment": "0.00" }
```

**Salida — detalle:** lo mismo, más el `evidencias[]` y el `gestiones[]` de siempre, sin cambios.

**Códigos de estado:** sin cambios (R36).

---

## 7. Coste de consulta — el número es FIJO y hay que MEDIRLO

Prisma resuelve **cada relación anidada con su propia consulta**. Es un hecho medido en este repo:
la 405 congeló el detalle en **9 consultas** por su nombre de tabla
(`tests/integration/db/gestiones-detalle-api-405.test.ts`, `CONSULTAS_DEL_DETALLE`) después de que
una revisión descubriera que había pasado de 6 a 9 con la suite entera en verde.

Esta ficha añade al `select` tres relaciones (`zona`, `distrito`, `cierreDetalles`) y al servicio
**una** llamada a `resolveTarifas`. Publicar `zona.id` **no añade ninguna consulta**: es una columna
más del `select` de una relación que ya hacía falta para `esCentral`. Las consecuencias previstas:

- **Detalle:** de 9 a **12** consultas + 1 de tarifas. **Previsto, no medido.** El implementer
  **mide con el mismo espía `$on("query")`** y actualiza `CONSULTAS_DEL_DETALLE` con el número y
  con el nombre de cada consulta nueva. **El número del spec no es la evidencia; el del gate sí.**
- **Listado:** `findMany` + `count` + una por relación + `resolveTarifas`. **Lo que hay que afirmar
  es la invariante, no el número:** el conteo **no depende del número de ítems de la página**, y
  tampoco de cuántas zonas distintas ni cuántos cierres tenga cada orden.

Se congela un literal de consultas también para el **listado**, igual que el detalle: es lo único
que caza que alguien resuelva una tarifa por ítem.

---

## 8. Por qué el ESTIMADO puede diferir del CONGELADO (y no es un bug)

Tres causas, todas reales y todas declaradas en el contrato:

1. **La tarifa se editó.** Es el motivo de la ficha: `tarifas` no tiene histórico. Medido:
   fulfillment 692,00 → 696,00 en **263 de 1.581** detalles.
2. **La elección de columna cambió.** `cierre_detail` congela `es_central` y `es_zona_especial`
   **porque deciden de qué columna sale el flete** (`resolverFlete`: pacto especial del distrito si
   lo hay, si no la variante GAM o la estándar según `es_central`). Las dos son **mutables en
   vivo**: un admin puede cambiar `zona.es_central` y un distrito puede pasar a
   `zona_especial = true`. El estimado usa los valores VIVOS (R20); el congelado, los de entonces.
3. **La zona de la orden cambió.** La ficha **366** metió, por primera vez, una corrección de
   `orden.zona_id` al guardar la configuración de una zona, y su promesa firmada es **«no se
   re-tarifa hacia atrás»**: no toca `cierre_detail`, ni wallets, ni pagos — hay una guardia
   dedicada (`zona-reconciliacion-no-retarifa.guardia.test.ts`). Consecuencia directa para esta
   feature: el `zona` que se publica es el **vivo**, y su `id` y su `nombre` pueden **no coincidir**
   con el `cierre_detail.zona_id` / `zona_nombre` que produjo el `costoReal`. Es deliberado y
   firmado; no se «reconcilia» aquí.

El manejo del tri-valuado de `distrito.zona_especial` (R21) es el que ya existe y **no se
reinventa**: `row.distrito?.zonaEspecial === true`. Escribir `!zonaEspecial` sería un fallo — con
`null` eso no es `false`, y lo dice el propio esquema.

---

## 9. Alcance multi-tenant: no se afloja nada

- El `where` del listado escribe `tiendaId: params.ownerId` y `deletedAt: null` **primero e
  incondicionalmente** (el comentario explica por qué: un spread posterior los pisaría). **No se
  toca.**
- El detalle sigue con `{ id, tiendaId: ownerId, deletedAt: null }` y `null` → 404 uniforme.
- La fila congelada se acota además por su **`tienda_id` CONGELADO** (R33, §5.1): ni un cambio
  posterior de dueño abre una rendija.
- `zona.id` se publica pero **no se acepta como entrada** en ningún endpoint del canal (R35): no es
  una superficie enumerable ni un selector.
- Los tests de aislamiento ya existentes (`ordenes-api-key-filtros-scope-ajeno.route.test.ts`,
  `ordenes-api-key-tienda-destino-aislamiento.route.test.ts`) **siguen verdes sin tocarlos**. Si hay
  que tocarlos, es la señal de que el alcance se movió.

---

## 10. Alternativas descartadas

**A1 — Publicar sólo `costoReal`, que es el único honesto.** Nada se reescribiría hacia atrás.
**Descartada:** el **28 %** de las órdenes vivas no tiene congelado, y una orden recién creada nunca
lo tendrá — el integrador no podría calcular margen de nada que no esté cerrado, que es justo lo que
necesita para decidir si vender.

**A2 — Publicar sólo `costoEstimado`.** Un campo, cero ambigüedad. **Descartada, y ésta es la
decisión central de la ficha:** `tarifas` se edita en sitio, así que **cada ajuste de tarifa
reescribiría hacia atrás la rentabilidad histórica del integrador sin que él pudiera saberlo**.
Medido: ya pasó con el fulfillment en 263 de 1.581 detalles.

**A3 — Un solo campo `costo` con una bandera `esDefinitivo: boolean`.** Menos claves.
**Descartada:** obliga al consumidor a ramificar por una bandera para saber si puede archivar el
valor, y el día que la bandera pase de `false` a `true` el número **cambia de significado** sin
cambiar de nombre. Dos nombres lo dicen una vez y para siempre.

**A4 — Persistir `costo_estimado` en una columna de `orden`.** Evitaría resolver la tarifa en cada
lectura. **Descartada:** es una migración + un backfill + un valor que **nace obsoleto** (el
estimado es, por definición, «con la tarifa de hoy»), y habría que reescribirlo en cada edición de
tarifa — o sea, reinventar `cierre_detail` con la semántica equivocada.

**A5 — Un endpoint nuevo `GET /api/ordenes/api-key/orden/{id}/costos`.** Aislaría el dinero.
**Descartada:** nadie lo pidió, duplica autenticación y alcance, obliga a N llamadas para medir una
página, y el integrador quiere el dato **en el mismo ítem** que ya consume.

**A6 — Dejar `API_ORDEN_SELECT` como constante y filtrar el `tienda_id` congelado en memoria.**
Menos diff. **Descartada:** con `take: 1` en el `select`, filtrar después **no** trae la siguiente
fila candidata: devolvería `costoReal: null` para una orden que sí tiene congelado del dueño actual.
Y sin `take: 1` se trae el historial entero de cierres de cada orden de la página para tirar casi
todo. El alcance se escribe en el `WHERE`, que es donde el repo ya insiste en escribirlo.

**A7 — Derivar los cinco conceptos dentro del repositorio.** Ahorraría el bundle `costeo` en la
fila. **Descartada:** el repositorio sólo ejecuta queries (`docs/architecture.md`), y meter ahí la
derivación crearía un **segundo** sitio donde se decide cuánto cuesta una orden. El patrón correcto
ya existe y se copia tal cual: `CotizacionOrdenService` resuelve los pares distintos en una consulta
y llama a la función pura.

**A8 — Publicar también el escenario DEVUELTO por orden, como hace la cotización.** Sería completo.
**Descartada:** duplica las claves publicadas para un dato que la cotización **ya sirve** y que no
depende de la orden concreta, y la ficha es un añadido mínimo. Se declara el hueco en el contrato
(R15) y se remite a la cotización.

**A9 — `zona` como cadena simple.** Era la propuesta original de este spec. **Descartada por el
humano el 2026-09-10:** ver D2. El resumen: `@unique` protege contra duplicados, no contra
renombrados; y dos entidades con nombre en el mismo payload con formas distintas obligan al
integrador a aplicar dos reglas opuestas de agrupación.

---

## 11. Riesgos y huecos declarados

1. **Clientes con validación estricta de esquema.** Un cliente generado con
   `additionalProperties: false` puede romper con tres claves nuevas. **Ya pasó con `mensajero`** y
   se avisó igual: va en el CHANGELOG, arriba del todo (R40).
2. **`costoEstimado` se mueve.** Es el punto de la ficha, pero un integrador que lo archive sin leer
   el aviso construirá una serie histórica que cambia sola. Por eso R23 obliga a decirlo **en el
   contrato**, no sólo en el CHANGELOG.
3. **`costoReal` puede moverse UNA vez más** si la orden entra en un segundo cierre aprobado (D6).
   Declarado en el contrato.
4. **El filtro por `aprobado` hoy no recorta nada** (D5). El riesgo no es que sobre: es que alguien
   lo lea como redundante y lo borre. Por eso su comentario lleva el número medido **y** el
   mecanismo real (la fila nace al solicitar), que es lo que explica por qué hace falta.
5. **Un renombrado de zona** ya no parte la serie del integrador si agrupa por `zona.id` (D2), pero
   **sí** rompe a quien agrupe por el nombre. El contrato y el manual lo dicen con la misma frase
   que ya usan para `mensajero`.
6. **El cuerpo de la respuesta crece.** Con `limit=100`, ~100 × (un objeto de zona + dos objetos de
   cinco cadenas). No afecta a ningún límite conocido, pero se mide en T0.3 por si acaso.
7. **El manual queda desactualizado en el instante del despliegue** si no se reescribe la
   «Corrección del 2026-09-10» (R40): hoy afirma justo lo contrario de lo que hará el código.

---

## 12. Tests congelados que se pondrán ROJOS a propósito

No son daños colaterales: **son contratos escritos como literal**. Antes de tocar cada uno hay que
decidir si el literal **ES** el contrato (se enmienda con fecha y motivo, siguiendo el precedente
que la 268, la 404 y la 405 ya dejaron en esos mismos archivos) o si era un polizón. **Ninguno se
relaja a `toMatchObject` ni a un aserto de longitud.**

| Test | Qué congela | Qué hay que hacer |
|---|---|---|
| `tests/unit/repositories/orden-repository.no-regresion-106.test.ts` (`SELECT_DETALLE_106`) | la proyección del detalle, `toEqual` literal | **Enmendar** con un bloque fechado 2026-09-10 (415). Es el contrato: se enmienda, nunca se sustituye por una comparación contra la constante de producción (sería tautológico). |
| `tests/unit/repositories/orden-repository.api-lectura.test.ts` (`toEqual` de la fila pública) | la fila pública COMPLETA | Gana `zona` y `costeo`, y **sigue siendo igualdad estructural**. |
| `tests/integration/db/gestiones-detalle-api-405.test.ts` (`CONSULTAS_DEL_DETALLE`) | las 9 consultas del detalle, por nombre de tabla | Pasa al número **MEDIDO**, con las nuevas nombradas una a una. |
| `tests/unit/services/api-orden-lectura-service*.test.ts` | forma del DTO (`toEqual` de objetos completos) | Ganan los tres campos. **Los valores se escriben a mano**, nunca derivados de la función bajo prueba. |
| `tests/integration/api/ordenes-api-key-listado.route.test.ts` y `...orden-consulta.route.test.ts` | respuesta de punta a punta | Ganan los tres campos y los casos nuevos. |
| `tests/unit/api/openapi-*.test.ts` | schema publicado | Ganan las propiedades y sus `required`. |
| `tests/unit/guards/mensajero-forma-unica.guardia.test.ts` | que `ApiMensajeroDTO` se declara UNA vez | **Revisar, no tocar.** `ApiZonaDTO` es un tipo DISTINTO con la misma forma; si esa guardia contara declaraciones por forma en vez de por nombre, caería en falso. Si cae, se acota su detector con su motivo escrito. |
| `tests/integration/asimetria-sin-tarifa.test.ts` | las **cuatro** superficies ante el mismo hueco | **Pasa a cinco.** Se amplía la cabecera y se añade el caso del canal de lectura → `costoEstimado: null`. **Si se pone rojo, se lee la cabecera antes de tocarlo.** |

---

## 13. Frontera con lo que NO se toca

- **El webhook** `orden.estado_actualizado` no gana ni `zona` ni costo. Su cuerpo es **firmado** y
  el orden de sus claves es load-bearing (99/R18, 404/R10); meter dinero ahí es otra decisión, con
  su propio aviso. Queda declarado fuera de alcance en `requirements.md`.
- **La cotización** sigue siendo la superficie del precio **antes** de crear la orden, con sus dos
  escenarios. Esta feature no cambia ni una de sus claves. Los dos contratos usan el **mismo
  dialecto de dinero** (D9) a propósito: el integrador no tiene que aprender dos.
- **`cierre_detail`** sólo se lee. La guardia de inmutabilidad (69/R10) sigue vigente y esta ficha
  **no** la toca.
- **`ApiMensajeroDTO` no se reutiliza para la zona**, aunque la forma sea la misma. Son dos
  conceptos distintos que hoy coinciden en estructura; fusionarlos haría que un cambio en uno
  arrastrara al otro en silencio. Lo que SÍ se comparte es la **regla publicada** (agrupá por `id`),
  y eso vive en el contrato, no en el tipo.
