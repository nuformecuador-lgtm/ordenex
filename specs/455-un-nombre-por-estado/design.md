# Feature 455 — Diseño técnico

> Requisitos en `requirements.md` (R1-R53). Base: el árbol de `feature/454-backend` + `dev` del 2026-09-23 y el
> diseño de la 454 (`specs/454-estado-al-aprobar-cierre/design.md`), sobre el que esto se aplica. Las líneas
> citadas son del archivo real a esa fecha; el índice del grafo está rancio en líneas y el implementador las
> confirma antes de editar.

---

## 0. Decisiones, en una tabla

| # | Pregunta | Decisión | Por qué, en una línea |
|---|---|---|---|
| **DA** | ¿Dónde vive el nombre? | **Una sola fuente en `lib/types/order-status.ts`**: `NOMBRE_ESTADO: Record<OrderStatusValue, string>` + `nombreDeEstado(value: string)`. `ORDER_STATUS_LABELS` (`app/(app)/ordenes/_components/EstatusBadge.tsx:13`) y `estatusLabel` (`estatus-label.ts`) pasan a ser reexportaciones. | `lib/` no puede importar de `app/` y hoy el rastreo, WhatsApp, analítica, API y webhooks necesitan el nombre desde `lib/`: por eso cada uno escribió el suyo. |
| **DB** | Regla de los códigos nuevos | Nombre visible → minúsculas, sin tildes, **sin artículos** («la», «el»), espacios a `_`. | Es la regla que ya siguen `por_recolectar_en_tienda`, `devuelta_a_tienda`, `devolviendo_a_bodega_central`. Un integrador deduce el código del nombre sin tabla. |
| **DC** | ¿`gestion_resultado` se renombra? | **Sí, en paralelo**, a los mismos códigos que su estado destino (`entregado`, `reprogramado`, `novedad`, `devolucion_a_origen_por_rechazo`, `incidente`). | §1.3: los literales de estado y resultado son las mismas palabras (no se pueden separar), `ESTATUS_POR_RESULTADO` vuelve a ser la identidad y la API dejaría de publicar dos códigos para el mismo hecho. |
| **DD** | Nombre en la API y webhooks | Campo hermano **`XNombre`** junto a cada campo de código `X`. | camelCase es la convención del canal (`numGuia`, `estadoResultante`, `costoReal`). |
| **DE** | Código anterior en la API | **`422` explicativo**, sin alias. | El humano acepta la ruptura; un alias perpetúa dos nombres y un filtro con código viejo hoy devolvería una página vacía en silencio (`ApiOrdenLecturaService.ts:157-159`). |
| **DF** | Rastreo público | Desaparece el vocabulario de hitos (`HITOS_PUBLICOS`, `ETIQUETA_POR_HITO`, `HITO_POR_ESTATUS`). La línea es una lista de **nombres de estado**. | Transparencia total pedida por el humano. |
| **DG** | Datos guardados con códigos | Catálogo y enum: **renombre en sitio** (ids/OIDs preservados). Snapshots de texto: **traducción al leer** con `CODIGO_VIGENTE_DE_ANTERIOR`. | Las filas snapshot declaran en su comentario que «deben seguir diciendo lo que dijeron» (`schema.prisma:1024`). |
| **DH** | Huérfanos `en_fulfillment`, `pendiente` | **Retiro condicional** (`DELETE … WHERE NOT EXISTS` sobre toda FK a `order_status`), patrón 155. | Si nadie los referencia, sobran; si el historial los referencia, no se pueden borrar sin mentir sobre el pasado. |
| **DI** | Guardias | Se **extiende** `censo-order-status-rename.test.ts` con un brazo nuevo basado en tokens (no en texto) y se crean dos guardias hermanas (nombres retirados y fuente única). | Los códigos viejos son palabras del castellano («entregada», «rechazada»): un regex sobre el texto crudo, como el censo de la 135, marcaría miles de comentarios en prosa. |

---

## 1. La fuente única

### 1.1 `lib/types/order-status.ts`

