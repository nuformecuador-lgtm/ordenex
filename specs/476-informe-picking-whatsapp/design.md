# 476 — Informe de picking por WhatsApp — design

> Requisitos en `requirements.md` (R1–R30). Contrato de la 474 leído en su rama (worktree
> `.claude/worktrees/agent-ae9899ade67378902`, HEAD `52e349f5`), porque aún no está en `dev`. El
> resto, en `dev` @ `6d919734`. Grafo `codebase-memory` para localizar; cada pieza citada se confirmó
> en el archivo real.

## 0. Qué existe y qué falta (medido)

| Pieza | Dónde | Para esta ficha |
| --- | --- | --- |
| Contrato de informe | 474: `lib/whatsapp-envios/informes/tipos.ts` (`InformeWhatsapp<P>`, `DescriptorParametro`, `ResultadoInforme`) | Se implementa. Falta una rama de `ResultadoInforme` (§3.1) y un valor de catálogo de descriptor (§3.2). |
| Registro | 474: `informes/catalogo.ts` (`INFORMES_WHATSAPP`, `catalogoDeVariables`, `VARIABLES_COMUNES` con `destinatario_nombre`) | Se registra `picking` ahí. |
| Motor | 474: `EjecucionEnvioService.ejecutar` — re-valida parámetros con el zod del informe (R34 de la 474), llama a `generar` UNA vez por ejecución, guarda UN PDF (`pdf_ruta`), sube UN `media_id` y manda el mismo documento y los mismos `valores` a todos los destinatarios; un reintento reutiliza lo fijado (R35 de la 474). | No se toca salvo §3.1. De aquí sale la decisión D1. |
| Idempotencia | 474: `UNIQUE (envio_id, fecha_cr) WHERE origen = 'programado'` en `whatsapp_envio_ejecucion` | Una ejecución programada por envío y día CR: otra razón de D1. |
| `adminTienda` | 474: campo `aptoParaAdminTienda` del informe; `WhatsappEnvioService` rechaza el rol o un usuario `adminTienda` si el informe no es apto (líneas 266-270) | `picking` = no apto (D3). R5 sale gratis. |
| Panel de parámetros | 474: `app/(app)/configuracion/envios-whatsapp/_components/ParametrosInforme.tsx` pinta entero/decimal/booleano/texto/selección FIJA; para `origen: "catalogo"` pinta «todavía no se puede editar» | Falta la rama del catálogo de tiendas (§5). |
| Parser de producto | `lib/analytics/producto-parse.ts` (ficha 345): `parsearProducto`, `claveDeProducto`. Medido en producción (768 órdenes, 2026-09-01): `cantidad * nombre` en 761; 12 % con varios productos separados por `. `; nombres con punto interno y con `|`; parte por el MARCADOR, no por el punto. Módulo puro (guardia `tests/unit/analytics/modulo-puro.guardia.test.ts`). | Se reutiliza tal cual (R10). |
| Fusión por orden y forma visible | `lib/services/ConteoProductosService.ts` `deduplicarPorClave` (R26 de la 345) y `formaVisible` (R18 de la 345), ambas PRIVADAS | Se replican las dos reglas (R11, R12) en el módulo puro de la 476; ver alternativa E. |
| Nacimiento en preparación | `lib/services/destino-creacion.ts`: `fulfillment = true` ⇒ `en_preparacion`, `conGuia: false`. `lib/types/order-status-transiciones.ts:109`: la ÚNICA salida es `→ en_bodega_central` por `generacion_guia`, y ninguna arista entra en `en_preparacion` (solo la creación) | Las órdenes en preparación NO tienen guía (D2) y su entrada al estado es su nacimiento (R14, con el historial como red). |
| Historial | `orden_historial_estado` con índice `(orden_id, estatus_destino_id)` | Para R14 sin N+1. |
| Orden natural de remisión | `orden.clave_remision`, columna GENERADA con `COLLATE "C"` (ficha 423) | `ORDER BY clave_remision` para R26. |
| Fuente del PDF | `lib/pdf/etiquetas-fuente.ts` (Liberation Sans, subconjunto cp1252 + `₡` + `€`, 219 code points, `registrarFuente`, `cubreTextoEn`); `escribibleEnFuenteEstandar` documenta que jsPDF BORRA en silencio lo que la fuente no cubre | Se reutiliza (R22). |
| Hora CR | `lib/utils/fecha-cr.ts` (`fechaCalendarioCR`), 474 `informes/formato.ts` (`fechaCRLegible`, `horaCRLegible`) | Se reutilizan (R14, R16, R28). |
| Datos de hoy | 120 órdenes en preparación de tiendas con fulfillment (Sicommer 61, Gameos 34, Nuform 25), todas sin guía — cifra que dio el humano el 2026-10-05 | Tamaño esperado: < 5 páginas por tienda. |

