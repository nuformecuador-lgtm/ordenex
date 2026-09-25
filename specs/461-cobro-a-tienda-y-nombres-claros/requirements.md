# Ficha 461 — Ordenex le cobra a una tienda: es ganancia, y cada movimiento dice quién le paga a quién

**Zona:** fullstack. **SDD:** sí. **Complejidad:** alta. **Depende de:** 459 (hecha en `dev`, sin
desplegar). **Sale con:** la release completa (SF-001, 454–456, 459, 460): el humano pidió un
despliegue completo y sin que falte nada. **Toca a:** la 457 (le reserva un nombre y cambia sus textos
previstos) y la 458 (sus etiquetas y su glosario), ver `design.md` §15.

## El encargo (2026-09-25)

Reportado por el humano y reproducido en preview: «Cobrar un costo a una tienda» (`cobro_manual`) escribe
**un solo** débito en el libro de la tienda. Cuando Ordenex le cobra algo a una tienda y se lo descuenta de
su saldo, ese dinero pasa a ser de Ordenex; pero hoy la ganancia no sube, «De las tiendas» no baja y en la
caja no aparece ninguna línea. Un cobro de 42.000 en preview bajó el saldo de la tienda y no dejó rastro en
la caja. La P3 de la 459 lo dejó así (HF6) por error de diseño, y para que cuadrara declaró una excepción
en la invariante R8 («De las tiendas» = Σ saldos **+ cobros sin reclasificar**).

## Decisiones firmadas por el humano (no se reabren)

- **HD1** — «Ordenex le cobra a una tienda» se trata **igual que los fletes** en la 459: un débito en el
  libro de la tienda **más una línea en la caja** de naturaleza propia y liquidez «cargo». No es dinero
  que entra: se toma del que Ordenex ya le guardaba a la tienda. **Suma a la ganancia, resta de «De las
  tiendas» y no cuenta en «Entró».** Anulación uniforme: motivo obligatorio y contra-asientos en los dos
  libros, nada se borra.
- **HD2** — Desaparece la excepción de R8 de la 459: la invariante queda **«De las tiendas» = Σ saldos
  de las tiendas, sin excepciones**. Los `cobro_manual` que no se reclasificaron (en producción no queda
  ninguno tras la 459; en local y preview sí hay) reciben su línea de caja en su fecha original por una
  migración de datos idempotente y con reversión, y su impacto se mide antes de desplegar.
- **HD3** — Los nombres se dicen **siempre desde Ordenex** y **diciendo quién le paga a quién**, en el
  diálogo, en el libro de la caja, en el libro de la tienda, en `/mi-wallet` y en las descargas. Los
  aprobados: «Ordenex le cobra a una tienda» · «Ordenex paga un gasto de una tienda» (antes «Pago por
  cuenta de una tienda») · «Ordenex le paga a una tienda» (el pago de liquidación) · «Una tienda le paga
  a Ordenex» (lo construye la 457; aquí solo se reserva el nombre) · «Sueldo» · «Gasto de Ordenex» (antes
  «Gasto variable») · «Aporte de dinero a la caja» (antes «Saldo inicial o aporte») · «Corrección de caja
  (suma)» y «Corrección de caja (resta)» (antes «Ajuste que suma/resta dinero»). Cada concepto lleva en
  el diálogo una frase de efecto de **una** línea. Desde la tienda, cada línea se lee desde su lado.
- **HD4** — La ayuda (`docs/ayuda`) y el contexto del asistente se actualizan **dentro de esta ficha**.
- **HD5** — Es dinero: fase 0 de caracterización con mutaciones; R7/R8 al céntimo con test y guardia;
  contraste en producción (SQL de solo lectura, lo corre el leader); migraciones a mano (P3006; el
  `down` de enums lee `pg_enum`); tabla R→test; recorrido por rol.
- Heredadas de la 381 y la 459: el cobro **no tiene tope ni comprobación de disponible** y el saldo de la
  tienda puede quedar negativo (D2/R27 de la 381, HF3 de la 459); ningún identificador interno se
  muestra, se pide ni se descarga (H6); anular = motivo obligatorio + contra-asiento visible (H5).

