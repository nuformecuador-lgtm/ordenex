# Ficha 312 — Diseño: corregir los datos del cliente de una orden

> Nota de método. La primera versión de este documento se levantó **sin** el grafo de
> `codebase-memory` (la herramienta MCP no figuraba en el toolset de aquella sesión) y cada
> afirmación citaba el archivo del que salía. En la revisión del **2026-08-28** el grafo **sí**
> estuvo disponible y se usó para re-medir los dos puntos que cambiaban de sentido:
> `ChatConversacionRepository.findByOrdenParaMensajero` (§5.4) y `ESTATUS_POR_GRUPO` /
> `ACCIONES_POR_GRUPO` (§3.3 y §9.2). Lo demás se conserva de la medición anterior.

---

## 0. Qué hay ya en disco, medido

| Pieza | Estado real | Dónde |
| --- | --- | --- |
| `OrdenRepository.update(id, data, historial)` | **VIVO** (líneas 1362–1441, confirmado por grafo el 2026-08-28). `updateMany` guardado por `deletedAt: null` + append al historial **solo si cambia `estatusId`** + encolado de geocodificación **solo si cambia `direccion`**, todo en la misma `$transaction`. | `lib/repositories/OrdenRepository.ts:1362` |
| Consumidores de `update` | `DevolucionOrigenService`, `EnvioDevolucionCentralService`. | — |
| `OrdenRepository.corregirDatosCliente` | **NO EXISTE** (comprobado en el grafo el 2026-08-28: cero coincidencias). Lo crea esta ficha. | — |
| `actualizarOrdenSchema` | **VIVO**, `.strict()`, admite los 4 campos del alcance **y 7 más** (`peso`, `estatusId`, `tiendaId`, `zonaId`, `provinciaId`, `cantonId`, `distritoId`). Ninguno de los cuatro del alcance lleva `.max()`: **no hay tope de longitud** (R6). | `lib/types/orden.ts:39` |
| `OrdenService.actualizar` / `lib/actions/ordenes.actualizarOrden` | **NO EXISTEN.** Borradas el 2026-08-07 («nacieron muertas, nunca tuvieron pantalla»). Solo quedan los comentarios del borrado. | `lib/services/OrdenService.ts:412`, `lib/actions/ordenes.ts:40` |
| `ESTADOS_TERMINALES` | `["entregada", "devuelta_a_tienda", "incidente"]`. | `lib/types/order-status-transiciones.ts:491` |
| Grupos de `/novedades` | `ESTATUS_POR_GRUPO = { ayuda: "ayuda_tienda", devolucion: "devuelta" }`, con su inverso derivado `grupoDeEstatus`. Punto único compartido servidor/UI. | `lib/types/novedad-grupo.ts:63` |
| Acciones por grupo | `ayuda: [contacto, reprogramarDesdeAyuda, rechazarDesdeAyuda, habilitar, conversacion, intentoContacto]`, `devolucion: [contacto, reprogramar, rechazar]`. | `novedad-acciones-catalogo.ts:121` |
| **Guardias** de `/novedades` | Toda acción de la fila debe estar en `ACCIONES_POR_GRUPO` **y** en `PRODUCTOR_POR_ACCION` (con su Server Action real, importada desde `app/(app)/novedades/`). | `novedad-acciones-una-tabla.guardia.test.ts`, `novedad-acciones-sin-maqueta.guardia.test.ts` |
| Acción POR FILA en el listado | Precedente vivo: `ReportarIncidenteAccion` (disparador propio + modal, **no renderiza nada** si la acción no aplica). | `app/(app)/ordenes/_components/ReportarIncidenteAccion.tsx` |
| Precedente de la familia | `EliminarOrdenService` + `IEliminarOrdenService` + `EliminarOrdenModal` + `eliminar-orden-error-messages.ts` + acción `lib/actions/eliminar-orden.ts`. | — |
| Cómo guarda el teléfono la carga | `filaCargaSchema.telefono = requiredNonEmpty("telefono")` → **texto recortado, NO E.164**. `notas: data.notas === "" ? null : data.notas`. | `lib/types/carga-masiva.ts:106`, `lib/services/BulkOrdenService.ts:730,738` |
| Matcheo de WhatsApp entrante | `resolverOrdenActivaPorNumero` va por `orden.telefono_dest` normalizado en SQL, **no** por `chat_conversacion.telefono_e164`. | `lib/repositories/ChatConversacionRepository.ts:65` |
| Lectura del hilo en el panel del mensajero | `findByOrdenParaMensajero` **no es un `findFirst` a secas**: ordena por `ultimoEntranteAt desc NULLS LAST`, luego `createdAt desc`, y su comentario dice que el desempate existe para «blindar la lectura del panel contra el hilo equivocado». Medido en el grafo el 2026-08-28 (líneas 141–156). **Esto cambia §5.4.** | `lib/repositories/ChatConversacionRepository.ts:141` |

