import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Entorno por defecto: node (tests de backend/repositorios/servicios).
    // Los tests de componente (React) declaran su propio entorno con la
    // directiva `// @vitest-environment jsdom` al inicio del archivo, para
    // no afectar los tests existentes que corren en node.
    environment: "node",
    globals: true,
    // Timeout por test/hook. El default de vitest (5000ms) provocaba flakiness
    // NO determinista bajo la carga de la suite completa: HomePage, HomePageRol,
    // OrdenesModuleReuse y a veces CierreDiaPage caian con "Test timed out in
    // 5000ms" por contencion de CPU en paralelo, pero pasaban en aislado. Un test
    // genuinamente colgado sigue fallando a los 20s; esto solo da holgura para la
    // contencion, para que `./init.sh` (que corre la suite) sea un gate confiable.
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup/jest-dom.ts"],
    environmentOptions: {
      jsdom: {
        // Necesario para que jsdom dispare la sumision implicita del
        // formulario (evento "submit") al hacer click en un boton
        // type="submit", comportamiento que jsdom solo activa en modo
        // "visual". No afecta a los tests que corren en entorno "node".
        pretendToBeVisual: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
