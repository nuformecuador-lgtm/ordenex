# impl 398 — la PANTALLA de la corrección del resultado (FRONTEND, R16)

> Tanda de `frontend_dev`. Cierra el ÚNICO requisito que la tanda de backend dejó sin test:
> **R16**. Los otros 15 ya estaban cubiertos (ver `progress/impl_398.md §4`).
> Rama: `worktree-agent-ad5607600191991b5`. Base: `b8e47c6d`.

---

## 0. Lo que había que poder hacer, y ahora se puede

Un mensajero marcó `entregada` una orden que fue **rechazada** y ya había solicitado el cierre. El
2026-09-08 hubo que corregirlo **a mano en la base de producción** porque esta pantalla no existía.
Hoy el admin abre el detalle de ese cierre, despliega la orden, pulsa **«Corregir el resultado»**,
escribe el motivo —el que se usó de verdad fue *«Corrección desde la central por error del
mensajero»*— y confirma.

---

## 1. Archivos

### Nuevos

| archivo | qué |
| --- | --- |
| `app/(app)/cierres-admin/_components/CorregirResultadoDialog.tsx` | el diálogo (T4.1) |
| `tests/components/CorregirResultadoCierre.test.tsx` | 22 casos: R16 en las dos capas + el diálogo |

### Modificados

| archivo | qué |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierre-factura.tsx` | prop `onCorregirResultado` + el botón de la fila, **sólo** en `entregada` |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` | prop `puedeCorregirResultado` (default `false`), estado propio del diálogo, el gate por estado del cierre y el montaje (T4.2) |
| `app/(app)/cierres-admin/page.tsx` | `puedeCorregirResultado={esAccesoTotal(actor.rol)}` — el MISMO predicado que exige el servicio |
| `lib/actions/cierres-admin.ts` | **se BORRA `@sin-superficie`** (comentario; ni una línea de código) |

**Nada de `lib/` más que ese comentario, ninguna migración, ni `feature_list.json` ni
`progress/current.md`.**

---

## 2. Cómo queda el diálogo

Hermano de `CorregirPagosDialog` a propósito: mismo `Modal`, mismos cinco desenlaces resueltos con
el mismo código, y el mismo aviso al padre para que **relea el detalle del servidor**.

1. **Se ofrece** como un botón en el desplegable de la fila —«Corregir el resultado»—, con nombre
   accesible que incluye la orden y el destinatario.
2. **Al abrirse** dice, en claro y sin jerga, las tres cosas que van a pasar (`design.md §7`):
   el cobro registrado de esa entrega **desaparece** del cierre; el pago al mensajero por esa
   entrega **pasa a cero**; el paquete **se tratará como una devolución** al aprobar el cierre.
3. **El motivo es obligatorio**: sin él el botón «Marcar como rechazada» está deshabilitado y no
   viaja nada. Un motivo de sólo espacios tampoco cuenta (el borde usa el MISMO `motivoSchema` que
   una gestión rechazada real, que recorta y rechaza el blanco).
4. **Lo que viaja son DOS claves**: `gestionId` y `motivo`. El nuevo resultado **no** se manda: el
   borde es `.strict()` y esta ficha concede una sola pareja.
5. **Al aplicarse** el diálogo NO se cierra: enseña los **cuatro totales del cierre** que devolvió
   el servidor, **verbatim**, en el mismo `TotalesPanel` que ya pinta los totales snapshot en el
   resto de la pantalla. Y avisa al padre, que relee el detalle por detrás: se cierre por donde se
   cierre —botón, Escape, overlay— el dinero de la pantalla de atrás nunca queda viejo.
6. **Los cinco desenlaces**: `ok`; `conflict` («el cierre dejó de estar abierto mientras
   corregías…»); `no_encontrada`; `forbidden`; `validation_error` (se pinta el texto del servidor,
   sea del campo `motivo` o del campo `resultado`). `unauthenticated` cae en el genérico, igual que
   en el hermano.

**Accesibilidad:** el aviso es una `region` con nombre, el campo tiene `<label htmlFor>`,
`aria-required`, `aria-invalid` y `aria-describedby` (ayuda o error), y el error es `role="alert"`.
Ningún texto está incrustado en la lógica: todos son constantes al principio del archivo.

**Redacción MÍA, y lo digo:** los rótulos y los seis mensajes de este diálogo los escribí yo
—«Corregir el resultado», «Marcar como rechazada», «Motivo de la corrección», el pie de ayuda y los
textos de los desenlaces—. Las **tres consecuencias** no: son las del `design.md §7`, pasadas a
frase completa.

---

## 3. Dónde se ofrece, y las dos capas que lo deciden (R16)

| capa | qué decide | dónde |
| --- | --- | --- |
| la FILA | **sólo** una gestión con resultado `entregada` | `cierre-factura.tsx`, `FilaGestion` |
| el MÓDULO | **sólo** un cierre `solicitado` o `vencido`, y **sólo** con permiso | `CierresAdminModule.tsx`, `ofrecerCorreccionResultado` |
| el SERVIDOR | las cinco guardias de R1-R5, que no dependen de la pantalla | ya estaba |

