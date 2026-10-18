"use server";

import { z } from "zod";
import { defineAction } from "@/server/auth/action";
import { createContact, deleteContact, updateContact, bulkTagContacts, createTag, deleteTag } from "@/server/services/contacts";
import { grantConsent, revokeConsent } from "@/server/services/consents";
import { addManualSuppression, resubscribeWithNewConsent } from "@/server/services/suppression";
import { addContactsToAudience, removeContactsFromAudience } from "@/server/services/audiences";
import { importContactRows, parseSpreadsheet, guessMapping } from "@/server/services/imports";
import { db } from "@/server/db";
import { UserError } from "@/server/rbac";
import { saveSheetSource, syncSheetSource } from "@/server/services/sheets";
import { BULK_CONSENT_SOURCES, type ConsentSourceCode } from "@/lib/consent";

const consentSources = ["WEB_FORM", "EXISTING_CUSTOMER", "PAPER_FORM", "VERBAL_RECORDED", "INBOUND_MESSAGE", "OTHER_DOCUMENTED", "API", "MANUAL_WITH_PROOF"] as const;

export const createContactAction = defineAction(
  "contacts:write",
  z.object({ phone: z.string().min(3).max(40), name: z.string().max(200).optional(), source: z.string().max(100).optional(), notes: z.string().max(2000).optional(), tagIds: z.array(z.string()).optional() }),
  async (ctx, input) => (await createContact(ctx, input)).id,
);

export const updateContactAction = defineAction(
  "contacts:write",
  z.object({ id: z.string(), name: z.string().max(200).nullable().optional(), source: z.string().max(100).nullable().optional(), notes: z.string().max(2000).nullable().optional(), tagIds: z.array(z.string()).optional() }),
  async (ctx, { id, ...input }) => {
    await updateContact(ctx, id, input);
  },
);

export const deleteContactAction = defineAction(
  "contacts:delete",
  z.object({ id: z.string(), keepDoNotContact: z.boolean() }),
  async (ctx, input) => {
    await deleteContact(ctx, input.id, { keepDoNotContact: input.keepDoNotContact });
  },
);

export const grantConsentAction = defineAction(
  "consents:write",
  z.object({
    contactId: z.string(),
    source: z.enum(consentSources),
    proofText: z.string().trim().max(2000).default(""),
    proofReference: z.string().max(500).optional(),
    capturedAt: z.coerce.date(),
  }),
  async (ctx, input) => {
    await grantConsent(ctx, input);
  },
);

export const revokeConsentAction = defineAction("consents:write", z.object({ contactId: z.string(), reason: z.string().max(500) }), async (ctx, input) => {
  await revokeConsent(ctx, input.contactId, input.reason);
});

export const suppressContactAction = defineAction("suppression:write", z.object({ contactId: z.string(), detail: z.string().max(500) }), async (ctx, input) => {
  const c = await db.contact.findFirst({ where: { id: input.contactId, organizationId: ctx.orgId } });
  if (!c) throw new UserError("איש הקשר לא נמצא");
  await addManualSuppression(ctx, c.phoneE164, input.detail || "הסרה ידנית לבקשת הנמען");
});

export const resubscribeAction = defineAction(
  "suppression:lift",
  z.object({
    contactId: z.string(),
    source: z.enum(["WEB_FORM", "PAPER_FORM", "VERBAL_RECORDED", "INBOUND_MESSAGE"]),
    proofText: z.string().trim().min(15, "יש לתעד את ההסכמה החדשה בפירוט").max(2000),
    proofReference: z.string().max(500).optional(),
    capturedAt: z.coerce.date(),
  }),
  async (ctx, input) => {
    await resubscribeWithNewConsent(ctx, input);
  },
);

export const bulkContactsAction = defineAction(
  "contacts:write",
  z.object({ ids: z.array(z.string()).min(1).max(1000), op: z.enum(["tag_add", "tag_remove", "audience_add", "audience_remove"]), targetId: z.string() }),
  async (ctx, input) => {
    switch (input.op) {
      case "tag_add":
        return bulkTagContacts(ctx, input.ids, input.targetId, "add");
      case "tag_remove":
        return bulkTagContacts(ctx, input.ids, input.targetId, "remove");
      case "audience_add":
        return addContactsToAudience(ctx, input.targetId, input.ids);
      case "audience_remove":
        await removeContactsFromAudience(ctx, input.targetId, input.ids);
        return input.ids.length;
    }
  },
);

