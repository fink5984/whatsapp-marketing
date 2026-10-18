-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'CAMPAIGN_MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING_SETUP', 'CONNECTED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ConnectionMethod" AS ENUM ('MANUAL', 'EMBEDDED_SIGNUP');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('UNKNOWN', 'GRANTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('WEB_FORM', 'PAPER_FORM', 'VERBAL_RECORDED', 'INBOUND_MESSAGE', 'IMPORT_WITH_PROOF', 'API', 'MANUAL_WITH_PROOF');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('KEYWORD_REPLY', 'QUICK_REPLY_BUTTON', 'MANUAL_REQUEST', 'META_USER_STOPPED_MARKETING', 'COMPLAINT', 'DATA_DELETION', 'API');

-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('MARKETING', 'UTILITY', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'ARCHIVED', 'DELETED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecipientEligibility" AS ENUM ('ELIGIBLE', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "OutboundKind" AS ENUM ('CAMPAIGN', 'TEST', 'SERVICE_REPLY', 'UNSUBSCRIBE_CONFIRMATION');

-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('QUEUED', 'SENDING', 'SUBMITTED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'CANCELLED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'HANDLED', 'INTERESTED', 'NOT_INTERESTED', 'NEEDS_AGENT');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ComplianceCheckStatus" AS ENUM ('NOT_STARTED', 'PASSED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "industry" TEXT,
    "planId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeOrgId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "displayName" TEXT,
    "legalName" TEXT,
    "businessIdNumber" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "websiteUrl" TEXT,
    "privacyPolicyUrl" TEXT,
    "logoUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "locale" TEXT NOT NULL DEFAULT 'he',
    "defaultCountry" TEXT NOT NULL DEFAULT 'IL',
    "defaultWhatsappAccountId" TEXT,
    "sendingWindow" JSONB NOT NULL,
    "safetyRollingCap" INTEGER NOT NULL DEFAULT 250,
    "defaultMessagesPerSecond" INTEGER NOT NULL DEFAULT 5,
    "unsubscribeFooterText" TEXT NOT NULL DEFAULT 'להסרה מרשימת התפוצה, השיבו הסר',
    "unsubscribeKeywords" TEXT[],
    "sendUnsubscribeConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "unsubscribeConfirmationText" TEXT NOT NULL DEFAULT 'הבקשה התקבלה. הוסרתם מרשימת התפוצה ולא תקבלו מאיתנו הודעות שיווקיות נוספות.',
    "requireAdvertisingLabel" BOOLEAN NOT NULL DEFAULT true,
    "perContactClickTracking" BOOLEAN NOT NULL DEFAULT true,
    "allowedRedirectDomains" TEXT[],
    "testRecipients" TEXT[],
    "costRates" JSONB NOT NULL DEFAULT '{}',
    "costCurrency" TEXT NOT NULL DEFAULT 'USD',
    "retentionInboundDays" INTEGER NOT NULL DEFAULT 730,
    "retentionClicksDays" INTEGER NOT NULL DEFAULT 365,
    "retentionWebhookRawDays" INTEGER NOT NULL DEFAULT 30,
    "retentionAuditDays" INTEGER NOT NULL DEFAULT 1095,
    "alertEmails" TEXT[],
    "alertOnQualityDrop" BOOLEAN NOT NULL DEFAULT true,
    "alertOnSendErrors" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_checks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "status" "ComplianceCheckStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "evidence" TEXT,
    "reviewerName" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "metaAppId" TEXT,
    "connectionMethod" "ConnectionMethod" NOT NULL DEFAULT 'MANUAL',
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "statusMessage" TEXT,
    "accessTokenEnc" TEXT,
    "appSecretEnc" TEXT,
    "webhookVerifyTokenEnc" TEXT,
    "webhookKey" TEXT NOT NULL,
    "webhookSubscribedAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "templateNamespace" TEXT,
    "currency" TEXT,
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastTemplateSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_phone_numbers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT,
    "verifiedName" TEXT,
    "qualityRating" TEXT,
    "messagingLimitTier" TEXT,
    "throughputLevel" TEXT,
    "nameStatus" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "messagesPerSecond" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "sendLeaseOwner" TEXT,
    "sendLeaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "name" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "consentStatus" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "consentUpdatedAt" TIMESTAMP(3),
    "isSuppressed" BOOLEAN NOT NULL DEFAULT false,
    "lastSentAt" TIMESTAMP(3),
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "lastInboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_consents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "purpose" TEXT NOT NULL DEFAULT 'MARKETING',
    "businessName" TEXT NOT NULL,
    "proofText" TEXT NOT NULL,
    "proofReference" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT,
    "recordedVia" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tags" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateTable
CREATE TABLE "audiences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'STATIC',
    "filter" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audience_members" (
    "audienceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audience_members_pkey" PRIMARY KEY ("audienceId","contactId")
);