## Glosario

- **Cobro a una tienda:** el movimiento manual con el que Ordenex le cobra algo a una tienda. Hoy es
  `cobro_manual` en el libro de la tienda; desde esta ficha lleva además su **línea de caja**.
- **Línea de caja del cobro:** el ingreso propio de liquidez «cargo» que la caja registra por cada cobro,
  vinculado al débito de la tienda. No es efectivo: la ganancia sube, «De las tiendas» baja lo mismo.
- **Cargo a una tienda:** lo que la 459 llamó así (flete, flete por rechazo, comisión de contra-entrega y
  sus impuestos) **más el cobro a una tienda**. Un cargo no es una entrada de efectivo.
- **Reverso de un cargo:** el egreso propio de liquidez «cargo» que anula un cargo. Tampoco es efectivo:
  la ganancia baja, «De las tiendas» sube lo mismo, «Salió» no cambia.
- **Cobro completado:** un cobro registrado antes de esta ficha, sin línea de caja, al que la migración de
  datos le añade la suya en su fecha original.
- **Cobro reclasificado:** un cobro de la lista aprobada de la 459, que ya tiene su salida como pago de un
  gasto de la tienda. **No** recibe línea de cobro ni se anula por esta vía.
- **Nombre desde Ordenex:** el rótulo de un concepto tal como lo lee la oficina (`/wallet`,
  `/wallet/tiendas`, el diálogo, la caja, las descargas de la oficina).
- **Lectura desde la tienda:** el rótulo del mismo concepto tal como lo lee la tienda en `/mi-wallet` y en
  su descarga, en segunda persona («Ordenex te cobró…»).
- **Nombre retirado:** un rótulo que esta ficha sustituye y que no debe volver a aparecer como nombre de
  un concepto, origen, grupo o acción (lista en `design.md` §7.9).
- **Nombre reservado:** «Una tienda le paga a Ordenex» y sus formas («La tienda le paga a Ordenex», «Le
  pagaste a Ordenex»), que la 457 usará y que ningún concepto de hoy puede tomar.
- **Vigente:** registrado y no anulado. **Acceso total:** maestro y admin.
- **R7 / R8:** las dos invariantes de la 459: cifra principal = ganancia + «De las tiendas» + capital; y
  «De las tiendas» = Σ saldos de las tiendas (desde esta ficha, sin excepción).

## Requisitos (EARS)

### A — Ordenex le cobra a una tienda: lo que escribe

**R1** — CUANDO una persona con acceso total registre un cobro a una tienda, el sistema DEBE escribir en
una sola transacción el débito en el libro de esa tienda, una línea en la caja de naturaleza propia y
liquidez «cargo» por el mismo monto, y la fila del historial; SI cualquiera de las tres escrituras falla,
ENTONCES NO DEBE quedar ninguna.

**R2** — La línea de caja del cobro DEBE quedar vinculada al débito de la tienda con un origen propio del
cobro y el identificador de ese débito, de modo que un segundo intento de escribirla para el mismo cobro NO
DEBE producir una segunda línea.

**R3** — El débito de la tienda y la línea de caja DEBEN llevar el mismo monto y el mismo instante de fecha:
con «hoy», el instante que fija el servicio (no el valor por defecto de cada columna); con un día anterior,
el inicio de ese día en Costa Rica.

**R4** — CUANDO un cobro quede registrado, la ganancia de Ordenex DEBE subir exactamente en el monto,
«De las tiendas» y el saldo de la tienda DEBEN bajar exactamente en el monto, y NO DEBEN cambiar «Entró»,
«Salió», la cifra principal de la caja, el capital de Ordenex, el libro de ninguna otra tienda ni el de
ningún mensajero.

**R5** — El cobro DEBE seguir registrándose sin tope ni comprobación de saldo disponible, y SI deja el saldo
de la tienda en contra, ENTONCES el sistema DEBE registrarlo igualmente y devolver el saldo resultante con
su signo.

**R6** — Las validaciones del cobro de hoy (tienda inexistente, no es una tienda, no está activa; monto no
válido; descripción vacía; fecha inexistente, futura o fuera de la ventana de los movimientos manuales)
DEBEN conservarse con sus mismos textos, y ninguna de ellas DEBE dejar escrita ninguna fila.

