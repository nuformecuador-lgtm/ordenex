# Feature 288 — Las variables de una plantilla se eligen de un catálogo, no se escriben a mano

> Requisitos en notación EARS. Sin detalles de implementación (eso vive en `design.md`).
> Alcance: `configuracion/plantillas` (crear y editar) + la resolución de variables al
> rellenar una plantilla. Actor único del módulo: `maestro`.
>
> **Revisión humana 2026-08-26** — tres decisiones incorporadas: la lectura legible pasa a ser
> **vista previa con valores de ejemplo** (R10–R12), se añade el **aviso de claves que no se
> reemplazan** (R15–R16) y los **alias se ocultan del selector** (R4–R5).

## Glosario (para que los requisitos no sean ambiguos)

- **Catálogo**: `CAMPOS_PLANTILLA` en `lib/types/plantilla-datos.ts`. Cada entrada tiene
  `clave`, `nombre` (etiqueta legible), `descripcion`, `ejemplo` y `sensible?`.
- **Clave**: el identificador `[a-z0-9_]+` que se escribe entre llaves en el cuerpo:
  `{{monto}}`. Es lo que resuelve el valor y lo que fija la posición del parámetro de Meta.
- **Nombre**: la etiqueta legible de esa clave: «Monto a cobrar».
- **Alias**: entrada del catálogo que apunta al MISMO dato que otra (`num_guia` → `guia`).
- **Cuerpo**: el texto de la plantilla tal como se persiste en `plantilla_mensaje.cuerpo`.
- **Vista previa**: el cuerpo con cada `{{clave}}` ya sustituida por el valor de ejemplo del
  catálogo. Es lo que el cliente final leería.

### Las tres representaciones, que no se mezclan

| | Qué es | Quién la usa |
| --- | --- | --- |
| **(a) La verdad** | `{{cliente}}` | El `<textarea>`, la base y el template aprobado por Meta. |
| **(b) La etiqueta** | «Cliente» | Solo el selector y la línea de resumen de campos usados. |
| **(c) El resultado** | «María Rodríguez» | El panel «Así lo verá el cliente» y el mensaje real. |

El maestro no necesita leer (b) para entender su plantilla: necesita leer (c). (b) explica la
estructura; (c) explica qué le llega al cliente, y el dato ya existe en el catálogo.

---

## A. Selección de variables desde el catálogo

**R1.** El sistema DEBE ofrecer en el formulario de plantillas (crear y editar) las
variables como una lista de opciones tomada del catálogo, mostrando por cada opción su
**nombre** y su **descripción**.

**R2.** El sistema NO DEBE permitir dar de alta una variable escribiendo una clave
arbitraria: el único camino para insertar una variable desde la lista es seleccionar una de
sus opciones.

**R3.** CUANDO el maestro escribe texto en el campo de búsqueda de variables, el sistema
DEBE mostrar únicamente las opciones cuyo nombre, descripción o clave contengan ese texto,
comparando sin distinguir mayúsculas/minúsculas ni acentos.

**R4.** CUANDO el campo de búsqueda está vacío, el sistema DEBE mostrar todas las opciones
del catálogo **que no sean alias**, en el orden en que el catálogo las declara.

**R5.** MIENTRAS un alias no se ofrezca en el selector (R4), el sistema DEBE seguir
tratándolo como una clave plenamente válida: DEBE resolver su valor al rellenar, DEBE
mostrarlo con su nombre en la línea de campos usados y DEBE sustituirlo por su valor en la
vista previa, sin marcarlo como clave inválida.

**R6.** SI el texto del filtro no deja ninguna opción, ENTONCES el sistema DEBE mostrar un
aviso de «sin resultados» y NO DEBE ofrecer ninguna inserción.

**R7.** CUANDO el maestro selecciona una opción de la lista, el sistema DEBE insertar en el
cuerpo, en la posición del cursor (reemplazando la selección si la hay), el texto
`{{clave}}` con la **clave** de esa opción, y DEBE dejar el cursor justo después de lo
insertado.

**R8.** CUANDO el maestro selecciona una opción, el sistema DEBE vaciar el filtro y cerrar
la lista, de modo que la siguiente búsqueda parta de cero.

**R9.** DONDE una opción del catálogo esté marcada como `sensible`, el sistema DEBE
mostrarla con un distintivo visible que la identifique como dato interno o personal, sin
impedir su selección.

---

## B. Lo que el maestro ve mientras edita

