# 470 — Descargas sin tope de filas · requirements

> Ficha 470 (`feature_list.json`), zona `fullstack`, `sdd: true`. Pedida por el humano el 2026-10-02:
> el Excel de la caja con «Movimientos y detalle por guía» falla en producción con «El detalle por guía
> tendría 14153 filas y la descarga admite hasta 5000». Cita del humano: «necesito poder descargar lo que
> sea». **Spec aprobado de antemano** (status_note de la ficha): no hay preguntas bloqueantes; las
> decisiones que la descripción no fija se toman con criterio conservador y quedan anotadas al final
> (§ Decisiones tomadas sin preguntar) y razonadas en `design.md`.

## Vocabulario

- **Control de descarga**: el botón «Descargar» común de las tablas (`DescargarDatasetButton`), también
  cuando va dentro de un diálogo (descarga de gestiones de cierres).
- **Familia A**: tablas cuya descarga pide el conjunto completo al servidor con una acción de descarga
  dedicada (`listar…Completo`, `…KardexAction`, etc.).
- **Familia B**: tablas cuyo conjunto completo ya está en el navegador cuando se pulsa «Descargar».
- **Inventario**: la lista de pantallas y acciones de `design.md §2`.
- **Límite de Excel**: 1.048.576 filas por hoja, es decir 1.048.575 filas de datos más la cabecera.
- **Umbral de entrega**: tamaño del conjunto serializado por encima del cual el conjunto no viaja en la
  respuesta de la acción (por defecto 2.000.000 bytes, configurable).
- **Objeto temporal**: el conjunto serializado y comprimido que se deja en el almacenamiento privado para
  que el navegador lo lea una vez.

## Requisitos

### Sin tope propio

- **R1** — El sistema DEBE producir el archivo de cualquier tabla del inventario con todas las filas del
  conjunto filtrado, sin más máximo que el límite de Excel (1.048.575 filas de datos por hoja).
- **R2** — SI el conjunto de una descarga, o cualquiera de las hojas del archivo, supera 1.048.575 filas de
  datos, ENTONCES el sistema NO DEBE producir archivo y DEBE mostrar un aviso que diga cuántas filas
  tendría, el máximo que admite Excel y qué hacer (acotar el periodo o los filtros).
- **R3** — El sistema DEBE ignorar la variable de entorno `DESCARGA_MAX_FILAS`: con ella definida a
  cualquier valor, el máximo sigue siendo el límite de Excel.
- **R4** — CUANDO se descarga «Movimientos y detalle por guía» del libro de la caja con un detalle de más de
  5.000 filas (y hasta el límite de Excel), el sistema DEBE producir el archivo de dos hojas en vez del
  aviso «la descarga admite hasta 5000».

### Entrega de los conjuntos grandes (Familia A)

- **R5** — CUANDO una descarga de Familia A produce un conjunto cuyo tamaño serializado supera el umbral de
  entrega, el sistema DEBE dejar el conjunto como objeto temporal en un almacenamiento privado y devolver
  al navegador, en lugar del conjunto, una URL firmada para leerlo.
- **R6** — MIENTRAS el conjunto serializado no supere el umbral de entrega, el sistema DEBE devolverlo en la
  respuesta de la acción, sin escribir nada en el almacenamiento ni firmar ninguna URL.
- **R7** — CUANDO el navegador recibe una URL firmada, el sistema DEBE leer el objeto temporal y producir el
  archivo con él sin ninguna acción adicional del usuario (sin enlaces que pulsar ni correos).
- **R8** — El archivo producido a partir de un objeto temporal DEBE ser idéntico al que se produce con el
  mismo conjunto entregado en la respuesta: mismas hojas y nombres de hoja, mismas columnas elegidas y en
  su orden, mismas filas en el mismo orden, mismos valores (incluidas fechas) y mismas filas en negrita.
- **R9** — El sistema DEBE guardar cada objeto temporal en un bucket privado, bajo una ruta cuyo único
  componente variable es un identificador aleatorio UUID v4, sin ningún dato del usuario, de la cuenta ni
  de los filtros.
- **R10** — El sistema DEBE firmar la URL de un objeto temporal con una caducidad de 300 segundos
  (configurable) y NUNCA DEBE generar una URL pública de un objeto temporal.
- **R11** — SI la acción de descarga devuelve un error (sin sesión, sin permiso, entrada inválida, límite de
  Excel o cualquier otro), ENTONCES el sistema DEBE devolver ese mismo error sin escribir nada en el
  almacenamiento ni firmar ninguna URL.
- **R12** — SI se pide preparar una descarga con un nombre que no está en el inventario, ENTONCES el sistema
  DEBE rechazarla sin ejecutar ninguna lectura ni tocar el almacenamiento.
- **R13** — La preparación de una descarga DEBE ejecutar la acción de descarga registrada con la misma
  entrada que el navegador envía y con la sesión de quien la pide, de modo que se apliquen exactamente los
  permisos y validaciones de hoy.
- **R14** — SI el bucket de los objetos temporales no existe al subir uno, ENTONCES el sistema DEBE crearlo
  como privado y reintentar la subida una sola vez.
