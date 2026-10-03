# 465 — Tarifas: Excel de cobertura por distrito

> Ficha 465 (`feature_list.json`): «Descargar desde tarifas un Excel por distrito que diga si hay
> cobertura, con qué zona y dónde no llegamos». Pedida y aprobada por el humano el 2026-10-01.
>
> Regla de negocio heredada (decisión del humano en la ficha 378): **si un distrito no tiene zona
> asignada es porque no tenemos cobertura**. La regla operativa que ya aplica el sistema al cargar
> órdenes (`resolveGeo`) es la vara de medir: un distrito «tiene cobertura» exactamente cuando una
> orden dirigida a él se aceptaría por geografía.

## Glosario

- **Distrito disponible**: el distrito, su cantón y su provincia están los tres activos
  (disponibilidad efectiva; un distrito activo bajo un cantón retirado NO está disponible).
- **Zonas del distrito**: las zonas a las que el distrito está asignado en la relación zona↔distrito.
- **Zona única**: el distrito tiene exactamente una zona. Con cero o con más de una, no tiene zona
  única (la carga de órdenes lo rechaza en ambos casos).
- **Tarifa general de la zona**: una tarifa asignada a la zona y a ninguna tienda (el tercer nivel
  de la cascada de tarifas). La tarifa sin zona y sin tienda NO es una tarifa general de ninguna zona.
- **Maestro**: el único rol con acceso a la página Tarifas.

## Requisitos

### Acceso y control

- **R1** — MIENTRAS el usuario autenticado tenga rol maestro, la página Tarifas DEBE mostrar un
  control de descarga con el texto «Descargar cobertura» y, junto a él, una línea que explique en
  lenguaje claro qué contiene el archivo (cada distrito y si llegamos a él).
- **R2** — SI quien solicita los datos de cobertura no tiene rol maestro, ENTONCES el sistema DEBE
  responder «prohibido» sin leer el catálogo geográfico ni las tarifas.
- **R3** — SI quien solicita los datos de cobertura no tiene sesión válida, ENTONCES el sistema
  DEBE responder «sesión no válida» sin leer datos, y el control DEBE mostrar un mensaje que pida
  volver a iniciar sesión, sin producir archivo.

### Contenido del archivo

- **R4** — CUANDO el maestro pulse «Descargar cobertura», el sistema DEBE leer los datos en ese
  momento (no reutilizar los que la pantalla cargó antes) y producir un archivo Excel (.xlsx) con
  **una fila por cada distrito del catálogo, disponible o no**.
- **R5** — El archivo DEBE tener, en este orden por defecto, las columnas: Provincia, Cantón,
  Distrito, Activo, Cobertura, Motivo sin cobertura, Zona, GAM, Zona especial, Tarifa general de
  la zona.
- **R6** — El sistema DEBE ordenar las filas por nombre de provincia, después de cantón y después
  de distrito, alfabéticamente en español sin distinguir mayúsculas ni tildes.
- **R7** — La columna Activo DEBE valer «Sí» cuando el distrito está disponible y «No» en otro caso.
- **R8** — La columna Cobertura DEBE valer «Sí» si y solo si el distrito está disponible Y tiene
  zona única; en cualquier otro caso DEBE valer «No».
- **R9** — SI la Cobertura de un distrito es «No», ENTONCES la columna Motivo sin cobertura DEBE
  decir la PRIMERA causa que aplique, en este orden de precedencia:
  1. «Provincia retirada del catálogo»
  2. «Cantón retirado del catálogo»
  3. «Distrito retirado del catálogo»
  4. «Sin zona asignada»
  5. «Asignado a varias zonas»
- **R10** — SI la Cobertura de un distrito es «Sí», ENTONCES la columna Motivo sin cobertura DEBE
  quedar vacía.
- **R11** — La columna Zona DEBE contener el nombre de la zona cuando el distrito tiene zona única;
  «Sin zona» cuando no tiene ninguna; y «Varias zonas: » seguido de los nombres de esas zonas en
  orden alfabético, separados por coma, cuando tiene más de una. Esto aplica también a distritos no
  disponibles.
- **R12** — La columna GAM DEBE valer «Sí» cuando el distrito tiene zona única y esa zona es la zona
  central; «No» cuando tiene zona única y no es la central; y quedar vacía cuando no tiene zona única.
- **R13** — La columna Zona especial DEBE valer «Sí» cuando el distrito está marcado como zona
  especial, «No» cuando está marcado como no especial, y «Sin definir» cuando nadie lo ha decidido.
- **R14** — La columna Tarifa general de la zona DEBE valer «Sí» cuando el distrito tiene zona única
  y existe una tarifa general de esa zona; «No» cuando tiene zona única y no existe; y quedar vacía
  cuando no tiene zona única. La tarifa sin zona y sin tienda NO DEBE contar como tarifa general.
- **R15** — Para todo distrito, la columna Cobertura DEBE valer «Sí» exactamente cuando la
  resolución geográfica de la carga de órdenes, con la provincia, cantón y distrito de esa fila,
  acepta la dirección; y «No» exactamente cuando la rechaza.

### Comportamiento del control

- **R16** — El control DEBE ofrecer el selector de columnas de la descarga y DEBE emitir solo las
  columnas marcadas, en el orden que el usuario haya fijado, recordando esa elección para la
  siguiente descarga en el mismo navegador.
- **R17** — El nombre del archivo DEBE ser `cobertura-por-distrito-AAAA-MM-DD.xlsx`, con la fecha
  del día calendario de Costa Rica en que se descarga.
- **R18** — SI la lectura de los datos falla, ENTONCES el control DEBE mostrar un mensaje que diga
  qué hacer (volver a intentarlo) y NO DEBE producir archivo.
- **R19** — SI el catálogo no tiene ningún distrito, ENTONCES el control NO DEBE producir archivo y
  DEBE avisar que no hay datos que descargar.
- **R20** — MIENTRAS una descarga esté en curso, el control DEBE impedir una segunda descarga
  simultánea.
- **R21** — La descarga NO DEBE crear, modificar ni borrar ningún dato.

## Fuera de alcance

- Columnas por tienda (si una tienda concreta tiene tarifa propia en cada zona).
- Editar zonas, distritos o tarifas desde el archivo, o subirlo de vuelta.
- Formato CSV (el pedido es Excel).

## Preguntas abiertas

1. **¿«Sin tarifa general» debe contar como «sin cobertura»?** Hoy, por la decisión de la 378,
   cobertura = disponible + zona única, y la tarifa general va en una columna informativa (R14).
   Un distrito con zona pero sin tarifa general acepta la orden por geografía, pero una tienda sin
   tarifa propia en esa zona no tendría con qué cobrarse. Si el humano quiere que eso cuente como
   «no llegamos», R8/R9/R15 cambian (y R15 dejaría de equivaler a la regla de la carga).
2. **Distritos no disponibles**: el spec los INCLUYE (Activo = «No», Cobertura = «No», con su
   motivo), porque «dónde no llegamos» incluye lo retirado y excluirlos haría que un distrito
   retirado no se distinga de uno que no existe en el catálogo. ¿Se prefieren fuera?
3. **¿Añadir la columna «Código DTA»** (código oficial IGN del distrito, ya existe en el modelo y
   puede estar vacío)? Facilita cruzar el archivo con otras fuentes; no estaba en el alcance pedido.
4. **¿Hoja de resumen** (totales: distritos con cobertura / sin cobertura por motivo)? El control
   reutilizado produce una sola hoja; un resumen exigiría ampliar el generador común o un control
   propio, y se dejó fuera.
