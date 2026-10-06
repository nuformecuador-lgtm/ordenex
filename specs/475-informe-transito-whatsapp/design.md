# 475 — Informe de tránsito por WhatsApp — design

## 0. Punto de partida y dependencia

- La 475 implementa el contrato `InformeWhatsapp<P>` de la 474, que **aún no está en `dev`**: vive en
  `origin/feature/474-envios-automaticos-whatsapp` (backend F0–F9 hecho, `progress/impl_474.md`;
  pantallas en curso). Leído de esa rama: `lib/whatsapp-envios/informes/{tipos,catalogo,prueba-envio,
  aviso-interno,formato}.ts`, `lib/types/envios-whatsapp.ts`, `specs/474-.../design.md` §2 y el
  `ParametrosInforme.tsx` del frontend de la 474.
- **La rama de la 475 nace de la 474** (o de `dev` cuando la 474 esté mergeada). T0.1 lo fija con un
  `merge-base`. Ningún archivo de la 474 se reescribe: solo se **añade** una entrada al catálogo, un
  tipo de descriptor y una rama del renderizador del panel (§8).
- Contrato que se cumple (verificado por el motor de la 474, no por buena fe): una entrada en
  `valores` por variable no vacía tras `sanearValor` (R32 de la 474), PDF presente si la plantilla
  lo lleva (R33), parámetros re-validados con el `zod` del informe al ejecutar (R34), «vacío» lo
  decide el informe (R31).

**Sin migraciones y sin tocar `db/schema.prisma` ni `lib/types/`** (§1, §11): esto es lo que permite
que el gate sea `./init.sh --rapido` (regla 5 de `CLAUDE.md`; el rápido se niega solo si el diff toca
migraciones, `schema.prisma`, `lib/types/`, build o archivos con nombre de dinero). Por eso los tipos
nuevos viven junto al módulo (`lib/whatsapp-envios/informes/transito/`), como manda
`docs/conventions.md` («colocados junto al módulo que los usa»), y ningún archivo nuevo lleva en su
nombre `monto`, `cobro`, `wallet` ni similares.

## 1. Datos: de dónde sale cada cosa (sin modelo nuevo)

| Dato | Fuente | Por qué es fiable |
| --- | --- | --- |
| Estado actual | `orden.estatus_id → order_status.value` | Columna NOT NULL; códigos vigentes de `ORDER_STATUS_SEED`. |
| Zona | `orden.zona_id → zona` (`nombre`, `es_central`) | NOT NULL (R12 de la orden). **Nunca** texto (R8). `es_central` tiene a lo sumo una zona (índice único parcial). |
| Borrada | `orden.deleted_at IS NULL` | Soft delete del repo. |
| Monto por cobrar | `orden.monto_cobrar` `DECIMAL(12,2)` | CHECK `orden_monto_cobrar_entero_check`: siempre entero. Se suma con `Prisma.Decimal`, nunca `Number`. |
| Hito «entrada a bodega central» | `MIN(h.created_at)` de `orden_historial_estado h` con `h.estatus_destino_id` = id de `en_bodega_central` | El historial es append-only e inmutable (feature 49) y lo escribe el choke point `appendCambioEstado` **en la misma transacción** que cambia `orden.estatus_id`. Las dos vías que llevan ahí (`generacion_guia` desde `en_preparacion`, `recepcion_bodega_central` desde `en_ruta_bodega_central`) y las de vuelta (`liberacion_*`, `deshacer_asignacion`, `recuperacion_manual`) escriben destino `en_bodega_central`. Filtrar por DESTINO y no por `origen_tipo` hace que una vía nueva quede cubierta sin tocar este código. `MIN` = primera entrada; un reingreso no reinicia el conteo. |
| Hito «creación» | `orden.created_at` | NOT NULL, `default now()`. |
| Hito «generación de guía» | `MIN(h.created_at)` sobre las filas: `origen_tipo = 'generacion_guia'`; `estatus_origen_id IS NULL AND destino = por_recolectar_en_tienda` (creación); `origen_tipo = 'ruteo_satelite'`. Exige `orden.num_guia IS NOT NULL`. | No existe columna con el instante de la guía (medido: `num_guia` no tiene marca temporal en ninguna tabla). Los tres sitios que la asignan (`OrdenRepository.ts`: creación con `conGuia`, `generarGuiaLote`, `rutearBodegaSateliteLote`, todos con `WHERE num_guia IS NULL`) y `resolverDestinoCreacion` (nace en `por_recolectar_en_tienda` ⇔ `conGuia: true`) determinan que la guía se asigna en el primero de esos tres eventos. |
| Última transición (para «parado») | `h.created_at` más reciente de la orden (`ORDER BY created_at DESC, id DESC LIMIT 1`) | Mismo choke point; el desempate por `id` copia `cteEstatusAlCorte` de la analítica. Una gestión registrada sin transición (454) no mueve esta marca, y es correcto: el estado no cambió. |
| Cantón / distrito | `orden.canton_id → canton.nombre`, `orden.distrito_id → distrito.nombre` (nullable) | Se muestra «Cantón · Distrito», o solo el cantón si no hay distrito. |
| Nombre visible del estado | `nombreDeEstado(value)` de `lib/types/order-status.ts` | Fuente única de nombres (ficha 455). |

