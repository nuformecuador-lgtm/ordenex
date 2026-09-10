# 408 — Diseño

Frontend puro. **Cero migraciones, cero tablas, cero RLS, cero endpoints, cero cambios de DTO.** El
dato ya viaja: `CierreDetalleGestion.motivo` (`lib/interfaces/services/ICierreDiaService.ts:65`) y
`CierreGestionDescargaDTO.motivo`. Lo único que cambia es cómo se pinta.

## 1. Qué hay hoy, medido

| Pieza | Archivo | Qué hace |
| --- | --- | --- |
| Productor del texto | `lib/services/DevolucionSlaService.ts:262` | escribe `` `escalado SLA ${orden.causa}` ``. **No se toca.** |
| Columna Motivo (admin) | `cierres-admin/_components/cierre-detalle-shared.tsx:1385, 1424, 1433, 1455` | `render: (g) => g.motivo ?? "—"` |
| Marcador de origen | mismo archivo, `renderRechazoOrigen`, 862-880 | `Automático` / `Manual` + nota accesible |
| Literales del módulo | `cierres-admin/_components/cierre-labels.ts` | módulo **PURO** (sin React); lo leen las descargas **y ya `/cierre-dia`** |
| Descarga por sección | `cierre-gestiones-descarga-columnas.ts:215, 240, 277, 315` | `motivo: gestion.motivo` |
| Hoja fundida (230) | `cierres-gestiones-fundida-descarga-columnas.ts:445` | `motivo: gestion.motivo` |
| Comprobante (admin **y** mensajero) | `cierre-factura.tsx:1530` | `<DatoFila label={FILA_MOTIVO_LABEL} value={g.motivo} />` |
| Pantalla del mensajero | `cierre-dia/_components/CierreDiaModule.tsx:1195, 1203, 1223, 1231` | `render: (g) => g.motivo ?? "—"` |
| Descarga del mensajero | `cierre-dia/_components/cierre-dia-descarga-columnas.ts:164, 178, 193, 216` | `motivo: gestion.motivo` |
| Catálogo de causas | `mis-asignaciones/_components/causa-devolucion-options.ts:12` | `CAUSA_DEVOLUCION_LABEL`, aprobado el 2026-07-15 |
| Valores del enum | `lib/types/causa-devolucion.ts:16` | `CAUSA_DEVOLUCION_SEED`, lista cerrada de 3 |

**El acoplamiento entre carpetas ya existe:** `CierreDiaModule.tsx:62` y
`cierre-dia-descarga-columnas.ts:31` **ya importan de `cierres-admin/_components/cierre-labels`**.
Esta ficha no estrena ninguna dependencia nueva: añade un símbolo a un import que ya está escrito.

## 2. La decisión de contenido: qué dice cada columna, y qué pasa cuando no hay dos columnas

Donde el marcador de origen acompaña al motivo, **cada columna responde una pregunta distinta**:

- **Origen** responde *quién lo hizo y por qué existe esta gestión*: `Automático` + su nota.
- **Motivo** responde *cuál era la causa*: `Dirección errada`.

Por eso la celda no dice «Rechazo automático por plazo vencido · dirección errada»: sería la tercera
vez que la misma fila cuenta lo mismo.

**Pero ese reparto sólo existe si hay dos columnas, y en `/cierre-dia` no las hay.**
`CierreDiaRepository.ts:295` fija `esRechazoSla: false` para esa vista —decisión de la 102, no un
olvido—, así que ahí **no hay marcador ni puede haberlo**: el texto del motivo es el **único**
portador de la información. Un «Dirección errada» a secas dejaría al mensajero creyendo que ese
motivo lo escribió él, sobre un rechazo que no hizo.

Por eso hay **dos variantes del mismo texto**, no dos vocabularios:

| Contexto de la fila | Texto |
| --- | --- |
| con marcador de origen a la vista | `Dirección errada` |
| sin marcador | `Dirección errada · lo rechazó el sistema al vencerse el plazo de la devolución` |

El texto largo **se sostiene solo**: dice la causa, quién rechazó y por qué. No usa la sigla, no
copia la frase del marcador —así que si algún día apareciesen juntos no sería un eco literal— y **no
depende del `title`**, que en táctil no existe (§7).