**R7** — La línea de caja del cobro DEBE describirse con el nombre de la tienda y la descripción del cobro,
sin ningún identificador interno; el débito de la tienda DEBE conservar la descripción que tecleó la persona,
tal cual.

**R8** — SI quien registra un cobro no tiene acceso total, ENTONCES el sistema DEBE rechazarlo como
prohibido antes de leer ningún saldo ni catálogo; y SI no hay sesión, ENTONCES DEBE rechazarlo como no
autenticado sin escribir nada.

**R9** — El servicio del cobro NO DEBE poder construirse sin su puerto de caja, y un registro hecho a través
de la acción de servidor DEBE dejar en la base el débito, la línea de caja y el historial.

### B — Anular un cobro

**R10** — CUANDO una persona con acceso total anule un cobro indicando un motivo, el sistema DEBE, en una
sola transacción, dejar constancia de la anulación (motivo, quién y cuándo), añadir al libro de la tienda un
crédito compensatorio por el monto del cobro, añadir a la caja un reverso del cargo por el mismo monto y
escribir la fila del historial; SI cualquiera falla, ENTONCES NO DEBE quedar ninguna.

**R11** — Los dos contra-asientos de R10 DEBEN fecharse con el mismo instante, del día de la anulación en
Costa Rica, y la anulación NO DEBE editar ni borrar el cobro, su débito ni su línea de caja original.

**R12** — CUANDO se anule un cobro, la ganancia de Ordenex DEBE bajar exactamente en el monto, «De las
tiendas» y el saldo de la tienda DEBEN volver a subir exactamente en el monto, y NO DEBEN cambiar «Entró»,
«Salió», la cifra principal ni el capital.

**R13** — El monto de los contra-asientos DEBE leerse del cobro en el servidor; SI la petición de anular trae
un monto o cualquier otro campo no previsto, ENTONCES el sistema DEBE rechazarla como error de validación sin
escribir nada.

**R14** — SI el motivo de la anulación está vacío una vez recortados los espacios, ENTONCES el sistema DEBE
rechazarla sin escribir nada.

**R15** — CUANDO se intente anular un cobro ya anulado, o lleguen dos anulaciones del mismo cobro a la vez,
el sistema DEBE dejar una sola anulación y responder a la otra que ya estaba anulado, sin escribir nada más.

**R16** — SI el cobro que se quiere anular no existe o no es un cobro a una tienda, ENTONCES el sistema DEBE
responder que no se encontró sin escribir nada.

**R17** — SI el cobro que se quiere anular es un cobro reclasificado como pago de un gasto de la tienda, o no
tiene línea de caja de cobro (ni propia ni completada), ENTONCES el sistema DEBE rechazar la anulación como no
anulable, sin escribir nada y diciendo por qué.

**R18** — SI quien anula no tiene acceso total, ENTONCES el sistema DEBE rechazarlo como prohibido antes de
leer el cobro; y SI no hay sesión, ENTONCES como no autenticado.

**R19** — El sistema NO DEBE ofrecer ninguna forma de editar un cobro ni de deshacer su anulación.

**R20** — El libro de la caja DEBE ofrecer «Anular…» (con motivo obligatorio) en la línea original de cada
cobro vigente —propia o completada—, DEBE mostrar «Anulado» en las ya anuladas, y NO DEBE ofrecerlo en los
contra-asientos, en las salidas de los cobros reclasificados ni en las líneas automáticas del cierre.

**R21** — CUANDO se registre o se anule un cobro desde `/wallet`, el sistema DEBE actualizar sin recargar la
página la tarjeta de la caja, el libro y la composición de la ganancia.

### C — La derivación y la invariante, sin excepción

**R22** — El sistema DEBE clasificar la línea de caja del cobro como ingreso de naturaleza propia y liquidez
«cargo», y su reverso como egreso de naturaleza propia y liquidez «cargo»; NINGUNO de los dos DEBE contarse
en «Entró» ni en «Salió».