-- CreateTable
CREATE TABLE "suppression_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "phoneE164" TEXT,
    "contactId" TEXT,
    "reason" "SuppressionReason" NOT NULL,
    "detail" TEXT,
    "sourceMessageId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),
    "liftedConsentId" TEXT,
    "liftedById" TEXT,

    CONSTRAINT "suppression_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_imports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fileName" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "invalid" INTEGER NOT NULL DEFAULT 0,
    "suppressedKept" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "contact_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_sheet_sources" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "range" TEXT NOT NULL,
    "columnMap" JSONB NOT NULL,
    "defaultTags" TEXT[],
    "audienceId" TEXT,
    "syncIntervalMin" INTEGER,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_sheet_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "metaTemplateId" TEXT,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" "TemplateCategory" NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectedReason" TEXT,
    "qualityScore" TEXT,
    "components" JSONB NOT NULL,
    "hasUnsubscribeFooter" BOOLEAN NOT NULL DEFAULT false,
    "hasUnsubscribeButton" BOOLEAN NOT NULL DEFAULT false,
    "hasAdvertisingLabel" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[],
    "accountId" TEXT,
    "phoneNumberId" TEXT,
    "templateId" TEXT,
    "audienceFilter" JSONB NOT NULL DEFAULT '{}',
    "variableMapping" JSONB NOT NULL DEFAULT '{}',
    "headerMediaUrl" TEXT,
    "trackedLinkId" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "maxRecipients" INTEGER,
    "messagesPerSecond" INTEGER,
    "respectSendingWindow" BOOLEAN NOT NULL DEFAULT true,
    "estimatedCost" DECIMAL(12,4),
    "costCurrency" TEXT,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "launchedAt" TIMESTAMP(3),
    "launchedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "pausedReason" TEXT,
    "failureReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT,
    "phoneE164" TEXT,
    "eligibility" "RecipientEligibility" NOT NULL,
    "exclusionReason" TEXT,
    "clickToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "OutboundKind" NOT NULL,
    "campaignId" TEXT,
    "recipientId" TEXT,
    "contactId" TEXT,
    "conversationId" TEXT,
    "phoneNumberId" TEXT NOT NULL,
    "toPhone" TEXT,
    "toPhoneHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "templateName" TEXT,
    "category" "TemplateCategory",
    "status" "OutboundStatus" NOT NULL DEFAULT 'QUEUED',
    "bizOpaqueId" TEXT NOT NULL,
    "wamid" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "errorCode" TEXT,
    "errorTitle" TEXT,
    "errorDetail" TEXT,
    "billable" BOOLEAN,
    "pricingCategory" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "accountId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "notes" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "wamid" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "buttonPayload" TEXT,
    "buttonText" TEXT,
    "contextWamid" TEXT,
    "raw" JSONB,
    "isUnsubscribe" BOOLEAN NOT NULL DEFAULT false,
    "campaignId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_links" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracked_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_clicks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "campaignId" TEXT,
    "recipientId" TEXT,
    "contactId" TEXT,
    "visitorHash" TEXT NOT NULL,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "isUnique" BOOLEAN NOT NULL DEFAULT false,
    "userAgent" TEXT,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT,
    "campaignId" TEXT,
    "source" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "value" DECIMAL(14,2),
    "notes" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT,
    "contactId" TEXT,
    "clickToken" TEXT,
    "type" TEXT NOT NULL,
    "value" DECIMAL(14,2),
    "currency" TEXT,
    "externalId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "lastFiredAt" TIMESTAMP(3),
    "fireCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "events" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseCode" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorUserId" TEXT,
    "actorApiKeyId" TEXT,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "worker_heartbeats" (
    "workerId" TEXT NOT NULL,
    "hostname" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "beatAt" TIMESTAMP(3) NOT NULL,
    "info" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("workerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "organization_members_userId_idx" ON "organization_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organizationId_userId_key" ON "organization_members"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_organizationId_idx" ON "invitations"("organizationId");

-- CreateIndex
CREATE INDEX "subscriptions_organizationId_idx" ON "subscriptions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "usage_counters_organizationId_metric_periodStart_key" ON "usage_counters"("organizationId", "metric", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "business_settings_organizationId_key" ON "business_settings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_checks_organizationId_ruleCode_key" ON "compliance_checks"("organizationId", "ruleCode");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_webhookKey_key" ON "whatsapp_accounts"("webhookKey");

-- CreateIndex
CREATE INDEX "whatsapp_accounts_wabaId_idx" ON "whatsapp_accounts"("wabaId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_organizationId_wabaId_key" ON "whatsapp_accounts"("organizationId", "wabaId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_phone_numbers_phoneNumberId_key" ON "whatsapp_phone_numbers"("phoneNumberId");

-- CreateIndex
CREATE INDEX "whatsapp_phone_numbers_organizationId_idx" ON "whatsapp_phone_numbers"("organizationId");

-- CreateIndex
CREATE INDEX "contacts_organizationId_consentStatus_isSuppressed_idx" ON "contacts"("organizationId", "consentStatus", "isSuppressed");

-- CreateIndex
CREATE INDEX "contacts_organizationId_createdAt_idx" ON "contacts"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "contacts_organizationId_source_idx" ON "contacts"("organizationId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_organizationId_phoneE164_key" ON "contacts"("organizationId", "phoneE164");

-- CreateIndex
CREATE INDEX "contact_consents_organizationId_contactId_createdAt_idx" ON "contact_consents"("organizationId", "contactId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tags_organizationId_name_key" ON "tags"("organizationId", "name");

-- CreateIndex
CREATE INDEX "contact_tags_tagId_idx" ON "contact_tags"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "audiences_organizationId_name_key" ON "audiences"("organizationId", "name");

-- CreateIndex
CREATE INDEX "audience_members_contactId_idx" ON "audience_members"("contactId");

-- CreateIndex
CREATE INDEX "suppression_entries_organizationId_phoneHash_liftedAt_idx" ON "suppression_entries"("organizationId", "phoneHash", "liftedAt");

-- CreateIndex
CREATE INDEX "suppression_entries_organizationId_createdAt_idx" ON "suppression_entries"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "contact_imports_organizationId_createdAt_idx" ON "contact_imports"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "google_sheet_sources_organizationId_idx" ON "google_sheet_sources"("organizationId");

-- CreateIndex
CREATE INDEX "message_templates_organizationId_status_idx" ON "message_templates"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_accountId_name_language_key" ON "message_templates"("accountId", "name", "language");

-- CreateIndex
CREATE INDEX "campaigns_organizationId_status_idx" ON "campaigns"("organizationId", "status");

-- CreateIndex
CREATE INDEX "campaigns_organizationId_createdAt_idx" ON "campaigns"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "campaigns_status_scheduledAt_idx" ON "campaigns"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_clickToken_key" ON "campaign_recipients"("clickToken");

-- CreateIndex
CREATE INDEX "campaign_recipients_organizationId_campaignId_eligibility_idx" ON "campaign_recipients"("organizationId", "campaignId", "eligibility");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaignId_contactId_key" ON "campaign_recipients"("campaignId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_messages_recipientId_key" ON "outbound_messages"("recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_messages_bizOpaqueId_key" ON "outbound_messages"("bizOpaqueId");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_messages_wamid_key" ON "outbound_messages"("wamid");

-- CreateIndex
CREATE INDEX "outbound_messages_status_nextAttemptAt_idx" ON "outbound_messages"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "outbound_messages_organizationId_campaignId_status_idx" ON "outbound_messages"("organizationId", "campaignId", "status");

-- CreateIndex
CREATE INDEX "outbound_messages_organizationId_createdAt_idx" ON "outbound_messages"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "outbound_messages_phoneNumberId_submittedAt_idx" ON "outbound_messages"("phoneNumberId", "submittedAt");

-- CreateIndex
CREATE INDEX "outbound_messages_organizationId_toPhoneHash_idx" ON "outbound_messages"("organizationId", "toPhoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "message_events_dedupeKey_key" ON "message_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "message_events_organizationId_occurredAt_idx" ON "message_events"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "message_events_messageId_idx" ON "message_events"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_payloadHash_key" ON "webhook_events"("payloadHash");

-- CreateIndex
CREATE INDEX "webhook_events_processedAt_receivedAt_idx" ON "webhook_events"("processedAt", "receivedAt");

-- CreateIndex
CREATE INDEX "conversations_organizationId_lastMessageAt_idx" ON "conversations"("organizationId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_organizationId_status_idx" ON "conversations"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_phoneNumberId_contactId_key" ON "conversations"("phoneNumberId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_messages_wamid_key" ON "inbound_messages"("wamid");

-- CreateIndex
CREATE INDEX "inbound_messages_organizationId_receivedAt_idx" ON "inbound_messages"("organizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "inbound_messages_conversationId_receivedAt_idx" ON "inbound_messages"("conversationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_links_token_key" ON "tracked_links"("token");

-- CreateIndex
CREATE INDEX "tracked_links_organizationId_idx" ON "tracked_links"("organizationId");

-- CreateIndex
CREATE INDEX "link_clicks_organizationId_clickedAt_idx" ON "link_clicks"("organizationId", "clickedAt");

-- CreateIndex
CREATE INDEX "link_clicks_linkId_clickedAt_idx" ON "link_clicks"("linkId", "clickedAt");

-- CreateIndex
CREATE INDEX "link_clicks_campaignId_idx" ON "link_clicks"("campaignId");

-- CreateIndex
CREATE INDEX "leads_organizationId_createdAt_idx" ON "leads"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "leads_organizationId_status_idx" ON "leads"("organizationId", "status");

-- CreateIndex
CREATE INDEX "conversions_organizationId_occurredAt_idx" ON "conversions"("organizationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversions_organizationId_externalId_key" ON "conversions"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "automation_rules_organizationId_isActive_idx" ON "automation_rules"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_organizationId_idx" ON "api_keys"("organizationId");

-- CreateIndex
CREATE INDEX "webhook_endpoints_organizationId_idx" ON "webhook_endpoints"("organizationId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_nextAttemptAt_idx" ON "webhook_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_organizationId_createdAt_idx" ON "webhook_deliveries"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_entityType_entityId_idx" ON "audit_logs"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_resetAt_idx" ON "rate_limit_buckets"("resetAt");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_phone_numbers" ADD CONSTRAINT "whatsapp_phone_numbers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_phone_numbers" ADD CONSTRAINT "whatsapp_phone_numbers_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audiences" ADD CONSTRAINT "audiences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audience_members" ADD CONSTRAINT "audience_members_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "audiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audience_members" ADD CONSTRAINT "audience_members_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppression_entries" ADD CONSTRAINT "suppression_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_imports" ADD CONSTRAINT "contact_imports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_sheet_sources" ADD CONSTRAINT "google_sheet_sources_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "whatsapp_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "whatsapp_phone_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "campaign_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "whatsapp_phone_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "outbound_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "whatsapp_phone_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "whatsapp_phone_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_links" ADD CONSTRAINT "tracked_links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_links" ADD CONSTRAINT "tracked_links_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "tracked_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