> **Lo que este censo YA NO necesita.** Hasta el 2026-08-27 tenía cuatro filas más —`orden_nota`,
> su repositorio, su guardia de frontera cerrada y la ventana de escritura del hilo— porque el
> diseño publicaba una nota automática. Con D4 (§6) esta ficha **no toca el hilo de notas**, así
> que esas piezas dejan de ser dependencias y salen del censo.

---

## 1. Forma general — se replica la de «eliminar orden»

```
app/(app)/ordenes/_components/CorregirDatosClienteAccion.tsx   ← disparador por FILA (patrón ReportarIncidenteAccion)
app/(app)/novedades/_components/NovedadAcciones.tsx            ← misma acción, otra superficie (celda de la tabla, LOS DOS grupos)
        ↓ ambas montan
app/(app)/ordenes/_components/CorregirDatosClienteModal.tsx    ← formulario + avisos (R26/R27/R28)
        ↓
lib/actions/corregir-datos-cliente.ts                          ← Server Action ('use server'), zod en el borde
        ↓ (interfaz)
lib/services/CorregirDatosClienteService.ts                    ← rol + pertenencia + ventana + diff
        ↓ (interfaz)
lib/repositories/OrdenRepository.corregirDatosCliente()        ← UN `updateMany` guardado por la ventana
```

Módulos puros que las dos capas comparten:

```
lib/types/correccion-datos-cliente.ts        ← zod, ventana, predicado UI/servidor, contratos
lib/interfaces/services/ICorregirDatosClienteService.ts
```

**Servicio propio y no un método de `IOrdenService`**, por la misma razón que la 226/«eliminar»:
`IOrdenService` es SOLO LECTURAS desde el 2026-08-07, y la escritura de órdenes vive por
convención en un servicio de dominio **por acción** (`DeshacerAsignacionService`,
`RecuperacionBodegaService`, `EliminarOrdenService`, …). Esta es una acción más de esa familia.

> **No hay `lib/services/mensajes-corregir-datos-cliente.ts`.** Ese módulo existía para componer
> el cuerpo de la nota automática; sin nota (D4) el servidor no compone ningún texto: devuelve
> códigos de desenlace y la pantalla los traduce en
> `corregir-datos-cliente-error-messages.ts` (§9.3).

---

## 2. Modelo de datos

### 2.1 Migraciones: **NINGUNA**

No hay tabla nueva, ni columna nueva, ni enum nuevo, ni índice nuevo. Las cuatro columnas
(`orden.destinatario`, `orden.telefono_dest`, `orden.producto`, `orden.notas`) existen desde
`20260709130100_ordenes`. Por tanto **no hay `migration.sql` ni `down.sql`** en esta ficha, y el
gate rápido no debe forzarse al completo por cimientos.

> Con D4 esto pasa de «es lo que salió» a **invariante de la ficha**: si alguien acaba escribiendo
> una migración, se salió del alcance. No hay rastro que persistir, así que no hay nada que crear.

### 2.2 RLS

Esta ficha **no crea ni altera ninguna tabla**, así que no hay política de RLS que escribir ni que
revisar. La única puerta de la corrección es la autorización de §3, en el servidor: no hay red de
seguridad debajo, y por eso §3.2 revalida rol, pertenencia y estado en cada petición (R25).

### 2.3 Lo que se escribe, exactamente

| Tabla | Operación | Columnas tocadas |
| --- | --- | --- |
| `orden` | `updateMany` (1 fila como mucho) | solo las corregidas de entre `destinatario`, `telefono_dest`, `producto`, `notas` (+ `updated_at` por Prisma, R15) |
| `orden_historial_estado` | **nada** (R14) | — |
| `orden_nota` | **nada** (R14, D4) | — |
| `chat_conversacion` | **nada** (R19) | — |
| cualquier otra | **nada** (R14) | — |

R5 y R14 se cumplen **por construcción y no por convención**: el método nuevo del repositorio
proyecta un `data` de exactamente cuatro claves posibles, y `estatusId` / `direccion` **no son
representables** en su tipo de entrada, así que este camino es estructuralmente incapaz de
disparar el `appendCambioEstado` o el `encolarGeocodificacion` que `update` sí tiene. Ver
§8/alternativa C.

---

## 3. Autorización — dos superficies, un solo servidor

### 3.1 El módulo puro compartido

`lib/types/correccion-datos-cliente.ts` es el **punto único** que la UI y el servicio consultan.
Existe por la misma razón que `lib/types/novedad-grupo.ts`: si la pantalla y el servidor derivan
la regla por separado, un día ofrecen cosas distintas y nada rompe.