**Respaldo cuando falta el hito (R14).** La maqueta aprobada lo fija: «Si un paquete todavía no ha
pasado por ese momento, no entra en el informe». Para que la exclusión no sea un fallo mudo, se
**cuenta** (`sinHito`) y se dice en el PDF y en la vista previa. Casos reales que caen ahí con el hito
por defecto: órdenes en `en_ruta_bodega_central`, `por_recolectar_en_tienda`, `recolectando`, o un
`incidente`/`devolviendo_a_tienda` ocurrido antes de llegar a la central. Producción se vació el
2026-08-25: toda orden viva tiene historial completo, así que no hay órdenes «sin historial».

**Índices (existentes, sin migración).** `orden(estatus_id)` para el universo de candidatas;
`orden_historial_estado(orden_id, estatus_destino_id)` para el hito central;
`orden_historial_estado(orden_id, created_at)` para la última transición y el hito de guía;
`orden(zona_id)`. Las subconsultas laterales son por orden y recorren solo sus filas de historial
(decenas como mucho).

## 2. Módulos

```
lib/whatsapp-envios/informes/transito/
  parametros.ts      PURO y apto para cliente: zod, partida, ESTADOS_OFRECIDOS, CIERRE_LOGISTICO,
                     plazoEfectivo(), descriptores, tipos (ParametrosTransito, ZonaInforme…)
  calculo.ts         PURO: cortesPorZona(), clasificar() → ModeloInformeTransito, variables()
  pdf.ts             jspdf: pdfInformeTransito(modelo) → Uint8Array
  informe.ts         crearInformeTransito(deps) → InformeWhatsapp<ParametrosTransito>
  tipos.ts           FilaTransito, ConsultaTransito, ResultadoPrevisualizacion (DTOs)
lib/interfaces/repositories/IInformeTransitoRepository.ts
lib/repositories/InformeTransitoRepository.ts      SQL crudo (Prisma.sql), solo lectura
lib/actions/informe-transito.ts                    previsualizarInformeTransito(parametros)
app/(app)/configuracion/envios-whatsapp/_components/ParamsTransito.tsx   el panel
```

Toques a la 474 (aditivos): `catalogo.ts` registra `crearInformeTransito()`; `tipos.ts` suma el
descriptor `panel` (§8.1); `ParametrosInforme.tsx` suma su rama.

## 3. Parámetros (`parametros.ts`)

