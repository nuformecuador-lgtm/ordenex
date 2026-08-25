# Feature 278 — Diseño

Referencia de requisitos: `requirements.md` (R1–R34).

## 1. Punto de partida (lo que hay hoy)

La plantilla v2 (feature 142) empaqueta la geografía en una sola celda:

```
direccion_destinatario = "País / Provincia / Cantón (Distrito) / Dirección"
```

y `lib/utils/direccion-destinatario.ts` la desarma en 4 partes con un parser de
tres `/`. Ese parser alimenta `geoInputDesdeDireccionUnificada`
(`lib/services/BulkOrdenService.ts:53`), el extractor que la vía sesión inyecta
en `resolveFila`. La vía API key inyecta el suyo,
`geoInputDesdeColumnasSeparadas` (`lib/services/geo-resolucion.ts`), que lee
`provincia`/`canton`/`distrito`/`direccion` sueltos.

Esa inyección por vía —el acierto de la 142— es exactamente lo que hace barata
esta feature: **se cambia un extractor, no la resolución**. `resolveGeo` no se
toca (R27) y la vía API key no se entera (R28, R29).

## 2. Forma nueva

```
provincia        = "Cartago"
canton_distrito  = "Cartago (Occidental)"
direccion        = "Frente gasolinera JSM, 200m sur"
```

El país desaparece: hoy ya se descarta sin validarlo ni persistirlo (R12 de la
142), así que quitarlo no pierde ningún dato (R6).

## 3. Módulo de parseo: se recorta, no se reescribe

`lib/utils/direccion-destinatario.ts` **ya contiene** la función que necesitamos:
`separarCantonDistrito`, privada, con las cinco ramas de error de R14–R18 y sus
mensajes. La v3 la **promueve a API pública** y borra todo lo que la envolvía
(los tres `/`, el país, la provincia y la dirección literal, que ahora llegan en
columnas propias).

El módulo se **renombra** a `lib/utils/canton-distrito.ts` porque su nombre viejo
pasaría a mentir: ya no parsea una dirección. Superficie nueva:

```ts
export const FORMATO_CANTON_DISTRITO = "Cantón (Distrito)";

export interface CantonDistritoPartes { canton: string; distrito: string }

export type ParseCantonDistritoResult =
  | { ok: true; partes: CantonDistritoPartes }
  | { ok: false; mensaje: string };

export function parseCantonDistrito(valor: string): ParseCantonDistritoResult;
```

Cuerpo: el de `separarCantonDistrito` casi tal cual (mismo orden de comprobación,
mismos textos de causa), más la guarda de campo vacío (R19) que hoy vive en
`parseDireccionDestinatario`, y **una desviación pedida por el humano durante la
implementación**: donde la 142 exigía paréntesis, la v3 los hace **opcionales**.

Sin paréntesis, el valor entero es el cantón y **el distrito se asume homónimo**
(`Cartago` ≡ `Cartago (Cartago)`) — R14; unos paréntesis vacíos reciben el mismo
trato (R16). Es la forma en que la gente escribe las cabeceras de cantón, que en
Costa Rica son la mayoría de los casos.

El atajo es seguro porque **no inventa una resolución**: `resolveGeo` sigue
buscando ese distrito dentro de ese cantón contra el catálogo y, si no existe, la
fila muere con el mensaje de siempre (R27b). Lo único que se ahorra es rechazar
por formato algo que el catálogo sabe responder. Sigue siendo puro y browser-safe
(R20, R21).

`lib/utils/direccion-destinatario.ts` se **elimina**: no queda ningún llamador.

## 4. Extractor de la vía sesión

En `BulkOrdenService.ts`, `geoInputDesdeDireccionUnificada` se sustituye por:

```ts
function geoInputDesdeCantonDistrito(raw: RawRow): GeoInput {
  const provincia = (raw.provincia ?? "").trim();
  if (provincia === "") {
    return { ok: false, fieldErrors: { provincia: ["provincia es obligatoria"] } };
  }
  const parsed = parseCantonDistrito(raw.canton_distrito ?? "");
  if (!parsed.ok) {
    return { ok: false, fieldErrors: { canton_distrito: [parsed.mensaje] } };
  }
  return {
    ok: true,
    provincia,
    canton: parsed.partes.canton,
    distrito: parsed.partes.distrito,
    direccion: (raw.direccion ?? "").trim(),
  };
}
```

