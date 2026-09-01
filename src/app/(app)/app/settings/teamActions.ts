"use server";

import crypto from "node:crypto";
import type { OrganizationPermission, OrganizationRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { issueAuthToken } from "@/lib/authTokens";
import { sendSystemMail } from "@/lib/systemMail";
import { config } from "@/lib/config";
import { requireOrganizationAdmin } from "@/lib/organization";
import { ORGANIZATION_PERMISSIONS } from "@/lib/organizationPermissions";

const permissions = new Set<OrganizationPermission>(ORGANIZATION_PERMISSIONS);

type TeamState = { ok?: string; error?: string } | undefined;

function readPermissions(formData: FormData) {
  return formData.getAll("permissions").map(String).filter((value): value is OrganizationPermission => permissions.has(value as OrganizationPermission));
}

function inviteUrl(token: string) {
  return `${config.appUrl.replace(/\/$/, "")}/access?token=${encodeURIComponent(token)}`;
}

async function sendInvite(email: string, organizationName: string, token: string) {
  const url = inviteUrl(token);
  return sendSystemMail({
    to: email,
    subject: `Приглашение в команду ${organizationName} в Smailee`,
    text: `Вас пригласили в команду «${organizationName}» в Smailee. Войдите по одноразовой ссылке (она действует 24 часа): ${url}`,
    html: `<p>Вас пригласили в команду <b>${organizationName}</b> в Smailee.</p><p><a href="${url}">Войти в Smailee</a></p><p>Ссылка действует 24 часа.</p>`,
  });
}

export async function inviteMemberAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const workspace = await requireOrganizationAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = String(formData.get("role") || "MEMBER") as OrganizationRole;
  const memberRole = role === "ORG_ADMIN" ? "ORG_ADMIN" : "MEMBER";
  const memberPermissions = readPermissions(formData);
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Введите корректный email." };
  if (email === workspace.owner.email.toLowerCase()) return { error: "Владелец организации уже состоит в команде." };

  let member = await prisma.user.findUnique({ where: { email } });
  if (member && member.organizationId && member.organizationId !== workspace.organizationId) {
    return { error: "Этот email уже состоит в другой организации." };
  }
  if (!member) {
    member = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(crypto.randomBytes(32).toString("base64url")),
        passwordEnabled: false,
        organizationId: workspace.organizationId!,
        organizationRole: memberRole,
        organizationPermissions: memberPermissions,
      },
    });
  } else {
    member = await prisma.user.update({
      where: { id: member.id },
      data: { organizationId: workspace.organizationId, organizationRole: memberRole, organizationPermissions: memberPermissions },
    });
  }

  const token = await issueAuthToken(member.id, "INVITE", 24 * 60 * 60 * 1000, { verifiesEmail: true });
  const sent = await sendInvite(member.email, workspace.organizationName, token);
  revalidatePath("/app/settings");
  return sent.ok
    ? { ok: `Приглашение отправлено на ${member.email}.` }
    : { ok: `Сотрудник добавлен. Настройте SYSTEM_SMTP, затем отправьте приглашение повторно.` };
}

export async function updateMemberAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const workspace = await requireOrganizationAdmin();
  const id = String(formData.get("memberId") || "");
  const role = String(formData.get("role") || "MEMBER") === "ORG_ADMIN" ? "ORG_ADMIN" : "MEMBER";
  const member = await prisma.user.findFirst({ where: { id, organizationId: workspace.organizationId } });
  if (!member || member.id === workspace.owner.id) return { error: "Нельзя изменить владельца организации." };
  await prisma.user.update({
    where: { id },
    data: { organizationRole: role, organizationPermissions: role === "ORG_ADMIN" ? [] : readPermissions(formData) },
  });
  revalidatePath("/app/settings");
  return { ok: "Доступы сотрудника сохранены." };
}

export async function resendInviteAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const workspace = await requireOrganizationAdmin();
  const id = String(formData.get("memberId") || "");
  const member = await prisma.user.findFirst({ where: { id, organizationId: workspace.organizationId } });
  if (!member) return { error: "Сотрудник не найден." };
  const token = await issueAuthToken(member.id, "INVITE", 24 * 60 * 60 * 1000, { verifiesEmail: true });
  const sent = await sendInvite(member.email, workspace.organizationName, token);
  return sent.ok ? { ok: "Новая ссылка отправлена." } : { error: "SYSTEM_SMTP не настроен: письмо не отправлено." };
}

export async function removeMemberAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const workspace = await requireOrganizationAdmin();
  const id = String(formData.get("memberId") || "");
  if (id === workspace.owner.id) return { error: "Нельзя удалить владельца организации." };
  const member = await prisma.user.findFirst({ where: { id, organizationId: workspace.organizationId } });
  if (!member) return { error: "Сотрудник не найден." };
  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { userId: member.id } }),
    prisma.user.update({ where: { id: member.id }, data: { organizationId: null, organizationRole: "MEMBER", organizationPermissions: [] } }),
  ]);
  revalidatePath("/app/settings");
  return { ok: "Доступ сотрудника к организации отозван." };
}
