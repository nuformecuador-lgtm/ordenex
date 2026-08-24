# Feature 278 — Plantilla de carga masiva v3 (provincia + cantón(distrito) + dirección)

Requisitos en notación EARS. Sin detalles de implementación (esos van en `design.md`).

Sucede a la feature 142 (plantilla v2). Igual que aquella, es un **corte duro**:
no hay modo de compatibilidad con la plantilla anterior (decisión del humano en
el alta, D1).

## Glosario

- **Plantilla**: archivo XLSX/CSV que la app genera para descargar desde el paso
  "Subir archivo" de la carga masiva de órdenes.
- **v2**: plantilla vigente hoy (feature 142). Columna única `direccion_destinatario`
  con formato `País / Provincia / Cantón (Distrito) / Dirección`.
- **v3**: plantilla de esta feature. Tres columnas geográficas separadas:
  `provincia`, `canton_distrito`, `direccion`.
- **`canton_distrito`**: columna con formato `nombreCantón (Distrito)`.
  Ejemplo: `Cartago (Occidental)`.
- **Parser de cantón/distrito**: función pura que separa el valor de
  `canton_distrito` en `canton` y `distrito`.
- **`resolveGeo`**: resolución existente provincia → cantón → distrito por nombre
  contra el catálogo, con derivación de `zona_id` desde el distrito
  (`lib/services/geo-resolucion.ts`). **No cambia** en esta feature.
- **Vía sesión**: carga masiva desde la UI (`/api/ordenes/carga-masiva/chunk`).
- **Vía API key**: carga por integrador (`/api/ordenes/api-key/carga`, feature 88).

---

## 1. Forma de la plantilla

- **R1** — El sistema DEBE generar la plantilla de carga masiva de órdenes con
  exactamente 10 columnas, en este orden y con estas claves:
  `destinatario`, `telefono`, `provincia`, `canton_distrito`, `direccion`,
  `monto_cobrar`, `producto`, `num_remision`, `peso`, `notas`.

- **R2** — El sistema DEBE emitir como texto de cada celda de cabecera la clave
  máquina de la columna, sin etiqueta alternativa ni sufijo de obligatoriedad, de
  modo que la plantilla descargada se pueda volver a subir sin editarla
  (round-trip descargar → subir, tanto en XLSX como en CSV).

- **R3** — El sistema DEBE incluir en la plantilla una fila de ejemplo con un
  valor por cada una de las 10 columnas; el ejemplo de `canton_distrito` DEBE
  cumplir el formato `nombreCantón (Distrito)`.

- **R4** — CUANDO el ejemplo de `provincia` + `canton_distrito` de la plantilla
  se pasa por el parser y por `resolveGeo`, el sistema DEBE producir una terna
  provincia/cantón/distrito que exista en el catálogo geográfico real y cuyo
  distrito tenga zona asignada (es decir: la plantilla descargada se carga tal
  cual, sin errores de geografía).

- **R5** — El sistema NO DEBE incluir en la plantilla la columna
  `direccion_destinatario` ni una columna de país.

- **R6** — El sistema NO DEBE persistir ni exigir un valor de país en ninguna
  parte de la vía sesión.

## 2. Validación de cabecera y corte duro (D1)

- **R7** — El sistema DEBE exigir como columnas obligatorias de cabecera
  exactamente: `num_remision`, `destinatario`, `telefono`, `provincia`,
  `canton_distrito`, `direccion`.

- **R8** — CUANDO se sube un archivo cuya cabecera no contiene alguna de las
  columnas obligatorias, el sistema DEBE reportar cuáles faltan y DEBE rechazar
  el archivo antes de enviar ninguna fila al servidor.

- **R9** — CUANDO se sube un archivo con el formato v2 (columna
  `direccion_destinatario`, sin `provincia`/`canton_distrito`), el sistema DEBE
  rechazarlo en la validación de cabecera con un mensaje que indique que la
  plantilla cambió y que hay que descargar la plantilla nueva.

- **R10** — El sistema NO DEBE aceptar el valor de `direccion_destinatario` como
  fuente de geografía en ninguna fila: no hay modo de compatibilidad.

- **R11** — La comprobación de cabecera DEBE seguir siendo de PRESENCIA y no una
  lista blanca: un archivo con columnas adicionales (p. ej. `motivo_error` del
  export de errores, feature 143) DEBE seguir aceptándose.

## 3. Parser de `canton_distrito`

- **R12** — El sistema DEBE separar `canton_distrito` en `canton` (texto antes
  del primer `(`) y `distrito` (texto entre ese `(` y el primer `)` posterior).