```ts
export const ORDER_STATUS_SEED = [ /* los 20 de requirements §0.1, en ese orden (posiciones intactas) */ ] as const;
export type OrderStatusValue = (typeof ORDER_STATUS_SEED)[number];

/** R1/R43 — el nombre visible. Literal: lo ancla un test contra la tabla aprobada. */
export const NOMBRE_ESTADO = { entregado: "Entregado", novedad: "Novedad", /* … 20 */ }
  as const satisfies Record<OrderStatusValue, string>;

/** R11/R34 — estados que ya no existen pero que el historial referencia. */
export const ESTADO_RETIRADO = {
  devolucion_por_confirmar: { nombreHistorico: "Devolución por confirmar", equivalente: "novedad" },
  ayuda_tienda:             { nombreHistorico: "Ayuda solicitada a la tienda", equivalente: "en_reparto" },
  en_fulfillment:           { nombreHistorico: /* T0.2: recuperado de git log -S */, equivalente: "en_preparacion" },
  pendiente:                { nombreHistorico: "Pendiente", equivalente: "en_preparacion" },
} as const satisfies Record<string, { nombreHistorico: string; equivalente: OrderStatusValue }>;

/** R22/R23/R26 — la correspondencia de esta ficha (y SOLO de esta; las de 135/153 ya no tienen lectores). */
export const CODIGO_VIGENTE_DE_ANTERIOR = {
  entregada: "entregado", devuelta: "novedad", reprogramada: "reprogramado",
  por_recoger: "mensajero_recogiendo_en_bodega", rechazada: "devolucion_a_origen_por_rechazo",
  sin_gestionar: "novedad_interna", por_devolver: "por_devolver_a_bodega_central",
} as const satisfies Record<string, OrderStatusValue>;

export const NOMBRE_NO_RECONOCIDO = "Estado no reconocido"; // R10

/** Interno: vigente → nombre; retirado → «<histórico> (estado retirado)»; resto → R10. */
export function nombreDeEstado(value: string | null | undefined): string;
/** Público (rastreo): retirado → nombre del equivalente. */
export function nombrePublicoDeEstado(value: string): string;
/** Traduce un código anterior (snapshots, URLs internas); devuelve el mismo valor si no lo es. */
export function codigoVigente(value: string): string;
```

- **`CODIGO_VIGENTE_DE_ANTERIOR` y `ESTADO_RETIRADO` son el único sitio del árbol donde viven los códigos
  anteriores** fuera de migraciones y de sus tests; la guardia de §6.1 los tiene en su lista de excepciones con
  el motivo escrito. (Precedente: `DeshacerAsignacionService.ts` en la allowlist de la 155.)
- `null`/vacío → `"—"` se queda en el render, fuera de estas funciones (precedente `motivoGestionLegible`).

### 1.2 Resultado = estado

```ts
// lib/types/gestion-resultado.ts (nuevo, puro)
type _ResultadoEsEstado = GestionResultado extends OrderStatusValue ? true : never; // compila o no
export function nombreDeResultado(r: GestionResultado): string { return NOMBRE_ESTADO[r]; }
export const SENAL_PENDIENTE = (r: GestionResultado) => `${nombreDeResultado(r)} · pendiente de confirmación`; // R33
```

- `ESTATUS_POR_RESULTADO` (`lib/types/gestion-destino.ts`) queda como identidad tipada; su test afirma
  `destino === resultado` para los cinco.
- Mapas que hoy derivan claves por plantilla (`ClaveResultado = \`${GestionResultado}s\``,
  `app/(app)/monitoreo/_components/contadores.ts:28`) dejan de compilar con los códigos nuevos (`novedads`):
  se sustituyen por un `Record<GestionResultado, keyof FilaTableroDia>` explícito. Las **columnas** de
  `FilaTableroDia`/`analytics_daily`/`ranking_snapshot` (`entregadas`, `devoluciones`, …) **no** cambian (§9-F).

### 1.3 Por qué el resultado se renombra en paralelo (DC), con el costo medido

- Los 7 códigos anteriores aparecen entrecomillados **1 166 veces en 237 archivos** de producción y **3 981
  veces en 497 archivos** de `tests/`. Para `entregada`, `reprogramada`, `devuelta` y `rechazada` el literal es
  **el mismo** sea estado o resultado: no hay forma mecánica de tocar solo los de estado. Separarlos exigiría
  leer cada aparición y decidir; renombrar las dos cosas es un reemplazo uniforme con el compilador y la
  guardia como red.
- Si el resultado conservara `entregada`, la guardia R40 **no podría** prohibir la palabra, y el día que alguien
  escribiera `estatus: "entregada"` compilaría como string suelto y fallaría en silencio en un `WHERE`.
- En el contrato: hoy `gestiones[]` publica `resultado: "devuelta"` y (tras la 454) `estadoResultante:
  "devuelta"`; sin renombre en paralelo pasaría a `resultado: "devuelta"` + `estadoResultante: "novedad"`.
- Costo en la base: `ALTER TYPE … RENAME VALUE` no reescribe filas (cambia la etiqueta en `pg_enum`), los
  CHECK e índices que citen el valor guardan su OID y siguen válidos, y el `down` es otro `RENAME VALUE`, **sin
  recrear el tipo con lista** (memoria «El down.sql borra los valores posteriores»).

---

## 2. Superficies: el inventario y la decisión por pieza

Inventario medido el 2026-09-23. **No es exhaustivo** a propósito: la tarea T0.3 lo completa barriendo el
árbol con las dos guardias en modo informe y clasifica cada aparición con la regla de §2.0. Lo de abajo son
las piezas conocidas y ya decididas.

### 2.0 La regla de clasificación

1. ¿Muestra el estado **de una orden concreta**? → `nombreDeEstado(orden.estatusValue)` (R2, R7).
2. ¿Rotula un recuento/columna/pestaña de **un solo** estado o resultado? → su nombre exacto (R5).
3. ¿Rotula un **grupo**, una **acción** o un **estado de la interfaz**? → texto propio que no coincida con
   ningún nombre de §0.1/§0.3 (R6), y si tiene ayuda, la ayuda lista los nombres que agrupa derivándolos del
   catálogo (patrón `ayudaBucket`, `contadores.ts:87`).
