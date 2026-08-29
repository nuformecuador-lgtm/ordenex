# Ficha 327 — Diseño: corregir la ubicación de una orden

> **Método.** El grafo de `codebase-memory` **no estaba en el toolset de esta sesión** (se intentó y
> las herramientas MCP disponibles no incluían `search_graph`/`trace_path`), así que **todo lo que
> este documento afirma se midió con `grep` y leyendo los archivos reales de `R:/wt327`**, y cada
> afirmación cita `archivo:línea`. Donde el encargo daba una línea concreta y la medición dio otra,
> se anota la medida.

---

## 0. Qué hay ya en disco, medido en `R:/wt327`

| Pieza | Estado real | Dónde |
| --- | --- | --- |
| `CorregirDatosClienteService` | **VIVO**. Secuencia rol → `findById` → pertenencia → ventana → diff → `corregirDatosCliente`. Depende del repo por `Pick<IOrdenRepository, "findById" \| "corregirDatosCliente">`. | `lib/services/CorregirDatosClienteService.ts:38,76` |
| `OrdenRepository.corregirDatosCliente` | **VIVO**. **UN solo `updateMany`**, sin `$transaction`, con la ventana en el `WHERE` (`estatus.value notIn`) y `deletedAt: null`. Proyecta **campo a campo** las cuatro columnas. | `lib/repositories/OrdenRepository.ts:1466-1488` |
| `CorregirDatosClienteData` | **VIVO**, cuatro claves. Su docstring dice que la ausencia de `estatusId` y `direccion` «NO ES UN DESCUIDO: ES EL MECANISMO». | `lib/interfaces/repositories/IOrdenRepository.ts:62-68` |
| `OrdenRepository.update` | **VIVO** y **NO es el camino de la corrección**. Trae el **guard latente de re-geocodificación** de la feature 91. | `lib/repositories/OrdenRepository.ts:1364-1443` |
| El **guard latente**, literal | «ESTE CODIGO NO ES ALCANZABLE HOY… el día que el CRUD gane el campo, sin este guard la orden quedaría con dirección NUEVA y coordenadas VIEJAS, en silencio». La frase que el encargo sitúa en `:1383` está medida en **`:1385`**; el bloque va de `:1380` a `:1393` y su efecto en `:1431-1436`. | `lib/repositories/OrdenRepository.ts:1380-1436` |
| `actualizarOrdenSchema` | **VIVO**, `.strict()`, **NO incluye `direccion`**. Sí incluye `peso`, `provinciaId`, `cantonId`, `distritoId`, y también `estatusId`, `tiendaId`, `zonaId`. **Cero consumidores** fuera del `.pick()` de la 312 (medido: solo `lib/types/correccion-datos-cliente.ts:3,121`). | `lib/types/orden.ts:39-53` |
| `toUpdateData` | **NO proyecta `direccion`**: por eso `update` sigue siendo incapaz de escribirla aunque el tipo la declare. | `lib/repositories/OrdenRepository.ts:1553-1569` |
| `UpdateOrdenData.direccion` | Declarado y con docstring que dice «Hoy NADIE lo informa… NO eliminar por "no usado"». | `lib/interfaces/repositories/IOrdenRepository.ts:83-91` |
| `encolarGeocodificacion(repo, tx, orden)` | **VIVO**. Patrón OUTBOX; `tx` puede ser `undefined` (caso del gate de asignabilidad). No-op si la dirección no es geocodificable. `dedupeKey = geocodificacion:<ordenId>:<hash8>` — **con hash**, «para que corregir la dirección de una orden ya geocodificada NO se descarte en silencio». Payload: **solo `{ ordenId }`**. | `lib/services/jobs/geocodificacion-encolado.ts:35,47-77` |
| `OrdenRepository` constructor | `(prisma, jobRepo = new JobRepository(prisma))`. **`jobRepo` ya está**: encolar desde `corregirDatosCliente` no cambia la firma ni ningún call-site. | `lib/repositories/OrdenRepository.ts:1090-1093` |
| De dónde sale la zona de un distrito | La columna escalar `distrito.zona_id` **fue eliminada**; la única fuente es la N:M `zona_distrito`. La regla viva: **exactamente 1 zona ⇒ esa; 0 o >1 ⇒ `null`** («no se inventa una zona»). | `db/schema.prisma:540,548-559`; `lib/repositories/OrdenRepository.ts:1631-1645` |
| Qué hace la carga con un distrito sin zona | **Error de fila**: `el distrito '<nombre>' no tiene zona asignada`. La zona de la orden se deriva del distrito y `orden.zona_id` es NOT NULL. | `lib/services/geo-resolucion.ts:121-165`; `db/schema.prisma:571` |
| `costosListadoOrden(tarifa, orden)` | **VIVO**, puro, money-safe. Devuelve `{ fleteConIva, comisionConIva, fleteOrigen }` como STRING escala 2. **No reimplementa nada**: llama a `derivarIngresoOrden(..., "entregada")`, la misma función que factura el cierre. Su docstring documenta los dos céntimos que se perdían al calcularlo en el navegador. | `lib/utils/ingreso-ordenex.ts:240-271` |
| Resolución de tarifa por par (tienda, zona) | `ITarifaVigenteRepository.resolveTarifa(tiendaId, zonaId)` — la cascada de la feature 274 (nivel 1 tienda+zona, nivel 2 tienda, nivel 3 zona; `null` si ninguno). La fila global **no es un cuarto nivel**. | `lib/interfaces/repositories/ITarifaVigenteRepository.ts:82-94` |
| Qué decide el flete | `resolverFlete(tarifa, { esCentral, esZonaEspecial })`: `esCentral` es **de la zona**, `esZonaEspecial` es **del distrito**. Los dos cambian al corregir la ubicación. | `lib/utils/ingreso-ordenex.ts:121-139` |
| `cierre_detail` | **SNAPSHOT congelado al SOLICITAR** el cierre: guarda `zona_id`, `es_central`, `es_zona_especial`, `tienda_id` y las 9 columnas de tarifa. **Sin `updated_at` ni `deleted_at`: fila inmutable.** Tiene `@@index([ordenId])`. | `db/schema.prisma:1979-2045` |
| La inmutabilidad de `cierre_detail` | **Ya está protegida por una guardia estructural**: ningún módulo de `lib/` puede emitir `update/updateMany/delete/deleteMany/upsert` sobre `cierreDetail`, y el único `createMany` vive en `CierreDiaRepository`. | `tests/unit/repositories/cierre-detail-inmutable.test.ts` |
| Relación inversa orden→cierres | `Orden.cierreDetalles CierreDetail[]`. Permite saber si la orden ya entró en un cierre **en la misma consulta** que la lee, sin round-trip ni ampliar el cliente Prisma. | `db/schema.prisma:671` |
| Catálogo geográfico ya servido y ya autorizado | `obtenerCatalogoFiltrosOrdenes` → `GeografiaFiltrosDTO` (provincias, cantones con `padreId`, distritos con `padreId`). **`adminTienda` está en la whitelist** y recibe la geografía completa. | `lib/services/FiltrosOrdenesService.ts:38-43,88-100`; `lib/types/filtros-ordenes.ts:43-49` |
| `listarArbolGeografico` | **NO sirve** para esta ficha: es `maestro`-only y colapsa la N:M con `take: 1`, que **oculta** el caso «>1 zona». | `lib/actions/geografia.ts:52-83` |
| `findById` (el que usa la 312) | Devuelve `OrdenDTO`, que **no lleva `direccion`, ni `montoCobrar`, ni `cobraComision`**. Insuficiente para esta ficha. | `lib/repositories/OrdenRepository.ts:1101-1107`; `lib/types/orden.ts:254-283` |
| `NovedadDTO` | Lleva `direccion` y `peso` (vía `MiAsignacionDTO`) pero **solo los NOMBRES** de provincia/cantón/distrito, **no los ids**. `OrdenListItemDTO` sí lleva los ids. **Las dos superficies no comparten la forma que el editor necesita.** | `lib/interfaces/services/IMisAsignacionesService.ts:15-34`; `lib/types/orden.ts:254-418` |
| `money(value: string \| null)` | El formateador único de dinero de las pantallas. Consume STRING, que es lo que emite el camino money-safe. | `lib/config/moneda.ts:245-247` |