Dos diferencias deliberadas con la corrección del desglose, y las dos están escritas en el código:

- **No exige que la entrega haya cobrado.** El botón de los métodos pide `pagos.length > 0` porque
  sin líneas no hay nada que repartir; aquí lo que se corrige es el RESULTADO, y una entrega
  declarada sin dinero también puede no haber ocurrido. El servidor sólo mira el `resultado` (R4).
- **`puedeCorregirResultado` es una TERCERA prop**, no `puedeCorregirPagos`. Es el argumento que ya
  dejó escrito su vecina cuando se separó de `puedeRegistrarPago`: hoy coinciden en el predicado
  (`esAccesoTotal`), pero repartir entre métodos un dinero que sí entró y borrar un cobro que no
  existió son dos permisos distintos. Default `false`: **falla cerrado**.

**«Abierto ⇒ no consolidado» no se pregunta aparte, y está razonado en el código:** la
consolidación en un `cierre_bodega` sólo toma cierres `aprobado`, así que un `solicitado`/`vencido`
no puede estar consolidado. Quien lo MIDE contra Postgres es el test de integración de la tanda de
backend («💰 R3: un cierre APROBADO Y CONSOLIDADO no se corrige…»); aquí se prueba lo que le toca a
la pantalla: que en un `aprobado` —el único estado en el que un cierre puede estar consolidado— el
botón **no está**.

---

## 4. R16 → test

| R | Test (`tests/components/CorregirResultadoCierre.test.tsx`) |
| --- | --- |
| **R16** (sólo `entregada`) | «en una entrega, cuando el padre lo autoriza» · «también en una entrega SIN cobro…» · «sobre una gestión YA rechazada NO se ofrece…» · «sobre una devuelta, una reprogramada o un incidente tampoco» · «sin autorización del padre NO se ofrece…» · «pulsarlo abre la corrección de ESA gestión» |
| **R16** (sólo cierre ABIERTO) | «en un cierre `solicitado`» · «y en un `vencido`…» · «💰 en un cierre APROBADO no, y ése es el único estado en el que puede estar consolidado» · «en un cierre RECHAZADO tampoco…» · «sin el permiso del servidor no se ofrece ni en un cierre abierto (falla cerrado)» · «un montaje que se OLVIDE de pasar el permiso tampoco lo ofrece» · «pulsarlo abre el diálogo de la corrección con la orden nombrada» |
| R5 en la pantalla | «💰 SIN MOTIVO no se puede confirmar, y no viaja nada» · «💰 un motivo de solo espacios tampoco cuenta como motivo» |
| el contrato del borde | «con el motivo escrito envía DOS claves: la gestión y el motivo, nunca el resultado» |
| R14 en la pantalla | «💰 pinta los CUATRO totales que devolvió el servidor, tal cual llegaron» |
| R3/R12 vistos por el usuario | «si el cierre dejó de estar abierto mientras corregías, lo dice y NO relee el detalle» |
| R1 visto por el usuario | «un `forbidden` del servidor se dice con palabras y no se pinta ningún total» |
| R4 visto por el usuario | «un `validation_error` del campo `resultado` se pinta con el texto del servidor» |
| higiene de estado | «al abrir con OTRA gestión arranca limpio…» · «dice EN CLARO las tres cosas que van a pasar» |

Con esto los **16** requisitos de la ficha tienen test.

---

## 5. La anotación que caducaba

`lib/actions/cierres-admin.ts` llevaba `@sin-superficie` sobre `corregirResultadoGestion` con su
motivo: *«se BORRA en el commit que monte el diálogo»*. **Borrada en este commit**, y en su sitio
queda escrito dónde vive ahora su superficie. No es un acto de fe: la mutación **M5** lo mide —al
devolver la anotación, `superficie-de-uso.guardia` se pone roja con «ninguna anotación
`@sin-superficie` de acción sobrevive a su motivo»—.

---

## 6. Mutaciones — 5 de 5 muertas, y UN superviviente declarado

Arnés propio con **autocomprobación**, fuera del repo: (0) baseline verde antes de mutar; (1) cada
ancla tiene que aparecer **exactamente una vez** o aborta sin tocar nada; (2) restaura siempre; (3)
comprueba al final por **sha256** que los cuatro archivos volvieron byte a byte.

```
AUTOCOMPROBACION 0 — BASELINE sin mutar: tiene que salir VERDE
 Test Files  2 passed (2)
      Tests  40 passed (40)
exit=0
```