```ts
/** D1: los cuatro campos, como valores (la UI itera esta lista; el schema se deriva de ella). */
export const CAMPOS_CORREGIBLES = ["destinatario", "telefonoDest", "producto", "notas"] as const;
export type CampoCorregible = (typeof CAMPOS_CORREGIBLES)[number];

/**
 * D3 — la ventana CERRADA. Se LEE de la fuente única (`ESTADOS_TERMINALES`) y se le suma el
 * único valor extra que el humano añadió; no se re-declara la lista de terminales.
 * El `satisfies` impide que un typo o un value retirado del catálogo compile.
 * T3 (2026-08-28): NO se añade `sin_gestionar` ni los estados de recolección.
 */
export const ESTADOS_SIN_CORRECCION = [
  ...ESTADOS_TERMINALES,          // entregada, devuelta_a_tienda, incidente
  "rechazada",
] as const satisfies readonly OrderStatusValue[];

/**
 * R22/R24 — FALLO CERRADO. `undefined`/`null` (fila sin estatus en el DTO, fixture viejo)
 * devuelve `false`: la ausencia de dato no habilita nada.
 */
export function estadoAdmiteCorreccion(estatusValue: string | null | undefined): boolean;

/**
 * R8/R9 — la ventana POR ROL, en una sola tabla. La regla es ASIMÉTRICA:
 *   maestro | admin  → cualquier estado que pase `estadoAdmiteCorreccion`
 *   adminTienda      → cualquier estado que pertenezca a un grupo de `/novedades`,
 *                      es decir `grupoDeEstatus(estatusValue) !== null` — LOS DOS grupos,
 *                      `devuelta` y `ayuda_tienda` (P2, 2026-08-28)
 *   el resto         → false
 * NO concede acceso a ninguna orden: la PERTENENCIA se comprueba aparte, en el servicio.
 */
export function rolAdmiteCorreccion(rol: RolValue, estatusValue: string | null | undefined): boolean;
```

**Por qué el `adminTienda` se expresa con `grupoDeEstatus` y no con una lista de dos valores.**
La regla que el humano dio no es «devuelta y ayuda_tienda»: es **«lo que `/novedades` le lista, lo
puede corregir»**. Escribirla derivada del punto único (`ESTATUS_POR_GRUPO`) dice exactamente eso
y no puede desalinearse de la pantalla. Consecuencia que conviene tener escrita: **si algún día
entra un tercer grupo en `/novedades`, la corrección quedará habilitada también ahí**, sin que
nadie lo decida explícitamente. Es la lectura pretendida de la regla, pero es una puerta que se
abre sola — anotado aquí para que el día que aparezca ese tercer grupo se mire esta línea.
(Los dos valores actuales, además, pasan `estadoAdmiteCorreccion`: ninguno está en la ventana
bloqueada de D3, así que las dos reglas no se contradicen.)

### 3.2 La secuencia del servicio

`CorregirDatosClienteService.corregir(input, actor)`:

1. **Rol, sin tocar dato aún.** Si el rol no es ninguno de los tres de D2 → `forbidden`
   inmediato, sin consultar nada (R10).
2. **Carga mínima de la orden**: `id`, `tiendaId`, `deletedAt`, `estatus.value` y los cuatro
   valores actuales. Una sola consulta.
   - No existe / `deletedAt !== null` → `forbidden` (R12: mismo resultado opaco).
3. **Pertenencia** (R9): `adminTienda` ⇒ `orden.tiendaId === actor.usuarioId`. Sale del ACTOR,
   nunca del input. Mismo mecanismo que `autorizarSobreHilo` (227/R9). Falla → `forbidden`.
4. **Ventana** (R8/R9/R11): `rolAdmiteCorreccion(actor.rol, orden.estatusValue)`. Falla →
   `forbidden`.
5. **Normalización y diff** (§10, R4): para cada campo recibido, normalizar y comparar con el
   valor actual. Conjunto vacío ⇒ `{ status: "ok", cambios: [] }` **sin escribir nada**.
   Si `telefonoDest` cambia y no es utilizable ⇒ `validation_error` (R18).
6. **Escritura** (§7). Una sola sentencia guardada.

> **Por qué la pertenencia NO se delega en `autorizarSobreHilo`** aunque sea la misma pregunta:
> esa función exige `esRolConHilo(actor.rol)` y **rechazaría a `maestro`/`admin`**, que son
> justamente el caso principal de esta ficha. Se reusa el *mecanismo* (`tiendaId === usuarioId`),
> no la función. (Y con D4 esta ficha ya no tiene ninguna otra relación con el hilo de notas.)

### 3.3 Lo que ve cada superficie

| Superficie | Rol | Cómo decide si ofrece |
| --- | --- | --- |
| `/ordenes`, acción por fila | `maestro`, `admin` | Prop `puedeCorregirDatos = esAccesoTotal(rol)` desde `page.tsx` (patrón exacto de `puedeReportarIncidente`), **más** `estadoAdmiteCorreccion(row.estatusValue)` dentro del disparador. `adminTienda` también usa `/ordenes` (`usaFiltroEstado` lo incluye) y **no** recibe la prop. |
| `/novedades`, cards | `adminTienda` | Celda `"corregirDatos"` en `ACCIONES_POR_GRUPO.devolucion` **y** en `ACCIONES_POR_GRUPO.ayuda` (R23). El grupo ya implica el estado, así que la ventana se cumple por la tabla; el disparador consulta igual `estadoAdmiteCorreccion` (fallo cerrado, R24). |