```ts
const HITOS = ["entrada_bodega_central", "creacion", "generacion_guia"] as const;

/** R5/R10 — nunca entran; no se ofrecen. */
export const CIERRE_LOGISTICO = ["entregado", "devuelta_a_tienda"] as const satisfies readonly OrderStatusValue[];

/** Orden del flujo = orden del panel y del bloque ATENCIÓN. `satisfies` + test de igualdad de
 *  conjuntos contra ORDER_STATUS_SEED − CIERRE_LOGISTICO: un estado nuevo rompe el test, no se
 *  queda fuera en silencio. */
export const ESTADOS_OFRECIDOS = [
  "en_ruta_bodega_central", "en_bodega_central", "mensajero_recogiendo_en_bodega",
  "en_ruta_bodega_satelite", "en_bodega_satelite", "en_reparto", "reprogramado", "novedad",
  "novedad_interna", "incidente", "devolucion_a_origen_por_rechazo", "por_devolver_a_bodega_central",
  "devolviendo_a_bodega_central", "por_devolver_a_tienda", "devolviendo_a_tienda",
  "en_preparacion", "por_recolectar_en_tienda", "recolectando",
] as const satisfies readonly OrderStatusValue[];

export const PARTIDA_PLAZO = {
  central: { plazoDias: 10, avisoDias: 2 },
  fuera:   { plazoDias: 20, avisoDias: 5 },
} as const;

parametrosTransitoSchema = z.object({
  hito: z.enum(HITOS),
  zonas: z.array(z.object({
    zonaId: z.string().uuid(),
    plazoDias: z.number().int().min(1).max(365),
    avisoDias: z.number().int().min(0),            // superRefine: avisoDias <= plazoDias - 1
  }).strict()).max(100),                           // superRefine: zonaId único
  estados: z.array(z.object({
    estado: z.enum(ESTADOS_OFRECIDOS),             // entregado / devuelta_a_tienda / retirados: rechazo
    incluido: z.boolean(),
    paradoSiMasDeDias: z.number().int().min(0).max(90).nullable(),
  }).strict()).max(ESTADOS_OFRECIDOS.length),       // superRefine: estado único, >= 1 incluido
  enviarSiVacio: z.boolean(),
}).strict();
```

- Un estado ofrecido que no aparece en `estados` = no incluido (así un envío guardado antes de que el
  catálogo gane un estado no empieza a mandar ese estado sin que nadie lo marque).
- Errores por campo con la ruta de zod (`parametros.zonas.3.avisoDias`), que es la convención de la
  474 (`parametros.<campo>`).
- `plazoEfectivo(zona, parametros)` implementa R6; la usa el cálculo y el panel (misma función).
- `PARAMETROS_POR_DEFECTO` = R5 con `zonas: []`.

## 4. Selección en la base (`InformeTransitoRepository`)

Interfaz:

```ts
interface IInformeTransitoRepository {
  zonas(): Promise<ZonaInforme[]>;                         // id, nombre, esCentral (todas, por nombre)
  filasEnAlerta(c: ConsultaTransito): Promise<FilaTransito[]>;
  contarSinHito(c: ConsultaTransito): Promise<number>;
}
interface ConsultaTransito {
  hito: Hito;
  estados: string[];                                       // incluidos (ya validados)
  cortes: { zonaId: string; corte: Date }[];               // una por zona existente
}
interface FilaTransito {
  ordenId: string; numRemision: string; numGuia: number | null; estado: string;
  zonaId: string; destinatario: string; canton: string; distrito: string | null;
  montoCobrar: Prisma.Decimal | null; hitoAt: Date; ultimaTransicionAt: Date | null;
}
```

**El corte se calcula en TypeScript, no en SQL.** Para la zona z con umbral `u = plazo − aviso`:
`corte_z = inicioDelDiaSiguienteCREnUtc(fechaCalendarioCR(ahora)) − u × 24 h`. Entonces
`hito < corte_z ⇔ diasNaturalesCRDesde(hito, ahora) >= u` (CR es UTC−6 fijo, sin horario de verano).
Así la base no hace aritmética de husos (cero `AT TIME ZONE`), el día se decide con los helpers del
repo (`lib/utils/fecha-cr.ts`) y la frontera queda en UN sitio testeable (R17). El ancla del día es la
misma que usa `diasNaturalesCRDesde`, que es la que pinta los días del PDF: el filtro y lo que se
muestra no pueden divergir.

SQL (forma; `Prisma.sql`, sin interpolar texto de usuario — el fragmento del hito sale de un mapa
cerrado de tres `Prisma.Sql`):