---

## 1. Forma general — se **extiende** la 312, no se duplica

Ni un archivo nuevo en `lib/`. Todo lo del servidor entra en los módulos que la 312 ya creó:

```
lib/types/orden.ts                          ← `actualizarOrdenSchema` gana `direccion` (§8.1)
lib/types/correccion-datos-cliente.ts       ← +5 campos en el schema, +CAMPOS_UBICACION, +predicados
lib/interfaces/services/ICorregirDatosClienteService.ts  ← +2 desenlaces, +tipos del aviso
lib/services/CorregirDatosClienteService.ts ← +derivación de zona, +coherencia geo, +gate de dinero
lib/interfaces/repositories/IOrdenRepository.ts ← CorregirDatosClienteData +6, +2 lecturas
lib/repositories/OrdenRepository.ts         ← corregirDatosCliente pasa a $transaction + guard
lib/actions/corregir-datos-cliente.ts       ← la acción se amplía + nace `obtenerUbicacionOrden`
```

Y en la pantalla, **un solo archivo nuevo** (el panel del aviso), porque un modal con nueve campos y
una comparación de importes dentro de un único componente no cabe en «una sola responsabilidad»
(`docs/conventions.md`):

```
app/(app)/ordenes/_components/CorregirDatosClienteModal.tsx  ← +5 campos, +2 fases
app/(app)/ordenes/_components/CorregirUbicacionAviso.tsx     ← NUEVO: la comparación y su confirmación
app/(app)/ordenes/_components/corregir-datos-cliente-error-messages.ts ← +3 motivos
app/(app)/novedades/_components/NovedadesModule.tsx          ← pasa el catálogo geográfico al modal
app/(app)/novedades/page.tsx                                 ← carga el catálogo (ya autorizado)
```

**`ACCIONES_POR_GRUPO` no cambia.** La celda `corregirDatos` ya está en los dos grupos
(`novedad-acciones-catalogo.ts:143,146`) y sigue apuntando a la misma Server Action: es **la misma
operación con más campos**, no una operación nueva. Las dos guardias de `/novedades`
(`novedad-acciones-una-tabla`, `novedad-acciones-sin-maqueta`) siguen verdes **sin tocarlas**, y eso
es lo que confirma que esta ficha no abrió una segunda puerta.

---

## 2. Modelo de datos

### 2.1 Migraciones: **NINGUNA**

Las nueve columnas existen: `orden.direccion` (`db/schema.prisma:578`), `provincia_id`, `canton_id`,
`distrito_id`, `zona_id` (`:571-574`) y `peso` (`:576`). No hay tabla nueva, ni columna nueva, ni
enum nuevo, ni índice nuevo. **Si alguien acaba escribiendo una migración, se salió del alcance** —
la guardia de la 312 ya barre el directorio de migraciones buscando nombres de auditoría
(`corregir-datos-sin-rastro.guardia.test.ts:276-289`) y esa comprobación se mantiene.

### 2.2 RLS

No se crea ni se altera ninguna tabla: no hay política que escribir. La única puerta es la
autorización del servicio (§3), y por eso R28 la revalida en cada petición.

### 2.3 Lo que se escribe, exactamente

| Tabla | Operación | Columnas |
| --- | --- | --- |
| `orden` | `updateMany` (1 fila como mucho) | solo las corregidas de entre `destinatario`, `telefono_dest`, `producto`, `notas`, `direccion`, `provincia_id`, `canton_id`, `distrito_id`, `peso` — **más `zona_id`, que la deriva el servidor** (+ `updated_at` por Prisma) |
| `jobs` | **1 `INSERT`**, y **solo si la dirección cambió** (R19) | vía `encolarGeocodificacion`; payload `{ ordenId }` y nada más |
| `orden_historial_estado` | **nada** (R25) | — |
| `orden_nota` | **nada** (R25) | — |
| `cierre_detail`, wallets | **nada** (R17) | — |
| `chat_conversacion` | **nada** (312/R19 sigue vigente) | — |
| `orden.latitud/longitud/geocoded_at/geocode_*` | **nada** (R22) | las escribe el trabajo, no esta ficha |