## 3. Dónde vive la traducción, y su contrato

En `cierre-labels.ts`, el módulo **puro** del texto de los cierres: la puerta por la que la pantalla,
el archivo y ya `/cierre-dia` piden sus rótulos desde la feature 170. Su razón de ser es justo ésta:
que lo descargado y lo pintado digan lo mismo **porque leen del mismo sitio**, no porque hoy
coincidan dos literales.

```ts
// cierre-labels.ts  (módulo puro: sin React, sin DOM)
import { CAUSA_DEVOLUCION_SEED } from "@/lib/types/causa-devolucion";
import { CAUSA_DEVOLUCION_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-devolucion-options";

/** Lo que se le añade a la causa cuando NO hay marcador de origen en la fila (R11). */
export const MOTIVO_RECHAZO_AUTOMATICO_COLA =
  "lo rechazó el sistema al vencerse el plazo de la devolución";

/**
 * `hayMarcadorDeOrigen`: ¿esta fila muestra el marcador «Automático»?
 * En la práctica TODOS los llamadores pasan `gestion.esRechazoSla`, que es exactamente el
 * booleano que decide si el marcador se pinta.
 */
export function motivoGestionLegible(
  motivo: string | null,
  hayMarcadorDeOrigen: boolean,
): string | null;
```

**Contrato de E/S**

| Entrada | `hayMarcadorDeOrigen: true` | `hayMarcadorDeOrigen: false` |
| --- | --- | --- |
| `null` | `null` | `null` |
| `"escalado SLA not_found"` | `"Cliente no localizado"` | `"Cliente no localizado · lo rechazó el sistema al vencerse el plazo de la devolución"` |
| `"escalado SLA wrong_number"` | `"Número de celular errado"` | `"Número de celular errado · …"` |
| `"escalado SLA wrong_address"` | `"Dirección errada"` | `"Dirección errada · …"` |
| cualquier otra cosa (texto libre, cadena vacía, causa desconocida, otra caja) | **la entrada, idéntica** | **la entrada, idéntica** |

**Un solo booleano para los 18 puntos de llamada, y siempre el mismo valor: `gestion.esRechazoSla`.**
*(Corregido el 2026-09-10, al implementar: esta línea decía «13». El número bueno es el que
enumera la tabla de §4 —4 + 4 + 1 + 1 + 4 + 4 = 18—, y es el que hay en el código.)*
Funciona sin excepciones y no es casualidad: `esRechazoSla` es `true` exactamente en las filas donde
el marcador se pinta (`renderRechazoOrigen`, la celda `origenRechazo` de las dos descargas, el badge
de `cierre-factura.tsx:1542`) y `false` en todas las demás —incluidas **todas** las de `/cierre-dia`,
por `CierreDiaRepository.ts:295`—. Así que el llamador no decide nada: repite el mismo booleano que
ya decide el marcador, y las dos cosas no pueden desincronizarse.

**El emparejamiento es por igualdad exacta de la cadena completa**, contra las tres cadenas
compuestas a partir de `CAUSA_DEVOLUCION_SEED`. No `startsWith`, no `includes`, no `toLowerCase`, no
`trim`, no expresión regular: el texto libre del mensajero es sagrado (R2) y cualquier
emparejamiento laxo puede comérselo o deformarlo. Coste aceptado y declarado: una fila con un
espacio de más saldría cruda — ninguna lo tiene, todas las produce el mismo `template literal`.

**Que `null` NO se convierta en `"—"` dentro de la función es parte del contrato**, no un detalle:
la descarga declara que una celda sin dato va **vacía** y no con el guion de la pantalla (R10 de la
170). Colapsarlo aquí metería un `"—"` en el Excel.

**Vocabulario: `CAUSA_DEVOLUCION_LABEL`, el aprobado el 2026-07-15 (feature 73)** — «Cliente no
localizado» / «Número de celular errado» / «Dirección errada». Es lo que el mensajero elige en el
selector y lo que pinta Novedades: un concepto, un nombre. El precedente de importarlo desde otra
ruta es exacto y está en el mismo archivo que se toca (`cierre-detalle-shared.tsx:33` ya importa
`CAUSA_INCIDENTE_LABEL` de esa carpeta, con su justificación escrita). Los dos módulos importados son
puros, así que `cierre-labels.ts` sigue sin arrastrar React.