## 1. Decisiones

### D1 — Un envío por tienda (parámetro `tiendaId` de una sola elección)

La maqueta pide «cada tienda recibe su propio PDF» y pinta casillas de tiendas. El contrato de la 474
no lo admite en un solo envío, y no por un detalle: `generar` se llama UNA vez por ejecución
(`EjecucionEnvioService.ts:149`), la ejecución guarda UN `pdf_ruta` y UN `media_id`, todas las entregas
llevan el mismo documento y los mismos `valores`, y el índice único de §1.4 de la 474 permite UNA
ejecución programada por envío y día. Las variables que pidió el humano («una por dato: tienda,
órdenes, unidades…») además solo tienen sentido con UNA tienda por mensaje.

Por eso: **un envío = una tienda**. Para tres tiendas, tres envíos («Picking Sicommer», …), cada uno
con su hora, sus destinatarios y su historial. El parámetro se llama «Tienda» y es de una sola
elección; el resto de la maqueta de parámetros se conserva (conteos por tienda, «Marcar las órdenes
atrasadas»). La nota de la maqueta «Una tienda sin nada en preparación no genera PDF» se cumple con
R8 («Sin novedades» en el historial). El pie del PDF NO dice «X e Y van en su propio PDF»: el informe
no sabe qué otros envíos existen.

Coste asumido y dicho: una tienda nueva con fulfillment NO entra sola; hay que crear su envío. Es
pregunta abierta 1 para el humano.

### D2 — Identificador = remisión

Una orden en preparación no tiene guía por construcción (§0). La maqueta enseña números de guía
porque se dibujó con datos inventados. El identificador es `num_remision` (único por tienda entre
órdenes vivas, índice parcial de la 294) y, si una fila trae `num_guia` (dato heredado, no lo produce
ningún flujo vigente), se añade «(guía N)» (R18). Cabecera de la columna: «Remisiones que lo llevan».

### D3 — No apto para `adminTienda`

El picking lo hace la bodega de Ordenex; la tienda ya ve sus órdenes en la app. Con D1 el PDF solo
lleva datos de UNA tienda, pero el rol `adminTienda` resuelve a TODAS las tiendas, y restringirlo a
«solo el usuario que ES la tienda del parámetro» exige un validador por informe y por parámetro en
`WhatsappEnvioService` (hoy un booleano). No se amplía aquí: `aptoParaAdminTienda: false` y el rechazo
lo hace la 474 (R5). Pregunta abierta 2.

### D4 — Tienda sin fulfillment al generar ⇒ `error`, no «vacío»

Si la tienda pierde el fulfillment (o deja de ser `adminTienda`) después de guardar el envío, el
historial NO debe decir «Sin novedades»: eso parece normal y oculta un envío que ya no sirve (familia
de los fallos mudos). La 474 no tiene canal para que un informe diga «error»: si `generar` lanza, la
ejecución queda en `generando` y la cola reintenta. Se añade la rama `{ tipo: "error"; motivo }` a
`ResultadoInforme` (§3.1). Las órdenes en preparación de una tienda que perdió el flag quedan FUERA
(R6, tal como lo pidió el humano: `usuario.fulfillment = true`).

### D5 — Días en preparación desde el historial, con la creación de red

Hoy la única entrada a `en_preparacion` es el nacimiento, así que `created_at` bastaría. Pero «una
imposibilidad razonada no es medida» (memoria): se toma `max(h.created_at)` de las transiciones con
destino `en_preparacion` y, si no hay ninguna (órdenes que el backfill de la 155 reasignó desde el
estado de fulfillment retirado, sin fila de historial), `orden.created_at`. Una arista nueva hacia el
estado no rompería el informe. Días = diferencia de fechas calendario CR (no de horas): una orden que
entró ayer a las 23:50 lleva 1 día.

### D6 — Fuente: la embebida de etiquetas para los datos; la estándar solo para rótulos fijos

Los textos que vienen de datos (tienda, producto, remisión) se dibujan con `fuenteEtiqueta`
(Liberation Sans, cubre `₡`, comillas y guiones tipográficos). Lo que su cobertura no tiene se
sustituye por `?` ANTES de dibujar y se cuenta (R22): jsPDF borra en silencio, y un producto que
pierde letras en una hoja de picking es un paquete mal preparado. Los rótulos fijos («Producto»,
«Unidades», «Total»…) usan Helvetica/Helvetica-Bold para la negrita y son literales de este módulo:
un test exige que todos sean `seguroEnFuenteEstandar` (nada de `—` ni `’` en ellos).