| # | Mutación | exit | Qué murió |
| --- | --- | --- | --- |
| **M1** | la corrección **se ofrece en un cierre ya aprobado o consolidado** (el gate pierde el estado) | 1 | «💰 en un cierre APROBADO no…», «en un cierre RECHAZADO tampoco…» |
| **M2** | **se ofrece sobre una gestión que no es `entregada`** (la fila pierde el filtro) | 1 | «sobre una gestión YA rechazada NO se ofrece…», «sobre una devuelta, una reprogramada o un incidente tampoco» |
| **M3** | **el motivo deja de ser obligatorio** (caen las dos barreras: el botón y el envío) | 1 | «💰 SIN MOTIVO no se puede confirmar, y no viaja nada», «💰 un motivo de solo espacios…», «al abrir con OTRA gestión arranca limpio…» |
| **M4** | **los totales devueltos se recalculan en el navegador** (se les resta el cobro de la gestión, con `Number`) | 1 | «💰 pinta los CUATRO totales que devolvió el servidor, tal cual llegaron» |
| **M5** | la anotación **`@sin-superficie` sobrevive a su motivo** | 1 | guardia `superficie-de-uso`: «ninguna anotación `@sin-superficie` de acción sobrevive a su motivo» |

```
AUTOCOMPROBACION FINAL — el arbol vuelve a ser el original, byte a byte
  CierresAdminModule.tsx restaurado: True
  CorregirResultadoDialog.tsx restaurado: True
  cierre-factura.tsx restaurado: True
  lib/actions/cierres-admin.ts restaurado: True
```

**M3b SOBREVIVE, y se dice en voz alta.** Mutando **sólo** la barrera interior
(`if (!gestion || enviando || motivoVacio) return;` dentro de `confirmar`) y dejando el botón
deshabilitado, los 22 casos siguen verdes. **No es un agujero de cobertura de R5/R16:** el `Modal`
compartido no llama a `onConfirm` mientras `confirmDisabled` es `true`, así que esa segunda barrera
**no es observable desde la interfaz** — es exactamente el mismo cinturón-y-tirantes que lleva el
diálogo hermano (`if (hayErrorDeLinea || !cuadra) return;`). Se conserva a propósito: protege una
llamada programática futura. Lo que el requisito SÍ expone —el botón deshabilitado y que no viaje
nada— muere con M3.

---

## 7. Gate COMPLETO (`./init.sh`, no `--rapido`)

Log propio (nombre con la rama, no un `/tmp/gate.log` compartido):
`…/scratchpad/gate-398-frontend-completo.log`, con `INIT_EXIT` escrito **DENTRO** y sin `tail`.
Se corrió el COMPLETO y no `--rapido`: el diff toca `app/(app)/cierres-admin/**`, que lleva
«cierre» en la ruta —nombre de dinero—, y el rápido se habría negado solo.

```
 Test Files  1820 passed (1820)
      Tests  26136 passed | 26 skipped (26162)
   Duration  1025.77s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1820 ejecutado(s), todos en el baseline conocido)
INIT_EXIT=0
```

Comprobado dentro del log, uno a uno:

- `✓ typecheck paso` (0 errores) y `✓ lint paso` (0 errores, 175 warnings preexistentes).
- **`skipped` = 26**, el número conocido, y los 26 son **los dos** archivos de siempre:
  `AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9). Ni uno más.
- `✓ DATABASE_URL resuelta: los 143 archivos de tests contra Postgres SI se ejecutan` — el `.env`
  estaba copiado, así que la integración corrió de verdad (sin él el gate salta ~143 archivos y
  aun así dice OK).
- Los tres archivos de esta ficha, verdes y con sus casos:
  `integration/db/correccion-resultado-gestion.int.test.ts` (14),
  `integration/db/correccion-resultado-gestion-migration.test.ts` (17) y
  `components/CorregirResultadoCierre.test.tsx` (22).
- **Cero rojos.** En particular `tests/integration/recuperar-contrasena-form.test.tsx` —el flake
  bajo carga que avisó el encargo— pasó en esta corrida. **No se tocó `tests/baseline-rojos.json`.**

Antes del gate: `pnpm install` propio del worktree (nada de junction de `node_modules`),
`prisma migrate deploy` («No pending migrations to apply» — las dos de la 398 ya estaban en la base
local compartida, `prisma migrate status` dice «up to date» en `localhost:5432/ordenex`) y
`pnpm run db:generate` **después**, repetido justo antes de arrancar el gate.

---

## 8. Veredicto

**R16 cerrado, y con él los 16 requisitos de la ficha.** La corrección se ofrece sólo sobre una
gestión `entregada` y sólo desde el detalle de un cierre `solicitado`/`vencido` de quien tiene el
permiso; el motivo es obligatorio; viajan dos claves y el nuevo resultado no; los cuatro totales se
pintan tal como llegan. Gate **completo en verde con `INIT_EXIT=0`**, 26 `skipped` (los conocidos)
y **cero** rojos. Cinco mutaciones, cinco muertas, con autocomprobación; el único superviviente
—la barrera interior redundante del envío— está medido, explicado y no es cobertura que falte.

Un hueco que no es mío pero que esta pantalla hace visible: **al mensajero no se le avisa** de que
su pago por esa entrega pasó a `0.00` (H5, declarado en `progress/impl_398.md §6`). Desde el
diálogo tampoco: se decidió que emitirlo pide otra notificación y otra migración.
