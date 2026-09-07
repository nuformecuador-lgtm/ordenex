# 383 — Normalizar al entrar los caracteres que la etiqueta no puede imprimir · design

> Leer antes: `requirements.md`. Todo lo afirmado aquí está **confirmado contra los archivos
> reales**, no contra el índice del grafo (que en `lib/pdf/` está rancio: la 382 lo dejó anotado en
> `progress/impl_382.md`, punto 5).

---

## 0. Lo que ya existe, y que esta ficha no reinventa

| Pieza | Dónde | Qué hace |
| --- | --- | --- |
| `COBERTURA` | `lib/pdf/etiquetas-fuente.ts:36` | 19 rangos inclusivos = **219 code points**: `0x20–0x7E`, `0xA0–0xFF`, `Œœ Šš Ÿ Žž ƒ ˆ ˜`, guiones/comillas/dagas/bullet/elipsis/‰/guillemets, **U+20A1 (₡)**, **U+20AC (€)**, **U+2122 (™)**. Archivo **GENERADO**; la cobertura se deriva del `.ttf` (282/R29). |
| `cubreCodePoint` / `caracterNoCubierto` / `cubreTexto` | `lib/pdf/etiquetas-fuente-registro.ts:87-112` | El predicado. Recorre **por code point**, no por unidad UTF-16 (no parte pares suplentes — imprescindible aquí: U+1D560 **es** un par suplente). |
| `exigirCobertura` | idem `:175` | Lanza `ErrorCaracterNoImprimible` con guía + carácter + code point + campo. **Se queda como está** (R20). |
| `notacionCodePoint` | idem `:115` | `U+1D560`. |
| `mensajeCaracterNoImprimible` + `aislado` | `app/(app)/ordenes/_components/EtiquetasGuiaModal.tsx:104-135` | El texto que la 382 escribió, con los aislantes bidi `⁨`/`⁩`. |
| `datosDeEtiqueta` | `lib/pdf/etiquetas-dibujo.ts:197` | Los **10** datos que se imprimen, en orden. |
| `filaCargaSchema` | `lib/types/carga-masiva.ts:102` | La puerta de validación de fila, **compartida** por las dos vías. |
| `BulkOrdenService.resolveFila` | `lib/services/BulkOrdenService.ts:682` | El punto donde ambas vías (`:161` sesión, `:380` API key) clasifican una fila. |
| `RowResult.montoAjustado` | `lib/types/carga-masiva.ts:24` | **El precedente exacto**: la 299/304 ajusta un dato (el dinero) y lo **dice** por una clave más de la fila creada. |
| `CorregirDatosClienteService.corregir` | `lib/services/CorregirDatosClienteService.ts:195` | Única superficie manual de estos campos. Ya devuelve `validation_error` con `fieldErrors`. |
| Guardia de carga diferida | `tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` | Prohíbe que `app/` y `components/` nombren `"@/lib/pdf/etiquetas-fuente"` salvo el cargador, y solo con `import()` dinámico. |

---

## 1. Qué campos se validan — la lista, y por qué no falta ninguno ni sobra

La etiqueta imprime **10** datos. Se cruza cada uno con su origen:

| Dato impreso | De dónde sale | ¿Lo valida esta ficha? |
| --- | --- | --- |
| `numGuia` | entero del servidor | **No** — no es texto |
| `fechaCreacion` | `YYYY-MM-DD` del servidor | **No** |
| `numRemision` | `num_remision` del archivo. No corregible. | **Sí, solo rechazo** (R12) |
| `destinatario` | archivo · corrección | **Sí** |
| `telefonoDest` | `telefono` del archivo · corrección | **Sí** |
| `direccion` | archivo · corrección | **Sí** |
| `ubicacion` | nombres de zona/provincia/cantón/distrito, del **catálogo** | **No** — riesgo residual, Q3 |
| `montoCobrar` | número → `formatMonto` | **No** |
| `producto` | archivo · corrección | **Sí** |
| `tiendaNombre` | `usuario.nombre` de la tienda | **No** — riesgo residual, Q3 |

Fuera **a propósito**: `notas` (no se imprime), `monto_cobrar` (número), `provincia` y
`canton_distrito` del archivo (son nombres que se **resuelven** contra el catálogo; lo que va al
papel es el nombre del catálogo, y un nombre con un carácter raro ya falla antes por no casar).

---