---

## 3. De dónde sale la zona que corresponde a un distrito

**De la N:M `zona_distrito`, y solo si resuelve EXACTAMENTE una.** No es una elección de esta ficha:
es la regla que ya está escrita y viva en `OrdenRepository.findDistritosByCantonIds:1631-1645` —
«Un distrito con EXACTAMENTE una zona resuelve `orden.zona_id`; con 0 zonas → sin zona asignada
(error de fila); con >1 → ambiguo/no derivable → `null` (mismo trato seguro: no se inventa una
zona)». La carga masiva la aplica en `geo-resolucion.ts:148` y **rechaza la fila**.

Esta ficha hace lo mismo (R7): si el distrito elegido no resuelve una zona única, **se rechaza la
corrección nombrando el motivo**. No hay alternativa: `orden.zona_id` es NOT NULL y elegir una de
varias sería inventar la tarifa.

**La regla se extrae a UNA función y las dos lecturas la comparten.** Hoy el colapso vive dentro del
`.map()` de `findDistritosByCantonIds`. Se saca a un helper privado del repositorio
(`zonaUnicaDeDistrito(zonas)`), que usan esa lectura y la nueva de §4.2. Dos copias del colapso
serían dos reglas que un día divergen — exactamente el motivo por el que existe
`lib/services/geo-resolucion.ts` (su cabecera lo dice: duplicar `resolveGeo` habría dado dos dueños a
los mismos tres mensajes).

**`esCentral` y `esZonaEspecial` viajan con la zona resuelta**, y no se confunden: `esCentral` es de
la **zona** (elige columna GAM del flete) y `esZonaEspecial` es del **distrito** (elige el pacto
especial). Lo dice `DistritoRow` (`IOrdenRepository.ts:536-550`) y lo consume `resolverFlete`.
Consecuencia que hay que tener escrita: **cambiar de distrito dentro de la MISMA zona también puede
mover el flete**, si la marca `zona_especial` de los dos distritos difiere. Por eso el gate de §4.3
se dispara con **el cambio de distrito**, no con el cambio de zona.

---

## 4. El aviso del importe — el centro de esta ficha

### 4.1 La decisión de forma: **el aviso lo emite el servidor al intentar guardar**

No hay una tercera Server Action de «previsualización». El flujo es:

```
[Guardar cambios]  ──►  corregirDatosCliente({ …, confirmaCambioDeUbicacion: false })
                        │
                        └─► el distrito cambia y no viene confirmación
                            ⇒ NO escribe nada
                            ⇒ responde { status: "confirmacion_requerida", actual, propuesta, enAlgunCierre }
                                          │
[el modal pinta la comparación]  ◄────────┘
[Confirmar el cambio]  ──►  corregirDatosCliente({ …, confirmaCambioDeUbicacion: true })  ⇒ escribe
```

**Por qué así y no con una acción de preview que la pantalla llama al elegir el distrito.** Porque
esta forma hace que **sea imposible guardar sin que el servidor haya enseñado los importes**: el
gate y el aviso son la misma respuesta, del mismo servidor, en la misma petición. Una preview
separada sería un adorno de pantalla que un cliente hecho a mano se salta, y volvería a dejar el
dinero cambiando en silencio — que es literalmente lo que D5 viene a impedir. Además evita la
carrera «vi un importe, guardé otro»: los números que el modal enseña son los de **la misma llamada
que se acaba de rechazar**.

El nombre de la clave es `confirmaCambioDeUbicacion` y no `…DeZona` **a propósito**: el gate se
dispara por el cambio de **distrito** (§3, el caso de la marca especial dentro de la misma zona).

### 4.2 De dónde salen los importes, sin duplicar la lógica de tarifas

Se **llama** a lo que ya existe, en este orden y en el servidor:

1. `resolveTarifa(orden.tiendaId, zonaId)` → la cascada (tienda, zona) de la feature 274.
   `ITarifaVigenteRepository.ts:94`.
2. `costosListadoOrden(tarifa, { esCentral, esZonaEspecial, montoCobrar, cobraComision })`
   → `{ fleteConIva, comisionConIva, fleteOrigen }`. `ingreso-ordenex.ts:257`.

**Ni una línea de aritmética nueva.** `costosListadoOrden` no reimplementa la fórmula: delega en
`derivarIngresoOrden(..., resultado: "entregada")`, que es **la misma función que factura el cierre**
(su docstring: «Si un día cambia la fórmula del cierre, el listado cambia con ella; no pueden
divergir por construcción»). Y `montoCobrar` viaja como **STRING**, nunca `number`: es la lección
medida de la feature 204 (14 de 66 órdenes con un céntimo de desviación al multiplicar en el
navegador). R12.

Se calcula **dos veces**: con la ubicación **actual** de la orden y con la **propuesta**. Enseñar
solo el importe nuevo obligaría a quien mira a recordar el viejo.

### 4.3 Cuándo se dispara el gate

`distritoId` propuesto ≠ `distritoId` almacenado ⇒ **gate**. Fail-closed y sin excepciones:

- si la zona resultante es la misma pero la marca especial cambia, el flete puede moverse (§3);
- si nada se mueve, el aviso lo dice y el humano confirma en un clic. Un aviso de más cuesta un
  clic; un aviso de menos cuesta dinero sin rastro.

Corregir **solo la dirección**, **solo el peso**, o cualquiera de los cuatro campos de la 312, **no**
dispara el gate: ninguno de ellos entra en `derivarIngresoOrden` (medido: `peso` no aparece en
`lib/utils/ingreso-ordenex.ts`; su único uso fuera del dominio de la orden es
`lib/utils/whatsapp-envio-valores.ts`).

### 4.4 La tarifa de la zona nueva no existe

`resolveTarifa` devuelve `null` y `costosListadoOrden` devuelve `"0.00"`/`"0.00"`. **Enseñar eso como
un importe sería mentir**: no significa «gratis», significa «nadie configuró la tarifa de ese par».
Por eso el contrato del aviso lleva un discriminante propio:

```ts
tarifa: "resuelta" | "sin_tarifa"
```

Con `"sin_tarifa"` la pantalla **no pinta `₡0`**: pinta «sin tarifa configurada para esa zona»
(R13). Y **no bloquea**: es la regla ya firmada de la feature 274 (un par sin tarifa no bloquea, se
muestra el hueco). La contrapartida está escrita como pregunta abierta P1 en `requirements.md`,
porque es una decisión de negocio, no técnica.

El tercer caso, `fleteOrigen: "especial_sin_pacto"`, también se enseña (R14): el importe es idéntico
al de una orden corriente, así que sin señalarlo no hay forma de distinguir «cobra la normal porque
le toca» de «cobra la normal porque falta configurar el pacto» — que es exactamente para lo que
`OrigenFlete` existe (`lib/types/orden.ts:338-348`).

---

## 5. Qué pasa si la orden ya entró en un cierre

**Medido, en tres piezas:**

1. `cierre_detail` congela `zona_id`, `es_central`, `es_zona_especial`, `tienda_id`, `monto_cobrar`,
   `cobra_comision` y las nueve columnas de tarifa **en el momento de SOLICITAR el cierre**
   (`db/schema.prisma:1984-2014`; el snapshot se puebla en la `$transaction` de `crearCierre`).
2. La fila **es inmutable**, y no de palabra: hay una guardia estructural que prohíbe cualquier
   `update/delete/upsert` sobre `cierreDetail` en todo `lib/`
   (`tests/unit/repositories/cierre-detail-inmutable.test.ts`).
3. Esta ficha escribe en `orden` y en `jobs`, y en nada más (§2.3).

**Conclusión: lo ya facturado NO cambia, y no porque esta ficha se acuerde de no tocarlo, sino
porque la única escritura posible sobre el snapshot ya está prohibida por una guardia que esta ficha
mantiene verde sin tocarla** (R17).

**Lo que sí cambia es el futuro.** La orden que sigue viva —típicamente `devuelta`, `reprogramada`,
`ayuda_tienda` o `por_devolver`: los estados terminales y `rechazada` están fuera de la ventana de
D4— se volverá a intentar, y **esa próxima gestión se facturará con la zona nueva**. Por eso:

- **No se bloquea.** Bloquear dejaría la ubicación **equivocada** para siempre justo en la orden que
  va a re-intentarse, que es el caso que esta ficha existe para arreglar.
- **Se avisa.** Si la orden tiene al menos una fila en `cierre_detail`, el aviso de §4 añade una
  línea: *«esta orden ya entró en un cierre; lo que se facturó allí no cambia, y el importe nuevo
  rige a partir de ahora»* (R16).
- **El dato sale gratis**: `Orden.cierreDetalles` con `take: 1` en la misma consulta que ya lee la
  orden (`db/schema.prisma:671`), y `cierre_detail` tiene `@@index([ordenId])` (`:2043`), que existe
  precisamente para «trazar en qué cierres apareció una orden». Ni round-trip extra, ni Seq Scan.

---

## 6. Lo que la corrección NO puede escribir, y por qué sigue siendo imposible

El encargo lo señala y tiene razón: `CorregirDatosClienteData` **era** el mecanismo por el que
`estatusId` y `direccion` no eran representables (`IOrdenRepository.ts:52-60`). Esta ficha **abre
una de las dos puertas y deja la otra cerrada con llave**. Cómo se sostiene:

1. **El tipo sigue siendo la defensa.** `CorregirDatosClienteData` gana exactamente seis claves
   —`direccion`, `provinciaId`, `cantonId`, `distritoId`, `zonaId`, `peso`— y **ninguna más**.
   `estatusId`, `tiendaId`, `montoCobrar`, `cobraComision`, `numGuia`, `numRemision` y
   `mensajeroAsignadoId` **siguen sin ser representables**, así que el camino sigue siendo
   estructuralmente incapaz de disparar el `appendCambioEstado` de `update` (R24).
2. **El `data` se sigue proyectando clave a clave** en el repositorio (`:1480-1485`), nunca con
   `...data`: lo que llega a Prisma es exactamente la lista de arriba aunque el llamador ensanche el
   objeto en tiempo de ejecución.
3. **La guardia de la 312 se actualiza, no se relaja.** `corregir-datos-sin-rastro.guardia.test.ts`
   comprueba hoy (`:258-274`) que el bloque del tipo **no contiene** `direccion`, `estatusId`,
   `tiendaId` ni `montoCobrar`. Esta ficha **quita únicamente la cláusula de `direccion`** y
   **añade** `cobraComision`, `numGuia`, `numRemision` y `mensajeroAsignadoId` a la lista prohibida.
   Es decir: el archivo que hoy documenta la exclusión pasa a documentar **una exclusión más
   estrecha y explícitamente enumerada**, y sigue poniéndose rojo si alguien mete `estatusId`.
4. **`zonaId` está en el tipo del repositorio pero NO en el schema del borde.** Es la distinción que
   entrega R5: el cliente **no puede** mandar la zona (`.strict()` la rechaza, y el test que ya
   existe para eso —`correccion-datos-cliente-schema.test.ts:27`— **se conserva tal cual**); la
   escribe el servidor tras derivarla del distrito.

---

## 7. Re-geocodificación: el guard latente y el camino real

### 7.1 El camino real hoy no pasa por `update`

`OrdenRepository.update` lleva el guard de la feature 91 (`:1380-1436`), escrito **exactamente para
este día**. Pero la 312 **no usa `update`**: usa su hermano `corregirDatosCliente` (`:1466`), que es
un `updateMany` suelto. Medido: los consumidores vivos de `update` son
`DevolucionOrigenService` y `EnvioDevolucionCentralService`, y ninguno informa `direccion`; y
`toUpdateData` (`:1553`) **no proyecta** `direccion`, así que `update` sigue siendo incapaz de
escribirla aunque su tipo la declare.

**Por tanto: añadir `direccion` al schema NO activa el guard.** Darlo por hecho habría producido
exactamente el bug que el comentario de la 91 describe — dirección nueva, coordenadas viejas, en
silencio.

