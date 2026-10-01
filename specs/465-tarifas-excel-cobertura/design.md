# 465 — Design: Excel de cobertura por distrito

> Nota de búsqueda: los símbolos citados se confirmaron leyendo los archivos reales (no solo el
> índice `codebase-memory`).

## 1. Resumen

Un control nuevo en `/configuracion/tarifas` que **reutiliza `DescargarDatasetButton`** (feature
151 + selector de columnas de la 314). Al pulsarlo, una Server Action de solo lectura devuelve
una fila de dominio por distrito; el cliente la proyecta a celdas y el generador común arma el
`.xlsx` en el navegador. **Sin migraciones, sin tablas nuevas, sin escrituras.**

La regla de cobertura se escribe UNA vez, en una función pura, y se construye **encima de las dos
reglas que ya existen** —no las copia—:

| Pieza existente | Archivo | Uso aquí |
| --- | --- | --- |
| `disponibleDesdeCadena` | `lib/repositories/_shared/geografia-activa.ts:119` | Activo (R7) |
| `zonaUnicaDeDistrito` (colapso 1/0/>1) | `lib/repositories/_shared/zona-colapso.ts:22` | zona única (R8, R11, R12, R14) |
| `resolveGeo` (precedencia provincia → cantón → distrito → zona) | `lib/services/geo-resolucion.ts:108` | vara de equivalencia (R9, R15) |
| Nivel 3 de la cascada (`tienda_id IS NULL AND zona_id = Z`) | `lib/utils/cascada-tarifa.ts:46-53` | Tarifa general (R14) |
| `DescargarDatasetButton`, `filasDesdeResultado`, `nombreArchivoDescarga` | `components/shared/…`, `lib/utils/descarga-dataset.ts:119` | control, errores, nombre (R16-R20) |

## 2. Modelo de datos

**Sin cambios.** Se lee:

- `distrito` (`nombre`, `activo`, `zona_especial` tri-valuado), `canton` (`nombre`, `activo`),
  `provincia` (`nombre`, `activo`).
- `zona_distrito` → `zona` (`id`, `nombre`, `es_central`). Única fuente zona↔distrito.
- `tarifas` filtrado a `tienda_id IS NULL AND zona_id IS NOT NULL` (solo el `zona_id`, `DISTINCT`).
  Índices existentes `@@index([zonaId])`/`@@index([tiendaId])` bastan; ~500 distritos y decenas
  de zonas, ruta fría (un clic de un maestro).

RLS: sin tablas nuevas; el acceso pasa por Prisma en servidor tras la puerta de rol (R2).

## 3. Capas y contratos

```
page.tsx (Server, ya filtra maestro)
  └─ DescargarCoberturaButton.tsx (client)  ── obtenerFilas ──▶ listarCoberturaDistritos()  [Server Action]
        └─ DescargarDatasetButton (shared)                         └─ CoberturaService.listar(actor)
                                                                      ├─ ICoberturaRepository (Prisma, 2 lecturas)
                                                                      └─ clasificarCobertura()  [pura, lib/utils]
```

### 3.1 Tipos (`lib/types/cobertura.ts`)

```ts
export type MotivoSinCobertura =
  | "provincia_retirada" | "canton_retirado" | "distrito_retirado"
  | "sin_zona" | "varias_zonas";

/** Fila de dominio: SIN textos de UI. */
export interface CoberturaDistritoDTO {
  provincia: string;
  canton: string;
  distrito: string;
  disponible: boolean;
  cobertura: boolean;
  motivo: MotivoSinCobertura | null;      // null <=> cobertura
  zonas: string[];                         // nombres, orden alfabético es
  zonaUnica: { nombre: string; esCentral: boolean; tieneTarifaGeneral: boolean } | null;
  zonaEspecial: boolean | null;            // null = sin definir (R13)
}
```

> Tocar `lib/types/` hace que `./init.sh --rapido` se niegue y mande al gate completo (regla 5).
> Se acepta: es un archivo nuevo y aislado.

### 3.2 Repositorio (`lib/interfaces/repositories/ICoberturaRepository.ts`, `lib/repositories/CoberturaRepository.ts`)

```ts
export interface DistritoCoberturaRow {
  provincia: { nombre: string; activo: boolean };
  canton: { nombre: string; activo: boolean };
  distrito: { nombre: string; activo: boolean; zonaEspecial: boolean | null };
  disponible: boolean;                      // disponibleDesdeCadena, calculado aquí
  zonas: { id: string; nombre: string; esCentral: boolean }[];  // TODAS, sin colapsar
}
export interface ICoberturaRepository {
  listDistritos(): Promise<DistritoCoberturaRow[]>;               // activos E inactivos
  listZonaIdsConTarifaGeneral(): Promise<string[]>;               // tienda NULL, zona NOT NULL
}
```

