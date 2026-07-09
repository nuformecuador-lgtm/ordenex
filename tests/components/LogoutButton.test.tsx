// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogoutButton } from "@/app/_components/LogoutButton";
import { logout } from "@/lib/actions/auth";

vi.mock("@/lib/actions/auth", () => ({
  logout: vi.fn(),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const mockedLogout = vi.mocked(logout);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LogoutButton (R26)", () => {
  it("al hacer click invoca la Server Action logout y luego navega a /login", async () => {
    mockedLogout.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(mockedLogout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login"));
  });
});
