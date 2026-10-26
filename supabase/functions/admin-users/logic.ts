// imsi magazine — 계정 관리 함수의 순수 로직 (index.ts 가 사용). Node/Deno 어디서나 테스트할 수 있게 분리.

export const ROLES = ["admin", "editor"];
export const MIN_PASSWORD = 8;

type Body = Record<string, unknown>;
type Account = { user_id: string; role: string; active: boolean };

const str = (b: Body, k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");

// 요청 검사. 문제가 있으면 한국어 오류 문구.
export function validate(action: string, b: Body): string | null {
  switch (action) {
    case "list":
    case "status":
      return null;
    case "create": {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(b, "email"))) return "이메일 형식이 올바르지 않아요.";
      if (str(b, "password").length < MIN_PASSWORD) return `비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요.`;
      if (!str(b, "display_name")) return "이름을 입력해 주세요.";
      if (!ROLES.includes(str(b, "role"))) return "역할은 어드민 또는 에디터여야 해요.";
      return null;
    }
    case "update": {
      if (!str(b, "user_id")) return "대상 계정이 없어요.";
      if ("role" in b && !ROLES.includes(str(b, "role"))) return "역할은 어드민 또는 에디터여야 해요.";
      if ("active" in b && typeof b.active !== "boolean") return "사용 여부 값이 올바르지 않아요.";
      if ("display_name" in b && !str(b, "display_name")) return "이름을 비울 수 없어요.";
      return null;
    }
    case "reset_password":
      if (!str(b, "user_id")) return "대상 계정이 없어요.";
      if (str(b, "password").length < MIN_PASSWORD) return `비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요.`;
      return null;
    case "delete":
      if (!str(b, "user_id")) return "대상 계정이 없어요.";
      if (!str(b, "transfer_to")) return "글을 넘겨받을 계정을 골라 주세요.";
      if (str(b, "transfer_to") === str(b, "user_id")) return "지우는 계정에게는 글을 넘길 수 없어요.";
      return null;
    default:
      return "알 수 없는 요청이에요.";
  }
}

// 사용 중인 어드민이 한 명도 안 남게 되는 변경은 막는다.
export function leavesNoAdmin(accounts: Account[], userId: string, change: { role?: string; active?: boolean; remove?: boolean }): boolean {
  const after = accounts
    .filter((a) => !(change.remove && a.user_id === userId))
    .map((a) => (a.user_id === userId ? { ...a, role: change.role ?? a.role, active: change.active ?? a.active } : a));
  return !after.some((a) => a.role === "admin" && a.active);
}
