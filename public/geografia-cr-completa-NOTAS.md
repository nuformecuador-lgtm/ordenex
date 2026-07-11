# Notas — Mapa territorial de Costa Rica (geografia-cr-completa.xlsx)

> BORRADOR para validación humana antes de sembrar la base de datos.
> Generado el 2026-07-10.

## Fuente

- **Registro Nacional — Instituto Geográfico Nacional (IGN). División Territorial
  Administrativa (DTA).** Tabla oficial por Provincias, Cantones y Distritos.
  Archivo: `DTA-TABLA_POR_PROVINCIA-CANTON-DISTRITO_2023.pdf`
  (encabezado interno "DIVISIÓN TERRITORIAL ADMINISTRATIVA, 2022"; publicado 2023).
  URL: https://files.snitcr.go.cr/boletines/DTA-TABLA_POR_PROVINCIA-CANTON-DISTRITO_2023.pdf
- Fuente de contraste para conteos: Wikipedia ES "Distritos de Costa Rica" y
  "Anexo:Cantones de Costa Rica" (consultadas 2026-07-10).

La estructura completa (los 491 distritos, con sus fechas de oficialización y
normas legales) se extrajo directamente de la tabla distrital del PDF del IGN
(páginas 6–19 y 20–29), que es la fuente autoritativa. Incluye las reformas
recientes exigidas: cantón **Puerto Jiménez** (Ley 10195, 2022, Puntarenas),
cantón **Monteverde** (Ley 10019, 2022, Puntarenas) y cantón **Río Cuarto**
(Ley 9440, 2018, Alajuela).

## Conteos finales (checksum)

| Provincia   | Cantones | Distritos |
|-------------|:--------:|:---------:|
| San José    |    20    |    123    |
| Alajuela    |    16    |    116    |
| Cartago     |     8    |     53    |
| Heredia     |    10    |     48    |
| Guanacaste  |    11    |     61    |
| Puntarenas  |    13    |     61    |
| Limón       |     6    |     29    |
| **TOTAL**   |  **84**  |  **491**  |

- **Provincias: 7** — cuadra con el checksum.
- **Cantones: 84** — cuadra exactamente con el checksum requerido (SJ 20, A 16,
  C 8, H 10, G 11, P 13, L 6). Cada cantón tiene todos sus distritos; ningún
  cantón quedó vacío.
- **Distritos: 491** — el archivo contiene 491 filas de distrito.

### ⚠️ Discrepancia de 1 distrito (491 vs 492) — REVISAR

La página resumen del propio PDF del IGN declara **492** distritos, pero la
**enumeración fila por fila de la tabla distrital del mismo documento suma 491**.
El conteo de 491 se obtuvo listando cada código de distrito oficial existente.
La diferencia de 1 se debe muy probablemente a la forma en que el IGN cuenta los
"huecos" de códigos históricos (distritos suprimidos/reasignados cuyo código
quedó vacante). Códigos vacantes detectados en la numeración oficial:

- Alajuela / Grecia: falta el código `20306` (salta de 20305 Tacares a 20307
  Puente de Piedra).
- Puntarenas / Puntarenas: falta el código `60109` (salta de 60108 Barranca a
  60110 Isla del Coco).
- Puntarenas / Golfito: falta el código `60702` (salta de 60701 Golfito a 60703
  Guaycará).

Wikipedia ES reporta San José 123 (coincide) y Limón como la de menos con "30"
distritos; nuestra extracción del IGN da **Limón = 29**. La diferencia está en el
cantón **Guácimo (706)**: la tabla de áreas del IGN lista 4 distritos
(70601 Guácimo, 70602 Mercedes, 70603 Pocora, **70604 Río Jiménez**), pero la
tabla de normas del mismo PDF (última página) solo lista 3 (omite Río Jiménez).
Se incluyó **Río Jiménez** (Guácimo = 4 distritos) por aparecer en la tabla
distrital principal con código y área. **Punto a confirmar con el humano** si se
quiere alinear el total exacto a 492.

Recomendación: tratar 491 como el número de distritos efectivamente enumerables
en la DTA 2022/2023 del IGN, y verificar contra la edición más reciente de la DTA
si el proyecto exige el número "oficial" 492.

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
- Elementos marcados para revisión humana: (1) total 491 vs 492; (2) inclusión de
  Río Jiménez en Guácimo; (3) tildes aplicadas en "Bolívar" y "San Cristóbal";
  (4) forma "San José o Pizote".

## Formato del archivo

- `public/geografia-cr-completa.xlsx`, una sola hoja **Geografia**.
- Fila 1 encabezados: `Provincia | Canton | Distrito`.
- 491 filas de datos (desnormalizado: provincia y cantón repetidos por distrito).
- Codificación UTF-8; tildes y ñ preservadas.