```sql
WITH cortes(zona_id, corte) AS (VALUES (...), (...)),        -- de c.cortes
cand AS (
  SELECT o.id, o.zona_id, o.num_remision, o.num_guia, o.destinatario, o.monto_cobrar,
         o.created_at, o.canton_id, o.distrito_id, s.value AS estado
  FROM orden o JOIN order_status s ON s.id = o.estatus_id
  WHERE o.deleted_at IS NULL
    AND s.value IN (${estados})
    AND s.value NOT IN ('entregado', 'devuelta_a_tienda')   -- R10, cinturón aunque zod ya lo impide
)
SELECT c.*, k.nombre AS canton, d.nombre AS distrito, hito.at AS hito_at, ult.at AS ultima_at
FROM cand c
JOIN cortes z            ON z.zona_id = c.zona_id
JOIN canton k            ON k.id = c.canton_id
LEFT JOIN distrito d     ON d.id = c.distrito_id
CROSS JOIN LATERAL (<fragmento del hito>) hito
LEFT JOIN LATERAL (
  SELECT h.created_at AS at FROM orden_historial_estado h
  WHERE h.orden_id = c.id ORDER BY h.created_at DESC, h.id DESC LIMIT 1) ult ON true
WHERE hito.at IS NOT NULL AND hito.at < z.corte
```

Fragmentos del hito:
- `entrada_bodega_central`: `SELECT MIN(h.created_at) AS at FROM orden_historial_estado h JOIN order_status sd ON sd.id = h.estatus_destino_id WHERE h.orden_id = c.id AND sd.value = 'en_bodega_central'`
- `creacion`: `SELECT c.created_at AS at`
- `generacion_guia`: `SELECT MIN(h.created_at) AS at FROM orden_historial_estado h LEFT JOIN order_status sd ON sd.id = h.estatus_destino_id WHERE h.orden_id = c.id AND c.num_guia IS NOT NULL AND (h.origen_tipo IN ('generacion_guia','ruteo_satelite') OR (h.estatus_origen_id IS NULL AND sd.value = 'por_recolectar_en_tienda'))`

`contarSinHito`: mismo `cand`, `COUNT(*) WHERE hito.at IS NULL` (sin cortes ni zona). El `JOIN cortes`
también descarta una orden de una zona que no vino en `cortes`; el servicio siempre pasa TODAS las
zonas leídas en la misma generación (R7 es el caso inverso: una entrada de parámetros sin zona real
no produce corte).

Por generación: **3 consultas fijas** (`zonas`, `filasEnAlerta`, `contarSinHito`), sin N+1 (R40).

## 5. Cálculo (`calculo.ts`, puro)

- `cortesPorZona(zonas, parametros, ahora)` → `{ zonaId, corte }[]` con `plazoEfectivo` (R6/R7).
- `clasificar(filas, zonas, parametros, ahora, sinHito)` → `ModeloInformeTransito`:
  - `dias = diasNaturalesCRDesde(hitoAt, ahora)`; `vencido = dias > plazo`; si no, por vencer (R15).
    Fronteras fijadas por la maqueta: «12/10» y «11/10» VENCIDO; «8/10» y «9/10» en alerta.
  - `diasEnEstado = ultimaTransicionAt ? diasNaturalesCRDesde(ultimaTransicionAt, ahora) : null`;
    `parado = umbral !== null && diasEnEstado !== null && diasEnEstado > umbral` (R16).
  - Agrupa por zona y ordena (R25/R26); bloque ATENCIÓN por estado en orden de `ESTADOS_OFRECIDOS`,
    dentro por días en el estado desc (R24).
  - Totales con `Prisma.Decimal` (suma), `toFixed(2)` → `formatMontoString` (`lib/config/moneda.ts`):
    `"322900.00"` → `₡322.900` (R20). Nunca `Number`/`parseFloat` sobre el monto (guardias vivas).
- `variables(modelo, ahora)` → `Record<clave, string>` de R2/R20; `fecha` con `fechaCRLegible` de la 474.

## 6. El informe (`informe.ts`)