La sigla `SLA` aparecerá en el **emparejador** —hay que reconocer la cadena guardada— y nunca en la
salida. Por eso la guardia de R4 se escribe sobre **la salida de la función** y no sobre el texto del
archivo: un `grep` del código fuente daría rojo por el emparejador y verde por un comentario, que es
justo el criterio de «hecho» que este arnés prohíbe.

## 4. Dónde se aplica

| # | Archivo | Puntos | Cambio |
| --- | --- | --- | --- |
| 1 | `cierres-admin/…/cierre-detalle-shared.tsx` | 1385, 1424, 1433, 1455 | `motivoGestionLegible(g.motivo, g.esRechazoSla) ?? "—"` |
| 2 | `cierres-admin/…/cierre-gestiones-descarga-columnas.ts` | 215, 240, 277, 315 | `motivo: motivoGestionLegible(gestion.motivo, gestion.esRechazoSla)` |
| 3 | `cierres-admin/…/cierres-gestiones-fundida-descarga-columnas.ts` | 445 | idem |
| 4 | `cierres-admin/…/cierre-factura.tsx` | 1530 | `value={motivoGestionLegible(g.motivo, g.esRechazoSla)}` |
| 5 | `cierre-dia/…/CierreDiaModule.tsx` | 1195, 1203, 1223, 1231 | igual que 1 (resuelve siempre a la variante larga) |
| 6 | `cierre-dia/…/cierre-dia-descarga-columnas.ts` | 164, 178, 193, 216 | igual que 2 |

El `?? "—"` se queda **en el render**, nunca dentro de la función. Ninguna llamada añade estado,
props ni cálculo.

**Sí, la descarga también se traduce.** Decisión explícita, por tres razones medidas: (a) la 170
declaró que el archivo y la pantalla dicen lo mismo porque leen del mismo módulo —dejarlos distintos
rompería eso—; (b) en el archivo **no hay tooltip ninguno**, así que la jerga es ahí todavía peor;
(c) el precedente ya está en el mismo archivo: `filaDescargaGestionIncidente` emite la **etiqueta
legible** de la causa y no el slug (`cierre-gestiones-descarga-columnas.ts:312-314`), y la hoja
fundida lo tiene escrito como R45 («SIEMPRE la etiqueta legible, JAMÁS el value del enum»). No
traducir aquí sería la excepción, no la norma.

## 5. Alternativas descartadas

**A. Reescribir el histórico (backfill de `gestion_orden.motivo`).** Descartada: esas filas son
evidencia de lo que el sistema hizo, una migración manda el gate al modo completo y arrastra un
`down.sql` sobre datos vivos, y encima no arregla nada hacia adelante — el cron seguiría escribiendo
la plantilla mañana.

**B. Cambiar el productor (`DevolucionSlaService.ts:262`) para que escriba ya el texto humano.**
Descartada: (1) no toca ni una de las filas que ya existen, que son justo el caso reportado; (2) mete
texto de presentación en un servicio de dominio que hoy no sabe nada de pantallas; (3) congelar la
redacción en el dato impide tener las dos variantes de §2, que es precisamente lo que hace falta.

**C. Derivar el texto en el servidor y añadirlo al DTO (`motivoLegible`).** Descartada por
sobre-ingeniería: el cliente ya tiene el dato y el catálogo; añadir un campo obliga a poblarlo en dos
repositorios, a mantener el DTO y a decidir qué pasa con los consumidores que quieren el crudo.

**D. Emparejar con expresión regular o `startsWith("escalado SLA")`.** Descartada: más código y
**puede comerse el texto libre del mensajero** (R2). La igualdad exacta contra las tres cadenas del
SEED es más corta, más estrecha y sin falsos positivos.

**E. Estrenar vocabulario propio para esta columna** («dirección incorrecta», «teléfono
incorrecto»…, como pedía el borrador de la ficha). **Descartada por el humano el 2026-09-10:** esos
tres valores ya tienen nombre publicado y aprobado desde la 73; un segundo juego de palabras daría
dos nombres al mismo valor según la pantalla. Mismo criterio que la 405 al descartar `fecha`/`tipo`.