### 7.2 La decisión: **una sola implementación del guard, usada por los dos métodos**

El guard se extrae del cuerpo de `update` a un método privado del repositorio:

```ts
private async encolarSiCambiaDireccion(
  tx: JobTxClient,
  id: string,
  direccionNueva: string | null | undefined,
): Promise<void>
```

que hace lo que hoy hacen las dos mitades del guard (`:1397-1404` la pre-lectura condicional y
`:1431-1436` el encolado condicional), y **lo llaman los dos**: `update` (que deja de tener el
código inline) y `corregirDatosCliente`. Una copia y no dos, por el mismo motivo que §3.

`corregirDatosCliente` pasa de una sentencia suelta a `$transaction`:

1. pre-lectura **condicional** de `direccion` (solo si `data.direccion !== undefined`), para no
   añadir una consulta a cada corrección que no toca la dirección;
2. el `updateMany` **con el mismo `WHERE` de siempre** (id + `deletedAt: null` + ventana de estado);
3. `count === 0` ⇒ `"conflict"`, **y se devuelve sin encolar nada** — no hubo escritura, no hay nada
   que geocodificar (R21);
4. `count === 1` ⇒ `encolarSiCambiaDireccion(tx, …)` dentro de la misma transacción (outbox, R21).

> **La 312 presumía de no tener `$transaction`** (su `design.md` §7). Esta ficha la reintroduce, y
> hay que decir por qué: el encolado del job **tiene** que compartir transacción con la escritura, o
> se rompe el invariante OUTBOX de la feature 91/R7 —«si la transacción del writer revierte, el job
> desaparece con ella: no hay ventana con una orden sin job, ni un job sin su orden»—. **El
> constructor no cambia**: `jobRepo` ya está inyectado con default desde la 91 (`:1090-1093`).

### 7.3 Lo que NO se hace

- **No se limpian las coordenadas** (R22). Ponerlas a `null` al corregir dejaría a la orden fuera de
  las puertas que exigen coordenadas (asignación de guía, ruteo a satélite) hasta que corriera el
  trabajo, es decir, **la corrección de un dato bloquearía la operación**. El diseño de la 91 es que
  el trabajo las sustituya; esta ficha lo respeta. La ventana de coordenadas viejas queda anotada
  como pregunta abierta P3.
- **No se toca la clave de idempotencia.** `dedupeKeyGeocodificacion` ya lleva el hash de la
  dirección precisamente para que **corregir una dirección ya geocodificada encole un job nuevo** en
  vez de chocar con la fila `done` del primero y descartarse en silencio
  (`geocodificacion-encolado.ts:22-34`). Hay un test que lo cubre desde la 91
  (`tests/integration/repositories/orden-geocode-enqueue.test.ts:291`).

### 7.4 Y se comprueba que se activa **de verdad**

No basta con que el código exista: el guard de la 91 lleva desde entonces sin ejecutarse nunca. R19,
R20, R21 y R23 se prueban **contra Postgres**, sobre el camino vivo (`corregirDatosCliente`), y cada
caso **se mata con una mutación** antes de creerlo (tareas B4 de `tasks.md`).

---

## 8. Los comentarios que quedarían mintiendo, y las pruebas que se ponen rojas

Esta sección existe porque nada de lo de abajo rompe el build: son verdades escritas que dejan de
serlo en silencio, que es «LA familia» de fallos de este repo.

### 8.1 `actualizarOrdenSchema` gana `direccion`

`lib/types/orden.ts:39` pasa a declarar `direccion: z.string().min(1).optional()`. **Se amplía el
schema en vez de hacer un `.extend()` local** por la misma razón por la que la 312 derivó de él: un
solo sitio donde vive la regla de cada campo de la orden. Riesgo real medido y descartado: ese
schema **no tiene ningún otro consumidor** (`OrdenService.actualizar` y su Server Action se borraron
el 2026-08-07), así que ampliarlo no cambia el comportamiento de ninguna ruta viva.

**Consecuencia obligatoria:** el comentario de `OrdenRepository.ts:1384-1388` —«la ruta de edición es
estructuralmente incapaz de cambiar una dirección: `actualizarOrdenSchema` es `.strict()` y no
incluye `direccion`, y `toUpdateData()` tampoco la proyecta»— **queda medio falso**. La segunda mitad
sigue siendo cierta; la primera, no. Se reescribe para que diga la verdad de hoy:

- `update` **sigue** sin poder escribir la dirección, porque `toUpdateData` no la proyecta y ningún
  consumidor vivo la informa;
- el writer que **sí** la escribe es `corregirDatosCliente`, y **comparte el guard** con él (§7.2).

Lo mismo con el docstring de `UpdateOrdenData.direccion`
(`IOrdenRepository.ts:83-91`), que hoy afirma «Hoy NADIE lo informa».

### 8.2 Las pruebas de la 312 que esta ficha pone rojas (y que hay que actualizar, no borrar)

| Prueba | Qué afirma hoy | Qué pasa a afirmar |
| --- | --- | --- |
| `tests/unit/types/correccion-datos-cliente-schema.test.ts:25-41` | `direccion`, `peso` y `zonaId` son claves **fuera** del alcance | `direccion` y `peso` pasan a la lista de **aceptadas**; **`zonaId` se queda rechazado** (R5) y se le suman `montoCobrar`, `cobraComision`, `numGuia`, `numRemision`, `mensajeroAsignadoId` |
| `tests/unit/guards/corregir-datos-sin-rastro.guardia.test.ts:258-274` | el tipo de escritura **no contiene** `direccion` | se quita **solo** esa cláusula; se añaden las cuatro nuevas prohibidas (§6.3) |
| `tests/unit/guards/corregir-datos-sin-rastro.guardia.test.ts:56-68` | censo de módulos de la ficha | **+`CorregirUbicacionAviso.tsx`**; un censo que no crece con la ficha vigila código donde ya no está el riesgo |
| `tests/integration/db/corregir-datos-cliente.repo.test.ts` (caso 5) | cambian **solo** las 4 columnas + `updated_at` | pasa a ser: cambian **solo** las columnas efectivamente corregidas + `zona_id` + `updated_at` |
| `tests/unit/repositories/cierre-detail-inmutable.test.ts` | `cierreDetail` es inmutable | **no se toca**, y seguir verde ES la prueba de R17 |
| `novedad-acciones-una-tabla` / `novedad-acciones-sin-maqueta` | la celda declarada tiene su acción real | **no se tocan**, y seguir verdes es lo que confirma que no se abrió una acción nueva |