**R10.** MIENTRAS el maestro edita el cuerpo, el sistema DEBE mostrar un panel titulado
«Así lo verá el cliente» con el cuerpo **ya resuelto con los valores de ejemplo del
catálogo**, y DEBE actualizarlo tras cada cambio del cuerpo.

**R11.** El sistema DEBE producir esa vista previa con el **mismo camino de resolución que
el envío real** —la misma función que resuelve las variables por clave y la misma que
sustituye los placeholders—, alimentado con datos de ejemplo. El sistema NO DEBE usar un
renderizador propio ni una sustitución paralela para la vista previa.

**R12.** El sistema DEBE definir un juego de datos de ejemplo tal que, para **toda** entrada
del catálogo, el valor que produce la resolución por clave sobre esos datos sea exactamente
el `ejemplo` que esa entrada declara.

**R13.** El sistema DEBE mostrar, bajo la vista previa, una línea de resumen con los campos
que el cuerpo usa —derivada del propio cuerpo: claves bien formadas, sin duplicados, en
orden de aparición— identificados por su **nombre**.

**R14.** SI el maestro borra o escribe una `{{clave}}` directamente en el cuerpo, ENTONCES
la vista previa (R10) y la línea de campos usados (R13) DEBEN reflejar el cuerpo resultante
sin ninguna acción adicional del maestro.

**R15.** DONDE el cuerpo contenga una clave bien formada que no esté en el catálogo, el
sistema DEBE mostrar un aviso visible que la nombre y advierta de que llegará vacía al
cliente, y NO DEBE impedir guardar por ese motivo.

**R16.** SI una clave fuera del catálogo tiene un nombre persistido para esa plantilla,
ENTONCES el aviso de R15 DEBE decir que el campo **ya no existe** e identificarlo por ese
nombre; SI no lo tiene, ENTONCES el aviso DEBE decir que **no es un campo válido** e
identificarlo por su clave.

---

## C. Persistencia

**R17.** CUANDO se crea o se actualiza una plantilla, el sistema DEBE persistir, además del
array de claves del cuerpo, el **nombre legible de cada clave** vigente en el catálogo en
ese momento.

**R18.** El sistema DEBE persistir el cuerpo conteniendo exclusivamente `{{clave}}`: ninguna
representación mostrada al maestro DEBE alterar el texto guardado.

**R19.** El sistema DEBE derivar el array `variables` del cuerpo con la regla vigente
—claves bien formadas, normalizadas, sin duplicados y **en orden de aparición**— y la
persistencia de los nombres NO DEBE alterar ni ese orden ni ese contenido.

**R20.** SI una clave del cuerpo no está en el catálogo, ENTONCES el sistema DEBE
persistirla igualmente en `variables` y NO DEBE inventarle un nombre.

**R21.** MIENTRAS una plantilla no tenga nombres persistidos (filas creadas antes de esta
feature), el sistema DEBE mostrar el nombre derivado del catálogo, y SI la clave tampoco
está en el catálogo, ENTONCES DEBE mostrar la clave.

---

## D. Invariantes que esta feature no puede romper

**R22.** El sistema DEBE seguir traduciendo el cuerpo a la notación numerada de Meta
asignando a cada clave el número correspondiente a su **posición en `variables`**, y el
texto que se envía a Meta NO DEBE cambiar por efecto de esta feature para un mismo cuerpo.

**R23.** El sistema DEBE seguir enviando los parámetros del template en el **mismo orden**
que `variables`, con el valor resuelto por clave.

**R24.** SI el cuerpo contiene una llave doble malformada, ENTONCES el sistema DEBE
rechazar el guardado con un error en el campo `cuerpo` y NO DEBE persistir nada, tanto al
crear como al actualizar. Ningún otro motivo —en particular una clave fuera del catálogo
(R15)— DEBE rechazar un guardado.

**R25.** SI el actor no tiene rol `maestro`, ENTONCES toda operación del módulo de
plantillas DEBE responder `forbidden` antes de tocar la base.

---

## E. Rellenado: el usuario ve el mensaje, no la clave

**R26.** CUANDO se rellena una plantilla con los datos de una orden, el sistema DEBE
resolver cada variable **por su clave** contra esos datos y producir el texto con los
valores ya sustituidos.

**R27.** MIENTRAS el mensajero elige una plantilla (chat y flujo wa.me), el sistema DEBE
mostrarle el mensaje **ya relleno**, sin `{{clave}}` ni nombres del catálogo visibles.