**No hace falta ningún campo nuevo en el DTO.** Éste es el punto en el que esta ficha se separa
de «eliminar orden»: allí la UI necesitaba `sinGestion` porque el predicado exigía una consulta
al historial. Aquí el predicado es una **función pura de `estatusValue`**, que
`OrdenListItemDTO` y `NovedadDTO` **ya llevan**. Se cumple el mismo requisito («la UI no ofrece
lo que el servidor va a rechazar») sin ampliar ningún contrato ni pagar una consulta por página.

---

## 4. Contratos de entrada/salida

### 4.1 Schema de borde (`lib/types/correccion-datos-cliente.ts`)

Se **DERIVA** de `actualizarOrdenSchema` (que ya existe y ya es `.strict()`) en vez de escribir
un cuarteto paralelo:

```ts
export const corregirDatosClienteSchema = actualizarOrdenSchema
  .pick({ destinatario: true, telefonoDest: true, producto: true, notas: true })
  .strict()                                        // R2: explícito, no confiado a que .pick lo herede
  .extend({ ordenId: z.uuid() })
  .refine((d) => CAMPOS_CORREGIBLES.some((c) => d[c] !== undefined), {
    path: ["destinatario"],
    message: "Indicá al menos un campo a corregir",  // R3
  });
```

- **Derivar y no copiar** es lo que garantiza que la corrección no acepte un `destinatario` vacío
  que la actualización rechazaría (`z.string().min(1)` ya está allí), ni al revés.
- **Y es también lo que entrega R6 sin escribir nada**: como el schema origen no tiene `.max()`
  en ninguno de los cuatro campos, la corrección hereda «sin tope» de la misma fuente que la
  carga. Escribir aquí un `.max()` sería justamente el caso que P3 descartó. Un test lo fija (A2).
- `.strict()` se re-declara **a propósito**: en zod 4 la conservación del modo por `.pick()` no
  es algo que este spec quiera dar por sabido. Un test lo fija (A2).
- `notas` conserva `.nullable().optional()` del schema origen: `null` es «vaciar el campo `notas`
  de la orden» (el campo de la propia orden, no ninguna nota de hilo: aquí no hay hilo).

### 4.2 Resultado del servicio

```ts
export type CorregirDatosClienteServiceResult =
  | { status: "ok"; cambios: readonly CampoCorregible[] }   // vacío ⇒ no hubo nada que cambiar (R4)
  | { status: "forbidden" }                                 // rol, pertenencia, estado, inexistente, borrada (R12)
  | { status: "conflict" }                                  // el estado se movió entre la lectura y la escritura (R13)
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R18 (teléfono inservible)
```

`cambios` dice **qué cambió el SERVIDOR**, no qué mandó la pantalla: es el mismo criterio que
`eliminadas` en `EliminarOrdenServiceResult`. Es un valor **de respuesta**, efímero: no se
persiste en ningún sitio (D4).

### 4.3 Resultado de la Server Action

```ts
export type CorregirDatosClienteActionResult =
  | CorregirDatosClienteServiceResult
  | { status: "unauthenticated" };                          // R7, resuelto en el BORDE
```

Patrón literal de `lib/actions/eliminar-orden.ts`: `withErrorHandler` + `resolveActorFromSession`
+ zod + fábrica del servicio + traductor de `AppErrorShape` a los dos códigos que este borde
puede producir. **Server Action y no Route Handler**: mutación interna del mismo proyecto
(`docs/architecture.md`).

---

## 5. WhatsApp: el punto delicado, resuelto

### 5.1 Cómo funciona hoy, leído

`ChatConversacionRepository.resolverOrdenActivaPorNumero(telefono)`
(`lib/repositories/ChatConversacionRepository.ts:65`) resuelve un entrante a su orden con:

```sql
WHERE o.deleted_at IS NULL
  AND o.mensajero_asignado_id IS NOT NULL
  AND <normalizarCR(o.telefono_dest)> = $numeroNormalizado
```

**El matcheo va contra `orden.telefono_dest`, no contra `chat_conversacion.telefono_e164`.** El
hilo se keyea después, con `upsertParaOrden`, por el único `(orden_id, telefono_e164)`, usando
`normalizarTelefonoWa(row.telefono_dest)`.

### 5.2 Qué pasa exactamente cuando la 312 escribe `telefono_dest`

| Momento | Efecto | Requisito |
| --- | --- | --- |
| Se corrige el número | `orden.telefono_dest` pasa a ser el nuevo. `chat_conversacion` **no se toca**. | R19 |
| Entrante desde el número **nuevo** | El `WHERE` de arriba **casa** → se resuelve a esta orden. | R20 |
| Ese entrante busca hilo | `upsertParaOrden(ordenId, nuevoNormalizado)` no encuentra `(orden_id, nuevo)` → **crea un hilo NUEVO**. El viejo sigue entero, con sus mensajes. | R19 |
| Entrante desde el número **anterior** | Ya no casa con esta orden → `sinResolver`, el webhook responde `200`, el mensaje no llega a nadie. | R21 |
| Saliente desde el panel / plantilla / bienvenida | Sale al número nuevo, porque todos leen `orden.telefonoDest`. | R20 |

### 5.3 Por qué NO se llama a `migrarTelefono`