**R23** — El sistema DEBE calcular «De las tiendas» como los ingresos de terceros más los reversos de cargos,
menos los egresos de terceros y menos los cargos a una tienda.

**R24** — El sistema DEBE cumplir al céntimo, para cualquier conjunto de movimientos con o sin filtros y con
los conceptos nuevos dentro: cifra principal = ganancia de Ordenex + «De las tiendas» + capital de Ordenex
(R7).

**R25** — El sistema DEBE cumplir al céntimo, sobre el libro entero y sin ninguna excepción: «De las tiendas»
= suma de los saldos de todas las tiendas (R8).

**R26** — SI algún concepto del libro de las tiendas distinto de `ajuste_debito` no declara su contrapartida
en la caja, si una contrapartida no mueve «De las tiendas» en el mismo sentido y por el mismo importe que el
concepto mueve el saldo de la tienda, o si algún concepto de la caja que mueve «De las tiendas» no es la
contrapartida de exactamente un concepto del libro de las tiendas, ENTONCES el gate DEBE fallar.

**R27** — La composición de la ganancia DEBE mostrar el cobro a una tienda como fila propia de ingresos y el
reverso de cobros como fila propia de egresos, y sus totales DEBEN seguir siendo, importe a importe, los
ingresos propios y los egresos propios de la caja.

**R28** — Para conjuntos de movimientos sin cobros ni reversos de cobro, la cifra principal, la ganancia, su
composición, «De las tiendas», el capital, el estado de la caja, el saldo y desglose de cada tienda y la
cuenta por pagar de cada mensajero DEBEN valer exactamente lo mismo que antes de esta ficha.

**R29** — La métrica «dinero en caja» DEBE incluir los dos conceptos nuevos y valer lo mismo que la cifra
principal sobre el mismo conjunto; «ganancia de Ordenex» DEBE incluirlos; «egresos» NO DEBE incluir el
reverso del cobro (no es dinero que salga); «cuenta por pagar a tiendas» DEBE incluir el crédito de la
anulación del cobro.

**R30** — La serie de finanzas por día DEBE informar como ingresos y egresos de cada día solo el efectivo (ni
el cobro ni su reverso), y DEBE contar el cobro y su reverso en la ganancia del día.

### D — Los cobros ya registrados sin línea de caja

**R31** — CUANDO se aplique la migración de datos de esta ficha, el sistema DEBE escribir, por cada cobro
que no sea un cobro reclasificado y no tenga ya una línea de caja de cobro, una línea de caja de cobro por el
mismo monto, con el mismo instante de fecha y la misma persona que lo registró, descrita con el nombre de la
tienda y la descripción del cobro, vinculada al cobro con un origen que la distinga de las que escribe el
servicio; y NO DEBE modificar ni borrar ninguna otra fila.

**R32** — La migración de datos NO DEBE escribir ninguna línea para un cobro reclasificado ni para un cobro
que ya tenga su línea de caja de cobro, con cualquiera de los dos orígenes.

**R33** — CUANDO la migración de datos se aplique dos veces, el sistema DEBE dejar una sola línea de caja por
cobro.

**R34** — SI al terminar la migración de datos el número de líneas escritas o su suma no coinciden con el
número y la suma de los cobros candidatos, ENTONCES la migración DEBE fallar sin dejar nada escrito.

**R35** — SI no existe ningún cobro candidato, ENTONCES la migración de datos DEBE terminar sin escribir
nada y decirlo.

**R36** — CUANDO se revierta la migración de datos, el sistema DEBE borrar exactamente las líneas que ella
escribió y ninguna otra; SI alguna de esas líneas ya tiene un reverso de anulación, ENTONCES la reversión
DEBE fallar sin borrar nada.

**R37** — El sistema DEBE mostrar las líneas completadas en el libro de la caja con el mismo concepto que el
cobro, dueño «Ordenex» y un origen legible que diga que se completó, y DEBE admitir su anulación igual que
la de un cobro propio.

**R38** — Antes de desplegar, el contraste de solo lectura (`design.md` §13) DEBE medir en producción el
número y la suma de los cobros candidatos y el efecto previsto (ganancia + Σ, «De las tiendas» − Σ, cifra
principal sin cambio); y después de desplegar, la diferencia de R7 y la de R8 DEBEN dar 0,00 y la ganancia
DEBE ser la de antes más esa suma; SI alguna no cuadra, ENTONCES no se sigue.

