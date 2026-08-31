# Ficha 336 — borrar `/mis-pagos` y `/qr` · tasks.md

> **Orden de las tandas.** El orden NO es cosmético: si se borra la producción antes de ajustar
> los censos compartidos, el árbol queda con ~7 archivos rojos a la vez y ya no se distingue el
> rojo esperado del rojo nuevo. Se hace al revés: **primero se mide, luego se borra, luego se
> ajusta lo compartido, y solo entonces se afirma el estado final.**
>
> `[P]` = puede ir en paralelo con las otras `[P]` de su misma tanda.
> **Zona `fullstack`**: la tanda B es de `backend_dev`, las tandas A/C/D/E son mixtas y las hace
> quien toque el archivo. Nunca en paralelo con el gate (el gate leería un árbol mutado).

---

## Tanda 0 — La medición previa (antes de borrar NADA)

Sin estos números, los ajustes de la tanda C son adivinanzas.

- [ ] **T0.1** — Correr y anotar los suelos y totales **antes** del borrado:
  ```
  pnpm exec vitest run tests/unit/descarga/contadores-cabecera.guardia.test.ts
  pnpm exec vitest run tests/unit/descarga/cobertura-tablas.guardia.test.ts
  pnpm exec vitest run tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts
  pnpm exec vitest run tests/unit/descarga/adaptador-conjunto.guardia.test.ts
  pnpm exec vitest run tests/unit/guards/superficie-de-uso.guardia.test.ts
  ```
  **Hecho:** en `progress/impl_336.md` figuran, con su cifra: `paginadas.size`,
  `TOTAL_ARCHIVOS_CON_DATATABLE` / `TOTAL_INSTANCIAS_DATATABLE` medidos, nº de constantes
  `COLUMNAS_DESCARGA_*`, nº de llamantes de `filasDesdeResultado`, y **la lista completa de
  acciones huérfanas que hoy imprime la guardia de superficie** (debe ser solo `obtenerTarifa`).

- [ ] **T0.2 [P]** — Confirmar en el archivo real, no en el grafo, que `useQrNavigate` solo lo
  importa `app/(app)/qr/page.tsx`.
  **Hecho:** la comprobación queda escrita en `progress/impl_336.md` con la lista de importadores.

- [ ] **T0.3 [P]** — Confirmar los importadores directos de `components/shared/QrScanner.tsx` (hoy
  3) y las 6 superficies que montan `EscanerGuiaCard`.
  **Hecho:** las dos listas, con nombre de archivo, en `progress/impl_336.md`.

---

## Tanda A — Borrado de producción (depende de: Tanda 0)

- [ ] **A.1** — Borrar los 6 archivos de `app/(app)/mis-pagos/**`.
  **Hecho:** el directorio no existe.

- [ ] **A.2 [P]** — Borrar `app/(app)/qr/page.tsx` y `hooks/useQrNavigate.ts`.
  **Hecho:** ninguno de los dos existe; `pnpm run typecheck` no señala un import roto a ellos.

---

## Tanda B — La superficie de servidor (depende de: Tanda A) · `backend_dev`

Regla transversal de esta tanda: **un símbolo se retira solo tras comprobar que no le queda
ninguna referencia en el árbol real.** Si queda una, se queda el símbolo y se dice en el informe.

- [ ] **B.1** — En `lib/actions/wallet-mensajero.ts`, retirar `verMiCuentaPorPagarAction`,
  `listarMisPagosAction` y `listarMisPagosCompletoAction`, con sus tipos de resultado
  (`VerMiCuentaPorPagarActionResult`, `ListarMisPagosActionResult`) y los imports que queden sin
  uso. **NO** añadir ninguna anotación `@sin-superficie`.
  **Hecho:** el archivo exporta exactamente las 4 acciones de administración; la única anotación
  `@sin-superficie` del archivo sigue siendo la de `listarCuentasPorPagarAction`.

- [ ] **B.2** — En `lib/services/WalletMensajeroService.ts`, retirar `verMiCuentaPorPagar`,
  `listarMisPagos` y `listarMisPagosCompleto`.
  **Hecho:** `pnpm run typecheck` en verde; el resto de métodos intacto.

- [ ] **B.3** — En `lib/interfaces/services/IWalletMensajeroService.ts`, retirar las 3 firmas y
  los tipos que quedan sin referencia (`ListarMisPagosPayload`, `VerMiCuentaPorPagarServiceResult`,
  `ListarMisPagosServiceResult`, `ListarMisPagosCompletoServiceResult`).
  **Hecho:** typecheck verde. **`CuentaPorPagarDTO` sigue en pie** (lo usan
  `DesglosePagosMensajero` y `lib/utils/cuenta-por-pagar.ts`).