`ChatConversacionRepository.migrarTelefono(anterior, nuevo)` existe (feature 311) y haría que el
hilo viejo adoptara el número nuevo, dando **continuidad**. Se descarta, y por dos razones que
apuntan al mismo sitio:

1. **Decisión del humano (D5):** esta ficha no toca el módulo de chat.
2. **Y aquí el argumento es más fuerte que en la 311.** En la 311 el cliente cambió de número:
   las dos puntas son la misma persona. En la 312 el número estaba **mal escrito**, así que el
   hilo viejo es —literalmente— una conversación con **otra persona**: la plantilla de bienvenida
   (`lib/services/jobs/whatsapp-bienvenida-handler.ts:146`, que envía a `orden.telefonoDest`) ya
   salió a un desconocido. Migrar ese hilo cosería los mensajes de un tercero al historial del
   cliente correcto. Eso no es continuidad: es contaminación de evidencia.

Palabras del humano el 2026-08-28: **si el número estaba mal, esa conversación no sirve de nada**.
El hilo viejo es desechable — lo que no significa borrarlo: significa que nadie tiene que hacer
nada con él. Se queda donde está (R19).

### 5.4 El hilo bueno emerge solo — corregido el 2026-08-28

**Esta sección decía lo contrario hasta el 2026-08-27, y estaba mal medida.** Afirmaba que
`findByOrdenParaMensajero` era «un `findFirst`» y que, tras corregir el número, el panel del
mensajero podía quedarse enseñando el hilo equivocado para siempre.

Lo medido en el grafo el 2026-08-28 (`ChatConversacionRepository.ts:141-156`):

```ts
const row = await this.prisma.chatConversacion.findFirst({
  where: { ordenId, mensajeroId },
  orderBy: [{ ultimoEntranteAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  select: SELECT,
});
```

No es un `findFirst` a secas: lleva un **desempate determinista** por actividad entrante más
reciente, con los `null` al final, y su propio comentario dice que existe justamente para
«blindar la lectura del panel contra el hilo equivocado».

**Consecuencia para esta ficha.** Corregido el número, en cuanto el cliente bueno escriba, su
hilo pasa a tener el `ultimoEntranteAt` más reciente y **emerge solo** en el panel. El hilo viejo
—el del desconocido— cae por debajo, y si nunca tuvo entrantes va directamente al final. No hay
nada que arreglar aquí, y por tanto no hay ninguna dependencia con el módulo de chat.

Las dos salidas que este documento planteaba como alternativas —(b) que el panel liste los hilos
de la orden, (c) fusionar hilos— quedan **descartadas, no aplazadas** (T2, 2026-08-28).

---

## 6. Rastro: no hay, y es una decisión

**D4, firmada por el humano el 2026-08-28.** La corrección **no deja ningún rastro** más allá del
`updated_at` de la fila (R14/R15). No hay nota automática en el hilo de la orden, no hay tabla de
auditoría, no hay fila en `orden_historial_estado` y no se guarda en ninguna parte qué campo
cambió ni cuál era su valor anterior.

**Esto no se coló: se decidió.** La versión anterior de este diseño dedicaba una sección entera a
componer y publicar una nota automática (`«valor viejo» → «nuevo»`, atribuida al autor, recortada
al tope del hilo, escrita en la misma transacción que el `UPDATE`). Se preguntó por ella —P1— y la
respuesta fue: *«no veo necesario avisar que se corrigió un dato»*. La sección se retiró entera,
junto con su módulo de mensajes, su método transaccional, su parámetro de constructor y sus
tests. La alternativa completa, con lo que costaba y lo que daba, está en §8/B.

**Lo que se pierde, dicho sin rodeos:** tras una corrección **no se puede saber quién la hizo, qué
campo tocó, ni cuál era el valor anterior**. Un teléfono corregido es indistinguible de un
teléfono que siempre fue así. Si mañana hace falta responder «¿esto lo cambió alguien?», la
respuesta no está en el sistema.

**Y por eso R14 es un requisito con test, no un comentario.** La ausencia de escrituras se
verifica contando filas contra Postgres (`orden_nota` y `orden_historial_estado` no aumentan,
`tasks.md` B3). Un requisito negativo sin test es indistinguible de un olvido, que es exactamente
lo que esta sección existe para evitar.

---

## 7. Escritura: un método nuevo en `OrdenRepository`

```ts
// lib/interfaces/repositories/IOrdenRepository.ts
export interface CorregirDatosClienteData {
  destinatario?: string;
  telefonoDest?: string;
  producto?: string;
  notas?: string | null;
}

corregirDatosCliente(
  ordenId: string,
  data: CorregirDatosClienteData,
  estadosBloqueados: readonly string[],
): Promise<"ok" | "conflict">;
```

Implementación (`lib/repositories/OrdenRepository.ts`), **una sola sentencia**:

1. `prisma.orden.updateMany({ where: { id, deletedAt: null, estatus: { value: { notIn: estadosBloqueados } } }, data })`.
   La ventana va **en el `WHERE` de la sentencia que muta**, no en un `if` previo: es el
   mecanismo de `OrdenNotaRepository.marcarBorrada` («la propiedad se comprueba en el MISMO
   statement que muta, así que no existe ventana entre el chequeo y el efecto»). Esto es R13.
2. `count === 0` ⇒ `return "conflict"`. No se escribió nada.
3. `count === 1` ⇒ `return "ok"`.

**Sin `$transaction`, y eso es consecuencia directa de D4.** Mientras hubo nota, este método tenía
que envolver dos escrituras en una transacción y el constructor de `OrdenRepository` ganaba un
tercer parámetro (`notaRepoDe`) para poder inyectar el repositorio del hilo sobre el `tx`. Sin
nota hay **una sola sentencia**, que Postgres ya ejecuta atómicamente: la transacción sobra, el
parámetro de constructor sobra, y `OrdenRepository` no cambia su firma. Menos superficie nueva
por haber quitado un requisito.

**`update` queda intacto.** Esta ficha no lo toca y ninguno de sus dos consumidores vivos se ve
afectado (§8/C).

R5 y R14 se cumplen **por el tipo**: `CorregirDatosClienteData` no puede expresar `estatusId` ni
`direccion`, así que este camino es estructuralmente incapaz de disparar el `appendCambioEstado`
o el `encolarGeocodificacion` que `update` sí tiene. No es una convención que alguien deba
recordar: no es representable.

---

## 8. Alternativas descartadas

**A — Tabla de auditoría propia (`orden_correccion_dato`).**
Descartada por decisión humana explícita (D4) y porque este repo ya rechazó dos specs por
proponer modelo nuevo en lugar del arreglo mínimo. Coste evitado: migración up/down, RLS,
repositorio, lector y una pantalla que nadie pidió (el precedente `OrdenHabilitacionApi` nació sin
lector y hubo que declararlo). Con D4 la decisión es todavía más firme: si no se quiere ni una
nota, menos aún una tabla.

**B — Nota automática en el hilo de notas de la orden.**
**Es lo que este diseño proponía hasta el 2026-08-27, y se retira por decisión humana del
2026-08-28 (D4, P1).** Consistía en escribir, en la misma transacción que el `UPDATE`, una fila de
`orden_nota` con el cuerpo `Corrección de datos del cliente. Destinatario: «viejo» → «nuevo» · …`,
atribuida al actor y recortada al tope de 200 caracteres del hilo.

Lo que daba: la única forma de saber, después, qué se corrigió y quién.
Lo que costaba, y pesó en la decisión:

1. Un módulo de composición de textos y su batería de tests de recorte.
2. Un método transaccional en `OrdenRepository` con un parámetro de constructor nuevo, solo para
   poder inyectar el repositorio del hilo sobre el `tx`.
3. Saltarse `OrdenNotaService.publicar` a propósito —`maestro`/`admin` no pasan `esRolConHilo` ni
   la ventana de escritura (227/R12)— y escribir directo por el repositorio.
4. **Una incoherencia sin salida limpia:** `OrdenNotaService.listar` solo admite `adminTienda` y
   `mensajero`, así que el `maestro` que corrige **escribiría un rastro que él mismo no puede
   leer**. Arreglarlo obligaba a reabrir una decisión firmada de la 227.

Con «no veo necesario avisar que se corrigió un dato», el punto 4 deja de ser un problema que
resolver: no se escribe nada. Lo que se pierde está en §6, escrito.

**C — Reusar `OrdenRepository.update` en vez de un método nuevo.**
Es lo primero que se probó, y se descarta por dos motivos concretos:
1. `update` **puede** escribir `estatusId` y `direccion`. Reusarlo dejaría R14 («no se escribe en
   `orden_historial_estado`») dependiendo de que el llamador se acuerde de no mandar `estatusId`.
   Con el método nuevo, R14 no es una convención: **no es representable**.
2. `update` **no tiene sitio para la ventana de estado**: su `WHERE` es `{ id, deletedAt: null }`.
   Meter `estatus.value NOT IN (…)` ahí cambiaría el comportamiento de sus dos consumidores vivos
   (`DevolucionOrigenService`, `EnvioDevolucionCentralService`), que sí transicionan estados.

*(Esta alternativa tenía un tercer motivo —«`update` no puede escribir la nota sin ampliar su
firma»— que desaparece con D4. Los dos que quedan siguen siendo suficientes.)*

**D — `chat_conversacion.migrarTelefono` al corregir el número.**
Descartada: §5.3. Daría continuidad a un hilo que muy probablemente es con otra persona.

**E — Un campo nuevo en `OrdenListItemDTO` (`puedeCorregirse`), calcado de `sinGestion`.**
Descartada: §3.3. El predicado es una función pura de `estatusValue`, que el DTO ya lleva. Un
campo nuevo añadiría una segunda verdad que puede quedarse atrás, y en el modo completo
(`listarCompleto`) habría que decidir otra vez si se emite.

**F — Acción por LOTE, como «Eliminar».**
Descartada: los cuatro campos son propios de cada orden; un lote no tiene un «destinatario»
común. Mismo argumento con el que `ReportarIncidenteModal` justifica recibir `orden` en singular.