### E — Los nombres

**R39** — El diálogo «Registrar movimiento» DEBE ofrecer exactamente estos siete conceptos, con estos nombres:
«Gasto de Ordenex», «Sueldo», «Ordenex paga un gasto de una tienda», «Corrección de caja (resta)», «Aporte de
dinero a la caja», «Corrección de caja (suma)» y «Ordenex le cobra a una tienda».

**R40** — Los siete conceptos DEBEN ir en tres grupos con encabezado: «Sale dinero de Ordenex» (gasto,
sueldo, pago de un gasto de una tienda, corrección que resta), «Llega dinero a la caja» (aporte, corrección
que suma) y «Se descuenta del saldo de una tienda» (el cobro).

**R41** — CUANDO el usuario elija un concepto, el diálogo DEBE mostrar una frase de efecto de una sola línea
con el texto exacto de `design.md` §7.6, que diga qué le pasa al dinero de Ordenex, al saldo de la tienda
(si la afecta) y a la ganancia; y la del cobro DEBE decir que no llega dinero nuevo, que se toma del saldo a
favor de la tienda y que es ganancia de Ordenex.

**R42** — El libro de la caja (tabla, filtro por concepto y descarga) DEBE rotular cada concepto con el
nombre desde Ordenex de `design.md` §7.2 y cada origen con el de §7.3, y NO DEBE mostrar el valor técnico
de ninguno.

**R43** — El desglose de `/wallet/tiendas` (tabla, filtro por concepto y descarga) DEBE rotular cada concepto
del libro de la tienda con el nombre desde Ordenex de `design.md` §7.4 y cada origen con el de §7.3.

**R44** — `/mi-wallet` (tabla, filtro por concepto y descarga) DEBE rotular cada concepto con su lectura
desde la tienda de `design.md` §7.5, y esa lectura DEBE ser distinta del nombre desde Ordenex en todo
concepto en el que una de las dos partes actúa sobre la otra.

**R45** — Las aclaraciones de las cabeceras («A tu favor», «Cargos de Ordenex», «Ya pagado» y sus gemelas en
`/wallet/tiendas`) DEBEN nombrar el cobro y su anulación con la misma palabra con la que se rotula su fila
en esa misma pantalla.

**R46** — El diálogo DEBE decir, para el concepto elegido, en qué libro cae y con qué nombre desde Ordenex
saldrá en cada uno, tomando esos nombres de los mismos diccionarios que pintan los libros.

**R47** — El sistema NO DEBE rotular ningún concepto, origen, grupo ni acción con un nombre retirado
(`design.md` §7.9) en ninguna superficie que esta ficha toca, y el gate DEBE fallar si alguno vuelve.

**R48** — El sistema NO DEBE usar ninguno de los nombres reservados para el pago de la tienda a Ordenex
(`design.md` §7.8) como rótulo de ningún concepto existente, y el gate DEBE fallar si lo hace.

**R49** — Ningún nombre nuevo de esta ficha DEBE coincidir con el nombre visible de un estado de orden
vigente ni retirado, y las guardias de textos de la 455, la 459 y la 460 DEBEN seguir en verde.

**R50** — La explicación de «De las tiendas» en la tarjeta de la caja DEBE decir que es la suma de los saldos
de las tiendas ya descontados el flete, la comisión, el impuesto y lo que Ordenex les cobró, y NO DEBE decir
en ninguna superficie que los cobros a una tienda no pasan por la caja.

**R51** — El historial de acciones DEBE mostrar los tipos que esta ficha toca con los textos de `design.md`
§7.7, y DEBE permitir filtrar por el tipo nuevo de la anulación.

**R52** — El sistema NO DEBE mostrar, pedir ni descargar ningún identificador interno en las superficies que
esta ficha toca, y todo importe DEBE llegar del servidor como texto sin que el navegador haga aritmética.

### F — El diálogo y el cobro