## 2. Modelo de datos

**Ninguna migración, ninguna tabla, ningún valor de enum, ninguna variable de entorno.** Solo
lectura de `orden`, `order_status`, `usuario`, `rol`, `orden_historial_estado`. RLS: no aplica (sin
tablas nuevas; la lectura va por el cliente de servidor, como el resto de repositorios).

## 3. Cambios en el contrato de la 474 (dependencia común con la 475)

Ambos son aditivos y pequeños. Si la 474 aún no está en `dev` cuando se implemente esto, se hacen en
esta rama tras mergear la 474; si la 475 los necesita también, **el primero que llegue los hace y el
segundo los reutiliza** (lo coordina el leader; este spec no toca `specs/475-*`). Es la misma línea de
`tipos.ts` y el mismo `if` del motor: si las dos fichas lo escriben, el conflicto de merge es seguro.

### 3.1 `ResultadoInforme` gana `{ tipo: "error"; motivo: string }`

- `tipos.ts`: la rama nueva en la unión.
- `EjecucionEnvioService.ejecutar`, justo después de `if (r.tipo === "vacio")`:
  `if (r.tipo === "error") return this.terminar(e.id, "error", r.motivo);` — terminal, sin mensaje,
  visible en el historial con su motivo, igual que los `error` que ya produce el motor.
- `prueba-envio.ts` y `aviso-interno.ts` no cambian (no la usan).

### 3.2 `DescriptorParametro`: catálogo `tiendas_fulfillment`

`opciones: { origen: "catalogo"; catalogo: "zonas" | "estados_orden" | "tiendas" | "tiendas_fulfillment" }`.
No se reutiliza `tiendas` porque su significado es «todas las tiendas», y el selector del picking
debe ofrecer solo las de fulfillment (R3). El panel de parámetros resuelve ese catálogo con la acción
de §5.

## 4. El informe

### 4.1 Archivos

| Archivo | Qué | Pureza |
| --- | --- | --- |
| `lib/whatsapp-envios/informes/picking.ts` | `crearInformePicking(deps)`: schema, descriptores, variables, `generar` | Recibe el lector por dependencias |
| `lib/whatsapp-envios/informes/picking-modelo.ts` | `construirModeloPicking(filas, { ahora, diasAtraso })` → modelo (grupos, totales, atrasadas, desde/hasta, valores) | Puro, sin IO ni reloj |
| `lib/whatsapp-envios/informes/picking-pdf.ts` | `pdfDePicking(modelo)` → `Uint8Array` (jspdf) | Puro dado el modelo |
| `lib/whatsapp-envios/informes/fecha-larga-cr.ts` | `fechaLargaCR(instante)` → «Lunes 5 de octubre de 2026» con tablas fijas de días y meses (sin `Intl`, determinista) | Puro |
| `lib/interfaces/repositories/IPickingRepository.ts` | `tiendaDelPicking(tiendaId)`, `ordenesEnPreparacion(tiendaId)`, `resumenTiendasFulfillment(ahora, diasAtraso)` | — |
| `lib/repositories/PickingRepository.ts` | `$queryRaw` (§4.3) | Solo SQL |

`catalogo.ts` registra `crearInformePicking()` cuya dependencia por defecto construye el repositorio
real PEREZOSAMENTE (dentro de la llamada, no al importar), con el `prisma` de `lib/db`. Así el
catálogo no abre conexión al importarse y la acción `listarInformesWhatsapp` sigue siendo barata.

### 4.2 Contrato

```ts
const parametros = z.object({
  tiendaId: z.string().uuid(),
  diasAtraso: z.number().int().min(1).max(30).default(2),
}).strict();

informe = {
  clave: "picking", nombre: "Picking",
  descripcion: "Lo que está «En preparación» de una tienda con fulfillment en el momento del envío, agrupado por producto, con las remisiones que lo llevan.",
  parametros, parametrosPorDefecto: { tiendaId: "", diasAtraso: 2 },   // ver nota
  descriptores: [
    { campo: "tiendaId", etiqueta: "Tienda", tipo: "seleccion",
      opciones: { origen: "catalogo", catalogo: "tiendas_fulfillment" },
      ayuda: "Solo aparecen las tiendas con fulfillment. Cada tienda va en su propio envío." },
    { campo: "diasAtraso", etiqueta: "Marcar las órdenes que llevan más de estos días en preparación",
      tipo: "entero", min: 1, max: 30,
      ayuda: "Salen señaladas junto a su remisión y resumidas arriba del PDF, para prepararlas primero." },
  ],
  variables: [ /* §4.5 */ ],
  generaDocumento: true, aptoParaAdminTienda: false, eventos: [], soloPorEvento: false,
  generar,
};
```