## 2. Decisión 1 — Una sola cobertura, y que su reuso no cueste 22 KB en el navegador

### 2.1 El problema, medido

El humano lo puso como no negociable: *«si la validación de entrada usa otra definición de
imprimible que la del PDF, las dos se desalinean el día que la fuente cambie»*. De acuerdo. Pero
reusar la de verdad tiene un obstáculo concreto:

- `lib/pdf/etiquetas-fuente.ts` lleva **22.592 caracteres de base64** (`PESO_DECLARADO_BASE64`).
- La guardia `etiqueta-fuente-diferida.guardia.test.ts` (282/R13) existe justo para que eso no entre
  en el bundle inicial. **Pero solo busca el especificador literal `"@/lib/pdf/etiquetas-fuente"`
  dentro de `app/` y `components/`: no ve una llegada transitiva.**
- Y hay una llegada transitiva a un paso: `app/(app)/ordenes/_components/OrdenesCargaUpload.tsx:27`
  importa **estáticamente y por valor** `findMissingHeaders` de `@/lib/types/carga-masiva`.

Es decir: colgar la validación de `lib/types/carga-masiva.ts` metería los 22 KB en el bundle inicial
de `/ordenes` **sin poner nada rojo**. Fallo mudo de manual, y del tipo que este repo ya tiene
catalogado.

### 2.2 La decisión

**Partir el artefacto generado en dos módulos:**

```
lib/pdf/etiquetas-fuente-cobertura.ts   ← GENERADO. Solo `export const COBERTURA` (19 rangos).
lib/pdf/etiquetas-fuente.ts             ← GENERADO. Importa COBERTURA y añade base64 + pesos.
```

`scripts/fuente-etiqueta-a-base64.ts` pasa a emitir **los dos**. Sigue habiendo **una sola**
cobertura y sigue **derivada del `.ttf`** (282/R29 intacto). `fuenteEtiqueta.cobertura` apunta a la
misma constante, así que el generador de PDF no se entera.

El nombre `etiquetas-fuente-cobertura` **no colisiona** con la guardia: `ARTEFACTO` es
`'"@/lib/pdf/etiquetas-fuente"'` **con la comilla de cierre**, y la propia guardia ya documenta esta
precaución para `etiquetas-fuente-registro`.

**Y el predicado se abre por su parámetro, no se duplica:**

```ts
// lib/pdf/etiquetas-fuente-registro.ts
export type Cobertura = readonly (readonly [number, number])[];

export function caracterNoCubiertoEn(cobertura: Cobertura, texto: string): string | null { … }
export function cubreCodePointEn(cobertura: Cobertura, cp: number): boolean { … }

// Los tres actuales quedan como envoltorios de una línea sobre `fuente.cobertura`.
export function caracterNoCubierto(f: FuenteEmbebida, t: string) {
  return caracterNoCubiertoEn(f.cobertura, t);
}
```

Una sola implementación, **cero call sites tocados** (los tests de la 382 siguen llamando igual).

### 2.3 Alternativas descartadas

**(a) No partir: que el validador importe `fuenteEtiqueta`.** Es lo más corto hoy y la trampa de
mañana: en cuanto el validador toque un módulo que también use el cliente, vuelven los 22 KB al
bundle **y la guardia no lo ve**. Arreglarlo pediría darle a la guardia un recorrido del grafo de
imports — más maquinaria de test de la que ahorra.

**(b) Que el validador declare su propia lista de caracteres permitidos** (una regexp tipo
`/^[\x20-\x7E\xA0-\xFF…]*$/`). Descartada de plano: es **exactamente** lo que el humano prohibió, y
ya hay precedente medido de lo que pasa — la 382 empezó contando **38** órdenes afectadas con un
filtro que contaba de más (U+2014, U+2019, U+2122 y U+00A0 **sí** están en cp1252); el número real
era **1**.

---

## 3. Decisión 2 — Se repara solo lo que hoy NO se imprime

### 3.1 La regla, por code point

```
repararTexto(cobertura, texto) -> { valor, cambio: boolean } | { culpable: string, codePoint: number }

  para cada code point c de `texto`:
    si cubreCodePointEn(cobertura, c)        -> se copia TAL CUAL          (R4)
    si no:
        cand = c.normalize("NFKC")
        si cubreTextoEn(cobertura, cand)     -> se emite `cand`, cambio=true  (R5)
        si no                                -> se ABORTA nombrando `c`       (R6)
```