**R28.** El texto que el mensajero ve al elegir la plantilla y el texto que se persiste como
mensaje enviado DEBEN salir de la misma resolución por clave, de modo que coincidan para
los mismos datos.

---

## F. Accesibilidad

**R29.** El sistema DEBE permitir recorrer las opciones filtradas y seleccionar una usando
solo el teclado (bajar, subir, confirmar y cerrar), sin necesidad de puntero.

**R30.** El campo de búsqueda de variables DEBE tener un nombre accesible estable y la lista
DEBE anunciarse como tal, indicando qué opción está activa en cada momento.

---

## Trazabilidad — cada `R<n>` a un test concreto

| Req | Test (archivo) | Qué asegura |
| --- | --- | --- |
| R1 | `tests/unit/plantillas/CampoVariablePicker.test.tsx` | Al abrir, se pintan opciones con nombre Y descripción de `CAMPOS_PLANTILLA`. |
| R2 | `tests/unit/plantillas/CampoVariablePicker.test.tsx` | Escribir `sucursal` + Enter no llama a `onSeleccionar` ni crea opción. |
| R3 | `tests/unit/plantillas/CampoVariablePicker.test.tsx` | «monto» deja `Monto a cobrar`/`Monto sin formato`; «GUIA» y «guía» dan el mismo conjunto. |
| R4 | `tests/unit/plantillas/CampoVariablePicker.test.tsx` | Filtro vacío ⇒ tantas opciones como `CAMPOS_PLANTILLA.filter(c => c.aliasDe === undefined).length`, en el orden del catálogo, y ninguna opción con clave `num_guia`/`nombre`/`destinatario`/`num_remision`/`total`. |
| R5 | `tests/unit/plantillas/VariablesInsert.test.tsx` | Cuerpo `{{num_guia}}`: la vista previa muestra `10432`, el resumen dice «Número de guía» y NO aparece el aviso de clave inválida. |
| R6 | `tests/unit/plantillas/CampoVariablePicker.test.tsx` | «zzz» ⇒ cero `role="option"` + aviso de vacío. |
| R7 | `tests/unit/plantillas/CampoVariablePicker.test.tsx` | Seleccionar «Monto a cobrar» ⇒ `onSeleccionar("monto")`; en `VariablesInsert.test.tsx`, con el cursor en la posición N, el cuerpo queda con `{{monto}}` ahí y el caret detrás. |
| R8 | `tests/unit/plantillas/CampoVariablePicker.test.tsx` | Tras seleccionar, el input de filtro queda vacío y `aria-expanded="false"`. |
| R9 | `tests/unit/plantillas/CampoVariablePicker.test.tsx` | La opción de `notas` trae el distintivo de sensible; la de `cliente` no. |
| R10 | `tests/unit/plantillas/VariablesInsert.test.tsx` | Cuerpo `Hola {{cliente}}, total {{monto}}` ⇒ el panel «Así lo verá el cliente» dice `Hola María Rodríguez, total ₡12.500`, y el `<textarea>` sigue diciendo `{{cliente}}`. |
| R11 | `tests/unit/plantillas/preview-mismo-motor.test.ts` | `previewConEjemplos(cuerpo)` es **idéntico** a `renderPlantilla(cuerpo, resolverValoresPlantilla(extraerVariables(cuerpo), DATOS_PLANTILLA_EJEMPLO))` para un juego de cuerpos, con espías que verifican que la preview PASA por esas dos funciones. |
| R12 | `tests/unit/types/plantilla-datos.test.ts` | Para **cada** entrada de `CAMPOS_PLANTILLA`: `valorDeCampo(campo.clave, DATOS_PLANTILLA_EJEMPLO) === campo.ejemplo`. |
| R13 | `tests/unit/plantillas/VariablesInsert.test.tsx` | Cuerpo `{{monto}} y {{cliente}} y {{monto}}` ⇒ el resumen lista 2 campos, en ese orden: «Monto a cobrar», «Cliente». |
| R14 | `tests/unit/plantillas/VariablesInsert.test.tsx` | Editar el textarea a mano borrando `{{monto}}` actualiza panel y resumen sin más interacción. |
| R15 | `tests/unit/plantillas/VariablesInsert.test.tsx` | Cuerpo `Hola {{sucursal}}` ⇒ aviso «{{sucursal}} no es un campo válido y llegará vacío al cliente», el guardado sigue habilitado y la vista previa muestra el hueco. |
| R16 | `tests/unit/plantillas/VariablesInsert.test.tsx` | Mismo cuerpo con `variablesNombres={{sucursal:"Sucursal"}}` ⇒ el aviso dice «ya no existe» y nombra «Sucursal»; sin él, dice «no es un campo válido» y nombra `sucursal`. |
| R17 | `tests/unit/services/plantilla-nombres-variables.test.ts` | `crear` y `actualizar` llaman al repo con el mapa `clave -> nombre` del catálogo. |
| R18 | `tests/unit/services/plantilla-nombres-variables.test.ts` | El `cuerpo` que llega al repo es exactamente el enviado (con `{{clave}}`), no la vista previa. |
| R19 | `tests/unit/plantillas/plantilla-mensaje-utils.test.ts` | `nombresDeVariables` no reordena ni deduplica `variables`; `extraerVariables` conserva su contrato. |
| R20 | `tests/unit/services/plantilla-nombres-variables.test.ts` | Clave `sucursal`: entra en `variables` y NO aparece en el mapa de nombres. |
| R21 | `tests/unit/plantillas/plantilla-mensaje-utils.test.ts` | `etiquetaDeVariable` con mapa vacío cae al catálogo, y sin catálogo cae a la clave. |
| R22 | `tests/unit/plantillas/whatsapp-template-numerado.test.ts` | `cuerpoANumerado("Hola {{cliente}}, {{monto}}, {{cliente}}", ["cliente","monto"])` ⇒ `"Hola {{1}}, {{2}}, {{1}}"`. |
| R23 | `tests/unit/plantillas/whatsapp-template-numerado.test.ts` | `construirComponentsEnvio` emite los parámetros en el orden de `variables` con el valor por clave. |
| R24 | `tests/integration/plantillas/plantillas.int.test.ts` | Cuerpo con `{{a b}}` ⇒ `validation_error` y sin escritura; cuerpo con `{{sucursal}}` ⇒ **se guarda** (`status: "ok"`). |
| R25 | `tests/integration/plantillas/plantillas.int.test.ts` | Actor `tienda` ⇒ `forbidden` en crear y actualizar, sin escritura. |
| R26 | `tests/unit/utils/whatsapp-envio-valores.test.ts` | `resolverValoresPlantilla` resuelve por clave y `renderPlantilla` sustituye todas las ocurrencias. |
| R27 | `tests/unit/components/chat-plantilla-relleno.test.tsx` | El selector de plantillas del chat muestra el cuerpo resuelto: no queda ningún `{{` ni clave cruda. |
| R28 | `tests/unit/services/chat-whatsapp-service.test.ts` | El texto persistido del saliente es idéntico al renderizado por el mismo cuerpo+valores. |
| R29 | `tests/unit/plantillas/CampoVariablePicker.test.tsx` | ArrowDown/ArrowUp mueven `aria-activedescendant`, Enter inserta la activa, Escape cierra. |
| R30 | `tests/unit/plantillas/CampoVariablePicker.test.tsx` | `getByRole("combobox", { name: /campo/i })` lo encuentra; la lista es `role="listbox"` y anuncia la opción activa. |
| Migración | `tests/integration/db/plantilla-variables-nombres-migration.test.ts` | La UP añade solo la columna nueva; la `down.sql` la quita y nada más. |
| Alias | `tests/unit/types/plantilla-datos.test.ts` | Las 5 entradas alias declaran `aliasDe` con la clave base, su `nombre` NO contiene «alias de», y comparten `campo`/`ejemplo` con su base. |

---

## Preguntas abiertas

1. **Campos que pueden resolver a vacío.** Una clave del catálogo perfectamente válida puede
   dar cadena vacía (`{{guia}}` en una orden sin guía, `{{mapa}}` sin geocodificar) y Meta
   rechaza parámetros vacíos en algunos casos. **Respuesta del humano (2026-08-26): fuera de
   alcance por ahora.** Queda anotado, sin requisito. Nótese que la vista previa de R10 no lo
   destapa: los datos de ejemplo son completos por construcción (R12), así que ahí todo se ve
   lleno. Si algún día se aborda, el sitio natural es un segundo juego de datos de ejemplo
   «orden incompleta» y un aviso en el selector.

*(Las preguntas 1 y 2 de la versión anterior —alias en el selector y alcance de la lectura
legible— fueron respondidas por el humano el 2026-08-26 y están incorporadas como R4/R5 y
R10/R11 respectivamente.)*