Dos `findMany` independientes (`Promise.all` en el servicio). Las zonas viajan **sin colapsar**
porque `GeoRepository.listArbol` ya colapsa >1 a `null` y así no se distingue «sin zona» de «varias
zonas» (R9/R11). El colapso se aplica en la función pura con `zonaUnicaDeDistrito`.

### 3.3 Regla pura (`lib/utils/cobertura-distrito.ts`)

```ts
export function clasificarCobertura(
  row: DistritoCoberturaRow,
  zonasConTarifaGeneral: ReadonlySet<string>,
): CoberturaDistritoDTO
export function compararCobertura(a: CoberturaDistritoDTO, b: CoberturaDistritoDTO): number // R6
```

- `motivo`: primera que aplique en el orden provincia inactiva → cantón inactivo → distrito
  inactivo → 0 zonas → >1 zonas (misma precedencia que `resolveGeo`, R9).
- `cobertura = disponible && zonaUnicaDeDistrito(zonas) !== null` (R8).
- Orden: `localeCompare(…, "es", { sensitivity: "base" })` por provincia, cantón, distrito (R6),
  igual que `GeoRepository`.

### 3.4 Servicio (`lib/services/CoberturaService.ts` + `lib/interfaces/services/ICoberturaService.ts`)

`listar(actor): Promise<ListarCompletoServiceResult<CoberturaDistritoDTO>>` (tipo existente en
`lib/types/descarga-listado.ts:48`):

1. `actor.rol !== "maestro"` → `{ status: "forbidden" }` **antes** de tocar el repositorio (R2).
2. Lee las dos fuentes, clasifica, ordena.
3. Si `items.length > descargaConfig.MAX_FILAS` → `limite_excedido` (no se espera; ~500 vs 5000,
   pero se respeta el tope único de la app).

Solo llama a métodos de lectura (R21).

### 3.5 Server Action (`lib/actions/cobertura.ts`)

`listarCoberturaDistritos(deps?)` → `ListarCompletoResult<CoberturaDistritoDTO>`.
Patrón `GeografiaActionDeps`: `getActor` y `coberturaService` inyectables; sin sesión →
`{ status: "unauthenticated" }` (R3). Composition root único `buildCoberturaService()` que **pasa**
`new CoberturaRepository(getPrismaClient())` (test de composition root, ver memoria «composition
root que no inyecta»). Sin entrada externa → no hay zod que validar.

### 3.6 Cliente

- `app/(app)/configuracion/tarifas/_components/cobertura-descarga-columnas.ts` (convención
  `*-descarga-columnas.ts`):
  - `AMBITO_DESCARGA_COBERTURA = "tarifas-cobertura"`.
  - `COLUMNAS_DESCARGA_COBERTURA: DescargaColumna[]` en el orden de R5:
    `provincia`, `canton`, `distrito`, `activo`, `cobertura`, `motivo`, `zona`, `gam`,
    `zona_especial`, `tarifa_general`.
  - `filaCobertura(dto): DescargaFila` — ÚNICO sitio con los textos: «Sí»/«No», motivos de R9,
    «Sin zona», «Varias zonas: A, B», «Sin definir», celda vacía `null` donde R10/R12/R14 la piden.
- `DescargarCoberturaButton.tsx` (client): envuelve `DescargarDatasetButton` con
  `titulo="Cobertura por distrito"` (→ `cobertura-por-distrito-AAAA-MM-DD.xlsx`, R17),
  `formatos={["xlsx"]}` (descarga directa, sin menú), `ambitoColumnas={AMBITO_DESCARGA_COBERTURA}`
  (R16), `label="Descargar cobertura"`, y
  `obtenerFilas={() => filasDesdeResultado(listarCoberturaDistritos(), filaCobertura)}` —lee al
  pulsar (R4) y hereda los mensajes de error, de «sin datos» y el guard de doble clic (R18-R20).
  Texto de ayuda (R1): «Descarga un Excel con cada distrito, si llegamos a él y con qué zona.»
- `app/(app)/configuracion/tarifas/page.tsx`: monta un bloque «Cobertura» con el botón y la línea
  de ayuda **entre el aviso de error del catálogo y `<ZonasTarifasModule>`**. La página ya corta a
  los no maestros (`page.tsx:18`), así que el botón solo existe para el maestro (R1); la acción
  vuelve a autorizar por su cuenta (R2), porque una Server Action es invocable fuera de la página.