Nota sobre `parametrosPorDefecto.tiendaId = ""`: la 474 precarga los defaults (R13 de la 474) y valida
con el schema al guardar; `""` no es uuid, así que guardar sin elegir tienda da error en
`parametros.tiendaId` (R2). Es lo deseado: no hay una tienda «por defecto» razonable.

### 4.3 Consultas (R6, R14, R26, R29) — una por generación, más una de la tienda

`tiendaDelPicking(tiendaId)`: `SELECT u.id, u.nombre, u.fulfillment, r.value AS rol FROM usuario u
JOIN rol r ON r.id = u.rol_id WHERE u.id = $1` (`rol.value` es el enum `RolValue`,
`db/schema.prisma:27`; la tienda es `adminTienda`). Una fila o ninguna. Se puede escribir con
`prisma.usuario.findUnique({ select: { id, nombre, fulfillment, rol: { select: { value } } } })`.

`ordenesEnPreparacion(tiendaId)` — UNA sentencia:

```sql
SELECT o.id, o.num_remision, o.num_guia, o.producto,
       COALESCE(h.entrada, o.created_at) AS entrada
FROM orden o
JOIN order_status s ON s.id = o.estatus_id AND s.value = 'en_preparacion'
JOIN usuario t      ON t.id = o.tienda_id AND t.fulfillment = true
LEFT JOIN LATERAL (
  SELECT max(hh.created_at) AS entrada
  FROM orden_historial_estado hh
  WHERE hh.orden_id = o.id AND hh.estatus_destino_id = s.id
) h ON true
WHERE o.deleted_at IS NULL
  AND o.tienda_id = $1
ORDER BY o.clave_remision, o.id
```

- Los cuatro predicados (`s.value`, `t.fulfillment`, `o.deleted_at`, `o.tienda_id`) son los que el test
  de integración mata uno a uno (§7).
- El `LATERAL` usa el índice `(orden_id, estatus_destino_id)`: no hay una consulta por orden (R29).
- `ORDER BY clave_remision` da el orden natural de la 423 (R26) y el orden de las remisiones dentro de
  cada producto; `o.id` desempata y hace la salida determinista.
- Sin tope de filas: 61 es el máximo de hoy. El PDF pagina (R21).

`resumenTiendasFulfillment(ahora, diasAtraso)` (para R3) — UNA sentencia: tiendas `adminTienda` con
`fulfillment = true`, `LEFT JOIN` a sus órdenes en preparación no borradas con la misma expresión de
entrada, `count(*)` y `count(*) FILTER (WHERE <días CR> > $diasAtraso)`, `ORDER BY u.nombre COLLATE "C",
u.id`. Los días CR se calculan en SQL con la misma convención que `fecha-cr.ts` (CR = UTC−6 fijo:
`(($ahora AT TIME ZONE 'UTC') - interval '6 hours')::date - ((entrada AT TIME ZONE 'UTC') - interval '6
hours')::date`); un test cruza este conteo con `construirModeloPicking` sobre las mismas filas para
que las dos definiciones de «atrasada» no diverjan.

### 4.4 `generar(ctx)`

1. `tienda = tiendaDelPicking(tiendaId)`. Sin fila, rol distinto de `adminTienda` o
   `fulfillment = false` → `{ tipo: "error", motivo: "La tienda del envío ya no tiene fulfillment (o no
   existe): revisa el envío." }` (R7). Si existe, el motivo lleva su nombre.
2. `filas = ordenesEnPreparacion(tiendaId)`. Vacío → `{ tipo: "vacio", motivo: "La tienda <nombre> no
   tiene órdenes en preparación." }` (R8).
3. `modelo = construirModeloPicking(filas, { ahora: ctx.ahora, diasAtraso, tienda: tienda.nombre })`.
4. `{ tipo: "contenido", valores: modelo.valores, documento: ctx.conDocumento ? { bytes:
   pdfDePicking(modelo), nombreArchivo: modelo.nombreArchivo } : undefined }` (R24).

Nada escribe (R9). El instante es `ctx.ahora`, que fija el motor; un reintento de la 474 reutiliza
valores y PDF ya guardados, así que la foto de una ejecución no cambia.

