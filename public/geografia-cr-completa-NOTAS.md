# Notas — Mapa territorial de Costa Rica (geografia-cr-completa.xlsx)

> BORRADOR para validación humana antes de sembrar la base de datos.
> Generado el 2026-07-10.

## Fuente

- **Registro Nacional — Instituto Geográfico Nacional (IGN). División Territorial
  Administrativa (DTA), edición 2026.** Es la fuente vigente y la que manda hoy.
  URL: https://www.snitcr.go.cr/pdfs/ign_repositorio/DTA-TABLA%20POR%20PROVINCIA-CANT%C3%93N-DISTRITO%202026.pdf
  **Aviso sobre este PDF:** su portada declara **494** distritos, pero su tabla de
  detalle sigue omitiendo **Duacarí** (Guácimo, Limón) y solo enumera 493. El
  documento se contradice a sí mismo; se toma la portada como buena porque Duacarí
  existe por decreto desde 1980 (ver más abajo).
- **DTA edición anterior (2022/2023)**, con la que se generó este archivo en su
  primera versión. Archivo: `DTA-TABLA_POR_PROVINCIA-CANTON-DISTRITO_2023.pdf`
  (encabezado interno "DIVISIÓN TERRITORIAL ADMINISTRATIVA, 2022"; publicado 2023).
  URL: https://files.snitcr.go.cr/boletines/DTA-TABLA_POR_PROVINCIA-CANTON-DISTRITO_2023.pdf
- Fuente de contraste para conteos: Wikipedia ES "Distritos de Costa Rica" y
  "Anexo:Cantones de Costa Rica" (consultadas 2026-07-10).

La estructura completa (los distritos, con sus fechas de oficialización y
normas legales) se extrajo directamente de la tabla distrital del PDF del IGN
(páginas 6–19 y 20–29), que es la fuente autoritativa. Incluye las reformas
recientes exigidas: cantón **Puerto Jiménez** (Ley 10195, 2022, Puntarenas),
cantón **Monteverde** (Ley 10019, 2022, Puntarenas) y cantón **Río Cuarto**
(Ley 9440, 2018, Alajuela).

**Actualización 2026-09-05 (DTA 2026).** El archivo pasó de 491 a **494**
distritos. Los tres que se añadieron:

| Distrito | Cantón | Provincia | Código DTA | Norma |
|----------|--------|-----------|:----------:|-------|
| **Cabagra**  | Buenos Aires | Puntarenas | 60310 | decreto 10709, 30/05/2025 |
| **Pijije**   | Bagaces      | Guanacaste | 50405 | decreto 10688, 30/05/2025 |
| **Duacarí**  | Guácimo      | Limón      | 70605 | decreto ejecutivo 12091-G, 27/11/1980 |

Cabagra y Pijije son creaciones **posteriores** a la edición 2022/2023 con la que
se generó este archivo, así que su ausencia era esperable. Duacarí no: existe
desde 1980 y faltaba por un defecto del PDF del IGN (ver la sección siguiente).
En la base de datos los añade la migración
`db/migrations/20260905175156_geografia_dta_2026_distritos_faltantes`.

## Conteos finales (checksum)

| Provincia   | Cantones | Distritos |
|-------------|:--------:|:---------:|
| San José    |    20    |    123    |
| Alajuela    |    16    |    116    |
| Cartago     |     8    |     53    |
| Heredia     |    10    |     48    |
| Guanacaste  |    11    |     62    |
| Puntarenas  |    13    |     62    |
| Limón       |     6    |     30    |
| **TOTAL**   |  **84**  |  **494**  |

- **Provincias: 7** — cuadra con el checksum.
- **Cantones: 84** — cuadra exactamente con el checksum requerido (SJ 20, A 16,
  C 8, H 10, G 11, P 13, L 6). Cada cantón tiene todos sus distritos; ningún
  cantón quedó vacío.
- **Distritos: 494** — el archivo contiene 494 filas de distrito, que es el total
  que declara la portada de la DTA 2026 del IGN.

### ✅ Discrepancia de 1 distrito (491 vs 492) — RESUELTA: era Duacarí