**R53** — CUANDO el concepto elegido sea «Ordenex le cobra a una tienda», el diálogo DEBE pedir la tienda, el
monto, la fecha y el motivo, con los mismos campos que hoy, y NO DEBE enviar al servidor ninguna clave que
hoy no envíe.

**R54** — CUANDO un cobro se registre con éxito, el diálogo DEBE avisar con el saldo resultante de la tienda
que devolvió el servidor, con su signo, y SI queda en contra, ENTONCES DEBE decir en palabras que la tienda
le debe ese dinero a Ordenex.

### G — El historial

**R55** — CUANDO se anule un cobro, el sistema DEBE dejar en el historial una fila de un tipo propio,
clasificada como acción que mueve dinero, con quién, cuándo, el importe y el nombre de la tienda, y sin el
motivo ni ningún otro texto libre; y la fila del registro del cobro DEBE conservarse como hoy.

### H — La ayuda y el asistente

**R56** — Los documentos de ayuda de la caja, de las tiendas y de «Mi wallet» DEBEN describir el cobro a una
tienda con su efecto (se descuenta del saldo a favor de la tienda y es ganancia de Ordenex; no llega dinero
nuevo), su anulación, y todos los conceptos con sus nombres nuevos; NO DEBEN decir que el cobro no pasa por
la caja ni usar ningún nombre retirado como nombre de concepto.

**R57** — El contexto del asistente DEBE contener, para maestro y admin, las explicaciones de la caja y de las
tiendas con las frases literales de `design.md` §11; para adminTienda, la de «Mi wallet»; y NO DEBE llevar
la de la caja a mensajero, adminTienda ni adminSatelite.

**R58** — Cada documento de ayuda tocado DEBE actualizar su fecha y su lista de fuentes con los archivos de
los que afirma lo que afirma.

### I — Verificación, no regresión y estructura

**R59** — Antes de tocar código, el sistema DEBE tener una fotografía con literales del escenario que ejerce
todos los caminos que escriben en la caja o en el libro de las tiendas (saldos y desgloses, ganancia y
composición, mensajeros y filas por camino), y las mutaciones de `design.md` §14.2 DEBEN ponerla roja.

**R60** — Registrar y anular pagos de un gasto de una tienda, aportes de dinero a la caja, pagos a tiendas y
a mensajeros, los cobros de gasto fijo, los cobros por rechazo, los premios y la aprobación de cierres DEBEN
conservar sus asientos en los tres libros, sus topes, su idempotencia, su historial y su comportamiento.

**R61** — La reclasificación de la 459 (su migración, sus 203 salidas y su guardia de lista) NO DEBE tocarse,
y sus tests DEBEN seguir verdes sobre cobros sin línea de caja de cobro.

**R62** — Revertir las migraciones de estructura de esta ficha sobre una base sin ninguna fila que use lo que
añaden DEBE devolver catálogos, restricciones y tablas exactamente a su estado previo; SI existe alguna fila
que lo use, ENTONCES la reversión DEBE fallar sin borrar ningún dato.

**R63** — La reversión de los valores de enum DEBE leer la lista vigente del catálogo y quitar solo los
valores de esta ficha, de modo que valga igual en `prod` y en `dev`.

**R64** — Toda tabla nueva de esta ficha DEBE tener la seguridad por filas activada.

**R65** — Antes de darla por hecha, el recorrido por rol de `design.md` §16 (maestro, admin, adminTienda y
mensajero) DEBE tener sus capturas y sus números en `progress/`.

## Trazabilidad prevista (R → test)

El detalle vive en `design.md` §17; el implementer fija las rutas finales en `progress/impl_461.md`.