Propiedad que da, y es el argumento entero: **la transformación está demostrablemente acotada a los
caracteres que hoy no se pueden imprimir**. Ningún dato que hoy sale bien en el papel se reescribe.

### 3.2 Por qué NO `NFKC` a secas sobre la cadena entera

Porque `NFKC` a ciegas **saca de la cobertura caracteres que hoy imprimen bien**. El caso que lo
demuestra:

> `½` es **U+00BD**, cubierto por el rango `0x00A0–0x00FF`. Su descomposición de compatibilidad es
> `1` + **U+2044 FRACTION SLASH** + `2`. Y **U+2044 no está en `COBERTURA`**: los rangos saltan de
> `0x203A` a `0x20A1`.

O sea: un `NFKC` a ciegas convertiría en **rechazo nuevo** una etiqueta que hoy sale perfecta. Se
espera lo mismo de `¼`, `¾` y de los espaciadores `´ ¨ ¯ ¸ ˜`, cuya descomposición de compatibilidad
es «espacio + marca combinante» y las marcas combinantes (`0x0300–0x036F`) tampoco están cubiertas.
Y reescribiría gratis `™→TM`, `…→...`, `m²→m2`.

**La cifra exacta la mide T1 y se commitea** — no se afirma de memoria. Pero fíjese en lo importante:
con la regla de §3.1 **esa lista es irrelevante para el comportamiento**. Se mide igual, porque es
la evidencia que justifica no haber hecho el `NFKC` corto.

De los dos ejemplos que el humano pidió ver escritos:

| Carácter | Hoy | Con `NFKC` a ciegas | Con la regla de §3.1 |
| --- | --- | --- | --- |
| `ﬁ` U+FB01 | **no** imprime | `fi` → imprime | `fi` → imprime **(mejora)** |
| `½` U+00BD | **imprime** | `1⁄2` con U+2044 → **deja de imprimir** | `½` **intacto** |
| `𝕠` U+1D560 | no imprime | `o` | `o` |

### 3.3 El bloque U+1D400 no es todo latino

El bloque Símbolos Alfanuméricos Matemáticos (U+1D400–U+1D7FF) trae latinas, **griegas** y dígitos.
Las griegas normalizan a griego (`𝛂` U+1D6C2 → `α` U+03B1), que **tampoco** está en la fuente: se
rechazan, y es el resultado correcto. Escrito aquí porque «normaliza el bloque U+1D400» suena a que
lo repara entero, y no.

### 3.4 Alternativas descartadas

**(c) `texto.normalize("NFKC")` y luego comprobar cobertura.** Es lo que la ficha pedía literalmente
y lo más corto de escribir. Descartada por §3.2: reescribe datos que hoy imprimen bien **y** crea
rechazos nuevos. Lo que la ficha quiere —que el bloque U+1D400 deje de tumbar el lote— se consigue
igual sin ninguno de los dos efectos.

**(d) Tabla propia `double-struck → ASCII`.** Cierra el caso medido y nada más: el día que llegue el
bloque de negritas matemáticas o el sans-serif hay que volver a tocarla, y nadie se acordará. `NFKC`
ya cubre el bloque entero y lo mantiene Unicode con el runtime.

**(e) Escalera de candidatos** (probar `NFKC` de la cadena entera y, si falla, el reparo por
carácter). Salvaría el caso «`𝕠` y `½` en el mismo campo». Descartada: son **dos** definiciones de
normalizado conviviendo, y el caso que salva tiene **cero ocurrencias medidas**.

### 3.5 Limitación conocida, escrita

Un texto en forma **descompuesta** (`"n" + U+0303`, lo que produce macOS al copiar) se lee «ñ» y se
**rechaza** nombrando `U+0303`. Hoy ese texto también revienta —pero en el PDF, cuatro días después—,
así que la ficha no empeora nada; lo que hace es dar un mensaje desconcertante. La vuelta es un
`.normalize("NFC")` previo, canónico y por tanto sin las pegas de §3.2. **Está en Q2 y no se ha
metido sin firma.**

---

## 4. Módulo nuevo (uno solo)

```
lib/utils/texto-imprimible-etiqueta.ts     ← puro, sin side effects (docs/conventions.md)
```

