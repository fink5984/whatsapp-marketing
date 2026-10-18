import type { Role } from "@/generated/prisma/enums";

export const PERMISSIONS = [
  "contacts:read",
  "contacts:write",
  "contacts:export",
  "contacts:delete",
  "consents:write",
  "suppression:write",
  "suppression:lift",
  "audiences:write",
  "templates:read",
  "templates:write",
  "campaigns:read",
  "campaigns:write",
  "campaigns:launch",
  "inbox:read",
  "inbox:write",
  "reports:read",
  "accounts:read",
  "accounts:write",
  "automations:read",
  "automations:write",
  "apikeys:manage",
  "settings:read",
  "settings:write",
  "users:manage",
  "compliance:write",
  "audit:read",
  "org:owner",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = [
  "contacts:read",
  "templates:read",
  "campaigns:read",
  "inbox:read",
  "reports:read",
  "accounts:read",
  "automations:read",
  "settings:read",
];

const CAMPAIGN_MANAGER: Permission[] = [
  ...VIEWER,
  "contacts:write",
  "contacts:export",
  "consents:write",
  "suppression:write",
  "audiences:write",
  "templates:write",
  "campaigns:write",
  "campaigns:launch",
  "inbox:write",
];

const ADMIN: Permission[] = PERMISSIONS.filter((p) => p !== "org:owner");

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  VIEWER: new Set(VIEWER),
  CAMPAIGN_MANAGER: new Set(CAMPAIGN_MANAGER),
  ADMIN: new Set(ADMIN),
  OWNER: new Set(PERMISSIONS),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "בעלים",
  ADMIN: "מנהל מערכת",
  CAMPAIGN_MANAGER: "מנהל קמפיינים",
  VIEWER: "צופה",
};

/** API-key scopes (machine access, e.g. n8n). */
export const API_SCOPES = [
  "contacts:read",
  "contacts:write",
  "consents:read",
  "campaigns:read",
  "messages:read",
  "leads:write",
  "conversions:write",
  "suppressions:read",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  "contacts:read": "קריאת אנשי קשר",
  "contacts:write": "יצירה ועדכון אנשי קשר",
  "consents:read": "קריאת סטטוס הסכמה",
  "campaigns:read": "קריאת נתוני קמפיינים",
  "messages:read": "קריאת נתוני הודעות",
  "leads:write": "יצירה ועדכון לידים",
  "conversions:write": "דיווח המרות",
  "suppressions:read": "קריאת אירועי הסרה",
};

export class ForbiddenError extends Error {
  constructor(message = "אין לך הרשאה לבצע פעולה זו") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "הפריט לא נמצא") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Domain/validation error whose message is safe to show to the user. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}