4. ¿Es un mensaje de error/confirmación que nombra el estado? → interpola `nombreDeEstado(...)`, nunca un
   literal escrito a mano.

### 2.1 Piezas conocidas

| Pieza | Hoy | Decisión |
|---|---|---|
| `EstatusBadge.tsx:13` `ORDER_STATUS_LABELS` | Mapa propio | Reexporta `NOMBRE_ESTADO`. Se **retira** la derivación «En ruta a bodega <zona>» (`:141-143`, R2): la zona ya es columna propia en los listados. |
| `estatus-label.ts` | Mapa + fallback al código crudo | `estatusLabel = nombreDeEstado` (el fallback crudo viola R3/R10). |
| `lib/types/rastreo-publico.ts` | 9 hitos + mapa estado→hito | Se retiran hitos y mapa (DF). §4. |
| `lib/types/plantilla-datos.ts:487-496` `{{estatus}}` | `ETIQUETA_POR_HITO[hitoDeEstatus(v)]`, ejemplo «En reparto» | `transform: nombreDeEstado`; `descripcion` dice «el nombre del estado, el mismo que ve la oficina». |
| `mis-asignaciones/_components/pos-card/pos-estado.ts` | Chip con «En gestión», «En detalle», «En reparto», «Por recoger», «En ayuda»; **colores indexados por el texto** | Chip = `nombreDeEstado(orden.estatusValue)`; colores por **código** (R12). «En gestión»/«En detalle» salen del chip a un marcador aparte: «Gestionando ahora» / «Abierta en detalle» (R8). La ayuda (454) es la nota «Ayuda solicitada a la tienda» fuera del chip (texto de la 456). |
| `RepartoModule.tsx:155` `AYUDA_CARD_ESTADO = "En ayuda"` | Rótulo fijo | Se retira (ver fila anterior). |
| `RecogerModule.tsx:195,309` `estado="Por recoger"` | Rótulo fijo | Chip = nombre del estado de la orden («Mensajero recogiendo en la bodega»). `aria-label` de la sección = título de la pantalla (fila de menú). |
| `recoleccion/_components/RecoleccionModule.tsx:203` `"Por recolectar"` y `RecolectadasHoyLista.tsx:100` `"Recolectada"` | Rótulos fijos; el DTO de la card **no** lleva estado (verificar T0.3) | El DTO gana `estatusValue`; chip = su nombre (R7). |
| `mis-asignaciones/_components/chat/chat-format.ts` `ESTADO_CHIP` | 4 estados + cajón «Asignada» | Chip = `nombreDeEstado`; la familia de color se decide por código con un mapa parcial y un color neutro por defecto (R12). |
| `monitoreo/_components/contadores.ts` | `ETIQUETA_RESULTADO` en plural; `ETIQUETA_BUCKET` «Sin recoger/En reparto/Otros» | Resultados: nombre exacto (R5). Buckets (grupos, R6): `sinRecoger` → «Todavía no sale a reparto», `enReparto` → «En reparto» (es un solo estado: nombre exacto), `otros` → «Otros estados». Su ayuda ya lista los nombres. |
| `cierres-admin/_components/cierre-labels.ts:25-51` | `RESULTADO_LABEL` plural + `RESULTADO_FILA_LABEL` singular | **Un solo** mapa: `nombreDeResultado`. Las pestañas del cierre y las celdas de las descargas dicen lo mismo (R4/R5). |
| `cierre-factura.tsx:1424` `SIN_GESTION_ORIGEN_LABEL` | «En reparto», «Ayuda de la tienda» | `nombreDeEstado(origen)` (histórico `ayuda_tienda` → R11). |
| `novedades/_components/novedad-grupo-textos.ts` | Pestaña «En devolución» (lista `devuelta`); subtítulo con «en devolución»/«rechazo» | Pestaña = «Novedad» (un solo estado, R5); ARIA y vacíos con «novedad»; subtítulo reescrito con los nombres. La pestaña de ayuda es un grupo (454) y conserva «Ayuda solicitada». |
| `AnaliticaOperativaRollupRepository.ts:132` `label: f.value` | Código crudo | `label: nombreDeEstado(f.value)`. |
| `analitica/_components/entregas/ConteoPorStatusDona.tsx:93` `etiquetaDeStatus` | Humaniza el código | Se retira; usa `nombreDeEstado` (R3, R42). |
| `analitica/_components/entregas/CohorteCargaTabla.tsx:143-144` | «Entregadas», «Devueltas» (esta última rotula `devuelta_a_tienda`) | Nombres exactos. |
| KPIs y columnas «Entregadas» (`KpisMensajero.tsx:30`, `KpisEfectividad.tsx:85`, `madurez-textos.ts:73`, `ranking-descarga-columnas.ts:48`, `ranking-historico-labels.ts:30`, `analitica-productos-descarga-columnas.ts:78-79`) | Plural | Regla 2: «Entregado», «Devolución a origen por rechazo». Métricas que no son un estado («Efectividad», «Tasa de entrega») no se tocan. |
| `catalogo-paneles.ts:114`, `metrics.ts:322`, `HoyGestionBarras.tsx:53` «Sin gestionar» | Mezcla estado y «sin gestión hoy» | T0.3 clasifica: si cuenta órdenes en `novedad_interna` → «Novedad interna»; si cuenta «órdenes sin gestión en el día» → «Sin gestión en el día» (grupo). |
| `recoleccion/_components/useRecolectarPorGuia.ts:62` | Toast con código crudo | `nombreDeEstado(result.estado)`. |
| `lib/auth/menu-visibility.ts:408` y `mis-asignaciones/recoger/page.tsx:45` «Por recoger» | Título de acción con forma de estado | «Recoger en bodega» (acción, R6). La ruta `/mis-asignaciones/recoger` **no** cambia (R51). |
| Mensajes con estado interpolado (`traspaso-error-messages.ts`, `corregir-dia-reparto-error-messages.ts`, `deshacer-asignacion-error-messages.ts`, `Escaner*.tsx`, `lib/services/mensajes-*.ts`) | Mezcla de `estatusLabel` y literales | Todos interpolan `nombreDeEstado`; los literales escritos a mano salen (T0.3 los lista). |
| `lib/notificaciones/emitir.ts:60` `TEXTO_ORDEN_RECHAZADA` | «Una orden fue rechazada por el destinatario.» | «Devolución a origen por rechazo: el destinatario rechazó una orden.» (contiene el nombre exacto, R36). Las filas ya emitidas no se reescriben. |
| `openapi-spec.ts:40` `ORDER_STATUS_ENUM` | Lista a mano, le faltan 6 | `[...ORDER_STATUS_SEED]` (R29). |
| Descargas de órdenes, cierres, satélite, novedades | Vía `estatusLabel`/mapas del cierre | Heredan; T0.3 confirma que ninguna escribe el código. |
| `docs/ayuda/**` (9 archivos con nombres viejos) y el asistente | Texto | §7. |

