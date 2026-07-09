import type { PrismaClient } from "@prisma/client";
import type {
  CreateEmailOtpChallengeInput,
  EmailOtpChallengeRecord,
  IEmailOtpChallengeRepository,
} from "@/lib/interfaces/repositories/IEmailOtpChallengeRepository";

type EmailOtpChallengePrismaClient = Pick<PrismaClient, "emailOtpChallenge">;

export class EmailOtpChallengeRepository implements IEmailOtpChallengeRepository {
  constructor(private readonly prisma: EmailOtpChallengePrismaClient) {}

  async create(input: CreateEmailOtpChallengeInput): Promise<EmailOtpChallengeRecord> {
    return this.prisma.emailOtpChallenge.create({ data: input });
  }

  async findActiveById(id: string): Promise<EmailOtpChallengeRecord | null> {
    const challenge = await this.prisma.emailOtpChallenge.findUnique({ where: { id } });
    if (!challenge) return null;
    if (challenge.consumedAt !== null) return null;
    if (challenge.expiresAt.getTime() <= Date.now()) return null;
    return challenge;
  }

  async markConsumed(id: string): Promise<void> {
    await this.prisma.emailOtpChallenge.update({
      where: { id },
      data: { consumedAt: new Date() },
    });
  }
}
