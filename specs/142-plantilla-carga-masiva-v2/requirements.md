# Feature 142 — Plantilla de carga masiva v2 (orden nuevo + dirección unificada)

Requisitos en notación EARS. Sin detalles de implementación (esos van en `design.md`).

## Glosario

- **Plantilla**: archivo XLSX/CSV que la app genera para descargar desde el paso
  "Subir archivo" de la carga masiva de órdenes.
- **`direccion_destinatario`**: columna única nueva, con el formato
  `País / Provincia / Cantón (Distrito) / Dirección literal`.
  Ejemplo: `Costa Rica / Cartago / Jimenez (Juan Vinas) / Frente gasolinera JSM, 200m sur`.
- **Parser de dirección**: función pura que separa el valor de `direccion_destinatario`
  en `provincia`, `canton`, `distrito` y `direccion`.
- **`resolverGeografia`**: resolución existente provincia → cantón → distrito por
  nombre contra el catálogo, con derivación de `zona_id` desde el distrito
  (`BulkOrdenService`).
- **Vía sesión**: carga masiva desde la UI (`/api/ordenes/carga-masiva/chunk`).
- **Vía API key**: carga por integrador (`/api/ordenes/api-key/carga`, feature 88).

---

## 1. Forma de la plantilla

- **R1** — El sistema DEBE generar la plantilla de carga masiva de órdenes con
  exactamente 8 columnas, en este orden y con estas claves:
  `destinatario`, `telefono`, `direccion_destinatario`, `monto_cobrar`,
  `producto`, `num_remision`, `peso`, `notas`.

- **R2** — El sistema DEBE emitir como texto de cada celda de cabecera la clave
  máquina de la columna, sin etiqueta alternativa ni sufijo de obligatoriedad, de
  modo que la plantilla descargada se pueda volver a subir sin editarla
  (round-trip descargar → subir, tanto en XLSX como en CSV).

- **R3** — El sistema DEBE incluir en la plantilla una fila de ejemplo con un
  valor por cada una de las 8 columnas, y el ejemplo de `direccion_destinatario`
  DEBE cumplir el formato `País / Provincia / Cantón (Distrito) / Dirección literal`.

- **R4** — CUANDO el ejemplo de `direccion_destinatario` de la plantilla se pasa
  por el parser de dirección, el sistema DEBE producir una terna
  provincia/cantón/distrito que exista en el catálogo geográfico real y cuyo
  distrito tenga zona asignada (es decir: la plantilla descargada se carga tal
  cual, sin errores de geografía).

- **R5** — El sistema NO DEBE incluir en la plantilla las columnas `provincia`,
  `canton`, `distrito` ni `direccion`.

## 2. Validación de cabecera y corte duro (D1)

- **R6** — El sistema DEBE exigir como columnas obligatorias de cabecera
  exactamente: `num_remision`, `destinatario`, `telefono`, `direccion_destinatario`.

- **R7** — CUANDO se sube un archivo cuya cabecera no contiene
  `direccion_destinatario`, el sistema DEBE reportarla como columna obligatoria
  ausente y DEBE rechazar el archivo antes de enviar ninguna fila al servidor.

- **R8** — CUANDO se sube un archivo con el formato antiguo (columnas
  `provincia`, `canton`, `distrito`, `direccion` y sin `direccion_destinatario`),
  el sistema DEBE rechazarlo en la validación de cabecera con un mensaje que
  indique que la plantilla cambió y que hay que descargar la plantilla nueva.

- **R9** — El sistema NO DEBE ofrecer ningún modo de compatibilidad con el
  formato antiguo: no existe camino de código que derive la geografía desde las
  columnas `provincia`/`canton`/`distrito` en la vía sesión, ni siquiera cuando
  esas columnas están presentes en el archivo.

- **R10** — SI el archivo trae columnas adicionales no reconocidas (incluidas
  `provincia`, `canton`, `distrito` o `direccion`) ADEMÁS de todas las
  obligatorias, ENTONCES el sistema DEBE ignorarlas y procesar el archivo con
  normalidad, sin error de cabecera.

## 3. Contrato del parser de `direccion_destinatario`

- **R11** — El sistema DEBE separar el valor de `direccion_destinatario` usando
  únicamente los **tres primeros** caracteres `/` como separadores, produciendo
  cuatro segmentos: país (1.º), provincia (2.º), cantón-con-distrito (3.º) y
  dirección literal (4.º = todo lo que sigue al tercer `/`).

