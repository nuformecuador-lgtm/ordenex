"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const handleLogout = () => {
    startTransition(async () => {
      try {
        await logout();
        // R26: after logout completes, redirect to /login
        router.push("/login");
      } catch (error) {
        // R10: el fallo NO simula éxito; feedback visible (toast, feature 11).
        console.error("Logout failed:", error);
        toast.error("No se pudo cerrar sesión");
      }
    });
  };

  return (
    <Button onClick={handleLogout} disabled={isPending} variant="outline">
      {isPending ? "Cerrando sesión..." : "Cerrar sesión"}
    </Button>
  );
}