**G — `adminTienda` solo desde el grupo `devolucion`.**
Es lo que este spec decía hasta el 2026-08-27, leyendo el encargo original al pie de la letra
(«las que llegan a novedades por una devolución»). Se abre a **los dos grupos** por decisión del
2026-08-28 (P2), con este razonamiento del humano: en `ayuda_tienda` la tienda ya reprograma,
rechaza y escribe en el hilo —decisiones de bastante más peso que arreglar un nombre mal escrito—,
así que negarle ahí la corrección era una asimetría sin motivo. R9 y R23.

---

## 9. Superficies, al detalle

### 9.1 `/ordenes` — acción por fila

- `app/(app)/ordenes/page.tsx`: `const puedeCorregirDatos = rol ? esAccesoTotal(rol) : false;`
  (comentario obligado: **no** es `accionesLote` aunque hoy coincida el predicado — es una acción
  por ORDEN, igual que el incidente).
- `OrdenesListado` → `OrdenesModule`: la prop viaja tal cual y entra como **tercera fuente** de la
  columna `acciones` (hoy son dos: `mostrarHistorial` y `puedeReportarIncidente`).
- `CorregirDatosClienteAccion`: `if (!puedeCorregirDatos || !estadoAdmiteCorreccion(orden.estatusValue)) return null;`
  — **no renderiza nada**, no un botón deshabilitado (patrón `ReportarIncidenteAccion`).
- Éxito ⇒ `mutate(key => Array.isArray(key) && key[0] === "ordenes:list")` (R29).

### 9.2 `/novedades` — celda de la tabla, en los DOS grupos

Tres archivos, y los tres son obligatorios para que las guardias pasen:

| Archivo | Cambio |
| --- | --- |
| `novedad-acciones-catalogo.ts` | `AccionNovedad` gana `"corregirDatos"`; la celda entra en `ACCIONES_POR_GRUPO.devolucion` **y en `ACCIONES_POR_GRUPO.ayuda`** (R23); `PRODUCTOR_POR_ACCION.corregirDatos = { accionServidor: "corregirDatosCliente", modulo: "lib/actions/corregir-datos-cliente" }`. |
| `NovedadAcciones.tsx` | Entrada en `ICONO_POR_ACCION` (rótulo «Corregir datos», nombre accesible `Corregir los datos del cliente de la orden de ${destinatario}`) + prop `onCorregirDatos`. |
| `NovedadesModule.tsx` | Estado `ordenACorregir` + montaje del modal + relectura tras éxito. |

**Una sola clave para los dos grupos, y aquí sí corresponde** —al revés que
`reprogramarDesdeAyuda` / `rechazarDesdeAyuda`, que necesitaron claves propias porque cada una va
a un servicio distinto. Corregir datos es **la misma operación, el mismo servicio y el mismo
modal** en los dos grupos: si se partiera en dos claves, `NovedadAcciones` tendría que ramificar
por grupo para llamar a lo mismo, que es exactamente la decisión fuera de la tabla que R18/R19 de
la 236 prohíben. El precedente correcto es `contacto`, que está en los dos grupos con una clave.

El icono: **`PencilLine`** (`lucide-react`). Es propio de esta acción, como `Power` lo es de
«Habilitar»: ninguna otra acción de la fila edita un dato.

### 9.3 El modal (compartido por las dos superficies)

`CorregirDatosClienteModal` vive en `app/(app)/ordenes/_components/` —donde nace y donde está su
consumidor principal— y `/novedades` lo **importa**, exactamente como `/recepcion-satelite`
importa `ReportarIncidenteAccion`. No se promueve a `components/shared/` (no hay una tercera
superficie).

- Recibe una `CorregirDatosClienteOrdenUI` estructural (`id`, `numRemision`, `numGuia`,
  `destinatario`, `telefonoDest`, `producto`, `notas`, `estatusValue`) que cumplen **por
  estructura** tanto `OrdenListItemDTO` como `NovedadDTO`. Mismo patrón que
  `ReportarIncidenteAccionOrden`.
- Cuatro campos precargados (R26). Valida en cliente con **el mismo** `corregirDatosClienteSchema`
  que el servidor revalida (patrón `ReportarIncidenteModal`): el cliente no tiene reglas propias,
  y en particular **no impone un largo máximo propio** a `producto` ni a `notas` (R6).
- **Aviso de etiqueta (R27)**, solo si `numGuia !== null`: «Esta orden ya tiene la guía N impresa.
  La etiqueta pegada al paquete seguirá mostrando los datos anteriores.» **Y nada más**: el modal
  no ofrece reimprimir (P4); esa acción ya está en la fila del listado.
- **Aviso de WhatsApp (R28)**, solo si el campo de teléfono cambió respecto del precargado: «Los
  mensajes nuevos irán al número corregido. La conversación anterior se conserva, pero no se
  traslada.» *(Vocabulario: nada de «SLA»; aquí no aplica, pero la regla se recuerda.)*