- **R12** — El sistema DEBE descartar el segmento de país sin validarlo contra
  ningún catálogo y sin persistirlo; SI el segmento de país está vacío o contiene
  cualquier texto, ENTONCES el resultado del parseo DEBE ser el mismo.

- **R13** — SI el valor contiene menos de tres caracteres `/`, ENTONCES el
  sistema DEBE producir un error de campo en `direccion_destinatario` indicando
  el formato esperado, y NO DEBE crear la orden de esa fila.

- **R14** — CUANDO el valor contiene exactamente tres caracteres `/`, el sistema
  DEBE producir provincia, cantón, distrito y dirección a partir de los cuatro
  segmentos resultantes.

- **R15** — CUANDO el valor contiene más de tres caracteres `/`, el sistema DEBE
  conservar en la dirección literal todos los `/` posteriores al tercero y todos
  sus espacios internos, sin colapsarlos ni recortarlos.
  (Ej.: `CR / Cartago / Jimenez (Juan Vinas) / Frente a la iglesia / casa verde  #3`
  → dirección `Frente a la iglesia / casa verde  #3`.)

- **R16** — CUANDO la dirección literal termina en `/`, el sistema DEBE
  conservar ese `/` final como parte de la dirección.

- **R17** — El sistema DEBE recortar los espacios sobrantes al inicio y al final
  de los segmentos de provincia, cantón, distrito y dirección literal, y DEBE
  dejar intactos los espacios internos de cada uno.
  (Ej.: `  Costa Rica  /  Cartago  /  Jimenez  (  Juan Vinas  )  /  Frente a X  `
  → provincia `Cartago`, cantón `Jimenez`, distrito `Juan Vinas`, dirección `Frente a X`.)

- **R18** — El sistema DEBE extraer el distrito del texto encerrado entre el
  primer `(` del tercer segmento y el primer `)` posterior, y DEBE tomar como
  cantón el texto que precede a ese `(`.

- **R19** — SI el tercer segmento no contiene paréntesis de distrito, ENTONCES el
  sistema DEBE producir un error de campo en `direccion_destinatario` indicando
  que falta el distrito entre paréntesis, y NO DEBE crear la orden de esa fila
  (decisión D2: `zona_id` se deriva del distrito).

- **R20** — SI el paréntesis de distrito está vacío o contiene solo espacios
  (p. ej. `Jimenez ()`), ENTONCES el sistema DEBE producir un error de campo en
  `direccion_destinatario` y NO DEBE crear la orden de esa fila.

- **R21** — SI el tercer segmento abre paréntesis y no lo cierra (p. ej.
  `Jimenez (Juan Vinas`), ENTONCES el sistema DEBE producir un error de campo en
  `direccion_destinatario` y NO DEBE crear la orden de esa fila.

- **R22** — SI el tercer segmento contiene texto no vacío después del `)` de
  cierre (p. ej. `Jimenez (Juan Vinas) extra`), ENTONCES el sistema DEBE producir
  un error de campo en `direccion_destinatario` y NO DEBE crear la orden de esa
  fila. Los espacios en blanco tras el `)` DEBEN ignorarse sin error.

- **R23** — SI el segmento de provincia está vacío o contiene solo espacios,
  ENTONCES el sistema DEBE producir un error de campo en `direccion_destinatario`
  y NO DEBE crear la orden de esa fila.

- **R24** — SI el texto del cantón (lo que precede al `(`) está vacío o contiene
  solo espacios, ENTONCES el sistema DEBE producir un error de campo en
  `direccion_destinatario` y NO DEBE crear la orden de esa fila.

- **R25** — SI el valor de `direccion_destinatario` está ausente, vacío o
  contiene solo espacios, ENTONCES el sistema DEBE producir un error de campo en
  `direccion_destinatario` indicando que es obligatorio y el formato esperado, y
  NO DEBE crear la orden de esa fila.

- **R26** — SI la dirección literal (cuarto segmento) queda vacía tras recortar
  espacios, ENTONCES el sistema DEBE aceptar la fila (dirección literal vacía se
  trata igual que la columna `direccion` vacía de hoy), sin producir error de
  campo por ese motivo.