### 3.7 Archivos y conflicto con la 275

La 275 (pending) toca `TiendasModule.tsx` y `CrearTiendaForm.tsx`. Esta feature **no toca
ninguno de los dos ni `ZonasTarifasModule.tsx`**: el único archivo existente que se edita es
`page.tsx`, que la 275 no menciona.

## 4. Equivalencia con la carga de órdenes (R15)

Test unitario de propiedad sobre fixtures: para cada caso (los 5 motivos + cubierto, y
combinaciones de varios retiros a la vez), construir con `indexBy` (`geo-resolucion.ts:42`) los
índices que `resolveGeo` consume —con `zonaId` colapsado por `zonaUnicaDeDistrito` y `disponible`
por la cadena, como lo hace `OrdenRepository`— y afirmar `clasificarCobertura(row).cobertura ===
resolveGeo(nombres).ok`, y que el motivo corresponde al campo/mensaje que `resolveGeo` devuelve.
Si un día `resolveGeo` gana una regla nueva, este test se pone rojo en vez de que el Excel mienta.

## 5. Tests y trazabilidad (resumen; el mapa final va en `progress/impl_465.md`)

| R | Test |
| --- | --- |
| R1 | unit (RTL) `DescargarCoberturaButton`: texto del botón y línea de ayuda; unit de `page.tsx` con actor maestro lo monta y con otro rol no |
| R2, R21 | unit `CoberturaService`: rol ≠ maestro → forbidden y el doble del repo con 0 llamadas; con maestro solo se invocan los 2 métodos de lectura |
| R3 | unit `lib/actions/cobertura`: sin actor → unauthenticated sin construir servicio; + composition root |
| R4 | unit del botón: `obtenerFilas` llama a la action en cada clic (dos clics → dos llamadas) |
| R5, R10-R14 | unit `cobertura-descarga-columnas`: claves/encabezados literales en orden (literal = contrato); proyección de cada caso |
| R6-R9 | unit `clasificarCobertura`/`compararCobertura`: tabla de casos, precedencia con varios retiros a la vez, tildes/mayúsculas |
| R14 (WHERE) | **integración `tests/integration/db`** de `CoberturaRepository`: siembra tarifa (NULL, Z), (T, Z), (T, NULL) y (NULL, NULL); solo Z sale; y distrito con 0/1/2 zonas e inactivo por cantón. Con datos sembrados, sin `if (!x) return` |
| R15 | unit de equivalencia §4 |
| R16-R20 | unit del botón: `ambitoColumnas` y `formatos` pasados; heredados de 151/314 (sus tests existentes cubren el comportamiento genérico) |

## 6. Alternativas descartadas

1. **Calcular la cobertura en el cliente con el árbol que la página ya carga
   (`listarArbolGeografico`).** Descartada: `listArbol` colapsa >1 zona a `null` (no distingue
   «sin zona» de «varias zonas»), no trae `esCentral` ni tarifas, y ampliar su DTO toca a todos sus
   consumidores (geografía, `CrearZonaForm`). Además el archivo saldría del estado cargado al abrir
   la página, no del momento del clic.
2. **Añadir `listCobertura()` a `GeoRepository`/`GeografiaService`.** Descartada: mezcla tarifas en
   el repositorio del catálogo y crece una interfaz con un composition root ya sensible (R60 de la
   374). Un repositorio dedicado de dos lecturas es más pequeño y no arriesga lo que funciona.
3. **Generar el `.xlsx` en el servidor (route handler).** Descartada: el patrón de la app (151, R32)
   arma el archivo en el navegador y lo entrega con `descargarBlob`; un segundo generador sería un
   segundo dialecto.
4. **Montar el botón en la cabecera de `ZonasTarifasModule` (junto a «Crear zona»).** Descartada
   para no compartir archivos con la 275 (ese módulo monta `TiendasModule`); `page.tsx` lo deja
   igual de visible.
5. **Excluir los distritos no disponibles.** Descartada: «dónde no llegamos» incluye lo retirado y
   omitirlo confunde «retirado» con «no existe»; con la columna Activo se filtran en Excel en un clic.
   Queda como pregunta abierta 2.
6. **Matriz por tienda.** Fuera del alcance pedido (columnas por tienda).

## 7. Riesgos

- El motivo «varias zonas» hoy no se ve en producción (medido 0 casos el 2026-09-05 según
  `GeoRepository.listArbol`), pero se mantiene porque es un rechazo real de la carga.
- Producción vacía desde el 2026-08-25: un archivo con casi todo «Sin zona» puede ser el estado
  real, no un fallo.