```ts
export function crearInformeTransito(deps: { repo: IInformeTransitoRepository } = depsDeProduccion()):
  InformeWhatsapp<ParametrosTransito> {
  return { clave: "transito", nombre: "Informe de tránsito", descripcion: "...",
    parametros: parametrosTransitoSchema, parametrosPorDefecto: PARAMETROS_POR_DEFECTO,
    descriptores: [
      { campo: "transito", etiqueta: "Parámetros del informe de tránsito", tipo: "panel",
        panel: "transito", campos: ["hito", "zonas", "estados"] },
      { campo: "enviarSiVacio", etiqueta: "Enviar aunque no haya nada que informar", tipo: "booleano",
        ayuda: "Desactivado, si ningún paquete está en alerta la ejecución queda «Sin novedades» y no se manda nada." },
    ],
    variables: [...], generaDocumento: true, aptoParaAdminTienda: false, eventos: [], soloPorEvento: false,
    async generar(ctx) { /* zonas → cortes → filas + sinHito (Promise.all) → clasificar → vacío | contenido (+ PDF si ctx.conDocumento) */ },
  };
}
```

- Errores de lectura: se envuelven en `Error("informe transito: <operación> falló", { cause })` y se
  propagan (R22). Nunca `catch` que devuelva vacío: el motor de la 474 deja la ejecución en `error`.
- `depsDeProduccion()` construye `new InformeTransitoRepository(prisma)` de forma perezosa (el
  catálogo se importa en el servidor; no se importa en componentes cliente, regla del contrato 474).

Variables (ejemplos que viajan a Meta como ejemplo del parámetro):

| clave | nombre | ejemplo |
| --- | --- | --- |
| `total_en_alerta` | Paquetes en alerta | `15` |
| `vencidos` | Vencidos | `7` |
| `por_vencer` | Por vencer | `8` |
| `parados` | Parados | `8` |
| `por_cobrar` | Por cobrar en la calle | `₡322.900` |
| `en_alerta_gam` | En alerta en la GAM | `5` |
| `en_alerta_fuera_gam` | En alerta fuera de la GAM | `10` |
| `fecha` | Fecha del informe | `05/10/2026` |

## 7. PDF (`pdf.ts`)

- `new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true })`, fuente
  **embebida** con `registrarFuente(doc, fuenteEtiqueta)` (`lib/pdf/etiquetas-fuente*.ts`): las
  fuentes estándar (WinAnsi) no tienen `₡` (U+20A1) — es el defecto que la 282 ya pagó en etiquetas
  (R32). Import estático del artefacto, nada de `readFileSync`.
- Estructura (maquetas): encabezado (marca, título, subtítulo, fecha larga «Lunes 5 de octubre de
  2026», «05:00 · hora de Costa Rica», «Días contados desde …»); 4 recuadros; ATENCIÓN; zona central;
  salto de página y «Informe de tránsito · fuera de la GAM» con su resumen; zonas fuera; «Sin
  paquetes en alerta: …»; resumen de parámetros y «N paquetes aún no han pasado por <hito>: no se
  cuentan»; pie por página «Ordenex · Informe de tránsito · <fecha> <hora>» / «Página X de Y» (el
  total de páginas se pinta al final recorriendo `doc.getNumberOfPages()`).
- Vencido: fila en rojo **y** etiqueta de texto «VENCIDO»; parado: «PARADO» (R27).
- Paginación (R31): antes de cada fila se comprueba el espacio restante; si no cabe, `addPage()` y se
  repite la cabecera de la tabla. Texto largo (cliente, cantón · distrito) se recorta con
  `splitTextToSize` a una línea con «…», para que la altura de fila sea fija y la cuenta de filas exacta.
- Datos que entran: solo los de R26 y los nombres de zona y estado. `FilaTransito` no trae teléfono,
  dirección, tienda ni mensajero (la consulta no los selecciona), así que R30 se cumple por
  construcción y se verifica sobre el texto extraído.
- Sin paquetes y `enviarSiVacio`: una página con encabezado, totales a 0 y «No hay paquetes en alerta
  con estos parámetros» (R19).

## 8. Panel y vista previa

### 8.1 Descriptor `panel` (aditivo al contrato de la 474)