| Requisitos | Test previsto |
| --- | --- |
| R1–R9 | `tests/unit/services/cobro-tienda-service.test.ts` (ampliado), `tests/integration/db/cobro-tienda-461.test.ts` (pasa por la action) |
| R10–R19 | `cobro-tienda-service.test.ts`, `tests/unit/types/cobro-tienda-anulacion-schema.test.ts`, `cobro-tienda-461.test.ts`, `tests/integration/db/cobro-tienda-461-concurrencia.test.ts` |
| R20, R21, R37 | `tests/components/WalletLedgerAcciones461.test.tsx` |
| R22–R24, R28 | `tests/unit/utils/caja-derivacion-461.test.ts`, `caja-derivaciones.guardia.test.ts` |
| R25 | `tests/integration/db/caja-invariante-tiendas.test.ts` (sin el término de excepción) |
| R26 | `tests/unit/guards/caja-clasificacion-459.guardia.test.ts` (contrato nuevo, con contraprueba) |
| R27 | `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts`, `tests/components/ComposicionGananciaCard.test.tsx` |
| R29 | `tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts`, `tests/unit/services/analitica-financiera-service.test.ts` |
| R30 | `tests/unit/analytics/finanzas-diario.test.ts` |
| R31–R36 | `tests/integration/db/cobro-tienda-461-completar-migration.test.ts` |
| R38 | `progress/contraste_461.md` (lo corre el leader; `design.md` §13) |
| R39–R41, R46, R53, R54 | `tests/unit/components/wallet-conceptos-manuales.test.ts`, `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` |
| R42 | `tests/unit/components/wallet-labels.test.ts` (nuevo), `tests/components/WalletLedgerAcciones461.test.tsx`, `tests/components/descarga/WalletDescarga.test.tsx` |
| R43, R45 | `tests/unit/components/desglose-tienda-labels.test.ts`, `tests/unit/components/desglose-movimientos-tienda.test.tsx`, `tests/unit/descarga/desglose-tienda-descarga-columnas.test.ts` |
| R44, R45 | `tests/unit/components/mi-wallet-labels.test.ts`, `tests/integration/mi-wallet-page.test.tsx`, `tests/unit/descarga/wallet-tienda-descarga-columnas.test.ts` |
| R47, R48, R49, R50 | `tests/unit/guards/nombres-wallet-461.guardia.test.ts` (nueva, con contraprueba) + las guardias de la 455/459/460 |
| R51, R55 | `tests/unit/historial-accion/catalogo-y-choke-point.test.ts`, guardias del censo del historial |
| R52 | `tests/unit/descarga/columnas-sensibles.guardia.test.ts`, `tests/integration/wallet-page.test.tsx` |
| R56–R58 | `tests/unit/asistente/contexto-461.test.ts`, `contexto-460.test.ts` (reescrito con los nombres nuevos), guardias `ayuda-*` |
| R59, R60 | `tests/integration/db/caja-caracterizacion-459.test.ts` (bloque nuevo «lo que la 461 cambia a propósito») + `progress/fase0_461.md` |
| R61 | `tests/integration/db/reclasificacion-459-migration.test.ts`, `reclasificacion-459-lista.guardia.test.ts` (sin tocar) |
| R62–R64 | `tests/integration/db/cobro-tienda-461-migration.test.ts` |
| R65 | `progress/recorrido_461.md` + `progress/recorrido_461/` |

## Preguntas abiertas — decisión tomada y alternativa (no bloquean)

**P1 — ¿Cómo se revierte el reverso de un cargo sin tocar «Salió»?** *Decisión:* la liquidez «cargo» vale
también para egresos: un egreso «cargo» no suma a «Salió», baja la ganancia y sube «De las tiendas» (R22,
R23). *Alternativa:* un ingreso negativo o una segunda categoría de tipo; ambas rompen el CHECK
tipo↔categoría o el money-safe.

**P2 — ¿Con qué origen se escriben las líneas completadas?** *Decisión:* un origen propio
(`cobro_tienda_completado`), como hizo la 459 con `cobro_manual_reclasificado`: la reversión borra
exactamente lo suyo y el libro dice qué pasó. *Alternativa:* el mismo origen que el servicio, con una tabla
auxiliar de ids para el `down`; deja una tabla fuera del esquema o un `down` impreciso.

**P3 — ¿Desde dónde se anula un cobro?** *Decisión:* desde su línea original en el libro de la caja, como el
pago de un gasto y el aporte (R20). *Alternativa:* también desde la fila del desglose de `/wallet/tiendas`;
duplica la acción y la ayuda ya dice que ahí no se anula nada.

