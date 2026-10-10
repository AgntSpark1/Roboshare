// Usage: node dist/scripts/enroll-staff.js <wallet> <ROLE[,ROLE...]>
// Creates or updates a staff account and prints a new authenticator enrolment URI once.
// Run it in a trusted shell; the printed secret is not stored anywhere in clear.
import { PrismaClient } from "@roboshare/db";
import { getAddress, isAddress } from "viem";
import { encryptSecret, newTotpSecret } from "../common/totp.js";

const ROLES = new Set(["OPERATOR", "REVIEWER", "COMPLIANCE", "GOV_VIEW"]);
const [wallet, rolesArg] = process.argv.slice(2);
const key = process.env.TOTP_ENC_KEY;
if (!wallet || !isAddress(wallet) || !rolesArg) throw new Error("usage: enroll-staff <wallet> <ROLE[,ROLE...]>");
if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) throw new Error("TOTP_ENC_KEY (32-byte hex) is required");
const roles = rolesArg.split(",");
for (const r of roles) if (!ROLES.has(r)) throw new Error(`unknown role ${r}`);

const prisma = new PrismaClient();
const address = wallet.toLowerCase();
const w =
  (await prisma.wallet.findUnique({ where: { address } })) ??
  (await prisma.wallet.create({ data: { address, user: { create: {} } } }));
const secret = newTotpSecret();
await prisma.staffAccount.upsert({
  where: { userId: w.userId },
  create: { userId: w.userId, roles, totpSecretEnc: encryptSecret(secret, key) },
  update: { roles, totpSecretEnc: encryptSecret(secret, key), disabledAt: null },
});
await prisma.$disconnect();
console.log(`Staff ${getAddress(wallet)} roles=${roles.join(",")}`);
console.log("Add to an authenticator app, then clear this terminal:");
console.log(`otpauth://totp/RoboShare:${getAddress(wallet)}?secret=${secret}&issuer=RoboShare&digits=6&period=30`);
console.log("Admin routes also require the matching on-chain role for this wallet.");