**La respuesta es Duacarí** (Guácimo, Limón), código DTA **70605**, creado por
**decreto ejecutivo 12091-G del 27/11/1980**. Añadido el 2026-09-05.

Lo que se había anotado como "probablemente huecos de códigos históricos" no lo
era: la portada del PDF del IGN contaba **bien** y su tabla de detalle contaba
**mal**. El defecto se repite en la edición 2026 del mismo documento —su portada
declara 494 y su tabla enumera 493, otra vez sin Duacarí—, así que no es un error
de una edición suelta sino un fallo arrastrado del PDF.

La pista estaba a la vista y se leyó al revés: Wikipedia ES reportaba **Limón =
30** contra los **29** de nuestra extracción, y la diferencia se atribuyó al
cantón **Guácimo (706)**. La atribución al cantón era correcta; la conclusión no.
Se investigó si sobraba **Río Jiménez** (70604) —que la tabla de normas del PDF
omite, aunque sí aparece en la tabla de áreas con código y superficie— cuando lo
que pasaba es que **faltaba Duacarí** (70605). Río Jiménez se queda: es legítimo.
Guácimo tiene **5** distritos: 70601 Guácimo, 70602 Mercedes, 70603 Pocora,
70604 Río Jiménez y 70605 Duacarí.

Los códigos vacantes que sí existen en la numeración oficial —y que no explicaban
nada del total, porque un código sin distrito no suma distrito— quedan anotados
como curiosidad de la numeración:

- Alajuela / Grecia: falta el código `20306` (salta de 20305 Tacares a 20307
  Puente de Piedra).
- Puntarenas / Puntarenas: falta el código `60109` (salta de 60108 Barranca a
  60110 Isla del Coco).
- Puntarenas / Golfito: falta el código `60702` (salta de 60701 Golfito a 60703
  Guaycará).

Con Duacarí dentro, Limón pasa a 30 y coincide con el contraste externo. Sumando
además Cabagra y Pijije (creados en 2025, posteriores a la edición 2022/2023), el
total queda en **494**, que es lo que declara la portada de la DTA 2026.

## Decisiones de nombres (ortografía / tildes)

Se tomó como referencia primaria la **tabla distrital de áreas** del PDF (la que
trae los nombres con acentuación más completa). Donde el propio PDF es
inconsistente entre sus tablas, se optó por la forma oficial acentuada:

- **Vázquez de Coronado** (cantón de San José): con tilde en "Vázquez". La tabla
  de normas del PDF lo escribe sin tilde ("Vazquez"); se usó la forma correcta.
- **Puerto Jiménez** (cantón de Puntarenas): con tilde. La tabla de cantones del
  PDF lo escribe "Puerto Jimenez" sin tilde; se usó la forma correcta.
- **León Cortés Castro** (cantón de San José): se mantuvo el nombre completo
  oficial.
- **Sarchí** (cantón de Alajuela): nombre oficial actual (antes "Valverde Vega",
  renombrado por Ley 9440-bis / reforma). Distritos "Sarchí Norte" y "Sarchí Sur".
- **Patarrá**, **Ipís**, **Páramo**: acentuados según la tabla distrital (la de
  normas los escribe sin tilde).
- **Bolívar** (distrito de Grecia, Alajuela): la tabla del IGN lo escribe
  "Bolivar" sin tilde; se aplicó la tilde correcta ("Bolívar"). REVISAR si se
  prefiere respetar el texto literal del IGN.
- **San Cristóbal** (distrito de Desamparados, San José): la tabla del IGN lo
  escribe "San Cristobal" sin tilde; se aplicó la tilde correcta. REVISAR igual
  que el anterior.
- **San José o Pizote** (distrito de Upala, Alajuela): la tabla lo muestra como
  "San José O Pizote" (con "O" mayúscula); se normalizó a "o" minúscula para
  homogeneizar con los otros distritos de doble nombre.
- Distritos con doble nombre conservados tal cual: **Aguacaliente o San
  Francisco** y **Guadalupe o Arenilla** (ambos en el cantón Cartago).

## Cobertura y confianza

