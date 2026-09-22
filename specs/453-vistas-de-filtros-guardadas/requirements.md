# Ficha 453 — Requisitos

**Guardar una combinación de filtros con nombre y volver a aplicarla de un clic.**

## De qué va, en una línea

Filtrar cuesta cada vez. Esta ficha deja que **cada persona** guarde sus propias combinaciones —«San
José arriba», «San José abajo»— y las vuelva a aplicar, con la garantía de que **una vista que ya no
se puede aplicar entera lo dice antes de cambiar nada**.

## Por qué no hay atajo automático (medido en producción el 2026-09-21)

El GAM tiene **141 distritos, 28 cantones y 4 provincias** —más de la mitad del sistema; las otras 7
zonas suman 117—. El volumen está repartido largo: en 90 días, Alajuela 326, San José 311,
Desamparados 129, Heredia 109, Cartago 104, Goicoechea 92, La Unión 76, Escazú 68, Tibás 68, Santa
Ana 67. **Ningún atajo por volumen sirve.** Y lo decisivo: «San José arriba» **no es una división
administrativa** —ni provincia, ni cantón, ni distrito—, es geografía operativa. No se deriva de los
datos: **la guarda una persona**.

## Decisiones ya firmadas por el humano (2026-09-21) — no se reabren

1. **Vistas personales.** Descartadas explícitamente: vistas de oficina definidas por un admin,
   «sectores» como entidad nueva del modelo, y atajos calculados.
2. **Genérico desde el primer día**: una vista es **superficie + filtro + nombre + dueño**, y el
   mecanismo vive en la **barra compartida** (`components/shared/BuscadorFiltros.tsx`), no en
   `/ordenes`. Textual: «así no tenemos que crecer esto más a futuro».
3. **Se habilita superficie por superficie**, empezando por `/ordenes`. Sumar la siguiente debe ser
   **encenderla**, no rehacer nada.
4. Se guarda el **filtro completo** tal cual está en pantalla, no solo la parte geográfica.
5. **Aplicar reemplaza** el filtro vigente; no se acumula.
6. **Tope por usuario**, nombre obligatorio, y **renombrar y borrar** desde el primer día.
7. **Riesgo aceptado, no se replantea**: cada quien tendrá su propia idea de «San José arriba» y
   quien entra nuevo empieza de cero. Pero el **modelo de datos debe permitir** que algún día un
   admin *publique* una de sus vistas para todos, sin rehacerse (extensión prevista, **no** se
   implementa aquí).

## Vocabulario

- **Vista**: una combinación de filtros guardada con nombre. Tiene dueño y superficie.
- **Superficie**: el juego de filtros de una pantalla. No es la ruta: `/cierres-admin` monta la
  misma barra con **tres** juegos distintos de filtros declarados (ver `design.md §10`).
- **Filtro de la barra**: las tres piezas que la barra tiene puestas —el **término** de búsqueda, los
  **controles montados** y la **selección** de cada control—. Es lo que se guarda (R5).
- **Aplicable entera**: la vista se puede reponer sin perder ninguna parte (R24).
- **Parte perdida**: un filtro que la pantalla ya no declara, o un valor guardado que ya no existe
  entre las opciones ofrecidas de su filtro (tienda desactivada, mensajero de baja, estado retirado
  del catálogo).

---

## Bloque A — Qué es una vista y dónde vive

**R1** (Ubicuo). El sistema DEBE permitir guardar combinaciones de filtros («vistas») compuestas
exactamente por **superficie, nombre, dueño y filtro**.

**R2** (Ubicuo). Una vista DEBE pertenecer a **una** persona y a **una** superficie, y el sistema NO
DEBE mostrar, aplicar, renombrar ni borrar a una persona ninguna vista que no sea suya.

**R3** (Ubicuo). El sistema DEBE resolver al dueño de una vista **a partir de la sesión** y NO DEBE
aceptarlo como parte de la entrada; una entrada que traiga un identificador de persona DEBE
rechazarse como entrada inválida, no ignorarse.

**R4** (Evento). CUANDO se elimine una persona, sus vistas DEBEN eliminarse con ella.