- **R27** — El sistema NO DEBE normalizar acentos ni mayúsculas/minúsculas en el
  parser: los nombres de provincia, cantón y distrito se entregan tal cual
  aparecen en el archivo (solo recortados, R17). La insensibilidad a acentos,
  mayúsculas, puntuación y espacios repetidos al comparar contra el catálogo DEBE
  seguir siendo responsabilidad exclusiva de `resolverGeografia` (normalizador
  existente), sin duplicarse.
  (Ej.: `costa rica / CARTAGO / jiménez (juan viñas) / X` DEBE resolver la misma
  geografía que el ejemplo canónico.)

- **R28** — El parser DEBE ser puro y determinista (misma entrada → misma
  salida, sin acceso a red, DB ni estado global) y NO DEBE lanzar excepciones
  para ninguna entrada de tipo `string`: todo caso inválido se expresa como
  resultado de error.

## 4. Errores de fila y resiliencia del lote

- **R29** — CUANDO el parseo de `direccion_destinatario` de una fila falla por
  cualquiera de las causas R13, R19-R25, el sistema DEBE reportar esa fila con
  `resultado: "error"` y con la clave de error `direccion_destinatario`, cuyo
  mensaje DEBE ser accionable (indica la causa concreta y el formato esperado).

- **R30** — MIENTRAS una o más filas de un lote fallan el parseo de
  `direccion_destinatario`, el sistema DEBE seguir procesando y creando las demás
  filas válidas del lote, sin abortar la carga ni devolver un error HTTP.

- **R31** — El sistema DEBE producir la misma clasificación de fila (creada /
  duplicada / error) en la validación previa (`dryRun: true`) y en la carga en
  firme, y DEBE hacerlo por igual cuando el archivo se procesa en varios lotes
  (chunks).

- **R32** — CUANDO una fila falla el parseo de `direccion_destinatario`, el
  resumen agregado (`total`, `creadas`, `duplicadas`, `conError`) DEBE contarla
  en `conError` y el chip de error correspondiente DEBE agruparla por tipo de
  mensaje junto con las demás filas que fallan por la misma causa.

## 5. Geografía: comportamiento conservado

- **R33** — El sistema DEBE seguir resolviendo la geografía de la fila por
  nombre contra el catálogo en el orden provincia → cantón (dentro de la
  provincia) → distrito (dentro del cantón), y DEBE seguir derivando `zona_id`
  del distrito resuelto.

- **R34** — SI la provincia derivada no existe o es ambigua, ENTONCES el sistema
  DEBE producir el error de campo actual bajo la clave `provincia`
  (`provincia no encontrada` / `provincia ambigua`).

- **R35** — SI el cantón derivado no existe o es ambiguo dentro de la provincia,
  ENTONCES el sistema DEBE producir el error de campo actual bajo la clave
  `canton` (`canton no encontrado en la provincia` / `canton ambiguo en la provincia`).

- **R36** — SI el distrito derivado no existe o es ambiguo dentro del cantón, o
  no tiene zona asignada, ENTONCES el sistema DEBE producir el error de campo
  actual bajo la clave `distrito` (`distrito no encontrado en el canton` /
  `distrito ambiguo en el canton` / `el distrito '<x>' no tiene zona asignada`).

- **R37** — El sistema DEBE persistir la dirección literal derivada en el mismo
  campo de la orden en que hoy se persiste la columna `direccion`, y SI la
  dirección literal es vacía ENTONCES DEBE persistir `null`.

## 6. Alcance: lo que NO cambia

- **R38** — El sistema DEBE conservar sin cambios el contrato de la carga por API
  key (feature 88): esa vía sigue recibiendo `provincia`, `canton`, `distrito` y
  `direccion` como campos separados y su comportamiento no se ve afectado por
  esta feature.

- **R39** — El sistema DEBE conservar sin cambios la semántica de las columnas
  `num_remision` (obligatoria por fila, clave de deduplicación),
  `destinatario` (obligatoria), `telefono` (obligatoria), `producto`
  (obligatoria), `monto_cobrar` (numérico ≥ 0 o vacío → `null`), `notas`
  (opcional) y `peso` (presente en la plantilla y NO persistida, igual que hoy).

- **R40** — El sistema NO DEBE introducir migraciones de base de datos, cambios
  de RLS, cambios en el modelo `orden`, ni endpoints nuevos.

---

## Preguntas abiertas

Ninguna que bloquee la escritura del spec. Las decisiones que tomé sin
instrucción explícita del humano (y que él puede revertir en la puerta de
aprobación) están listadas en `design.md > Preguntas abiertas`; afectan a
**R22**, **R26** y al mensaje exacto de **R8**.
