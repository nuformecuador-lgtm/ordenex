export interface LoginCommandInput {
  email: string;
  password: string;
  ipAddress: string;
  userAgent: string;
}

export type LoginCommandResult =
  | { status: "ok"; sessionId: string; expiresAt: Date }
  | { status: "challenge_required"; challengeId: string }
  | { status: "invalid_credentials" }
  | { status: "account_unavailable" }
  | { status: "account_locked"; retryAfterMinutes: number };

export interface VerifyChallengeCommandInput {
  challengeId: string;
  code: string;
  ipAddress: string;
  userAgent: string;
}

export type VerifyChallengeCommandResult =
  | { status: "ok"; sessionId: string; expiresAt: Date }
  | { status: "invalid_or_expired" };

export interface IAuthService {
  login(input: LoginCommandInput): Promise<LoginCommandResult>;
  verifyChallenge(input: VerifyChallengeCommandInput): Promise<VerifyChallengeCommandResult>;
  logout(sessionId: string): Promise<void>;
}