- Todos los nombres provienen 1:1 de la DTA del IGN; no se inventó ningún
  distrito ni cantón.
- Ningún cantón quedó sin distritos.
- Elementos marcados para revisión humana: (1) tildes aplicadas en "Bolívar" y
  "San Cristóbal"; (2) forma "San José o Pizote".
- **Cerrados el 2026-09-05**: el total 491 vs 492 (era Duacarí, ver arriba; el
  total correcto contra la DTA 2026 es 494) y la inclusión de Río Jiménez en
  Guácimo (es legítima: Guácimo tiene 5 distritos, no 3 ni 4).

## Formato del archivo

- `public/geografia-cr-completa.xlsx`, una sola hoja **Geografia**.
- Fila 1 encabezados: `Provincia | Canton | Distrito`.
- 494 filas de datos (desnormalizado: provincia y cantón repetidos por distrito).
  Cada distrito va junto a sus hermanos, dentro del bloque de su cantón.
- Codificación UTF-8; tildes y ñ preservadas.

## Deuda abierta: dos familias de nombre de zona (medido el 2026-09-05)

`canonicalZonaNombre('ZONA SUR')` (`lib/geo/normalize.ts`) devuelve `'Zona Sur'`,
y `zona.nombre` es único **por texto exacto**. Como consecuencia, las dos vías que
crean zonas producen filas distintas para la misma zona:

- la migración `20260713010000_seed_zonas_pago_distrito` inserta los nombres en
  mayúsculas (`ZONA SUR`, `SAN RAMÓN`, `LIMÓN ABAJO`, `GUANACASTE`, …);
- `scripts/seed-zonas.ts` inserta la forma canónica (`Zona Sur`, `San Ramón`,
  `Limón Abajo`, `Guanacaste`, …).

Un distrito alcanzado por ambas vías acaba con **2 filas en `zona_distrito`**, y
`zonaUnicaDeDistrito` (`lib/repositories/_shared/zona-colapso.ts`) colapsa más de
una zona a `null`: el distrito queda inservible **pareciendo configurado**.

Medición sobre una base **desechable y limpia**, secuencia
`prisma migrate deploy` → `pnpm exec tsx scripts/seed-zonas.ts`:

- tabla `zona`: **13 filas**. `GAM` (151 distritos) es la única sin pareja, porque
  es acrónimo y su forma canónica coincide. Las otras seis van en pareja:
  `ZONA SUR` 36 / `Zona Sur` 0 · `PUNTARENAS` 27 / `Puntarenas` 22 ·
  `GUANACASTE` 15 / `Guanacaste` 1 · `SAN RAMÓN` 12 / `San Ramón` 21 ·
  `LIMÓN ABAJO` 8 / `Limón Abajo` 4 · `QUEPOS` 7 / `Quepos` 0.
- distritos con más de una zona: **3** — Quesada (San Carlos, Alajuela) y
  San Ramón (San Ramón, Alajuela) con `San Ramón | SAN RAMÓN`, y Puerto Viejo
  (Sarapiquí, Heredia) con `Limón Abajo | LIMÓN ABAJO`.
- **Producción está limpia: 0 distritos con más de una zona** (medido 2026-09-05).

Esto obligó a una decisión en `public/mapa-geografico-costa-rica.xlsx`. Con una
fila `Puntarenas | Buenos Aires | Cabagra | ZONA SUR` en la hoja
`Jerarquía (revisar)`, la medición daba **Cabagra con 2 zonas**
(`Zona Sur | ZONA SUR`) y el total de distritos afectados subía a **4**: la
migración `20260905175156` le hereda `ZONA SUR` de sus 9 hermanos y el seed CLI le
añadía encima `Zona Sur`. **Esa fila se quitó**; sin ella Cabagra queda con **1**
zona (`ZONA SUR`) y el total vuelve a **3**. La fila de **Pijije sí se conserva**:
Bagaces no tiene zona en la migración de zonas, así que el seed es su única vía y
acaba con **1** (`Guanacaste`), sin colisión.

Queda como deuda a decidir aparte: unificar las dos familias de nombre. **No se
arregla aquí** — tocaría datos ya editados a mano por el maestro en producción.