### 2.2 Satélite (SF-001) y filtro por URL

`recepcion-satelite` filtra por **código** en la URL (`filtro-estado-def.ts:95-97`, `satelite-ordenes-filtros.ts`).
El parser de ese parámetro aplica `codigoVigente` **antes** del `z.enum` (R22): un enlace guardado con
`estado=por_devolver` abre el listado de `por_devolver_a_bodega_central`, no una lista vacía ni un error. Mismo
tratamiento para cualquier otro parámetro interno por código que T0.3 encuentre.

`EXCLUDE_ESTADO_DEFAULT = ["pendiente"]` (`filtro-estado-def.ts:72`) se retira: `estadosOfrecidos` ya descarta
todo lo que no está en el seed (`:86`, `:117`), así que era redundante; R18 lo cubre con un test.

---

## 3. Base de datos

### 3.1 Migraciones (escritas a mano)

> `pnpm run db:migrate:create` no funciona (P3006). El DDL de `schema.prisma` se obtiene con
> `prisma migrate diff --from-migrations db/migrations --to-schema-datamodel db/schema.prisma --script` y se
> contrasta con lo escrito; el DML es manual. Timestamps posteriores a las de la 454 (comprobar contra
> `origin/dev` al abrir el PR: el pre-vuelo caduca).

| # | Carpeta | UP | DOWN |
|---|---|---|---|
| M1 | `<ts>_order_status_nombre_unico` | 7 `UPDATE "order_status" SET "value" = '<vigente>' WHERE "value" = '<anterior>';` (igualdad exacta, patrón `20260724120000`). Antes, un `DO` que falla con `RAISE EXCEPTION` si **ya** existe una fila con el código vigente **y** otra con el anterior (dos filas para un estado: la dejaría un seed corrido fuera de orden, R20). | Los 7 `UPDATE` inversos. |
| M2 | `<ts+1>_gestion_resultado_nombre_unico` | Por cada uno de los 4: `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'gestion_resultado' AND e.enumlabel = '<anterior>') THEN ALTER TYPE "gestion_resultado" RENAME VALUE '<anterior>' TO '<vigente>'; END IF; END $$;` (idempotente, R16). | El mismo `DO` al revés. **Sin** `CREATE TYPE … AS ENUM (lista)`. |
| M3 | `<ts+2>_order_status_retiro_huerfanos` | `DELETE FROM "order_status" WHERE "value" IN ('en_fulfillment','pendiente') AND NOT EXISTS (…)` sobre **todas** las FK a `order_status` (`orden.estatus_id`, `orden_historial_estado` origen y destino, `cierre_sin_gestion.estatus_origen_id`, `analytics_daily.estatus_id` y cualquier otra que liste `information_schema` en T1.3). | `INSERT … SELECT gen_random_uuid()::text, v WHERE NOT EXISTS` por cada uno (nadie los referenciaba, así que un id nuevo no rompe nada). |