**R5** (Ubicuo). El filtro guardado DEBE incluir **las tres piezas** de la barra —término, controles
montados y selección de cada control— y no solo una parte.

**R6** (Ubicuo). El filtro DEBE guardarse en una representación **propia**, distinta de la clave de
caché del listado; un cambio en esa clave de caché NO DEBE cambiar lo guardado ni cómo se lee, y un
cambio en el formato guardado NO DEBE cambiar la clave de caché.

**R7** (Ubicuo). Toda vista guardada DEBE llevar la **versión** del formato de su filtro.

**R8** (Condicional). SI el filtro de una vista no se puede leer con las reglas de la versión que
declara, ENTONCES el sistema DEBE marcarla **ilegible**, NO DEBE aplicarla ni entera ni en parte, y
DEBE seguir permitiendo **renombrarla y borrarla**.

---

## Bloque B — Guardar, renombrar, actualizar y borrar

**R9** (Evento). CUANDO la persona guarde una vista, el sistema DEBE exigir un **nombre no vacío**
—una vez recortados los extremos— y DEBE rechazar el guardado sin él, diciéndolo.

**R10** (Condicional). SI el nombre supera el máximo declarado, ENTONCES el sistema DEBE rechazar el
guardado y DEBE decir cuál es el máximo.

**R11** (Condicional). SI esa persona ya tiene una vista con **el mismo nombre en la misma
superficie**, ENTONCES el sistema DEBE rechazar el guardado nombrando el conflicto y NO DEBE
sobrescribir la existente.

**R12** (Condicional). SI la barra no tiene **nada** puesto —ni término, ni controles montados, ni
valores seleccionados—, ENTONCES el sistema DEBE rechazar el guardado y decir que no hay nada que
guardar.

**R13** (De estado). MIENTRAS una persona tenga el **máximo** de vistas permitido en una superficie,
el sistema DEBE rechazar guardar una más y DEBE decir cuál es el tope y cuántas tiene.

**R14** (Ubicuo). El sistema DEBE ofrecer **renombrar** y **borrar** cada vista, con las mismas
reglas de nombre de R9–R11.

**R15** (Evento). CUANDO la persona pida **actualizar** una vista con el filtro que tiene en
pantalla, el sistema DEBE reemplazar el filtro guardado de esa vista, conservar su nombre, y aplicar
las mismas reglas de R12.

**R16** (Ubicuo). Aplicar una vista NO DEBE modificar **nada** de lo guardado: solo guardar,
actualizar, renombrar y borrar escriben.

**R17** (Evento). CUANDO la persona pida borrar una vista, el sistema DEBE pedir una confirmación que
**nombre esa vista**, y solo DEBE borrar tras ella.

---

## Bloque C — Aplicar

**R18** (Evento). CUANDO la persona aplique una vista **aplicable entera**, el sistema DEBE dejar la
barra exactamente en el estado guardado: el mismo término, los mismos controles montados y la misma
selección en cada uno.

**R19** (Ubicuo). Aplicar una vista DEBE **reemplazar** el filtro vigente: ninguna parte del filtro
anterior que la vista no traiga DEBE sobrevivir.

**R20** (Evento). CUANDO se aplique una vista, el listado DEBE quedar acotado por ese filtro y DEBE
volver a la **primera página**.

**R21** (Evento). CUANDO se aplique una vista, el sistema DEBE **retirar de la dirección** los
parámetros de filtro propios de la barra y NO DEBE añadir ninguno, de modo que recargar la página no
reponga el filtro que la vista acaba de reemplazar.

**R22** (De estado). MIENTRAS haya una vista aplicada, SI la persona cambia cualquier parte del
filtro, ENTONCES el sistema DEBE dejar de presentar esa vista como la que está puesta.

**R23** (Ubicuo). Aplicar una vista DEBE **cerrar** la siembra desde la dirección: un catálogo que
llegue después NO DEBE reponer sobre la vista aplicada ningún valor que viniera en la query.

---

## Bloque D — La vista que ya no se puede aplicar entera

> Esta es la regla que en este repo vale doble. Aplicar lo que se puede y callar el resto deja a la
> persona filtrando otra cosa sin saberlo.