### 4.5 `construirModeloPicking` (puro)

- Por orden: `items = parsearProducto(producto)`; fusión por `clave` sumando cantidades (R11). Sin
  ítems → la orden va al grupo especial «Sin producto indicado» con 0 unidades (R13).
- Por producto (clave): unidades = Σ, órdenes = lista de `{ identificador, cantidad, dias, atrasada }`
  en el orden de las filas (natural de remisión); forma visible = la de más órdenes, empate menor por
  unidades de código (R12, misma regla que `formaVisible` de la 345).
- Orden de grupos: unidades desc, empate forma visible asc por unidades de código (R17); «Sin producto
  indicado», si existe, al final.
- `dias = diferencia de fechaCalendarioCR(ahora) y fechaCalendarioCR(entrada)` en días; `atrasada =
  dias > diasAtraso` (R14, R15). Lista de atrasadas: días desc, empate orden natural.
- Identificador: `num_remision`, más ` (guía N)` si `num_guia` no es nulo (R18).
- Totales: órdenes = nº de filas; unidades = Σ de grupos; productos = nº de grupos SIN contar «Sin
  producto indicado»; atrasadas = nº de órdenes atrasadas (R20, R27).
- `valores` sale de ESTOS totales (R27), no de otra cuenta:

| Variable | Nombre en pantalla | Ejemplo | Valor |
| --- | --- | --- | --- |
| `tienda` | Tienda | Gameos | nombre de la tienda |
| `ordenes` | Órdenes en preparación | 25 | total de órdenes |
| `unidades` | Unidades | 41 | total de unidades |
| `productos` | Productos distintos | 10 | nº de productos |
| `atrasadas` | Órdenes atrasadas | 2 | nº de atrasadas («0» si ninguna) |
| `dias_atraso` | Días para marcar atrasada | 2 | el parámetro N |
| `remision_desde` | Primera remisión | NA-1069 | primera en orden natural (R26) |
| `remision_hasta` | Última remisión | NA-1101 | última en orden natural (R26) |
| `fecha` | Fecha del picking | 05/10/2026 | `fechaCRLegible(ahora)` (R28) |
| `hora` | Hora del picking | 06:30 | `horaCRLegible(ahora)` (R28) |

  Ninguna es `destinatario_nombre` (la añade la 474; su test de catálogo R46 lo vigila).
- `nombreArchivo = picking-<slug>-<fechaCalendarioCR(ahora)>.pdf`; slug = NFD sin diacríticos,
  minúsculas, todo lo que no sea `[a-z0-9]` → `-`, sin guiones repetidos ni en los extremos; vacío →
  `tienda` (R23).

### 4.6 `pdfDePicking(modelo)` — maqueta `PdfPicking.dc.html`

Dos pasos, para que el contenido del papel se pueda probar sin leer un PDF:
`maquetarPicking(modelo, medir)` (puro: recibe la función de medida de texto) devuelve las páginas
como listas de operaciones `{ texto, x, y, fuente, tamaño, estilo }` y rectángulos; `pdfDePicking`
crea el `jsPDF`, registra la fuente, pasa `doc.getTextWidth` como `medir` y ejecuta las operaciones.

A4 vertical, mm, márgenes ~15 mm. Orden de dibujo:

1. Encabezado: «Ordenex · Picking», nombre de la tienda grande, «Lo que está En preparación, agrupado
   por producto»; a la derecha `fechaLargaCR`, «HH:mm · hora de Costa Rica», cifras ÓRDENES y UNIDADES
   (R16). Raya naranja inferior (`#f26419`).
2. Bloque de atrasadas, solo si hay (R19): «N órdenes llevan más de D días en preparación,
   prepáralas primero:» + `remisión (X días)` separadas por « · ».
3. Tabla: Producto · Unidades · Remisiones que lo llevan · Listo (casilla de 18 px). Las remisiones se
   pintan como fichas que saltan de línea dentro de la celda; `×k` si cantidad > 1; atrasadas con fondo
   ámbar y `· Xd` (R17, R19). La fila crece con sus fichas; si no cabe, salta de página y repite la
   cabecera de la tabla (R21). Una fila más alta que una página entera (un producto en cientos de
   órdenes) se parte en varias filas «(continúa)»: el PDF nunca recorta.
4. Fila total: «Total · P productos» · U · «en O órdenes» (R20).
5. Nota: «Ordenado de más a menos unidades. «×2» = esa remisión lleva dos unidades del producto. Es la
   foto de las HH:mm: lo que entre después sale en el siguiente envío.» Y, si se sustituyó algún
   carácter, «N caracteres que no se pueden imprimir se muestran como «?».» (R22).