- **R19**: SQL puro; no pasa por `appendCambioEstado`; ningún `INSERT` en `jobs` ni en `notificacion`.
- **Round-trip** en `tests/integration/db/455/migracion.test.ts`: base sembrada con filas en los 7 estados, 4
  resultados, historial, `cierre_sin_gestion`, `analytics_daily`, una vista guardada, un `orden_evento` (454) y
  un snapshot; UP → ids idénticos, conteos idénticos, `pg_enum` con las etiquetas nuevas, 0 filas con códigos
  anteriores; UP otra vez → 0 cambios; DOWN → foto idéntica a la inicial; UP → idéntica a la primera UP.
- **Encadenado histórico (declarado, no se toca)**: el `down.sql` de `20260730120000_incidente_indemnizacion`
  recrea `gestion_resultado` con los 4 códigos anteriores (`:67-76`). Un rollback que salte el DOWN de M2 y
  llegue a ese fallaría con error de conversión (**ruidoso**, no mudo). Los `down.sql` previos no se editan
  (son fotos históricas; memoria «Enum nuevo y los down.sql previos»).

### 3.2 `schema.prisma`

`enum GestionResultado { entregado reprogramado novedad devolucion_a_origen_por_rechazo incidente @@map("gestion_resultado") }`
**sin `@map` por valor**: el código de TypeScript, de Prisma y de Postgres es el mismo (DC). Comentarios de
`OrderStatus` (`:470-475`) y de los enums que citan valores se reescriben con fecha. Tras cambiarlo, `prisma
generate` y reinicio del dev server (memoria «404 que es error de servidor»).

### 3.3 Sembrado

`seedOrderStatus` (upsert por `value`) gana una comprobación previa: si existe alguna fila cuyo `value` sea
clave de `CODIGO_VIGENTE_DE_ANTERIOR`, lanza `Error("order_status: la base tiene el código anterior '<x>'; aplica
la migración 455 antes de sembrar")` sin escribir nada (R20). Sin esto, sembrar una base sin migrar crearía una
**segunda** fila `entregado` junto a `entregada`: dos estados con el mismo nombre visible.

### 3.4 Datos guardados: qué pasa con cada uno

| Dato | Guarda | Qué hace la ficha |
|---|---|---|
| `order_status.value` | código | M1 (id preservado). |
| `gestion_orden.resultado`, `orden_evento.resultado/resultado_anterior` (454) | enum | M2 (OID preservado; ninguna fila cambia). |
| `orden.estatus_id`, historial, `cierre_sin_gestion`, `analytics_daily` | FK (id) | Nada. |
| `vista_filtro.filtro` (453) | ids de catálogo en `seleccion.status_id` (única superficie encendida: `/ordenes`) | Nada; R21 lo prueba. Si T0.3 encuentra una superficie que guarde **códigos**, se añade un migrador v1→v2 en `leerPayloadGuardado` (el camino que la 453 dejó escrito en `vista-filtro.ts:118-120`). |
| `jobs.payload` `webhook_estado` | `estatusDestinoId` (id) | Nada: se resuelve el código al entregar (R28). `webhook_evento` (454) guarda `ordenEventoId`. |
| `historial_accion.valor_anterior/valor_nuevo` (`cierre_dia_gestion_corregida`) | código de resultado (snapshot) | Traducción al leer con `codigoVigente` (R23). |
| `orden_habilitacion_api.estado_resultante` | código (snapshot, sin lector) | Nada; si un día tiene lector, traduce al leer. |
| Plantillas de WhatsApp | texto libre + clave de variable | Nada: la variable cambia su salida (R35). |
| `notificacion` ya emitidas | texto | Nada (fuera de alcance). |
| Cualquier otra columna de texto/JSON | ¿? | **T0.2 lo mide**: barrido de todas las columnas `text`/`varchar`/`json`/`jsonb` de la base (local y producción, solo lectura) buscando los 7 códigos como token. Lo que aparezca se decide con esta misma tabla. |

---

## 4. Rastreo público (DF)

- `RastreoPublicoDTO` pasa a `{ numGuia, nombreVigente: string, actualizadoEn, linea: { nombre: string; fecha:
  string; pendiente?: true }[] }` (sigue siendo lista blanca cerrada, 229/R22).
- `RastreoPublicoService` proyecta cada fila de historial con `nombrePublicoDeEstado` y **fusiona los tramos
  consecutivos con el mismo nombre** (la misma regla de «rachas» de hoy, ahora por nombre): un
  `en_reparto → ayuda_tienda → en_reparto` histórico se sigue viendo como un solo «En reparto» (R34).
- La señal pendiente de la 454 es la última entrada con `pendiente: true` y `nombre = nombreDeResultado(r)`;
  la página pinta `SENAL_PENDIENTE(r)` (R33).