- **R15** — SI la subida del objeto temporal o la firma de su URL fallan, ENTONCES el sistema NO DEBE
  producir archivo y el control de descarga DEBE mostrar «No se pudo generar el archivo. Vuelve a
  intentarlo; el listado no cambió.» (o el aviso de error propio de esa pantalla, si ya tiene uno).
- **R16** — SI la lectura del objeto temporal desde el navegador falla (URL caducada, red, contenido
  ilegible), ENTONCES el sistema NO DEBE producir archivo y DEBE mostrar el mismo aviso de R15.

### Limpieza

- **R17** — CUANDO se ejecuta la purga programada de descargas, el sistema DEBE borrar todos los objetos
  temporales creados hace más de 60 minutos (configurable) y conservar los más recientes.
- **R18** — El sistema DEBE ejecutar la purga programada de descargas al menos cada 15 minutos.
- **R19** — SI la purga se invoca sin el secreto de cron correcto, ENTONCES el sistema DEBE responder 401 sin
  leer ni borrar nada del almacenamiento.
- **R20** — CUANDO la purga termina, el sistema DEBE responder solo con conteos (objetos borrados y si queda
  trabajo pendiente), nunca con rutas de objetos.

### Interfaz

- **R21** — MIENTRAS una descarga se está preparando, el control de descarga DEBE mostrar el texto
  «Preparando el archivo…» y NO DEBE iniciar una segunda descarga.
- **R22** — CUANDO la preparación termina con éxito, el sistema DEBE entregar el archivo al navegador con el
  mismo nombre de archivo que hoy (`<título>-AAAA-MM-DD.<extensión>`).

### Alcance

- **R23** — DONDE el conjunto ya está en el navegador (Familia B), el sistema DEBE producir el archivo en el
  navegador con todas las filas, sin consultar el servidor y sin más máximo que el de R2.
- **R24** — Cada pantalla de Familia A del inventario DEBE obtener el conjunto de su descarga mediante la
  preparación de R5/R6; ninguna DEBE llamar directamente a su acción de descarga para producir el archivo.

## Trazabilidad prevista

El mapa definitivo R<n> → test lo escribe el implementador en `progress/impl_470.md`; los tests previstos
están en `tasks.md` (columna «Cubre»).

## Decisiones tomadas sin preguntar (aprobación previa del humano)

Cada una está razonada en `design.md`; se listan aquí para que el reviewer las vea juntas.

1. **El archivo se sigue armando en el navegador; lo que cambia es el transporte del conjunto.** El
   humano propuso armar el xlsx en el servidor. Se descarta por coste y riesgo (design §1, alternativa A1):
   la proyección de filas, la elección de columnas (preferencia guardada en el navegador) y el armado de
   las hojas del kardex viven hoy en el cliente en ~30 tablas; moverlo al servidor es reescribir el
   contrato de todas. Lo que el humano pidió como resultado se cumple igual: pulsar Descargar, ver
   «Preparando el archivo…», el archivo se baja solo, bucket privado, URL firmada de vida corta, limpieza
   automática, y archivo idéntico (aquí por construcción: es el mismo código el que lo arma).
2. **Umbral por tamaño serializado (2 MB), no «siempre por almacenamiento».** Las descargas pequeñas (la
   inmensa mayoría) no cambian de camino ni dependen de Storage; tampoco los tests ni el entorno local.
3. **Familia B solo pierde el tope**: el conjunto ya está en el navegador, no cruza ninguna respuesta de
   Vercel, así que no necesita transporte (design §5).
4. **El tope único se mantiene como concepto y pasa a valer el límite de Excel** (1.048.575), fijo en
   código y no por entorno; también aplica al CSV, por simplicidad y para acotar memoria.
5. **Los textos de aviso existentes no cambian** (siguen interpolando el máximo, que ahora es el de Excel);
   el único texto nuevo de aviso es el de la hoja que excede Excel en el armado (R2).
6. **Limpieza por cron propio cada 15 min con retención de 60 min** (vida máxima de un objeto ≈ 75 min;
   la URL caduca a los 5 min, así que el objeto deja de ser legible mucho antes).
7. **Bucket `descargas`, creado por el propio código en el primer uso** (R14), así existe en producción,
   preview y local sin pasos manuales.

## Preguntas abiertas

Ninguna bloqueante. Una no bloqueante, para cuando el humano vuelva:

- **Q1 (no bloqueante)** — ¿Se quiere en el futuro armar el archivo en el servidor (p. ej. para conjuntos
  de cientos de miles de filas en equipos con poca memoria)? Hoy no hace falta: la tarea de medición
  (T5) deja el número de filas/tiempo/memoria del armado en el navegador para decidirlo con datos.

## Aprobación

Aprobado de antemano por el humano el 2026-10-02 noche («sácalo lo más rápido que podás a producción»). El leader acepta la desviación A1 (el archivo se sigue armando en el navegador; lo que cambia es que los conjuntos grandes viajan por el bucket privado `descargas` con URL firmada): el resultado visible para el usuario es el pedido (pulsa Descargar y se baja, sin tope propio) con menos riesgo de que el archivo cambie. Q1 (armarlo en servidor si la memoria del navegador no alcanza) queda como ficha futura según la medición de T5.