> **Trampa anotada.** La guardia de la 312 barre los «textos de rechazo» buscando PII, y su regex
> incluye la palabra `direccion` (`:94`). Un mensaje nuevo escrito como
> `mensaje: "no se pudo guardar la direccion"` **la pondría roja**. Los motivos de esta ficha hablan
> del **distrito y de la zona**, nunca del valor de la dirección — que además es exactamente lo que
> R26 quiere.

---

## 9. Contratos de entrada/salida

### 9.1 El schema del borde (`lib/types/correccion-datos-cliente.ts`)

```ts
/** D1 — los NUEVE campos que el humano puede mandar. `zonaId` NO está: la deriva el servidor (R5). */
export const CAMPOS_CORREGIBLES = [
  "destinatario", "telefonoDest", "producto", "notas",          // 312
  "direccion", "provinciaId", "cantonId", "distritoId", "peso", // 327
] as const;

/** Los tres que viajan JUNTOS o no viajan (R3). */
export const CAMPOS_GEOGRAFIA = ["provinciaId", "cantonId", "distritoId"] as const;

export const corregirDatosClienteSchema = actualizarOrdenSchema
  .pick({ destinatario: true, telefonoDest: true, producto: true, notas: true,
          direccion: true, provinciaId: true, cantonId: true, distritoId: true, peso: true })
  .strict()                                                  // R2
  .extend({
    ordenId: z.uuid(),
    // §4.1 — el gate del dinero. `false` por defecto: la ausencia NO confirma nada.
    confirmaCambioDeUbicacion: z.boolean().optional().default(false),
  })
  .refine(alMenosUnCampo, { path: ["destinatario"] })         // R3 de la 312 (no cuenta la confirmación)
  .refine(geografiaCompletaOAusente, { path: ["distritoId"] })// R3
  .refine((d) => d.distritoId !== null, { path: ["distritoId"] }); // R4
```

- `distritoId` viene del origen como `.nullable()`; el tercer `refine` **quita el `null`**, porque la
  zona se deriva del distrito y `orden.zona_id` es NOT NULL (R4).
- `direccion` hereda `min(1)` del campo nuevo de §8.1 ⇒ R8 sin escribir una regla propia.
- `peso` hereda `z.number().positive()` ⇒ R9.
- **Ningún `.max()` en ningún campo**: R6 de la 312 sigue vigente y por la misma vía (herencia).

### 9.2 Desenlaces del servicio

```ts
export type CorregirDatosClienteServiceResult =
  | { status: "ok"; cambios: readonly CampoCorregible[] }        // 312/R4
  | { status: "forbidden" }                                      // R30
  | { status: "conflict" }                                       // R29
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R6, R7, R8, R9, 312/R18
  // 327 — EL GATE DEL DINERO (R11). No es un error: es el aviso, con sus cifras.
  | { status: "confirmacion_requerida"; aviso: AvisoCambioUbicacion };

export interface AvisoCambioUbicacion {
  actual: UbicacionConCostos;
  propuesta: UbicacionConCostos;
  /** R16 — la orden ya tiene al menos una fila congelada en un cierre. */
  yaEnUnCierre: boolean;
}

export interface UbicacionConCostos {
  zonaId: string;
  zonaNombre: string;
  distritoNombre: string | null;
  esCentral: boolean;        // de la ZONA
  esZonaEspecial: boolean;   // del DISTRITO
  /** R13 — «sin tarifa» NO es «cero». La pantalla ramifica por esto, no por el importe. */
  tarifa: "resuelta" | "sin_tarifa";
  fleteConIva: string;       // STRING escala 2, money-safe
  comisionConIva: string;    // STRING escala 2, money-safe
  fleteOrigen: OrigenFlete;  // R14 — `especial_sin_pacto` se señala
}
```

`geografia_incoherente` (R6) y `zona_no_resoluble` (R7) **no** son estados propios: son
`validation_error` con `fieldErrors.distritoId`, que es la forma que la familia ya usa y que el modal
ya sabe pintar junto al campo. Un estado nuevo por cada motivo de rechazo es superficie sin ganancia.

### 9.3 La lectura de precarga (R31)

```ts
// lib/actions/corregir-datos-cliente.ts — MISMO archivo, para no crecer el censo de la guardia.
export async function obtenerUbicacionOrden(input: unknown): Promise<ObtenerUbicacionOrdenResult>;

export type ObtenerUbicacionOrdenResult =
  | { status: "ok"; orden: OrdenParaCorreccionDTO }
  | { status: "forbidden" }        // R18/R30: misma puerta que la escritura, resultado opaco
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };
```

`OrdenParaCorreccionDTO` lleva los nueve valores actuales + los **nombres** de zona/provincia/
cantón/distrito + `numGuia` + `yaEnUnCierre`, y **nada de dinero de la orden** (`montoCobrar` no
viaja: no se edita aquí y no hace falta para pintar).

**Por qué una lectura y no ampliar los DTO.** Medido en §0: `/ordenes` tiene los ids pero
`/novedades` **solo tiene los nombres** (`MiAsignacionDTO:31-34`), y ese DTO lo comparte el portal
del mensajero. Ampliarlo obligaría a emitir tres ids en dos listas donde nadie los lee. Una lectura
bajo demanda, al abrir el modal, sirve **igual** a las dos superficies, no ensancha ningún contrato
y de paso resuelve `yaEnUnCierre` en la misma consulta.

### 9.4 Las dos lecturas nuevas del repositorio

```ts
findParaCorreccion(ordenId: string): Promise<OrdenParaCorreccionRow | null>;
findDistritoParaCorreccion(distritoId: string): Promise<DistritoResueltoRow | null>;
```