- Consecuencia declarada de la transparencia: el destinatario verá «Novedad interna», «Incidente» y
  «Devolución a origen por rechazo», que la 229 escondía (G6/G7/G8). Es lo pedido.
- **Frontera**: la respuesta no lleva códigos. `rastreo-sin-estatus-crudo.guardia.test.ts` se reescribe
  (fechado): cada `nombre` ∈ `Object.values(NOMBRE_ESTADO)` y ninguna cadena del resultado contiene un código
  vigente o anterior. La homonimia `en_reparto` que ese archivo documenta desaparece (el DTO ya no lleva ids de
  hito), y su contraprueba se conserva con los códigos.
- `censo-order-status-rename.test.ts` retira de su allowlist las cuatro entradas de la homonimia del hito
  `en_bodega` (`:131-134`) cuando el hito deje de existir.

---

## 5. Canal de integración

### 5.1 Campos `XNombre` (R24, R25)

| Superficie | Campos de código → hermanos |
|---|---|
| `GET /api/ordenes/api-key` (ítem) y `/orden/{id}` (detalle) | `estado` → `estadoNombre` |
| Detalle `gestiones[]` | `resultado` → `resultadoNombre`; `estadoResultante` → `estadoResultanteNombre` |
| `DELETE /orden/{id}`, `PUT /{numGuia}/cancelar`, `POST /habilitar` | cada `estado`/`estadoResultante` que devuelvan → su `…Nombre` (T1.6 enumera con el contrato) |
| `POST /carga` | `filas[].estatus` → **`filas[].estado` + `filas[].estadoNombre`** (R27) |
| Webhook `orden.estado_actualizado` | `data`: `numGuia, numRemision, estado, estadoNombre, motivo, mensajero, evidenciasUrl?` |
| Webhooks de la 454 (`orden.gestion_*`, `orden.ayuda_*`) | `resultado` → `resultadoNombre`; `resultadoAnterior` → `resultadoAnteriorNombre` |

- El nombre sale siempre de `nombreDeEstado`/`nombreDeResultado`: el DTO no lo calcula a mano.
- El `eventoId` no cambia de fórmula (`dedupeKeyWebhookEstado(ordenId, estatusDestinoId, ocurridoAt)`, ids): un
  job encolado antes y entregado después lleva el código vigente (se resuelve por id al entregar) y el mismo
  `eventoId` (R28).
- La **firma** cubre el cuerpo entero; insertar `estadoNombre` tras `estado` cambia el texto firmado, que es lo
  esperado (los integradores verifican sobre el texto crudo, CHANGELOG 2026-09-01).

### 5.2 Código anterior (R26)

El schema zod del parámetro `estado` (`GET /api/ordenes/api-key`) acepta `z.enum(ORDER_STATUS_SEED)`. Antes
del enum, un `superRefine` detecta `value in CODIGO_VIGENTE_DE_ANTERIOR` y emite el issue
`«'<anterior>' ya no existe: desde el <fecha de release> se llama '<vigente>'»`. Respuesta `422` con el shape
`Error` de siempre. Un código que no es ni vigente ni anterior sigue su camino de hoy (T1.6 lo caracteriza en
T0: si hoy es página vacía, pasa a `422` genérico y se anuncia en el CHANGELOG).

### 5.3 Contrato publicado (R29, R30)

- `openapi-spec.ts`: `ORDER_STATUS_ENUM = [...ORDER_STATUS_SEED]`, `GESTION_RESULTADO_ENUM` derivado del enum de
  Prisma, `XNombre` declarados (`type: string`, en `required`), ejemplos reescritos. El enum del webhook sigue
  derivándose de `EVENTOS_PUBLICOS` (con códigos vigentes). `docs/api/api-key-openapi.yaml` espejo exacto
  (`openapi-contrato-en-reparto.test.ts` y `openapi-webhook-contrato.test.ts` lo muerden).
- `docs/api/ordenex-api-key.postman_collection.json`: ejemplos y el valor de ejemplo del filtro `estado`.
- `docs/api/CHANGELOG.md`: entrada «RUPTURA — los estados cambian de código y ganan su nombre» con: la tabla
  §0.1 (solo las 7 filas que cambian) y §0.2; los campos `…Nombre`; `estatus` → `estado` en la carga; el `422`
  por código anterior; que el `eventoId` no cambia; la fecha de despliegue; y el «qué hacer» (buscar los 11
  literales en su código). Se escribe como el aviso que se copia y se manda (convención del propio archivo).
- Manual de integradores en el repo: `docs/ayuda/oficina/configuracion-api.md` y
  `docs/api/manual-metricas-por-mensajero.md` sin códigos anteriores (la guardia R40 los incluye en su barrido de
  `docs/`). Si existe un manual fuera del repo (Abierto), la release lo lista como pendiente de reenviar.

---

## 6. Guardias

Todas usan el quitador de comentarios del repo (`tests/fixtures/sin-comentarios.ts`) **o** el escáner de
TypeScript (`ts.createScanner`), y se prueban contra una mutación en su propio archivo (R44). El
implementador elige entre los dos por pieza: el quitador tiene el fallo conocido de los comodines de ruta
dentro de comentarios (`menu-visibility.ts:376-387`), que el escáner no tiene.