`DescriptorParametro` gana `{ campo; etiqueta; tipo: "panel"; panel: "transito"; campos: string[]; ayuda? }`.
`ParametrosInforme.tsx` (474) pinta `<ParamsTransito>` para `panel === "transito"` y le pasa
`valores`, `onCambiar` y los errores cuyas claves empiezan por `parametros.<campo de campos>`. Hoy el
renderizador dice «todavía no se puede editar» para lo que no conoce; el design de la 474 §2 deja
explícito que 475/476 añaden su tipo de descriptor.

### 8.2 `ParamsTransito.tsx` (maqueta `ParamsTransito.dc.html`)

- Al montar llama a `previsualizarInformeTransito(valores)`: devuelve zonas reales y conteos. Rellena
  en el estado local las zonas sin entrada con `plazoEfectivo` (R35) y las envía todas al guardar.
- «Entra en alerta: el día N» = `plazo − aviso`, calculado en el cliente con la misma función pura.
- Hito: tres radios. Estados: casilla + número; desmarcado ⇒ «no entra» y número deshabilitado (R37).
- «Volver a los valores de partida» (R36): `PARAMETROS_POR_DEFECTO` + zonas a la partida de su tipo.
- Conteo (R38): tras 400 ms sin cambios, nueva llamada; muestra «Con estos valores, hoy entrarían
  **N paquetes** (M parados)» y, si `sinHito > 0`, «K paquetes en esos estados aún no han pasado por
  ese momento». Con errores de validación: errores por campo, sin conteo.
- Texto de la maqueta «Una zona nueva aparece aquí con los valores de la GAM» → «con los valores de
  partida de su tipo» (pregunta abierta 1).
- Accesible: cada número con `<Label>`, `aria-describedby` de ayuda y error (patrón de
  `ParametrosInforme`). Pantalla existente de la 474: no es módulo nuevo, no pasa por `/design`
  (la maqueta ya está aprobada).

### 8.3 `previsualizarInformeTransito(parametros: unknown)` (`lib/actions/informe-transito.ts`)

Sesión → `forbidden` si no es `maestro` (mismo patrón que `lib/actions/envios-whatsapp.ts`) →
`parametrosTransitoSchema.safeParse` → si inválido `{ status: "validation_error", fieldErrors, zonas }`
(las zonas se devuelven igual para pintar la tabla) → si válido usa **el mismo** repo + `cortesPorZona`
+ `clasificar` que `generar` y devuelve `{ status: "ok", zonas, totalEnAlerta, parados, sinHito }`.
Solo lectura (R39). Se importa desde el panel, así que no lleva `@sin-superficie`.

## 9. Composición

`INFORMES_WHATSAPP` registra `crearInformeTransito()` (deps de producción). Lección «composition root
que no inyecta»: un test comprueba que la instancia registrada en el catálogo usa
`InformeTransitoRepository` real (contra Postgres devuelve la orden sembrada), no un doble.

## 10. Seguridad

- Datos de todas las tiendas ⇒ `aptoParaAdminTienda: false`; la 474 rechaza el guardado con el rol o
  un usuario `adminTienda` (su R16 enmendada).
- PDF sin PII extra (R30); el nombre del cliente sí sale (maqueta aprobada) y la variable no lo lleva.
- SQL con `Prisma.sql` y parámetros; el hito elige entre tres fragmentos fijos.

## 11. Rendimiento

- 3 consultas por generación (R40); `filasEnAlerta` devuelve solo lo que entra (el filtro de días va
  en el `WHERE`), así que el trabajo en memoria y el PDF escalan con las alertas, no con las órdenes vivas.
- Laterales por orden servidos por los índices `(orden_id, estatus_destino_id)` y `(orden_id, created_at)`.
- Si el `EXPLAIN` de producción (T6.2, solo lectura por MCP) mostrara un seq scan sobre el historial,
  se abre ficha aparte para un índice: esta ficha no migra.

## 12. Alternativas descartadas

