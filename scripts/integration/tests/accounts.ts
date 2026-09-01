import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyPassword } from "@/lib/passwords";
import { provisionTrialClient, replaceWithTemporaryPassword } from "@/server/accountProvisioning";
import { consumeAuthToken, inspectAuthToken, issueAuthToken } from "@/lib/authTokenStore";
import { assert, makeUser, prisma, suiteHeader, test } from "../harness";

export default async function accountsSuite() {
  suiteHeader("accounts — создание кабинета и временные пароли");

  await test("админское создание даёт владельца организации на бессрочном пробном тарифе", async () => {
    const user = await provisionTrialClient({
      email: "owner@example.test",
      name: "Иван",
      companyName: "Тестовая компания",
      initialPassword: "Initial-Password9!",
    });
    assert.equal(user.plan, "TRIAL");
    assert.equal(user.isDemo, false);
    assert.equal(user.mustChangePassword, false);
    assert.equal(user.organizationRole, "ORG_ADMIN");
    assert.equal(user.ownedOrganization?.name, "Тестовая компания");
    assert.equal(user.organizationId, user.ownedOrganization?.id);
    assert.equal(user.demoUsedAt, null);
    assert.equal(user.planExpiresAt, null);
    const profile = await prisma.organizationProfile.findUniqueOrThrow({ where: { organizationId: user.organizationId! } });
    assert.ok(profile.manualData);
    assert.ok(profile.draftData);
    assert.equal(profile.publishedData, null);
    assert.equal(await prisma.demoWorkspace.count({ where: { organizationId: user.organizationId! } }), 0);
    assert.equal(await verifyPassword("Initial-Password9!", user.passwordHash), true);
  });

  await test("кабинет без email получает короткий логин и одноразовую ссылку", async () => {
    const user = await provisionTrialClient({
      email: null,
      name: "Анна Смирнова",
      companyName: "Компания без почты",
      initialPassword: "Initial-Password9!",
    });
    assert.equal(user.emailPending, true);
    assert.match(user.login ?? "", /^anna-smirnova-[a-f0-9]{5}$/);
    assert.equal(user.email, `${user.login}@pending.smailee.invalid`);

    const rawToken = await issueAuthToken(user.id, "INITIAL_ACCESS");
    assert.equal((await inspectAuthToken(rawToken))?.userId, user.id);
    assert.equal((await consumeAuthToken(rawToken))?.userId, user.id);
    assert.equal(await consumeAuthToken(rawToken), null);
  });

  await test("миграция demo Standard переводит аккаунт в Trial и сохраняет прогрев ящика", async () => {
    const user = await provisionTrialClient({
      email: "demo-standard-migration@example.test",
      name: "Клиент на демо",
      companyName: "Компания на демо",
      initialPassword: "Initial-Password9!",
    });
    const organizationId = user.organizationId!;
    const demoEndsAt = new Date("2026-09-10T12:00:00.000Z");
    const warmupStartedAt = new Date("2026-08-20T09:00:00.000Z");

    await prisma.user.update({
      where: { id: user.id },
      data: {
        plan: "START",
        planExpiresAt: demoEndsAt,
        isDemo: true,
        demoUsedAt: new Date("2026-08-27T12:00:00.000Z"),
      },
    });
    await prisma.demoWorkspace.create({
      data: { organizationId, status: "ACTIVE" },
    });
    const domain = await prisma.domainGroup.create({
      data: { userId: user.id, domain: "demo-standard-migration.test" },
    });
    const mailbox = await prisma.mailbox.create({
      data: {
        userId: user.id,
        email: "sender@demo-standard-migration.test",
        senderName: "Клиент на демо",
        smtpHost: "smtp.demo-standard-migration.test",
        smtpPort: 465,
        smtpLogin: "sender@demo-standard-migration.test",
        imapHost: "imap.demo-standard-migration.test",
        imapPort: 993,
        imapLogin: "sender@demo-standard-migration.test",
        smtpPasswordEnc: "encrypted",
        imapPasswordEnc: "encrypted",
        domainGroupId: domain.id,
        connState: "ok",
        warmupState: "warming",
        warmupDay: 8,
        warmupStartedAt,
        warmupSentToday: 4,
      },
    });

    const migrationSql = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/20260821121000_convert_demo_users_to_trial/migration.sql",
      ),
      "utf8",
    );
    await prisma.$executeRawUnsafe(migrationSql);

    assert.deepEqual(
      await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { plan: true, planExpiresAt: true, isDemo: true, demoUsedAt: true },
      }),
      { plan: "TRIAL", planExpiresAt: null, isDemo: false, demoUsedAt: null },
    );
    assert.equal(
      (await prisma.demoWorkspace.findUniqueOrThrow({ where: { organizationId } })).status,
      "DISABLED",
    );
    assert.deepEqual(
      await prisma.mailbox.findUniqueOrThrow({
        where: { id: mailbox.id },
        select: {
          warmupState: true,
          warmupDay: true,
          warmupStartedAt: true,
          warmupSentToday: true,
          connState: true,
        },
      }),
      {
        warmupState: "warming",
        warmupDay: 8,
        warmupStartedAt,
        warmupSentToday: 4,
        connState: "ok",
      },
    );
  });

  await test("новый временный пароль заменяет старый и отзывает ссылки", async () => {
    const user = await makeUser({ passwordHash: "$2b$10$wL7FDsMI3yeY71lpqDPC1e.LxXJxsOyiFN3cBC8fVsgU4M2MMKkC6" });
    await prisma.authToken.create({
      data: {
        userId: user.id,
        type: "PASSWORD_RESET",
        tokenHash: "integration-reset-token",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    assert.equal(await replaceWithTemporaryPassword(user.id, "Fresh-Password8!"), true);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(updated.mustChangePassword, true);
    assert.equal(await verifyPassword("Fresh-Password8!", updated.passwordHash), true);
    assert.equal(await prisma.authToken.count({ where: { userId: user.id, usedAt: null } }), 0);
  });

  await test("пароль служебного администратора нельзя заменить клиентской функцией", async () => {
    const admin = await makeUser({ role: "ADMIN", passwordHash: "unchanged" });
    assert.equal(await replaceWithTemporaryPassword(admin.id, "Fresh-Password8!"), false);
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    assert.equal(unchanged.passwordHash, "unchanged");
    assert.equal(unchanged.mustChangePassword, false);
  });
}