6. Pie en CADA página: «Ordenex · Picking <tienda> · <d mmm aaaa> <HH:mm>» y «Página X de Y» (R21). El
   total de páginas se conoce al terminar de maquetar: el pie se añade a cada página en una segunda
   pasada de `maquetarPicking`.

Fuente según D6. Medida de fichas con `getTextWidth` de la MISMA fuente con que se dibujan.

## 5. Pantalla (frontend, sobre la de la 474)

- `ParametrosInforme.tsx`: rama nueva para `tipo: "seleccion"` con `origen: "catalogo"` y `catalogo:
  "tiendas_fulfillment"` → componente `SelectorTiendaPicking` (nuevo, en `_components/`). Lista de
  opciones de UNA elección (radio) con «<nombre> · N órdenes · M atrasadas» (M en ámbar si > 0) según
  la maqueta; pide los datos a la acción de abajo con el `diasAtraso` actual del formulario y los
  vuelve a pedir cuando cambia (debounce corto). Sin tiendas con fulfillment → texto «No hay tiendas con
  fulfillment». La rama genérica «todavía no se puede editar» sigue para los demás catálogos.
- Acción nueva en `lib/actions/envios-whatsapp.ts`: `listarTiendasPicking({ diasAtraso })` → sesión → zod
  (`diasAtraso` entero 1..30) → `forbidden` si no es `maestro`, SIN llamar al repositorio (R4) →
  `{ status: "ok", tiendas: { tiendaId, nombre, ordenes, atrasadas }[] }`. DTO y schema en
  `lib/types/envios-whatsapp.ts`.
- La guardia `superficie-de-uso` exige que la acción nueva se use desde la pantalla en el mismo PR (no
  hace falta `@sin-superficie`).
- Texto de UI en lenguaje llano; nada de «SLA».

Por qué la lista de tiendas no viaja dentro de `listarInformesWhatsapp`: los conteos dependen del N
que el usuario está tecleando, y el resumen de informes es estático por diseño de la 474.

## 6. Integraciones

Ninguna nueva. El PDF lo guarda, lo sube a Meta y lo manda la 474. Plantilla: el humano crea en
`/configuracion/plantillas` una plantilla «de informe: Picking» con documento y la envía a aprobación
(flujo de la 474). Ejemplo de cuerpo, solo como guía para el humano (no lo crea el código):
«Hola {{destinatario_nombre}}, picking de {{tienda}} de las {{hora}}: {{ordenes}} órdenes, {{unidades}}
unidades, {{atrasadas}} con más de {{dias_atraso}} días.»

## 7. Mapa de trazabilidad R → test

Rutas bajo `tests/`. «int» = `tests/integration/db/` contra Postgres; cada una siembra SUS filas,
afirma el CONJUNTO exacto de ids (no `> 0`) y se mata con una mutación antes de darla por buena
(memorias «probar el WHERE donde vive» y «test de integración verde sin datos»).

