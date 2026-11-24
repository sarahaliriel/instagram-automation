CREATE TABLE "DataRightsErasure" (
    "caseId" UUID NOT NULL,
    "digest" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataRightsErasure_pkey" PRIMARY KEY ("caseId")
);