**P4 — ¿Un diccionario por audiencia para el libro de la tienda?** *Decisión:* sí: `/wallet/tiendas` y el
diálogo leen el nombre desde Ordenex; `/mi-wallet` lee la lectura desde la tienda; los dos son `Record`
totales sobre el mismo enum y un test exige que difieran donde una parte actúa sobre la otra (R44).
*Alternativa:* un solo diccionario neutro; contradice HD3.

**P5 — «Ordenex pagó por ti a Facebook…»:** el beneficiario vive en la descripción del movimiento.
*Decisión:* el concepto se lee «Ordenex pagó un gasto por ti» y la columna de origen sigue con «A Facebook ·
motivo · método»; en una fila se lee la frase completa. *Alternativa:* extraer el beneficiario de la
descripción (texto libre) o ampliar el DTO de la tienda con un campo; se descarta por parsear texto.

**P6 — El rótulo de la tarjeta «Saldo inicial y aportes».** *Decisión:* se conserva: es la suma de las dos
clases y el estado «saldo» depende del saldo inicial. El concepto del diálogo, la categoría y el origen pasan
a «Aporte de dinero a la caja» y la clase se sigue eligiendo dentro. *Alternativa:* «Aportes de dinero a la
caja» también en la tarjeta.

**P7 — ¿Se tocan las etiquetas de la analítica («Ingreso por comisión COD», «Dinero en caja»…)?**
*Decisión:* no: son ids de métricas con sus propias guardias y otra pantalla. *Alternativa:* renombrarlas
aquí; se deja como deuda anotada para el tablero.

**P8 — ¿Dónde vive la acción de anular?** *Decisión:* en `lib/actions/wallet-tienda.ts`, junto a la de
registrar y compartiendo su composition root (no hay test de lista exacta de exportaciones en ese archivo).
*Alternativa:* un archivo nuevo, que duplicaría el composition root.

**P9 — «COD» en los rótulos de la wallet.** *Decisión:* se dice «contra-entrega» en los rótulos de los
libros de la wallet (caja, tiendas, mi wallet); la analítica no cambia (P7). *Alternativa:* dejar «COD».

**P10 — ¿Se cobra a una tienda inactiva?** *Decisión:* no, como hoy (381). *Alternativa:* admitirla, como
la 457 para el pago recibido.

**P11 — ¿Candado de tienda en el cobro y en su anulación?** *Decisión:* no, como la 381 (R27): nada se
compara contra un disponible; la idempotencia de la anulación la da el UNIQUE sobre el cobro. *Alternativa:*
tomar el candado del pago a tienda; serializaría por ceremonia.

**P12 — Anular un cobro reclasificado.** *Decisión:* rechazado como no anulable (R17): su dinero nunca fue
ganancia y su salida ya está en la caja como pago de un gasto. *Alternativa:* permitirlo escribiendo el
reverso del pago de un gasto; mezcla dos documentos.

**P13 — Fecha de los contra-asientos.** *Decisión:* el día de la anulación (R11), como la 172, la 457 y la
459. *Alternativa:* la fecha original, que reescribe periodos ya vistos.

**P14 — ¿El reverso del cobro entra en la métrica «egresos»?** *Decisión:* no (R29): no es dinero que salga.
*Alternativa:* incluirlo como se incluyó el reverso de un egreso (183); aquel sí era efectivo.

**P15 — Estilo de los textos del historial.** *Decisión:* verbo en pasado con la persona como sujeto («Le
cobró a una tienda»), como el resto del catálogo. *Alternativa:* «Ordenex le cobró…», que cambia el sujeto
de toda la pantalla.

**P16 — Textos exactos.** *Decisión:* los de `design.md` §7. *Alternativa:* los que el humano ajuste al
revisar; cambiarlos cuesta una línea por texto y su literal en el test.

**P17 — «Tipo» de la línea del cobro en el libro de la caja.** La columna dirá «Ingreso» (como los fletes de
la 459) aunque no entre dinero. *Decisión:* se acepta: el concepto y la pista de la tarjeta lo explican, y un
tercer tipo exigiría cambiar el enum y el CHECK. *Alternativa:* un tipo «cargo»; fuera de alcance.