- [ ] **B.4** — En `lib/types/wallet-mensajero.ts`, retirar `listarMisPagosCompletoSchema` y
  `ListarMisPagosCompletoInput`.
  **Hecho:** `listarPagosMensajeroSchema` **SIGUE EXISTIENDO** — es la base de la que
  `listarPagosDeMensajeroSchema` deriva con `.extend(...)`; borrarlo rompe la vista del maestro.
  Verificado corriendo `tests/unit/actions/wallet-mensajero-actions.test.ts`.

- [ ] **B.5 [P]** — (Opcional, pregunta abierta nº 5) Corregir la prosa rancia que nombra
  `/mis-pagos` en `lib/config/moneda.ts` y `lib/interfaces/services/ILiquidacionService.ts`.
  **Hecho:** ningún comentario de `lib/` promete una pantalla que no existe.

- [ ] **B.6** — `pnpm run typecheck` + `pnpm run lint` + `pnpm exec vitest related --run` sobre los
  archivos tocados en A y B.
  **Hecho:** typecheck y lint en cero errores; los rojos que queden son **solo** los previstos en
  §4/§5 del design y están nombrados uno a uno en `progress/impl_336.md`.

---

## Tanda C — La cobertura ajena SOBREVIVE (depende de: Tanda B)

Cada task de esta tanda quita **solo** la mitad que afirmaba sobre la pantalla borrada. Ninguna
borra un archivo.

- [ ] **C.1 [P]** — `tests/unit/actions/wallet-mensajero-actions.test.ts`: quitar los `describe` de
  `verMiCuentaPorPagarAction` y `listarMisPagosAction`.
  **Hecho:** siguen los 4 `describe` de las acciones del maestro y el archivo pasa.

- [ ] **C.2 [P]** — `tests/unit/actions/wallet-mensajero-descarga-action.test.ts`: quitar el
  `describe` de `listarMisPagosCompletoAction` y su import.
  **Hecho:** sobrevive el de `listarPagosDeMensajeroCompletoAction` y el archivo pasa.

- [ ] **C.3 [P]** — `tests/unit/services/wallet-mensajero-service.test.ts`: quitar los `describe` de
  `verMiCuentaPorPagar` y `listarMisPagos`.
  **Hecho:** sobreviven `listarCuentasPorPagar`, `listarPagosDeMensajero` y el de inmutabilidad.

- [ ] **C.4 [P]** — `tests/unit/descarga/wallet-mensajero-descarga-columnas.test.ts`: quitar el
  `it` de `COLUMNAS_DESCARGA_MIS_PAGOS`, su entrada de `LEDGERS`, el import de
  `mis-pagos-descarga-columnas` y el `describe` de paridad.
  **Hecho:** **sigue existiendo el `it` que NOMBRA `COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO`** (es lo
  que lo mantiene fuera del censo de «constante sin aserción de orden») y el archivo pasa.

- [ ] **C.5 [P]** — `tests/components/descarga/WalletDescarga.test.tsx`: quitar `renderMisPagos`, su
  caso de la tabla de ledgers, los mocks `listarMisPagos*` y **la ruta
  `app/(app)/mis-pagos/_components/DesglosePagos.tsx` de la lista de tablas de presentación**.
  **Hecho:** el archivo pasa. *Si se olvida la ruta, el `readFileSync` revienta con ENOENT y cae el
  archivo entero, no un caso.*

- [ ] **C.6 [P]** — `tests/components/PremioRankingRotulo.test.tsx` (ficha **293**, R34): quitar los
  2 imports de `mis-pagos/_components/*`, el `describe` de la vista del mensajero, el `it` de
  `filaDescargaMiPago`, su entrada del `it.each` de rótulos, y **actualizar la cabecera**, que hoy
  dice «las CUATRO superficies».
  **Hecho:** R34 sigue afirmado sobre el desglose del maestro y su archivo; la cabecera declara el
  número real de superficies cubiertas.

- [ ] **C.7 [P]** — `tests/unit/guards/liquidacion-money-safe.test.ts` (ficha **172**): quitar las
  2 rutas de `mis-pagos` de `ARCHIVOS_DE_LA_FEATURE`.
  **Hecho:** el `it` «el censo de archivos de la feature existe entero» pasa; el resto del censo
  (≈45 rutas) intacto.