**R24** (Ubicuo). Una vista es **aplicable entera** exactamente cuando: la pantalla sigue declarando
**todos** los filtros que la vista trae, **cada** valor guardado sigue existiendo entre las opciones
ofrecidas de su filtro, y su formato es legible (R8).

**R25** (Condicional). SI al aplicar una vista alguna parte no es aplicable, ENTONCES el sistema **NO
DEBE aplicar ninguna parte** y DEBE mostrar un aviso que **enumere cada parte perdida** con su
nombre visible —nunca un identificador crudo— y su motivo.

**R26** (Ubicuo). Ese aviso DEBE ofrecer **exactamente dos** salidas: aplicar el resto **sin** las
partes perdidas, o cancelar **sin tocar** el filtro vigente.

**R27** (Evento). CUANDO la persona elija aplicar el resto, el sistema DEBE aplicar **exclusivamente**
las partes aplicables, DEBE cumplir R19–R21 con ese filtro recortado, y NO DEBE modificar la vista
guardada.

**R28** (De estado). MIENTRAS una vista no sea aplicable entera, DEBE aparecer **marcada como
incompleta** en la lista de vistas, con su motivo alcanzable, y la marca DEBE desaparecer solo cuando
la vista se actualice (R15) o se borre.

**R29** (Condicional). SI las opciones de la superficie **no están disponibles** —el catálogo no se
pudo resolver—, ENTONCES el sistema NO DEBE clasificar ninguna vista como incompleta, NO DEBE aplicar
ninguna, y DEBE decir que no puede comprobarlas ahora.

**R30** (Ubicuo). El sistema NO DEBE, bajo ninguna circunstancia, aplicar **parte** de una vista sin
que la pérdida se haya nombrado antes de que el listado cambie.

---

## Bloque E — Genérico desde el primer día

**R31** (Ubicuo). El mecanismo DEBE vivir en la **barra compartida** y ofrecerse por **declaración**
de la superficie; una superficie que no lo declare NO DEBE cambiar en nada —ni un control nuevo, ni
una petición nueva, ni una emisión nueva—.

**R32** (Ubicuo). Habilitar una superficie nueva NO DEBE requerir migración de base de datos ni
cambio alguno en el modelo de datos.

**R33** (Ubicuo). SI se pide operar sobre una superficie **no declarada**, ENTONCES el sistema DEBE
responder con un error explícito y NO DEBE responder con una lista vacía.

**R34** (Ubicuo). Toda superficie declarada DEBE tener su control **montado** en pantalla; una
superficie declarada que nadie monta DEBE poner el árbol en rojo.

**R35** (Ubicuo). Dos personas distintas DEBEN poder tener vistas con **el mismo nombre** en la misma
superficie sin que una impida a la otra guardarla. *(Es la propiedad que mantiene posible la
extensión firmada en la decisión 7: publicar una vista sin rehacer el grano ni las claves.)*

---

## Bloque F — Dónde se ve

**R36** (Ubicuo). El control de vistas DEBE ocupar un **sitio fijo** en la barra, que no cambie según
qué filtros haya puestos ni según si hay algo que limpiar.

**R37** (Ubicuo). Aplicar, guardar, renombrar, actualizar y borrar DEBEN alcanzarse **sin salir del
listado**.

**R38** (De estado). MIENTRAS la persona no tenga ninguna vista guardada en esa superficie, el
control DEBE ofrecer **guardar** y NO DEBE presentar la ausencia de vistas como un error.

**R39** (Ubicuo). Los textos visibles NO DEBEN usar jerga técnica —«selección», «payload», «clave»,
«superficie»— para nombrar lo que la persona ve.

---

## Fuera de alcance (dicho para que no se descubra como sorpresa)

- **No se migra ninguna pantalla** a la barra canónica: eso es la ficha 326. Esta ficha solo enciende
  `/ordenes` (decisión 3).
- **No se implementa publicar** una vista para la oficina (decisión 7): solo se deja el modelo
  preparado, y `design.md §11` dice exactamente qué haría falta.