- **R13** — El sistema DEBE recortar los espacios de los extremos de `canton` y
  de `distrito`, y NO DEBE normalizar acentos ni mayúsculas (esa normalización
  ya vive en `resolveGeo`).

- **R14** — SI el valor no contiene `(`, ENTONCES el sistema DEBE tomarlo entero
  como cantón y asumir que el distrito se llama **igual que el cantón**
  (`Cartago` ≡ `Cartago (Cartago)`). NO es un error de formato.

- **R15** — SI el paréntesis no está cerrado, ENTONCES el sistema DEBE rechazar
  la fila con un mensaje que cite el formato esperado.

- **R16** — SI el distrito entre paréntesis está vacío o solo tiene espacios,
  ENTONCES el sistema DEBE aplicar la misma asunción de R14 (distrito = cantón):
  unos paréntesis vacíos dicen lo mismo que no ponerlos.

- **R17** — SI hay texto después del `)`, ENTONCES el sistema DEBE rechazar la
  fila con un mensaje que cite el formato esperado.

- **R18** — SI el cantón (texto antes del `(`) está vacío, ENTONCES el sistema
  DEBE rechazar la fila con un mensaje que cite el formato esperado.

- **R19** — SI `canton_distrito` está ausente, vacío o solo con espacios,
  ENTONCES el sistema DEBE rechazar la fila indicando que el campo es obligatorio
  y citando el formato esperado.

- **R20** — El parser NO DEBE lanzar excepciones para ninguna entrada `string`:
  todo caso inválido DEBE expresarse como resultado.

- **R21** — El parser DEBE ser importable desde el navegador: sin Prisma, sin
  `next/*`, sin Supabase, sin `process.env`, sin I/O.

## 4. Fila: geografía y dirección

- **R22** — El sistema DEBE tomar la provincia de la fila desde la columna
  `provincia`, recortada en los extremos.

- **R23** — SI `provincia` está ausente, vacía o solo con espacios, ENTONCES el
  sistema DEBE rechazar la fila indicando que la provincia es obligatoria.

- **R24** — El sistema DEBE persistir como dirección literal de la orden el valor
  de la columna `direccion`, recortado en los extremos y conservando `/`,
  paréntesis y espacios internos.

- **R25** — Una `direccion` vacía DEBE ser válida (no bloquea la fila), igual que
  hoy.

- **R26** — CUANDO el parser de `canton_distrito` o la validación de `provincia`
  fallan, el sistema DEBE reportar el error EN SU CAMPO (`canton_distrito` o
  `provincia`) y NO DEBE intentar resolver la geografía de esa fila.

- **R27** — El sistema DEBE seguir resolviendo la geografía con `resolveGeo` sin
  cambios: mismos mensajes de provincia/cantón/distrito no encontrado o ambiguo,
  y mismo error de distrito sin zona.

- **R27b** — CUANDO se aplica la asunción de R14 y el cantón no tiene un distrito
  homónimo en el catálogo, el sistema DEBE rechazar la fila con el mensaje normal
  de `resolveGeo` (`distrito no encontrado en el canton`): la asunción NO DEBE
  producir nunca una resolución que el catálogo no respalde.

## 5. Vía API key: intacta

- **R28** — El sistema NO DEBE cambiar el contrato público de
  `/api/ordenes/api-key/carga`: sigue recibiendo `provincia`, `canton`,
  `distrito` y `direccion` como campos separados.

- **R29** — El sistema NO DEBE exigir `canton_distrito` en la vía API key ni
  aceptarlo como sustituto de `canton`/`distrito`.

- **R30** — El sistema DEBE mantener el `filaCargaSchema` compartido por ambas
  vías sin campos geográficos propios de una sola vía que rompan a la otra.

## 6. Consecuencias en pantalla

- **R31** — El texto de ayuda del paso de subida DEBE describir la estructura v3
  (las tres columnas y el formato de `canton_distrito`), no la columna única v2.

- **R32** — El export de filas con error (feature 143) DEBE emitir las 10
  columnas de la plantilla más `motivo_error`, y el archivo exportado DEBE poder
  re-subirse (round-trip).

- **R33** — Los chips de agrupación de errores del dry-run DEBEN seguir
  agrupando los errores de geografía por tipo, incluidos los nuevos errores de
  formato de `canton_distrito`.

## 7. Trazabilidad

- **R34** — Cada requisito R1–R33 DEBE quedar mapeado a al menos un test
  ejecutable, y el mapa DEBE constar en `tasks.md`.
