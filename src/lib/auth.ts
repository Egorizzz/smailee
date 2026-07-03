import "server-only";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";

const COOKIE_NAME = "smailee_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 дней

// Ленивая проверка секрета: в проде отсутствие JWT_SECRET — ошибка,
// но только в РАНТАЙМЕ (не при сборке, где env ещё может быть не задан).
function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (s && s !== "dev-insecure-secret-change-me") return s;
  if (process.env.NODE_ENV === "production" && !process.env.NEXT_PHASE) {
    throw new Error(
      "JWT_SECRET не задан. Задайте длинную случайную строку в переменных окружения."
    );
  }
  return "dev-insecure-secret-change-me";
}

export type SessionPayload = { userId: string; email: string };

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: SessionPayload) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: MAX_AGE });
}

export function verifyToken(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as SessionPayload;
  } catch {
    return null;
  }
}

// Устанавливает сессионную cookie (вызывать в Route Handler / Server Action)
export async function createSession(payload: SessionPayload) {
  const token = signToken(payload);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// Возвращает текущего пользователя или null
export async function getCurrentUser() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
  });
  return user;
}

// Требует авторизации: возвращает пользователя или редиректит на /login.
// Использовать в каждой защищённой странице (layout и page рендерятся
// параллельно, поэтому одной проверки в layout недостаточно).
export async function requireUser(): Promise<NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

// Требует роль ADMIN: иначе редирект в обычный кабинет.
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    redirect("/app");
  }
  return user;
}