### 6.1 G1 — códigos anteriores (R40): se **extiende** `censo-order-status-rename.test.ts`

- Brazo nuevo `455`: sobre tokens de TypeScript/TSX (literal de cadena, plantilla, nombre de propiedad), sobre
  `.sql` y `.json`, busca **igualdad exacta** con uno de los 7 códigos anteriores o su aparición como
  `'<código>'` dentro de SQL. No mira comentarios: «entregada» es castellano y los comentarios en prosa lo usan
  (la 135 pudo escanear comentarios porque `en_espera_aceptacion` no es una palabra).
- `\bpor_devolver\b` no marca `por_devolver_a_tienda` ni `por_devolver_a_bodega_central` (el `_` es carácter de
  palabra): caso explícito en el test, como los de `en_bodega`/`en_ruta`.
- Excepciones con motivo escrito: el módulo de §1.1 (`CODIGO_VIGENTE_DE_ANTERIOR`), los tests de migración de
  la 455, este archivo, y las que ya tiene. `db/migrations/**` no se escanea.
- Se conserva el caso «los values del censo son DISJUNTOS del catálogo vigente» ampliado a los 7.

### 6.2 G2 — nombres retirados (R41, R9): `nombres-estado-retirados.guardia.test.ts` (nuevo)

- En código: literal de cadena o texto JSX **igual** (tras `trim`) a un nombre de §0.3, o que lo contenga entre
  comillas angulares/dobles (`«Entregada»`). Igualdad y no «contiene»: «Devuelta a tienda» es vigente y contiene
  «Devuelta».
- En `docs/ayuda/**` y `docs/api/**`: el nombre retirado entre `«»`, `**`, comillas o backticks, y `\bB\.\s` como
  abreviatura de bodega.
- Sobre los textos del asistente (§7): el contexto que devuelve `contextoPara(docs, rol)` para cada rol.

### 6.3 G3 — fuente única (R42, R12): se **extiende** la cláusula (f) de `tests/unit/tablero-dia/frontera.guardia.test.ts`

Hoy vigila mapas de **color** por estado en el tablero. Se generaliza a todo el árbol: falla si, fuera de
`lib/types/order-status.ts`, un objeto literal tiene ≥ 2 claves que son códigos de estado con valor `string`
que no es una clase de Tailwind/token, o si aparece `.replaceAll("_", " ")`/`.replace(/_/g, " ")` sobre algo
llamado `*status*`/`*estatus*`/`*estado*`. Y falla si un mapa de presentación está indexado por un texto
visible de §0.1 (el caso de `pos-estado.ts:27-43`).

### 6.4 G4 — el catálogo es el aprobado (R43)

`nombre-estado-catalogo.test.ts`: `NOMBRE_ESTADO` comparado contra la tabla §0.1 **escrita a mano en el test**
(literal de contrato, memoria «Literal: contrato o polizón»), nombres únicos, y el conjunto igual a la primera
columna de `specs/456-tooltip-estados/textos-aprobados.md` (leída del disco).

### 6.5 G5 — contrato (R24, R25, R29)

`openapi-contrato-*`: todo schema con una propiedad `estado`/`resultado`/`estadoResultante`/`estadoAnterior`/
`resultadoAnterior` tiene su `…Nombre`; y un test de servicio por superficie de §5.1 afirma
`xNombre === nombreDeEstado(x)` con datos reales (no contra la función que lo genera sola: también contra el
literal esperado de una fila, memoria «Aserción contra su propia fuente»).

---

## 7. Documentación de ayuda y asistente (SF-001)

- `docs/ayuda/**`: cada estado por su nombre exacto; la página `mensajero/por-recoger.md` pasa a titularse
  «Recoger en bodega». Los **slugs y nombres de archivo no cambian** (los enlaza `PageHeader` y la guía de
  ayuda de SF-001; cambiarlos rompe enlaces sin ganancia visible).
- El asistente (436) arma su contexto desde `docs/ayuda/**` (`specs/436-asistente/design.md` §contexto): alinear
  los documentos alinea su fuente. Si en `dev` tiene texto fijo propio (system prompt, respuestas de rechazo),
  T2.10 lo revisa y G2 lo barre.

---

## 8. Despliegue y ventana

1. La migración corre en el build **antes** de que el código nuevo sirva, pero el **código viejo sigue
   sirviendo** mientras dura el build. En esa ventana, un mensajero que registre una gestión con el código viejo
   recibirá un error (el valor `entregada` ya no existe en el enum) y una consulta con `value = 'entregada'`
   no encontrará nada. Mitigación: desplegar fuera de horario de reparto (el humano fija la hora; es la misma
   ventana que necesita la 454) y medir tras el despliegue que no hubo errores de runtime (`get_runtime_errors`,
   memoria «Diagnosticar prod con los logs de Vercel»).