- La primera sustituye al `findById` que usa hoy el servicio: `OrdenDTO` **no lleva `direccion`, ni
  `montoCobrar`, ni `cobraComision`** (§0), que son entradas de §4.2. Conserva `deletedAt: null` en
  el `WHERE`, que es lo que da R30 gratis (borrada e inexistente devuelven `null` igual).
  `montoCobrar` sale como **STRING escala 2**, nunca `number`.
- La segunda devuelve `{ id, nombre, cantonId, provinciaId, zonaId, zonaNombre, esCentral,
  esZonaEspecial }` con el colapso de §3. `provinciaId` viene por la relación `canton.provinciaId`,
  para poder comprobar la cadena de R6 **en una sola consulta**.

`OrdenPrismaClient` ya incluye `orden`, `distrito`, `canton`, `provincia`, `zona` y `tarifa`
(`OrdenRepository.ts:330-348`): **no hay que ampliarlo**, y `cierre_detail` se lee por la relación
inversa `Orden.cierreDetalles`.

### 9.5 Dependencias del servicio

```ts
type CorregirDatosClienteRepo = Pick<IOrdenRepository,
  "findParaCorreccion" | "findDistritoParaCorreccion" | "corregirDatosCliente">;
type CorregirDatosClienteTarifas = Pick<ITarifaVigenteRepository, "resolveTarifa">;
```

Por `Pick` de la interfaz, como `EliminarOrdenService` y como la 312. **El composition root
(`buildService()` en la acción) tiene que PASAR de verdad el repositorio de tarifas**, no solo
importarlo: un servicio que recibe `undefined` compila igual y muere en producción.

---

## 10. Las superficies

### 10.1 El modal, en dos fases

`CorregirDatosClienteModal` conserva sus cuatro campos y su comportamiento, y gana:

1. **Al abrir**, llama a `obtenerUbicacionOrden` y precarga los nueve campos (R31). Mientras carga,
   los controles de ubicación van deshabilitados; si falla, el modal sigue permitiendo corregir los
   cuatro de la 312 y dice que la ubicación no se pudo cargar (**degradación, no pantalla muerta**).
2. **Tres selectores encadenados** provincia → cantón → distrito, alimentados por
   `GeografiaFiltrosDTO` (§0: ya servido y ya autorizado para los tres roles). El encadenamiento se
   hace con `padreId`, que es para lo que ese DTO existe. `components/ui/select.tsx` ya está en el
   repo; no se crea ningún componente de formulario nuevo.
3. **Un campo de dirección** (`Input`, sin `maxLength`) y **uno de peso** (numérico, `> 0`).
4. **`CorregirUbicacionAviso`** (archivo nuevo): se monta **solo** cuando el servidor responde
   `confirmacion_requerida`, y pinta la comparación —zona actual vs. zona nueva, flete + IVA y
   comisión + IVA de cada una con `money()`, la línea de `especial_sin_pacto` si aplica, el texto de
   «sin tarifa configurada» en vez de `₡0`, y el aviso de R16— más el botón **Confirmar el cambio**,
   que reenvía con `confirmaCambioDeUbicacion: true`. **El botón de guardar normal no puede
   saltárselo**: el servidor lo rechaza igual (R28).
5. **El aviso de la etiqueta** (312/R27) pasa a nombrar también la dirección (R36): el papel pegado
   al paquete lleva la dirección impresa, y esa es justamente la que se está corrigiendo.
6. **Vocabulario**: nada de «SLA». Los textos hablan de zona, tarifa, flete e importe.

### 10.2 `/novedades`

`ACCIONES_POR_GRUPO` **no cambia** (§1). Lo único que hace falta es que `NovedadesModule` reciba el
catálogo geográfico y se lo pase al modal; la página lo pide con `obtenerCatalogoFiltrosOrdenes`,
que ya autoriza a `adminTienda` (`FiltrosOrdenesService.ts:38-43`). Es **una llamada más en un
Server Component**, del mismo tipo que la que `/ordenes` ya hace.

### 10.3 Lo que la pantalla no decide

El disparador sigue usando `estadoAdmiteCorreccion` (fallo cerrado, 312/R24) y la prop de rol; la
ficha **no toca** esa lógica (R27). Y la pantalla **no calcula ni un importe**: los pinta.

---

## 11. Alternativas descartadas

**A — Enrutar la corrección por `OrdenRepository.update` para «activar» el guard latente.**
Es la lectura más obvia del comentario de la 91, y se descarta por tres motivos medidos:
1. `update` **no tiene sitio para la ventana de estado**: su `WHERE` es `{ id, deletedAt: null }`
   (`:1407`). Meter el `notIn` ahí cambiaría el comportamiento de sus dos consumidores vivos, que sí
   transicionan estados. Y sin ventana en el `WHERE` se pierde el mecanismo de R29 («la propiedad se
   comprueba en el MISMO statement que muta»).
2. `UpdateOrdenData` **sí puede expresar `estatusId`, `tiendaId` y `zonaId`**, así que R24 pasaría de
   «no representable» a «que el llamador se acuerde». Eso es exactamente la garantía que el encargo
   pide conservar.
3. `update` exige `HistorialContexto` y devuelve `OrdenDTO`: dos cosas que esta corrección no tiene
   ni necesita.
   *Lo que sí se toma de `update` es el guard*, extraído a un método compartido (§7.2), que da la
   re-geocodificación **sin** ninguno de los tres costes.

**B — Duplicar el guard de re-geocodificación dentro de `corregirDatosCliente`.**
Descartada: dos copias de la condición «vino informada Y difiere de la almacenada» es la forma
silenciosa de que un día una de las dos deje de encolar. Es el mismo argumento con el que
`geo-resolucion.ts` existe («duplicar `resolveGeo` habría dado dos dueños a los tres mensajes»).

**C — Encolar la geocodificación FUERA de la transacción (`tx: undefined`).**
`encolarGeocodificacion` lo admite (`:53`), así que era gratis. Descartada porque rompe el OUTBOX de
la 91/R7 en las dos direcciones: un job que sobrevive a una escritura revertida (geocodifica una
dirección que no se guardó) o una escritura sin job (dirección nueva, coordenadas viejas, **en
silencio**) — que es literalmente el bug que el guard existe para impedir.

