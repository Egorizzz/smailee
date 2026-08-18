"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { hasEncKey } from "@/lib/crypto";
import { provisionMailbox } from "@/server/mailboxProvisioning";
import type { MailProvider } from "@prisma/client";
import { isDemoWorkspaceActive } from "@/lib/demoWorkspace";

// Ручное добавление одного ящика.
export async function connectMailbox(formData: FormData): Promise<{ ok?: string; error?: string }> {
  const workspace = await requireCapability("INFRASTRUCTURE_MANAGE");
  if (await isDemoWorkspaceActive(workspace.organizationId)) return { error: "Рабочая инфраструктура недоступна для изменения в демо-режиме" };
  const user = workspace.owner;
  if (!hasEncKey()) {
    return { error: "Не задан MAILBOX_ENC_KEY в .env — без него доступы к ящикам не шифруются. Сгенерируйте: openssl rand -hex 32" };
  }

  const provider = (String(formData.get("provider") || "yandex") as MailProvider);
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const senderName = String(formData.get("senderName") || "").trim();
  const appPassword = String(formData.get("appPassword") || "");
  const confirmedWarm = formData.get("confirmedWarm") === "on";

  if (!email.includes("@") || !senderName || !appPassword) {
    return { error: "Укажите имя отправителя, email и пароль приложения" };
  }

  const err = await provisionMailbox({
    userId: user.id,
    email,
    senderName,
    provider,
    appPassword,
    mode: "customer",
    alreadyWarm: confirmedWarm,
  });
  revalidatePath("/app/mailboxes");
  if (err) return { error: err };
  return {
    ok: confirmedWarm
      ? `Ящик ${email} подключён и отмечен как прогретый`
      : `Ящик ${email} подключён`,
  };
}

export async function deleteMailbox(formData: FormData) {
  const workspace = await requireCapability("INFRASTRUCTURE_MANAGE");
  if (await isDemoWorkspaceActive(workspace.organizationId)) return;
  const user = workspace.owner;
  const id = String(formData.get("id"));
  await prisma.mailbox.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/app/mailboxes");
}

// Ручная пауза (§5.8) — то же состояние, что и авто-пауза мониторингом
// здоровья (computeFleetHealth), поэтому ящик так же выпадает из ротации
// отправки/приёма/прогрева (connState=disabled ни в одном allow-list M2–M4).
export async function pauseMailbox(formData: FormData) {
  const workspace = await requireCapability("INFRASTRUCTURE_MANAGE");
  if (await isDemoWorkspaceActive(workspace.organizationId)) return;
  const user = workspace.owner;
  const id = String(formData.get("id"));
  await prisma.mailbox.updateMany({
    where: { id, userId: user.id },
    data: {
      connState: "disabled",
      pausedReason: "Приостановлено оператором вручную",
      pauseKind: "MANUAL",
      nextReconnectAt: null,
      reconnectAttempts: 0,
    },
  });
  revalidatePath("/app/mailboxes");
}

// Возобновить: возврат в "paused" — как только что подключённый ящик, снова
// допущен к ротации, но должен сам подтвердить себя рабочей отправкой/
// поллингом (не сразу "ok"). healthScore сбрасывается — честный новый отсчёт.
export async function resumeMailbox(formData: FormData) {
  const workspace = await requireCapability("INFRASTRUCTURE_MANAGE");
  if (await isDemoWorkspaceActive(workspace.organizationId)) return;
  const user = workspace.owner;
  const id = String(formData.get("id"));
  await prisma.mailbox.updateMany({
    where: { id, userId: user.id },
    data: {
      connState: "paused",
      pausedReason: null,
      pauseKind: null,
      connError: null,
      connectionIncidentAt: null,
      reconnectAttempts: 0,
      nextReconnectAt: null,
      healthScore: 100,
    },
  });
  revalidatePath("/app/mailboxes");
}