export const createTagAction = defineAction("audiences:write", z.object({ name: z.string().trim().min(1).max(50), color: z.string().max(20).optional() }), async (ctx, input) => (await createTag(ctx, input.name, input.color)).id);
export const deleteTagAction = defineAction("audiences:write", z.object({ id: z.string() }), async (ctx, input) => deleteTag(ctx, input.id));

const MAX_FILE = 15 * 1024 * 1024;

function fileFrom(form: FormData): File {
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) throw new UserError("לא נבחר קובץ");
  if (f.size > MAX_FILE) throw new UserError("הקובץ גדול מ-15MB");
  return f;
}

export const previewImportAction = defineAction("contacts:write", z.instanceof(FormData), async (_ctx, form) => {
  const file = fileFrom(form);
  const { headers, rows } = await parseSpreadsheet(file.name, await file.arrayBuffer());
  if (headers.length === 0) throw new UserError("לא נמצאה שורת כותרות בקובץ");
  return { headers, sample: rows.slice(0, 5), total: rows.length, guess: guessMapping(headers) };
});

const mappingSchema = z.object({
  phone: z.string().min(1, "יש לבחור עמודת טלפון"),
  name: z.string().optional(),
  notes: z.string().optional(),
  source: z.string().optional(),
  tags: z.string().optional(),
  consentProof: z.string().optional(),
  consentDate: z.string().optional(),
});
const optionsSchema = z.object({
  source: z.string().trim().min(1).max(100),
  tagNames: z.array(z.string().max(50)).max(20).default([]),
  audienceId: z.string().nullable().optional(),
  consent: z.object({ enabled: z.boolean(), source: z.enum(BULK_CONSENT_SOURCES as unknown as [ConsentSourceCode, ...ConsentSourceCode[]]), note: z.string().max(1000).optional() }).nullable().optional(),
});

export const runImportAction = defineAction("contacts:write", z.instanceof(FormData), async (ctx, form) => {
  const file = fileFrom(form);
  const mapping = mappingSchema.parse(JSON.parse(String(form.get("mapping") ?? "{}")));
  const options = optionsSchema.parse(JSON.parse(String(form.get("options") ?? "{}")));
  const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v && v !== "__none")) as z.infer<typeof mappingSchema>;
  const { rows } = await parseSpreadsheet(file.name, await file.arrayBuffer());
  const kind = file.name.toLowerCase().endsWith(".xlsx") ? "excel" : "csv";
  return importContactRows(ctx, rows, clean, options, { kind, fileName: file.name });
});

// ─── Google Sheets ───

export const saveSheetSourceAction = defineAction(
  "contacts:write",
  z.object({
    name: z.string().trim().min(1).max(100),
    spreadsheet: z.string().trim().min(10).max(300),
    range: z.string().trim().max(100),
    phoneColumn: z.string().trim().min(1, "יש לציין את כותרת עמודת הטלפון"),
    nameColumn: z.string().trim().max(100).optional(),
    tags: z.string().max(300).optional(),
    audienceId: z.string().nullable().optional(),
    syncIntervalMin: z.number().int().min(0).max(10080).nullable().optional(),
  }),
  async (ctx, input) =>
    saveSheetSource(ctx, {
      name: input.name,
      spreadsheet: input.spreadsheet,
      range: input.range,
      columnMap: { phone: input.phoneColumn, ...(input.nameColumn ? { name: input.nameColumn } : {}) },
      defaultTags: (input.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      audienceId: input.audienceId,
      syncIntervalMin: input.syncIntervalMin,
    }),
);

export const syncSheetSourceAction = defineAction("contacts:write", z.object({ id: z.string() }), async (ctx, input) => (await syncSheetSource(ctx, input.id)).stats);

export const deleteSheetSourceAction = defineAction("contacts:write", z.object({ id: z.string() }), async (ctx, input) => {
  await db.googleSheetSource.deleteMany({ where: { id: input.id, organizationId: ctx.orgId } });
});