- **No se arregla el contador «Filtros (N)»**, que cuenta controles *pedidos* y no valores aplicados
  (medido en `design-filtros/Censo.dc.html`). Es deuda vecina y no la toca esta ficha.
- **No se implementa el modo «Aplicar» (submit) de `FilterComponent`** que piden las cuatro barras de
  wallet: es el hueco 2 de la ficha 328 y es otra necesidad (ver `design.md §2.1`).

---

## Decisiones cerradas (P1–P5) — confirmadas el 2026-09-21

> Estas cinco nacieron como preguntas abiertas y **las cinco están decididas e implementadas**. Se
> dejan escritas con su respuesta y su motivo, y no con su signo de interrogación: una pregunta que
> sigue redactada como pregunta después de estar implementada hace dudar de si el código la respetó
> o la resolvió por su cuenta.

**P1 — ¿El ORDEN del listado entra en la vista? → NO. Confirmado por el humano el 2026-09-21.**
El orden no esconde filas —las mismas órdenes, en otra secuencia—, y por eso
`OrdenesListado.limpiarFiltros` ya lo excluye hoy de «Limpiar todo», con su motivo escrito. La
decisión 4 («el filtro completo tal cual está en pantalla») se refiere a los filtros, no a los dos
conmutadores de orden que viven en esa misma barra. Implementado: el payload es `.strict()`, así que
un `sortBy` colado **no parsea** (`tests/unit/utils/vista-filtro-payload.test.ts` lo afirma), y
aplicar una vista **no reordena** la tabla (caso propio en
`tests/unit/components/ordenes-listado-vistas.test.tsx`). El campo `v` (R7) deja añadirlo más
adelante sin romper nada de lo guardado.

**P2 — El tope por usuario. → 20 por superficie. Confirmado el 2026-09-21.**
Elegido por la forma del control: una lista de más de ~20 nombres deja de poder recorrerse de un
vistazo y pide su propio buscador, que es un control nuevo que esta ficha no quiere. Vive en
`MAX_VISTAS_POR_SUPERFICIE` (`lib/types/vista-filtro.ts`), lo impone el **servicio** —no la base— y
el rechazo dice **cuál es el tope y cuántas hay** (R13).

**P3 — Nombres que solo se diferencian en mayúsculas. → CONVIVEN. Límite aceptado el 2026-09-21.**
«San José arriba» y «san josé arriba» son dos vistas distintas: el único es exacto. Hacerlo
insensible a mayúsculas exigiría un índice funcional que Prisma no expresa en el datamodel y que
dejaría deriva permanente contra `prisma migrate diff`. Queda medido contra Postgres, no supuesto:
hay un caso que inserta las dos y comprueba que la base admite ambas
(`tests/integration/db/vista-filtro-migration.test.ts`, «P3 (limite asumido)»). El día que se quiera
cambiar, ese es el caso que hay que dar la vuelta.

**P4 — Granularidad de «superficie» en `/cierres-admin`. → LA SUPERFICIE ES EL JUEGO DE FILTROS, no
la ruta. Confirmado el 2026-09-21.**
Tres módulos montan la MISMA barra con tres juegos distintos de filtros declarados (`sinMensajero`,
`conEstado`): si la superficie fuera la ruta, una vista guardada en Bodega saldría «incompleta» en
Mensajero cada vez. **No afecta a esta entrega** —solo se enciende `/ordenes`—, y el día que se
encienda cierres serán **tres** superficies, no una; encenderlas es añadir tres cadenas a
`SUPERFICIES_VISTA` y montar el control, sin migración (R32).

**P5 — Tras «Aplicar el resto», ¿ofrecer arreglar la vista? → NO en v1. Aceptado el 2026-09-21.**
Aplicar nunca escribe (R16), y una vista incompleta se arregla con «Actualizar» cuando la persona
quiera. Ofrecer «quitar lo que ya no existe» en el mismo aviso convertiría una aplicación en una
escritura, y con ello un catálogo caído (R29) podría destruir vistas buenas. El aviso ofrece
**exactamente dos** salidas (R26), y hay un caso que afirma que «Aplicar sin eso» **no llama a
ninguna acción de escritura**.