**F. Un solo texto para todas las superficies.** Era el borrador de este spec. Descartada al medir
`CierreDiaRepository.ts:295`: con el texto corto, el mensajero se queda sin saber que el rechazo no
fue suyo; con el texto largo en todas partes, la fila del admin cuenta lo mismo tres veces. El
booleano de §3 resuelve las dos sin duplicar ni un literal.

**G. Llevar el marcador de origen a `/cierre-dia`.** Descartada: exige que el servidor derive
`esRechazoSla` para esa vista —hoy es `false` por decisión expresa de la 102—, es backend, y esta
ficha es frontend puro. Es además más caro que una cola de frase.

## 6. Verificación

⚠️ **El gate rápido se va a negar, y hay que contarlo antes.** Los archivos que se tocan llevan
`cierre` en el nombre, y `cierre` está en la lista de nombres de dinero de `docs/verification.md`.
`./init.sh --rapido` **falla por diseño** en esta ficha: el gate es **`./init.sh` completo**, también
para abrir el PR. No es un contratiempo, es la regla funcionando.

Tests nuevos y tocados (el mapa `R<n> → test` está requisito por requisito en `requirements.md`):

- `tests/unit/components/motivo-rechazo-automatico-legible.test.ts` *(nuevo)* — R1, R2, R3, R5, R7, R11, R12.
- `tests/unit/guards/motivo-automatico-sin-jerga.guardia.test.ts` *(nuevo)* — R4. Guardia de
  **comportamiento**: recorre el SEED, compone la plantilla, pasa la salida por las dos variantes y
  exige que no contenga `"SLA"` ni el value. Las guardias las selecciona el patrón `vitest run guard`
  solas.
- `tests/components/CierreMotivoRechazoAutomatico.test.tsx` *(nuevo)* — R8, R9.
- `tests/components/CierreDiaMotivoRechazoAutomatico.test.tsx` *(nuevo)* — R11 en la pantalla real
  del mensajero.
- `tests/unit/descarga/cierre-gestiones-descarga-columnas.test.ts` *(tocado)* — R3, R6.
- `tests/unit/descarga/cierres-gestiones-fundida-descarga-columnas.test.ts` *(tocado)* — R6.
- `tests/unit/descarga/cierre-dia-descarga-columnas.test.ts` *(tocado)* — R6 con la variante larga.

**Todos los literales se afirman a mano.** Ni un test compara la salida contra
`CAUSA_DEVOLUCION_LABEL[...]`, contra `MOTIVO_RECHAZO_AUTOMATICO_COLA` ni contra
`motivoGestionLegible`: eso es «aserción contra su propia fuente» y sale verde aunque las palabras se
rompan. Se escribe `"Dirección errada"` en el test.

**Mutaciones obligatorias, cada una con su número de rojos anotado:**
1. devolver la entrada sin traducir → R1, R4, R6, R9, R11;
2. cambiar la igualdad exacta por `startsWith` → el caso de texto libre de R2;
3. colapsar `null` a `"—"` dentro de la función → R3, por la celda de la descarga;
4. traducir en la pantalla y no en la descarga → R6;
5. cambiar una de las tres palabras del catálogo → R1, R9, R12;
6. **pasar `true` fijo en los llamadores de `/cierre-dia`** (el fallo mudo de esta ficha: nadie ve un
   error, sólo un texto más corto) → R11;
7. borrar la cola del texto largo → R11 y R12.

## 7. Límites declarados

- **La nota del marcador vive sólo en `title`/`aria-label`: en táctil no existe, y los mensajeros
  están en móvil.** Esta ficha no lo arregla —sería rediseñar la columna «Origen»—, pero **no lo da
  por bueno**: por eso el texto de R11 no depende de ningún tooltip para entenderse. Queda como deuda
  conocida de la superficie de admin.
- En la descarga, un usuario puede ocultar la columna «Origen» con su preferencia de columnas
  (`AMBITO_DESCARGA_GESTIONES_*`, ficha 314). En esa hoja el motivo corto se quedaría sin su vecino.
  Se acepta: el texto de origen sigue en la pantalla, y adivinar la preferencia del usuario dentro de
  un módulo puro sería peor que el problema.
- La igualdad exacta no traduce una fila con espacios de más. Ninguna existe hoy.