| R | Test |
| --- | --- |
| R1 | `unit/whatsapp-envios/informe-picking.test.ts` (clave, `generaDocumento`, `aptoParaAdminTienda: false`, `eventos: []`, `soloPorEvento: false`); `unit/whatsapp-envios/catalogo-informes.test.ts` de la 474 sigue verde con el informe nuevo |
| R2 | `unit/whatsapp-envios/informe-picking.test.ts` (schema: uuid, 0/31/1,5 rechazados, default 2); `unit/services/whatsapp-envio-service-picking.test.ts` (guardar sin tienda → `parametros.tiendaId`) |
| R3 | int `picking-resumen-tiendas.test.ts` (solo `adminTienda` con fulfillment; conteos y atrasadas con N=2 y N=5; orden por nombre); `components/SelectorTiendaPicking.test.tsx` (pinta «N órdenes · M atrasadas», una elección, re-pide al cambiar N) |
| R4 | `unit/actions/envios-whatsapp-picking-actions.test.ts` (sin sesión, `admin`, `adminTienda` → sin llamar al repo) |
| R5 | `unit/services/whatsapp-envio-service-picking.test.ts` (rol `adminTienda` y usuario `adminTienda` rechazados con el informe REAL del catálogo) |
| R6 | **int `picking-ordenes-en-preparacion.test.ts`**: siembra en la tienda A (fulfillment) 2 en preparación + 1 en otro estado + 1 borrada; tienda B (fulfillment) 1 en preparación; tienda C (sin fulfillment) 1 en preparación → con A devuelve EXACTAMENTE las 2. Mutaciones obligatorias, cada una ROJA: quitar `s.value = 'en_preparacion'`; quitar `t.fulfillment = true` (con C como parámetro); quitar `o.deleted_at IS NULL`; quitar `o.tienda_id = $1` |
| R7 | `unit/whatsapp-envios/informe-picking.test.ts` (sin tienda, rol distinto, fulfillment false → `error` con motivo); `unit/services/ejecucion-envio-informe-error.test.ts` (rama §3.1: `error` terminal, sin entregas, sin PDF) |
| R8 | `unit/whatsapp-envios/informe-picking.test.ts` (cero filas → `vacio` con el texto exacto) |
| R9 | int `picking-ordenes-en-preparacion.test.ts` (tras `generar` por el catálogo: `updated_at` de las órdenes intacto, cero filas nuevas en `orden_historial_estado`; segunda generación «al día siguiente» con `ahora + 1 día` → la orden sigue saliendo; tras moverla a `en_bodega_central` → ya no sale) |
| R10, R11 | `unit/whatsapp-envios/picking-modelo.test.ts` («2 * Crema X» → 2; «Crema X» → 1; «1 * Base Dr. 1 * BASE C.» → dos productos; «2 * Base C. 1 * base c.» en la misma orden → 3 unidades y la orden UNA vez) |
| R12 | `unit/whatsapp-envios/picking-modelo.test.ts` (variantes «BASE C» ×2 órdenes y «Base C.» ×1 → «BASE C»; empate → menor) |
| R13 | `unit/whatsapp-envios/picking-modelo.test.ts` (producto «» → fila «Sin producto indicado», 0 unidades, cuenta en órdenes, no en productos) |
| R14 | `unit/whatsapp-envios/picking-modelo.test.ts` (entrada 23:50 CR de ayer → 1 día; frontera de medianoche CR en UTC); int `picking-ordenes-en-preparacion.test.ts` (orden con historial hacia `en_preparacion` posterior a su `created_at` → `entrada` = el del historial; sin historial → `created_at`) |
| R15 | `unit/whatsapp-envios/picking-modelo.test.ts` (N=2: 2 días no, 3 días sí) |
| R16, R17, R19, R20 | `unit/whatsapp-envios/picking-pdf.test.ts` sobre `maquetarPicking(modelo)` (§4.6: páginas con sus textos, fuente y estilo de ficha): nombre de tienda, fecha larga y «hora de Costa Rica», cifras, orden de filas, «×2», ficha de atrasada con días y estilo ámbar, bloque de atrasadas presente/ausente, fila total. Más un humo de `pdfDePicking`: bytes que empiezan por `%PDF`, nº de páginas = el de la maqueta (no hay `pdf-parse` en `package.json`; no se añade dependencia) |
| R18 | `unit/whatsapp-envios/picking-modelo.test.ts` (sin guía → remisión; con guía → «R (guía N)») |
| R21 | `unit/whatsapp-envios/picking-pdf.test.ts` (500 órdenes, 80 productos → > 1 página, cabecera de tabla en cada página, «Página X de Y» con Y correcto en todas) |
| R22 | `unit/whatsapp-envios/picking-pdf.test.ts` (producto con U+1D560 → «?» en la operación de texto y aviso «1 carácter…»; el resto del nombre intacto; todo texto de datos va con la fuente embebida y cabe en su cobertura); rótulos fijos: todos `seguroEnFuenteEstandar` |
| R23 | `unit/whatsapp-envios/picking-modelo.test.ts` («Gameos» → `picking-gameos-2026-10-05.pdf`; «Ñandú Más» → `picking-nandu-mas-…`; instante 23:30 CR = día siguiente en UTC → fecha CR) |
| R24 | `unit/whatsapp-envios/informe-picking.test.ts` (`conDocumento: false` → sin `documento`, `pdfDePicking` no llamado) |
| R25 | `unit/whatsapp-envios/informe-picking.test.ts` (las 10 claves exactas, ninguna vacía con contenido); `unit/whatsapp-envios/catalogo-de-variables.test.ts` de la 474 (`catalogoDeVariables("picking")` = las 10 + `destinatario_nombre`) |
| R26 | int `picking-ordenes-en-preparacion.test.ts` (remisiones «NA-107», «NA-1069», «BS-3» sembradas en desorden → desde/hasta según `clave_remision`); unit del modelo con filas ya ordenadas |
| R27 | `unit/whatsapp-envios/informe-picking.test.ts` (las cifras de `maquetarPicking` del mismo modelo = `valores` de la misma llamada a `generar`) |
| R28 | `unit/whatsapp-envios/informe-picking.test.ts` (instante 2026-10-06T05:30Z → «05/10/2026», «23:30») |
| R29 | `unit/repositories/picking-repository.test.ts` (doble de prisma: `ordenesEnPreparacion` hace UNA `$queryRaw` con 1 y con 60 órdenes); la forma `LATERAL` la ejerce la int de R6 |
| R30 | int `picking-ordenes-en-preparacion.test.ts`: llama a `informePorClave("picking")!.generar(...)` (el registrado, no una instancia de test) contra Postgres y obtiene las remisiones sembradas. Mutación: registrar el informe con un lector vacío → ROJO |

