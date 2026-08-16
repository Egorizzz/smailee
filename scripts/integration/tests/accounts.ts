import { verifyPassword } from "@/lib/passwords";
import { DEMO_DURATION_DAYS } from "@/server/billing";
import { provisionDemoClient, replaceWithTemporaryPassword } from "@/server/accountProvisioning";
import { assert, makeUser, prisma, suiteHeader, test } from "../harness";

export default async function accountsSuite() {
  suiteHeader("accounts — создание кабинета и временные пароли");

  await test("админское создание даёт владельца организации и демо тарифа «Стандартный» на 14 дней", async () => {
    const before = Date.now();
    const user = await provisionDemoClient({
      email: "owner@example.test",
      name: "Иван",
      companyName: "Тестовая компания",
      initialPassword: "Initial-Password9!",
    });
    const after = Date.now();

    assert.equal(user.plan, "START");
    assert.equal(user.isDemo, true);
    assert.equal(user.mustChangePassword, false);
    assert.equal(user.organizationRole, "ORG_ADMIN");
    assert.equal(user.ownedOrganization?.name, "Тестовая компания");
    assert.equal(user.organizationId, user.ownedOrganization?.id);
    assert.ok(user.demoUsedAt);
    assert.ok(user.planExpiresAt);
    const profile = await prisma.organizationProfile.findUniqueOrThrow({ where: { organizationId: user.organizationId! } });
    assert.ok(profile.manualData);
    assert.ok(profile.draftData);
    assert.equal(profile.publishedData, null);
    const expected = DEMO_DURATION_DAYS * 86_400_000;
    assert.ok(user.planExpiresAt!.getTime() >= before + expected);
    assert.ok(user.planExpiresAt!.getTime() <= after + expected);
    assert.equal(await verifyPassword("Initial-Password9!", user.passwordHash), true);
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