```ts
import { COBERTURA } from "@/lib/pdf/etiquetas-fuente-cobertura";
import { caracterNoCubiertoEn, cubreCodePointEn, notacionCodePoint }
  from "@/lib/pdf/etiquetas-fuente-registro";

export type ResultadoTexto =
  | { estado: "intacto"; valor: string }
  | { estado: "reparado"; valor: string; original: string }
  | { estado: "irreparable"; culpable: string; codePoint: number };

/** R4/R5/R6. `reparar: false` = solo veredicto (uso de `num_remision`, R12). */
export function evaluarTextoDeEtiqueta(
  texto: string,
  opciones?: { reparar?: boolean },
): ResultadoTexto;
```

No exporta ninguna lista de caracteres. No conoce Prisma, ni HTTP, ni React.

### 4.1 El mensaje, sin una segunda redacción

`mensajeCaracterNoImprimible` vive en un componente de `app/` y el rechazo de esta ficha se produce
en el **servidor**. Para que no nazcan dos redacciones se extrae el **fragmento de diagnóstico** a
`lib/`:

```
lib/utils/mensaje-caracter-no-imprimible.ts
  aislado(caracter)                          // `⁨${c}⁩`, ESCAPADO (382, decisión 3)
  fraseCaracterNoImprimible(c, cp)           // «⁨𝕠⁩» (U+1D560)
```

- El modal de la 382 **conserva su literal palabra por palabra** y pasa a componerlo con
  `fraseCaracterNoImprimible`. Su test de literal sigue verde **sin tocarlo** — ése es el criterio de
  «hecho» de esa tarea.
- Los mensajes de esta ficha reusan la frase y cambian **solo el cierre**, porque el de la 382 («…
  ninguna etiqueta del lote se descarga…») no aplica a una orden que aún no existe:

| Superficie | Mensaje |
| --- | --- |
| Carga masiva, campo irreparable | `El campo «destinatario» lleva un carácter que la etiqueta no puede imprimir: «⁨🙂⁩» (U+1F642). Reintentar no lo cambia: corrige esa celda y escríbela con letras y números normales.` |
| Corrección, texto irreparable | `«destinatario» lleva un carácter que la etiqueta no puede imprimir: «⁨🙂⁩» (U+1F642). Reintentar no lo cambia: escríbelo con letras y números normales.` |
| Corrección, texto reparable (R18) | `«destinatario» lleva un carácter que la etiqueta no puede imprimir: «⁨𝕠⁩» (U+1D560). Escríbelo así: «orfirio».` |

Los aislantes bidi y la notación `U+XXXX` **no son opcionales** y se heredan con su motivo: sin los
primeros un `U+202E` en el dato reordenaría el aviso que lo denuncia; sin la segunda, un carácter de
ancho cero se pinta como unas comillas vacías (382, decisión 3 y «lo que queda vivo», punto 2).

---

## 5. Superficie 1 — Carga masiva (las dos vías)

### 5.1 Dónde va el corte, y por qué NO en el schema

Va en **`BulkOrdenService.resolveFila`**, justo después del `filaCargaSchema.safeParse` (línea 704),
sobre `parsed.data` — es decir, sobre el texto **ya recortado**, que es el que se va a almacenar.

Es el punto que ya comparten las dos vías (`cargarMasiva:161` y `cargarViaApi:380`), así que **un
solo sitio cierra las dos**, que es lo que la ficha exige.

**No** se cuelga de `filaCargaSchema` pese al precedente de la 299 (que puso ahí el redondeo del
monto «porque es la puerta compartida»): aquella `.transform` no necesitaba la fuente, y ésta sí.
`lib/types/carga-masiva.ts` **viaja al navegador** (§2.1). `BulkOrdenService` no.

### 5.2 Flujo por fila

```
parsed.data  ─┬─ num_remision  → evaluar(reparar: false)   → irreparable ⇒ fila a ERROR   (R12)
              ├─ destinatario  ┐
              ├─ telefono      ├→ evaluar(reparar: true)   → irreparable ⇒ fila a ERROR   (R13)
              ├─ producto      │                            reparado    ⇒ valor + aviso  (R9/R10)
              └─ direccion     ┘                            intacto     ⇒ nada           (R21)
              (notas, monto_cobrar, provincia, canton_distrito: NO se evalúan)            (R16)
```

- **Error:** `{ status: "error", numRemision, errores: { destinatario: [mensaje] } }`. La clave es
  **la de la columna del archivo** (`destinatario`, `telefono`, `producto`, `direccion`,
  `num_remision`), lo que hace que los chips (`carga-masiva-error-chips.ts`) y el export
  `motivo_error` (ficha 143/148) funcionen **sin tocarlos**.