- Errores traducidos por causa en `corregir-datos-cliente-error-messages.ts` (patrón
  `eliminar-orden-error-messages.ts`), sin exponer ids internos (R30). El borrador **no** se
  limpia ante un rechazo.
- **No hay ningún texto que prometa un rastro.** Nada de «se registrará quién hizo el cambio»:
  no se registra (D4), y una promesa falsa en la pantalla es peor que el silencio.

---

## 10. Normalización de los valores al guardar

| Campo | Tratamiento | De dónde sale |
| --- | --- | --- |
| `destinatario` | `.trim()`, no vacío, **sin tope** | `crearOrdenSchema`/`filaCargaSchema` hacen lo mismo |
| `producto` | `.trim()`, no vacío, **sin tope** (R6) | ídem |
| `notas` | `.trim()`; `""` ⇒ `null`; **sin tope** (R6) | copia literal de `BulkOrdenService.ts:738` |
| `telefonoDest` | `.trim()` y **se guarda tal cual** (R17) | `filaCargaSchema.telefono = requiredNonEmpty("telefono")` |

**Aclaración medida, confirmada como decisión en T1 (2026-08-28).** La carga masiva **NO** guarda
el teléfono en E.164: guarda el texto recortado. Lo dice el propio código del chat: «una orden de
Costa Rica guardada en formato LOCAL (`8888-7777`, que es como las carga el negocio)»
(`ChatConversacionRepository.ts:78`). La normalización con `normalizarTelefonoCR` /
`normalizarTelefonoWa` vive **en el punto de uso** (matcheo del entrante, clave del hilo, destino
del envío), no en la columna.

Se preguntó si convenía canonizar desde esta superficie y la respuesta fue **no**: canonizar solo
aquí dejaría la columna con **dos formatos según por dónde entró el dato**. Por tanto
«normalizarse igual que en la carga» se implementa como `.trim()` en la columna, y la corrección
**usa** `normalizarTelefonoWa` para una cosa distinta:

**R18 — la validación de utilidad.** Si `normalizarTelefonoWa(nuevo) === ""` el número es
inservible: no puede casar ningún entrante ni recibir ningún saliente (el job de bienvenida ya
lanza en ese caso, `whatsapp-bienvenida-handler.ts:146`). Se rechaza en el servicio con
`validation_error`, no se guarda.

---

## 11. Verificación (resumen; el desglose está en `tasks.md`)

- **Servicio con dobles**: rol (los tres permitidos y los tres denegados), pertenencia, ventana
  por rol en **los dos grupos** de `/novedades`, diff y teléfono inservible.
- **Repositorio contra Postgres** (`tests/integration/db`): el `WHERE` de la ventana recorta de
  verdad, ninguna otra columna cambia, `updated_at` sí cambia (R15), y **cero** filas nuevas en
  `orden_historial_estado` **y cero en `orden_nota`** (R14 — la ausencia de rastro se mide, no se
  supone). Los tests de servicio usan dobles y **no ven el SQL**: la ventana se prueba donde vive.
- **Chat contra Postgres**: tras corregir, `resolverOrdenActivaPorNumero(nuevo)` devuelve la
  orden y `resolverOrdenActivaPorNumero(viejo)` **no**; y la fila de `chat_conversacion` con el
  número viejo sigue intacta.
- **Componentes**: precarga, los dos avisos, fallo cerrado del disparador, relectura tras éxito, y
  la acción presente en **las dos** pestañas de `/novedades`.
- **Guardias existentes que deben seguir verdes**: `novedad-acciones-una-tabla`,
  `novedad-acciones-sin-maqueta`, `superficie-de-uso`. La guardia del hilo de notas
  (`orden-nota-frontera`) **no la afecta esta ficha**, porque ya no toca el hilo — pero se corre
  igual, que es lo que confirma que no lo toca.

---

## 12. Preguntas técnicas, ya respondidas (2026-08-28)

> Las de producto y alcance están en `requirements.md` §Preguntas resueltas (P1–P4).
> Se conservan con su respuesta porque cada una explica una línea concreta de este diseño.

**T1 — ¿Guardar el teléfono corregido en forma canónica?**
**No.** Se guarda como lo guarda la carga (texto recortado). La medición era correcta y es lo que
decide la coherencia: canonizar solo desde esta superficie dejaría la columna con dos formatos
según por dónde entró el dato. §10, R17. *(Canonizar sigue siendo posible algún día, pero como
ficha propia y con backfill, no como efecto lateral de ésta.)*

**T2 — Dos hilos de chat por orden, y el panel enseña uno.**
**No hay nada que arreglar.** `findByOrdenParaMensajero` ordena por actividad entrante más
reciente con los `null` al final, así que el hilo del cliente bueno emerge solo en cuanto escriba.
Las salidas (b) «que el panel liste los hilos» y (c) «fusionar hilos» quedan **descartadas, no
aplazadas**. §5.4, con la medición.

**T3 — ¿La ventana de estado debe excluir además `sin_gestionar` o los estados de recolección?**
**No.** Se queda con los cuatro valores de D3, tal cual. §3.1.