- [ ] **C.8 [P]** — `tests/unit/guards/caja-173-alcance.guardia.test.ts` (ficha **173**): quitar
  `app/(app)/mis-pagos/_components` de `PANTALLAS_CONGELADAS`.
  **Hecho:** R63 pasa con las 2 carpetas restantes. **Comprobar los dos umbrales medidos**:
  `componentes.length > 12` (quedan 13) y `> 3` por carpeta (7 y 6). Si alguno no se cumpliera, se
  ajusta nombrando la pantalla retirada.

- [ ] **C.9** — `tests/integration/db/pago-mensajero-liquidacion.test.ts` (R23 de la 44/172):
  quitar los dos `expect(typeof actions.…)` de las acciones retiradas y **añadir una segunda
  acción viva** como control positivo (p. ej. `listarPagosDeMensajeroAction`).
  **Hecho:** quedan **≥ 2** controles positivos y la afirmación negativa
  (`registrarLiquidacionMensajeroAction` es `undefined`) intacta. El archivo pasa **sin**
  `DATABASE_URL` (lee `db/schema.prisma`, no la base).

- [ ] **C.10 [P]** — `tests/integration/wallet-mensajeros-page.test.tsx`: quitar las 2 claves
  rancias del `vi.mock`. **No es bloqueante**, es higiene.
  **Hecho:** el doble solo declara acciones que existen.

- [ ] **C.11 [P]** — `e2e/wallet-mensajeros.spec.ts`: quitar los 2 `test.describe` de `/mis-pagos`
  y la constante del mensajero sembrado si queda sin uso; ajustar la cabecera.
  **Hecho:** sobreviven los 2 `describe` de `/wallet/mensajeros`. *Contabilidad: en este repo los
  E2E no se ejecutan.*

- [ ] **C.12** — Borrar los 2 tests **suyos**: `tests/integration/mis-pagos-page.test.tsx` y
  `tests/unit/services/wallet-mis-pagos-descarga.test.ts`.
  **Hecho:** no existen. *Se hace al final de la tanda C a propósito: hasta aquí sirven de testigo
  de que lo demás se editó por el motivo correcto.*

---

## Tanda D — Los censos compartidos y las citas (depende de: Tanda C)

- [ ] **D.1** — `tests/unit/descarga/censo-tablas.ts`: quitar la entrada
  `app/(app)/mis-pagos/_components/DesglosePagos.tsx`.
  **Hecho:** la entrada no está; se añade en la cabecera la línea que dice qué desapareció y por
  qué, como hicieron el chore del 2026-07-31 y el del 2026-08-07.

- [ ] **D.2** — `tests/unit/descarga/cobertura-tablas.guardia.test.ts`: bajar
  `TOTAL_ARCHIVOS_CON_DATATABLE` y `TOTAL_INSTANCIAS_DATATABLE` **al número que la guardia
  reporte**, y escribir en la cabecera el motivo nombrando la pantalla.
  **Hecho:** la guardia pasa; los números del archivo coinciden con los **medidos**, no con una
  resta de escritorio. `excluidas.length` **no cambia** (la tabla que se fue era `con_descarga`).

- [ ] **D.3** — `tests/unit/descarga/contadores-cabecera.guardia.test.ts`: **medir**
  `paginadas.size` tras el borrado.
  **Hecho:** una de dos, y la elegida queda escrita en `progress/impl_336.md` con la cifra:
  (a) sigue `>= 30` → **el suelo no se toca**; (b) bajó → se baja el suelo **nombrando
  `/mis-pagos`**, siguiendo la regla que el propio archivo declara.

- [ ] **D.4 [P]** — Verificar que **no** hay que tocar `columnas-asercion-de-orden.guardia` ni
  `adaptador-conjunto.guardia`.
  **Hecho:** en `progress/impl_336.md` constan las dos cifras posteriores (constantes
  `COLUMNAS_DESCARGA_*` ≥ 35 y llamantes de `filasDesdeResultado` ≥ 13) y los dos archivos pasan
  **sin editar**.

- [ ] **D.5** — `specs/172-liquidacion/tasks.md`: añadir la anotación
  `<!-- @test-desaparecido mis-pagos-page.test.tsx: … -->` con motivo de ≥30 caracteres, junto a
  la tabla de trazabilidad (fuera de la fila, que un comentario dentro parte la tabla markdown).
  **Hecho:** `tests/unit/guards/test-citado-desaparecido.guardia.test.ts` pasa. *Es el único
  archivo de otra ficha que esta ficha toca, y lo exige la guardia.*

---

## Tanda E — La guardia del estado final (depende de: Tanda D)

- [ ] **E.1** — Crear `tests/unit/guards/rutas-336-retiradas.guardia.test.ts` con los seis bloques
  del design §6, usando `tests/fixtures/sin-comentarios.ts` para leer código y no prosa.
  **Hecho:** el archivo existe y pasa. Cada bloque tiene su aserción y su mensaje diciendo qué
  significa el rojo.