- **Reparada:** el valor reparado entra en `createData` y el aviso viaja en la fila.
- Se evalúan **todos** los campos antes de decidir, para que una fila con dos problemas los liste
  los dos (mismo criterio que el `fieldErrors` de la geografía).

### 5.3 Contrato de salida — clave nueva, copiada del precedente

`lib/types/carga-masiva.ts`:

```ts
export interface TextoNormalizado {
  campo: "destinatario" | "telefono" | "producto" | "direccion";
  original: string;
  aplicado: string;
}

export interface RowResult {
  … // sin cambios
  /** 383 — solo en filas `creada`, y solo cuando hubo reparación. */
  textoNormalizado?: TextoNormalizado[];
}
```

Copia literal de la disciplina de `montoAjustado` (299/304):

- la clave **solo aparece cuando hubo cambio** → una carga normal devuelve el mismo resumen que
  antes, byte a byte (**R21**);
- `reclasificarOmitidas` (`BulkOrdenService:262`) hace `delete fila.montoAjustado` cuando una fila
  creada resulta ser duplicada; **debe hacer lo mismo con `textoNormalizado`**. Si no, el resumen
  diría «se reparó el nombre» de una orden que no se creó — la mentira exacta que mató la 294.
- La vía API la hereda: `CargaViaApiRow extends RowResult`. Los errores viajan por
  `summary.errores[]` (contrato del 2026-08-31), sin tocar su forma.

### 5.4 El CUÁNDO (R11) — el dry-run ya es la puerta

La carga por sesión es **de dos fases**: `OrdenesCargaUpload.tsx:139` manda `dryRun: true`, se pinta
`OrdenesCargaPreview` y solo tras confirmar `OrdenesCargaMasivaButton.tsx:174` manda la carga real.
Las dos fases pasan por el **mismo** `resolveFila`, así que la reparación y los rechazos aparecen
**antes de escribir una sola fila**, con el lote delante. **No hace falta ninguna superficie nueva de
confirmación: el preview ya es una puerta humana real.**

En fase 2 el cliente reenvía las **filas originales** del archivo; la reparación la recalcula el
servidor. El cliente nunca manda el valor reparado — una sola fuente de verdad.

### 5.5 UI (frontend)

`carga-masiva-clasificacion.ts` gana `normalizadas: OrdenTextoNormalizado[]`, exactamente como la 304
añadió `ajustadas`: **no es un cuarto grupo**, es una vista de las creadas. Con los mismos guardas
defensivos (`asRecord`, y descartar la entrada si `original === aplicado`).

`OrdenesCargaPreview.tsx` añade una línea al `Alert` que ya pinta el aviso de céntimos (línea 151),
en el mismo sitio y con la misma condición «vacío ⇒ no se pinta nada»:

> `2 traen caracteres que la etiqueta no puede imprimir y se cargarán corregidos («𝕠rfirio» → «orfirio»).`

**En la vía API no hay preview.** El aviso viaja en la respuesta y un integrador que ignore el cuerpo
no lo verá. Es el **mismo** residual que ya tiene `montoAjustado` — que cambia **dinero**, y es más
grave. Se hereda con su precedente, no se inventa nada.

---

## 6. Superficie 2 — Corrección de datos del cliente

### 6.1 La decisión: rechaza, no repara

En `CorregirDatosClienteService.corregir`, en el bloque **5.b (rechazos de valor)**, junto a
`CAMPOS_NO_VACIABLES` y al chequeo de teléfono. Sobre `destinatario`, `telefonoDest`, `producto` y
`direccion`; **solo sobre los campos que efectivamente cambian** (misma disciplina que el resto de
5.b), y **antes** de tocar geografía o de escribir nada → si hay rechazo, **no se guarda ningún
campo** (R17).

Devuelve `{ status: "validation_error", fieldErrors: { destinatario: [mensaje] } }`, que el modal ya
sabe pintar. **Cero contrato nuevo, cero UI nueva.**

### 6.2 Por qué distinto de la carga, y no por capricho

Es el **mismo criterio que este repo ya aplica al dinero en estas dos mismas superficies**:

| | Carga masiva | Corrección |
| --- | --- | --- |
| Dinero (299 / 327) | **ajusta y avisa** (`montoAjustado`) | **pregunta antes de escribir** (`confirmacion_requerida`, 327/R11) |
| Texto (esta ficha) | **repara y avisa** | **rechaza con la sugerencia** |

El motivo está escrito en el propio código: en la carga **no hay nadie delante** de 500 filas en el
instante en que se decide; en la corrección **sí hay una persona mirando esa orden**. La versión
barata y honesta de «preguntar» es no escribir y devolver el texto bueno para que lo pegue: así
Ordenex **nunca guarda un nombre que el humano no haya tecleado**.

### 6.3 Y por qué la corrección NO es opcional

Porque **el alta manual no existe** (`requirements.md` §«El alta manual no existe»). Si se deja
fuera, la única superficie manual del sistema sigue admitiendo el carácter, y la puerta queda
abierta con un cartel encima. **Recomendación firme del leader: entra.**

`notas` queda fuera (R19): no se imprime.

---

## 7. Modelo de datos, RLS y migraciones

**Ninguna migración. Y no es un descuido:**

- No hay tabla nueva, ni columna nueva, ni enum nuevo, ni índice nuevo.
- Lo que se escribe en `orden` son los mismos cinco campos de texto de siempre, con el mismo tipo y
  la misma longitud.
- Ninguna política de RLS cambia: no hay tabla nueva y las existentes no cambian de dueño.
- La visibilidad de la reparación vive en la **respuesta** de la carga, igual que `montoAjustado`
  —que tampoco tiene columna—.

**Consecuencia asumida (A5):** no queda rastro persistente de que un texto se reparó. Si la tienda
cierra la pestaña, ese «`𝕠rfirio` → `orfirio`» ya no existe en ningún sitio. La vuelta atrás, si el
humano la pide, es una fila en `historial_accion` (ficha 362) — que **tampoco** pediría migración.
Ver **Q4**.

**El gate rápido no se debería negar** con este diff (no toca migraciones, `db/schema.prisma`,
`lib/types/` de dominio ni configuración de build). Se corre el completo igualmente por ser pre-PR y
por tocar `lib/`.

---

## 8. Riesgos y bordes

1. **El texto reparado sigue teniendo que caber.** La reparación puede **alargar** el texto (`ﬁ`
   ocupa 1 carácter y `fi` ocupa 2; `½` no se toca, pero `¼`… tampoco). Una dirección al límite podría
   pasar a no caber y disparar `ErrorEtiquetaNoCabe` (ficha 350) al imprimir. No es una regresión
   nueva (hoy ese texto ni siquiera se imprimía), pero **hay que decirlo** y hay un caso de test.
2. **Un par suplente mal partido.** U+1D560 son **dos** unidades UTF-16. El recorrido es por code
   point (`for…of`), que es lo que ya hace `caracterNoCubierto`. Un `split("")` aquí produciría dos
   mitades sin sentido: **caso de test explícito**.
3. **`num_remision` reparado rompería la identidad compartida** con la tienda (dedup R25/R26 y
   round-trip del XLSX). Por eso R12; y es el motivo, no una preferencia.
4. **La geografía y el nombre de tienda siguen abiertos** (Q3): el aviso apuntaría a una orden cuyo
   dato está bien.
5. **Coste.** Un recorrido por code point sobre 4 campos cortos por fila. Despreciable frente a las
   consultas de catálogo que `precargar` ya hace por lote. Sin bucles anidados nuevos.

---

## 9. Verificación — qué NO valdría como prueba

- **Comparar el resultado contra la función que lo genera** está siempre verde (lección escrita en
  `lib/pdf/etiquetas-dibujo.ts:192`). Los valores esperados van como **literales** en el test:
  `"\u{1D560}rfirio"` → `"orfirio"`, escritos con escapes (un literal invisible es un literal que
  alguien borra sin darse cuenta).
- **Un test de servicio con dobles no ve lo que se escribe en la columna.** El caso de R17 («no se
  guarda ningún campo») se clava afirmando que el **doble del repositorio no recibió ninguna
  llamada**, no que el resultado fue `validation_error`.
- **Un test que retorna temprano reporta `passed` sin comprobar nada.** Los barridos de R7 y R8 no
  llevan ningún `if (…) return;`: afirman un **conteo** además del contenido.
- La ficha **no lleva E2E**: no hay harness en el repo. La comprobación humana está en T9.