Sin E2E (no hay harness; memoria «nada de E2E»). La verificación visual del PDF y del selector la hace
el implementador con capturas y la compara con las maquetas (memoria «verificar lo que el usuario ve»).

## 8. Gate

`./init.sh --rapido` (regla 5). Esta ficha toca `lib/types/envios-whatsapp.ts` y añade tests de
`tests/integration/db/`: el rápido se clasifica **ampliado** y exige `DATABASE_URL` (si falta, falla:
no es un verde). Ninguna migración. Antes de mergear: `gh pr checks` (el gate no corre `next build`).

## 9. Alternativas descartadas

- **A. Ampliar el motor de la 474 para varios documentos por ejecución** («partes»: el informe devuelve
  una lista de `{ valores, documento }` y el motor manda un mensaje por parte y destinatario). Es lo
  que pinta la maqueta con un solo envío, pero cambia lo central de la 474 ya implementada y con gate
  verde: el único de entrega `(ejecucion_id, usuario_id)` pasaría a incluir la parte, `pdf_ruta` y
  `media_id` saldrían de la ejecución a una tabla nueva, y habría que rehacer R23, R33, R35, R43 y el
  historial de la 474. Para tres tiendas, tres envíos cuestan tres formularios.
- **B. Un PDF con una sección por tienda.** Encaja en el contrato, pero contradice lo pedido («UN PDF
  POR TIENDA») y deja sin sentido las variables `tienda`, `ordenes`, `unidades` (serían listas).
- **C. Lotes con código y marca en las órdenes**, como el sistema externo (código PK, no repetir
  pedidos). Descartado por el humano: exigiría una columna o tabla, un sitio que la limpie al avanzar
  de estado y otro que la reabra; es justo la familia de «marca persistida que alguien olvida apagar»
  que retiró la 235. La foto no guarda nada y repite lo que siga en preparación.
- **D. Días en preparación desde `orden.created_at` sin historial.** Hoy da lo mismo, pero dejaría de
  ser cierto el día que exista una arista hacia `en_preparacion`, sin que nada fallara (D5).
- **E. Extraer `deduplicarPorClave` y `formaVisible` de `ConteoProductosService` a un módulo
  compartido.** Evitaría replicar dos funciones de 10 líneas, pero toca un servicio de analítica con
  dinero (su gate se amplía) por una ficha que no lo necesita. Se reutiliza lo que ya es público
  (`parsearProducto`, `claveDeProducto`: la CLAVE, que es lo que no puede divergir) y se replican las dos
  reglas con su cita a los R de la 345.
- **F. Que «tienda sin fulfillment» salga como «vacío».** Sin tocar el contrato, pero el historial diría
  «Sin novedades» de un envío roto (D4).
- **G. Fuente estándar de jsPDF para todo.** Borra en silencio `₡`, `—`, `’` y cualquier cosa fuera de
  Latin-1 (medido en la ficha 350): un nombre de producto que pierde letras en una hoja de picking.

## 10. Riesgos

- **La 474 no está en `dev`.** Esta ficha no arranca hasta que se mergee; su rama nace de `dev` después.
- **Conflicto con la 475** en `tipos.ts` (unión de `ResultadoInforme` y de catálogos del descriptor),
  `EjecucionEnvioService.ts` (§3.1), `catalogo.ts` (registro) y `ParametrosInforme.tsx` (rama de
  catálogo). Secuenciar los merges o que la segunda reutilice lo de la primera (§3).
- **Envíos huérfanos**: si una tienda deja de tener fulfillment, su envío sigue encendido y cada día
  sale `error` en el historial (D4). Es visible, no se apaga solo.
- **Texto de producto fuera del formato** (7 de 768 en la medida de la 345): sale como un producto de
  cantidad 1 con el texto entero. Lo dice el PDF tal cual, sin inventar.