1. **Calcular días y filtrar en SQL con `AT TIME ZONE 'America/Costa_Rica'`.** Funciona, pero pone una
   segunda definición del día CR en la base, distinta de `diasNaturalesCRDesde` que pinta el PDF: el
   filtro y lo mostrado podrían divergir en la frontera de medianoche. El corte calculado en TS da una
   sola definición (§4).
2. **Traer todas las órdenes vivas y filtrar en memoria.** Más simple de escribir, pero trae miles de
   filas por ejecución (y por cada tecla del panel) para quedarse con decenas, y deja el `WHERE` de
   estados/zona sin probar contra Postgres (memoria «probar el WHERE donde vive»).
3. **Columna nueva `orden.entrada_bodega_central_at` (o tabla de hitos) con backfill.** Haría la
   consulta trivial, pero obliga a migrar, a tocar cada productor de la transición (y a recordar los
   futuros) y saca el gate del modo rápido; el historial ya tiene el dato, inmutable y escrito en la
   misma transacción.
4. **Descriptores genéricos `tabla` + `seleccion_multiple` en vez de un panel propio.** La maqueta
   tiene una columna calculada («entra en alerta el día N»), filas que salen de las zonas reales con
   partida por tipo, umbral dependiente de la casilla, el conteo «hoy entrarían» y «volver a los
   valores de partida»: forzarlo en descriptores genéricos inventa un mini-lenguaje de formularios
   para un solo consumidor. Un descriptor `panel` con nombre mantiene el formulario dirigido por el
   informe sin `if (clave === "transito")` en la pantalla.
5. **Zona por texto, «fuera» por defecto y exclusión por subcadena «devol» (sistema externo).** Es
   exactamente lo que se pidió no copiar: una dirección mal escrita cambia de zona un paquete y
   «devol» excluye estados que siguen en tránsito (`devolviendo_a_bodega_central`).

## 13. Pruebas y mutaciones previstas

Sin E2E (no hay arnés; memoria «nada de E2E»). Integración contra Postgres en
`tests/integration/db/` (base propia del worktree, clon de la local; esta ficha no migra, así que no
pisa a otras). Fechas con `ahora` fijo, sembrando `orden_historial_estado.created_at` a mano.

| Mutación (se aplica, se corre el test, se revierte y se comprueba el revert) | Test que debe matarla |
| --- | --- |
| M1 quitar `o.deleted_at IS NULL` | int `informe-transito-seleccion` |
| M2 quitar `s.value IN (estados)` | int `informe-transito-seleccion` |
| M3 quitar `NOT IN ('entregado','devuelta_a_tienda')` (consulta llamada con esos estados) | int `informe-transito-seleccion` |
| M4 un solo corte para todas las zonas (el de la central) | int `informe-transito-zonas` |
| M5 `hito.at <= z.corte` en vez de `<` | int `informe-transito-zonas` (frontera exacta) |
| M6 `MAX` en vez de `MIN` en el hito central | int `informe-transito-hitos` (reingreso) |
| M7 hito central sin filtro de destino | int `informe-transito-hitos` |
| M8 hito de guía sin la rama de creación en `por_recolectar_en_tienda` | int `informe-transito-hitos` |
| M9 última transición `ORDER BY ... ASC` | int `informe-transito-parados` |
| M10 `contarSinHito` sin filtro de estados | int `informe-transito-hitos` |
| M11 `vencido = dias >= plazo` | unit `informe-transito-calculo` |
| M12 `parado = diasEnEstado >= umbral` | unit `informe-transito-calculo` |
| M13 catálogo registra el informe sin repo real | int `informe-transito-catalogo-real` |
| M14 `generar` atrapa el error de lectura y devuelve vacío | unit `informe-transito-informe` |

Autocomprobación obligatoria del arnés de mutaciones (memoria «arnés que miente»): verde sin mutar,
archivo cambiado tras mutar, revert verificado; las mutaciones SQL se confirman leyendo el archivo.

## 14. Gate

`./init.sh --rapido` (regla 5). Si el rápido se negara (diff tocando cimientos), es señal de que el
diseño se salió de §0: se corrige el diff, no se cambia al completo. Antes de mergear,
`gh pr checks` (el gate no corre `next build`).