2. Tras desplegar: `SELECT value FROM order_status` (20 vigentes + los huérfanos que R18 haya conservado),
   `SELECT enumlabel FROM pg_enum … gestion_resultado` (5 vigentes), 0 filas con códigos anteriores en el
   barrido de T0.2, y un webhook real de prueba con `estadoNombre`.
3. Aviso a integradores **antes** de la fecha (CHANGELOG), con la audiencia medida (memoria «Puerta de
   despliegue: mide la audiencia»).

---

## 9. Alternativas descartadas

### A · Columna `nombre` en la tabla `order_status`
La base como fuente del nombre. **Descartada** (ya lo fue en la 153, §6.3): el nombre lo necesitan módulos puros
y componentes cliente sin acceso a la base, la exhaustividad (`satisfies Record<OrderStatusValue, …>`) solo
existe en TypeScript, y una columna editable divergería del código sin que el build lo note.

### B · Cambiar solo los nombres visibles y conservar los códigos
No rompe a nadie. **Descartada por el humano** («es mejor dejar todo bien ahora que aún es barato»), y con razón:
un integrador que lee `devuelta` para lo que la app llama «Novedad» vuelve a tener dos nombres para un estado.

### C · No renombrar `gestion_resultado`
Ahorra M2. **Descartada** (§1.3): las palabras son las mismas en 1 166 + 3 981 apariciones y no se separan
mecánicamente, la guardia R40 dejaría de poder prohibirlas, `ESTATUS_POR_RESULTADO` dejaría de ser la identidad
y la API publicaría dos códigos distintos para el mismo desenlace.

### D · Aceptar los códigos anteriores como alias durante un tiempo
Amortigua la ruptura. **Descartada**: el humano la acepta; el alias perpetúa dos nombres, alguien tendría que
acordarse de retirarlo y, mientras, el contrato publicaría dos listas. El `422` con el código vigente en el
mensaje convierte la ruptura en una instrucción.

### E · Reescribir los snapshots (`historial_accion`, `orden_habilitacion_api`)
Dejaría la base sin códigos anteriores. **Descartada**: esas filas se declararon evidencia de un instante
(`schema.prisma:1024`), el `down.sql` tendría que revertirlas y distinguir las escritas antes y después;
traducir al leer cuesta una función que ya hace falta para las URLs.

### F · Renombrar también familias del historial, tipos de notificación, tipos de job y columnas
Por la regla «se llame igual en todas partes». **Descartada**: nombran **procesos** o **medidas**, no estados
(`escalado_devuelta_sla` es «el escalado de una devolución», `entregadas` es una columna de conteo), nunca
llegan crudos a una persona, y renombrar valores de `orden_historial_origen_tipo` obliga a pelear con los
`down.sql` que recrean ese enum con lista (memoria). Si un texto visible deriva de ellos, ese texto sí se
alinea (§2.0).

### G · Mantener los hitos del rastreo y solo cambiarles el texto
Menos cambio en la frontera pública. **Descartada**: el humano pide que el destinatario vea los mismos nombres
que la oficina; nueve hitos para veinte estados son, por construcción, nombres paralelos.

### H · Códigos cortos (`recogiendo`, `rechazo`, `por_devolver_central`)
Más cómodos de escribir. **Descartada**: rompen la regla DB, obligan a una tabla para deducir el código del
nombre, y `rechazo` volvería a no decir que el paquete va de vuelta.

### I · Renombrar también `en_ruta_bodega_central`/`en_ruta_bodega_satelite` para que sigan la regla DB
**Descartada**: el humano listó exactamente qué cambia y dijo que el resto conserva su nombre; tocar dos códigos
más rompe a integradores sin que cambie nada visible.

### J · Feature flag para desplegar primero los nombres y luego los códigos
**Descartada**: dos rupturas del contrato en vez de una, y una ventana en la que la API diría `devuelta` con
`estadoNombre: "Novedad"`.

---

## 10. Riesgos

1. **SQL crudo que compila y falla en runtime**: un `'entregada'` dentro de `$queryRaw` no lo ve el compilador.
   Cubierto por la Fase 0 (caracterización contra Postgres real de cada consulta cruda, memoria «Probar el
   WHERE donde vive») y por G1, que lee SQL dentro de plantillas.
2. **Cliente Prisma rancio** tras cambiar el enum: falsos rojos/verdes en local y en el typecheck del build de
   Vercel (memoria «CI = solo deploy de Vercel»). `prisma generate` en cada worktree y reinicio del dev server.
3. **Base local compartida**: M1-M2 ponen rojo el gate de cualquier otro worktree sin la ficha (memoria). Avisar
   en `progress/current.md` antes de migrar la base local.
4. **Ruptura de integraciones**: aceptada; la mitigación es el aviso previo con audiencia medida y el `422`
   explicativo.
5. **Volumen del cambio en tests** (~4 000 literales): se hace con el reemplazo mecánico **después** de fijar la
   caracterización con el interruptor de códigos (T0.1), de modo que los tests de la Fase 0 no se editan.