Cubre R22–R26. `resolveFila`, su firma `GeoInputExtractor` y el uso de
`geoInput.direccion` como dirección literal (R24, R25) no cambian.

**Nota deliberada**: el extractor de la vía sesión queda ahora a un paso del de
la vía API key (la única diferencia es `canton_distrito` partido vs `canton` y
`distrito` sueltos). NO se unifican: el de la API es contrato público congelado
por la feature 88 y fundirlos volvería a dar un solo dueño a dos contratos que
pueden divergir otra vez. Se documenta en el módulo para que la próxima lectura
no lo "arregle".

## 5. Cabecera y tipos

`lib/types/carga-masiva.ts`:

- `REQUIRED_HEADERS = ["num_remision","destinatario","telefono","provincia","canton_distrito","direccion"]` (R7).
- `filaCargaSchema`: fuera `direccion_destinatario`; entran `provincia`,
  `canton_distrito` y `direccion` como paso-a-través tipado
  (`z.string().trim().optional().default("")`). La validación de contenido vive
  en el extractor (R26), no aquí, para no romper la vía API key (R30).
- Se mantiene **sin `.strict()`** y `findMissingHeaders` sigue comprobando
  presencia (R11): ancla de la feature 143, no tocar.

Ojo: `direccion` como clave de fila **ya la usa** la vía API key, así que el
schema no gana un campo ajeno a nadie — lo comparten las dos vías.

## 6. Frontend

- `carga-masiva-fields.ts`: las 10 columnas de R1 con sus ejemplos. El ejemplo
  geográfico se conserva del v2 (`Cartago` + `Cartago (Occidental)`), que ya está
  blindado como terna existente y con zona (R4).
- `OrdenesCargaUpload.tsx`: `COLUMNA_DIRECCION` (v2) pasa a ser el **detector de
  archivo viejo**: si la cabecera trae `direccion_destinatario` y le faltan
  obligatorias, el mensaje es el de "la plantilla cambió" (R9). El texto de
  ayuda pasa a describir las tres columnas (R31).
- `carga-masiva-export-errores.ts` deriva de `ORDENES_BULK_FIELDS`: sigue solo
  (R32). Se ajusta el comentario que dice "8 columnas".
- `carga-masiva-error-chips.ts` agrupa por texto normalizado: los mensajes nuevos
  de formato entran sin cambio de código (R33).

## 7. Lo que NO cambia

- `lib/services/geo-resolucion.ts` (`resolveGeo`, `geoInputDesdeColumnasSeparadas`).
- `app/api/ordenes/api-key/carga/route.ts` y su OpenAPI.
- `CotizacionOrdenService` (usa `geoInputDesdeColumnasSeparadas`).
- La aritmética de tarifas, el troceo por chunks y el dry-run.

## 8. Caducidades (tests que mueren con la regla vieja)

Son contrato de la v2 y deben RETIRARSE, no adaptarse a la fuerza:

- `tests/unit/utils/direccion-destinatario.test.ts` → se reemplaza por
  `tests/unit/utils/canton-distrito.test.ts`.
- Los casos de `tests/unit/types/carga-masiva.test.ts` que fijan
  `direccion_destinatario` en `REQUIRED_HEADERS`.
- Los de `bulk-orden-service.carga-lote.test.ts` / `.test.ts` que arman filas con
  `direccion_destinatario`.
- `tests/unit/scripts/carga-masiva-ejemplos-geo.test.ts` cambia de fuente (del
  parser de 3 `/` al de `canton_distrito` + columna `provincia`).
- `tests/integration/carga-masiva-plantilla-roundtrip.test.ts` y
  `carga-masiva-errores-roundtrip.test.ts`: pasan de 8 a 10 columnas.

## 9. Riesgos

1. **Usuarios con archivos v2 a medio llenar.** Mitigado solo por el mensaje de
   R9: es un corte duro por decisión explícita del humano. No hay migración.
2. **`tests/unit/types/cotizacion.test.ts` menciona `direccion_destinatario`.**
   Verificar si es referencia real o solo texto; la cotización va por la vía API
   key y no debe cambiar (R28).