**D — Una Server Action de «previsualización» que la pantalla llama al elegir el distrito.**
Descartada: §4.1. Sería un adorno de pantalla que un cliente hecho a mano se salta, y dejaría el gate
del dinero en el navegador. Con `confirmacion_requerida` el aviso y el gate son **la misma respuesta
del mismo servidor**, y además no puede haber desfase entre el importe que se enseñó y el que se
guardó. Coste aceptado: guardar un cambio de distrito son **dos clics**, no uno.

**E — Que el cliente devuelva los importes que vio, como testigo de concurrencia.**
Descartada por sobre-ingeniería: obligaría a comparar dinero venido del navegador en el camino que
decide dinero, que es justo lo que la 204 dejó de hacer. Riesgo residual declarado: si alguien edita
la tarifa **entre** el aviso y la confirmación, se guardará con la tarifa nueva y el humano habrá
visto la vieja. La ventana son segundos y el efecto es un importe distinto del mostrado, no una
escritura equivocada.

**F — Recalcular la zona sin avisar (lo que haría un CRUD normal).**
Descartada por D5, y con el argumento escrito: la zona decide la tarifa, así que corregir una
ubicación **mueve el flete y la comisión que se facturan**. Sin aviso sería dinero cambiando en
silencio — y encima sin rastro, porque D3 no lo deja. La combinación «cambia dinero» + «no queda
registro» es la que obliga al aviso; con rastro, bastaría con poder auditarlo después.

**G — Bloquear la corrección si la orden ya entró en un cierre.**
Descartada: §5. Lo ya facturado no se puede tocar (guardia existente) y lo que queda vivo dentro de
un cierre es precisamente la orden que se va a re-intentar: bloquear la condenaría a re-intentarse
con la ubicación equivocada.

**H — Bloquear cuando la zona nueva no tiene tarifa.**
Descartada por coherencia con la feature 274/R20 (un par sin tarifa no bloquea; se muestra el hueco).
Se avisa con un discriminante propio para que no se lea como «₡0» (§4.4). Queda como pregunta
abierta P1, porque es decisión de negocio.

**I — Añadir los tres ids de geografía a `NovedadDTO` para precargar el modal.**
Descartada: §9.3. Ese DTO extiende `MiAsignacionDTO`, que comparte el portal del mensajero;
ampliarlo obligaría a emitir tres campos en dos listas donde nadie los lee. Una lectura bajo demanda
sirve a las dos superficies y además trae `yaEnUnCierre` gratis.

**J — Un servicio nuevo (`CorregirUbicacionOrdenService`) en vez de ampliar el de la 312.**
Descartada: duplicaría la secuencia de autorización (rol → pertenencia → ventana), que es la parte
que **no puede** divergir entre las dos mitades de la misma acción, y obligaría a un segundo modal o
a que uno solo hablara con dos servicios. El encargo lo dice: esta ficha **extiende**.

---

## 12. Verificación (resumen; el desglose está en `tasks.md`)

- **Módulo puro**: el schema acepta los nueve y rechaza los ocho de D2, con `zonaId` **entre los
  rechazados**; la geografía viaja completa o no viaja; `distritoId: null` es error.
- **Repositorio contra Postgres**: el `WHERE` de la ventana sigue recortando; cambian **solo** las
  columnas corregidas + `zona_id` + `updated_at`; **cero** filas nuevas en `orden_historial_estado`,
  `orden_nota` y `cierre_detail`; **una** fila nueva en `jobs` si y solo si la dirección cambió, con
  el `dedupeKey` con hash y sin la dirección en el payload; `latitud`/`longitud`/`geocoded_at` **sin
  tocar**. Cada caso **matado con una mutación** antes de creerlo (memoria del repo: un test de
  integración verde sin datos reporta `passed` sin comprobar nada).
- **Servicio con dobles**: derivación de zona (1 zona / 0 zonas / 2 zonas), cadena geográfica
  incoherente, gate de confirmación (con y sin), aviso con tarifa y sin tarifa, `especial_sin_pacto`,
  `yaEnUnCierre`, y que **la decisión se toma con el actor, nunca con el input**.
- **Dinero, sin dobles de la fórmula**: el test del aviso compara contra `costosListadoOrden` llamada
  con los mismos insumos… **no**: eso sería una aserción contra su propia fuente. Se compara contra
  **valores literales calculados a mano** a partir de una tarifa sembrada, que es lo que detecta que
  alguien cambió la fórmula.
- **Componentes**: precarga de los nueve, encadenamiento de los selectores, el aviso con sus dos
  columnas de importes, «sin tarifa configurada» en vez de `₡0`, el aviso de cierre, la
  confirmación obligatoria, el aviso de etiqueta con dirección, y el borrador que sobrevive al
  rechazo.
- **Guardias que deben seguir verdes SIN tocarlas**: `cierre-detail-inmutable`,
  `novedad-acciones-una-tabla`, `novedad-acciones-sin-maqueta`, `orden-nota-frontera`,
  `superficie-de-uso`.
- **Guardia que se actualiza a propósito**: `corregir-datos-sin-rastro` (§8.2), con contraprueba.

---

## 13. Preguntas abiertas

Las cuatro (P1–P4) están en `requirements.md` §Preguntas abiertas, con su contexto. Resumidas:

- **P1** — sin tarifa en la zona nueva: ¿avisar (lo que este diseño hace) o bloquear?
- **P2** — el `adminTienda` puede mover su propio flete corrigiendo el distrito; D4 lo permite y no
  se reabre, pero queda anotado.
- **P3** — cuánto dura la ventana de coordenadas viejas y si alguna puerta decide con ellas.
- **P4** — presentación de los importes del aviso (escala 2 vs. enteros).

Y una técnica que **no** es pregunta sino decisión, escrita aquí para que se lea junto a ellas:
**esta ficha enmienda 312/R5 y 312/R14** (`requirements.md` §D6). No es un incumplimiento: es el
alcance nuevo, declarado.
</content>
</invoke>
