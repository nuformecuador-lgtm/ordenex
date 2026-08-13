# Feature 213 — tasks

> Zona **frontend**. Cero migraciones, cero repositorios, cero servicios.
> Cada tanda cierra con `./init.sh --rapido`; la feature cierra con `./init.sh` completo, y ese
> mismo gate completo va **antes del PR, sin excepción**.

## Tanda 0 — la única incógnita, antes de escribir nada

- [ ] **T0.1** Leer cómo el borde de la 212 lee `pagos` desde `FormData`
      (`lib/actions/mis-asignaciones.ts`, alrededor de :199 y :253) y **anotar el formato exacto**
      en `progress/impl_213.md`.
      *Hecho:* el formato está escrito con su línea de código, y el §2 del design queda confirmado
      o corregido. **Bloquea toda la tanda 2.**
- [ ] **T0.2** Censar los fixtures que construyen gestiones con `metodoPago` escalar y anotar
      cuántos son y dónde. *Hecho:* lista en la bitácora, con el conteo ANTES de tocar nada.

## Tanda 1 — la pieza de formato [P con la 0.2]

- [ ] **T1.1** `lib/utils/descripcion-desglose-pago.ts`: helper puro (§1). R11/R12/R13/R15/R16.
      *Hecho:* exportado, sin importar nada de `app/` ni de `@prisma/client`.
- [ ] **T1.2** Test de unidad del helper: vacío / 1 / 2 / 3 líneas, orden del enum, formato de
      moneda. *Hecho:* R11-R16 mapeados en la tabla de trazabilidad.
- [ ] **T1.3** Mutación: cambiar el separador y comprobar que T1.2 se pone rojo.
      *Hecho:* rojo verificado y **revertido**.

## Tanda 2 — el editor de captura (depende de T0.1)

- [ ] **T2.1** Sustituir el estado `metodoPago` por `lineas` y sembrar la línea inicial en
      `elegirResultado`. R1/R9.
- [ ] **T2.2** Pintar el editor: método + monto por línea, «Añadir método», quitar línea.
      R1/R3/R4/R5.
- [ ] **T2.3** Monto no editable con una sola línea (`readOnly`, no `disabled`). R2.
- [ ] **T2.4** Aviso de cuadre permanente con 2+ líneas, usando `sumaCuadra`/`aCentimos`.
      R6/R9b. *Ojo al contraste: `text-destructive`, no la píldora (§5.3).*
- [ ] **T2.5** `buildRaw` y `buildFormData`: mandar `pagos`, **no** mandar `metodoPago`, filtrar
      líneas incompletas, y **borrar** `metodoPagoEfectivo` (:331). R7/R8/R9.
- [ ] **T2.6** Tests de componente del editor: los ocho casos del §6.
      *Hecho:* incluido el que afirma que el `FormData` enviado **no** lleva `metodoPago`.

## Tanda 3 — los cinco puntos de consumo [las cinco en paralelo]

- [ ] **T3.1** `CierreDiaModule.tsx:886` → helper. R10.
- [ ] **T3.2** `cierre-detalle-shared.tsx:898` → helper. R10.
- [ ] **T3.3** `cierre-factura.tsx:959` → helper con su prefijo ` · `. R10.
- [ ] **T3.4** `cierre-dia-descarga-columnas.ts:101` → helper; muere el `?? metodoPago`. R17/R15.
- [ ] **T3.5** `cierre-gestiones-descarga-columnas.ts:115` → ídem. R17/R15.
- [ ] **T3.6** Actualizar los fixtures del censo de T0.2. **Con `metodoPago` distinto del desglose
      o en `null`**, nunca coincidiendo (§5.2): un doble cuyos dos valores concuerdan no distingue
      qué campo lee el código.
- [ ] **T3.7** Comprobar que los tests de `COLUMNAS_DESCARGA_*` siguen verdes **sin tocarlos**.
      R18. *Hecho:* si alguno se movió, es que se cambió la forma del archivo y hay que deshacerlo.

## Tanda 4 — la mutación que ata las dos mitades

- [ ] **T4.1** Cambiar el separador **solo en el helper** y comprobar que caen a la vez un test de
      pantalla y uno de descarga. R19/R14. *Hecho:* los dos rojos, y revertido.
- [ ] **T4.2** Mutación: hacer que el helper lea `metodoPago` en vez de `pagos`. Debe poner rojo
      al menos un test. *Hecho:* rojo verificado y revertido. *(Sin esta, R10 es una afirmación
      sobre el propio razonamiento.)*

## Tanda 5 — lo que esta ficha promete NO hacer

- [ ] **T5.1** Corregir los dos comentarios que atribuyen el retiro a la 213:
      `lib/utils/pagos-recaudo.ts:47-49` e `ICierreDiaService.ts:36` → **214**. R20.
- [ ] **T5.2** Comprobar que el diff no toca `computeTotales`, ni los tres `total_*`, ni
      `normalizarPagos`, ni el schema de zod, ni la columna `metodo_pago`, ni las cinco fronteras
      inmunes. R21/R22/R23. *Hecho:* `git diff --stat` pegado en la bitácora, con esa lectura
      hecha archivo por archivo.

## Tanda 6 — cierre

- [ ] **T6.1** Mapa completo `R1..R23 → test nombrado` en `progress/impl_213.md`.
      **Caso a caso contra el árbol**, no copiado del spec: en la 188 ese ejercicio encontró dos
      requisitos que no protegía nada.
- [ ] **T6.2** `./init.sh` completo verde, con el conteo de archivos y tests comparado contra el
      baseline (`1086 / 13662` sobre `dev` @ `bb4c3185`). *Comparar el total de ARCHIVOS antes de
      creerse el de tests: una suite saturada omite archivos y reporta verde.*
- [ ] **T6.3** **Verlo en la app**: registrar una entrega con DOS métodos y comprobar en pantalla
      el desglose en la vista del día, en el detalle admin y en la factura, más las dos descargas.
      La base local ya tiene el caso montado y Marco con ₡2.000 pendientes.
      *Hecho:* texto citado en la bitácora. **No lo sustituye ninguna suite.**
- [ ] **T6.4** PR con el mapa, la mutación de T4.1/T4.2 y el hueco que quede declarado.