- [ ] **E.2** — Probar la guardia **por mutación**, en las dos direcciones. Sin esto no vale nada.
  **Hecho:** en `progress/impl_336.md` figura la evidencia de que la guardia se pone **roja** al:
  1. recrear un `app/(app)/qr/page.tsx` vacío;
  2. añadir un `import { QrScanner } …` en un archivo cualquiera con la palabra `mis-pagos`;
  3. re-exportar `listarMisPagosAction` desde `lib/actions/wallet-mensajero.ts`;
  4. borrar `components/shared/QrScanner.tsx` (control positivo: la cámara viva);
  5. quitar `EscanerGuiaCard` de una de las seis superficies;
  6. añadir una entrada falsa a `tests/baseline-rojos.json` que mencione `wallet-mensajero`.
  Y que vuelve a **verde** al deshacer cada una.

- [ ] **E.3** — Comprobar que la guardia **no** se apoya en cifras que ya no son ciertas: que NO
  afirma «`QrScanner` tiene cuatro importadores directos» (son dos tras la ficha) ni «seis
  pantallas importan `QrScanner`» (lo importan por la cadena).
  **Hecho:** revisado a mano; el criterio está escrito en el propio archivo.

---

## Tanda F — Cierre (depende de: Tanda E) · **no en paralelo con nada**

- [ ] **F.1** — `./init.sh --rapido` **debe negarse** y mandar al completo.
  **Hecho:** la salida del rechazo, con la lista de rutas sensibles que lo dispara, pegada en
  `progress/impl_336.md`. *Si NO se negara, algo va mal: el diff toca `lib/types/**` y rutas con
  nombre de dinero.*

- [ ] **F.2** — `./init.sh` **completo**, capturando el código de salida dentro del log
  (`INIT_EXIT=$?`), sin canalizar por `tail`.
  **Hecho:** salida pegada en `progress/impl_336.md`; typecheck y lint en cero; el veredicto del
  baseline en verde.

- [ ] **F.3** — **Leer el CONTENIDO, no el nombre del archivo.** Extraer de la corrida la lista de
  acciones sin superficie que imprime `superficie-de-uso.guardia` y compararla con la de T0.1.
  **Hecho:** la lista posterior es **idéntica** a la previa (solo la deuda ajena de
  `lib/actions/tarifas.ts obtenerTarifa`) y está pegada en `progress/impl_336.md`. *Este paso
  existe porque el gate compara por ARCHIVO: sin él, la ficha podría dejar rojos nuevos dentro de
  una entrada ya listada y el gate saldría **verde mintiendo**.*

- [ ] **F.4** — `git diff --stat -- tests/baseline-rojos.json` debe ser **vacío**.
  **Hecho:** el archivo no cambió. Si cambió, la ficha **se detiene** y se reporta al humano (R14).

- [ ] **F.5** — `git diff --stat -- db/` debe ser **vacío**.
  **Hecho:** cero migraciones, cero schema.

- [ ] **F.6** — Escribir el mapa `R1..R27 → test` en `progress/impl_336.md`, con el nombre del
  archivo y del caso para cada uno.
  **Hecho:** los 27 mapeados; los que se cubren con evidencia y no con un caso ejecutable (R14,
  R26, R27) lo dicen explícitamente.

- [ ] **F.7** — Verificar el **blob commiteado**, no el árbol de trabajo: `git show HEAD --stat` y
  confirmar que los 8 borrados y los 20 editados están dentro.
  **Hecho:** el listado del commit coincide con los censos de `design.md §1` y `§4`.

- [ ] **F.8** — Abrir el PR contra `dev` con `gh pr create --base dev`.
  **Hecho:** URL reportada al humano. *Un PR verde no dice nada de los tests: el check de Vercel es
  un build. El testigo es F.2/F.3.*

---

## Resumen de dependencias

```
Tanda 0  (medir)
   └── Tanda A  (borrar producción)
          └── Tanda B  (retirar superficie de servidor)
                 └── Tanda C  (la cobertura ajena sobrevive)   ← 12 tasks, 10 en paralelo
                        └── Tanda D  (censos compartidos + la cita de la 172)
                               └── Tanda E  (guardia del estado final + mutaciones)
                                      └── Tanda F  (gate completo, evidencia, PR)
```

**Cuenta de archivos al cerrar:** 8 de producción borrados · 4 de producción editados · 2 de test
borrados · 14 de test/e2e editados · 1 guardia nueva · 1 `tasks.md` ajeno anotado.
