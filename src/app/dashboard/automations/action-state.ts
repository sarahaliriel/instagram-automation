export type AutomationActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message: string;
  id?: string;
  fieldErrors?: Partial<
    Record<
      | "name"
      | "mediaProviderId"
      | "strategy"
      | "keyword"
      | "privateMessageTemplate",
      string[]
    >
  >;
  review?: AutomationReviewState;
}>;

export type AutomationReviewState = Readonly<{
  id: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  revision: number;
  strategy: "EXACT" | "WHOLE_WORD";
  scope: "GLOBAL" | "MEDIA";
  priority: number;
  mediaProviderId: string | null;
  keyword: string;
  privateMessageTemplate: string;
  executionCount: number;
  publicFallbackEnabled: boolean;
  reviewDigest: string;
  conflicts: readonly Readonly<{
    ruleId: string;
    name: string;
    scope: "GLOBAL" | "MEDIA";
    priority: number;
    revision: number;
    overlappingKeywords: readonly string[];
    precedence: "CANDIDATE_WINS" | "EXISTING_RULE_WINS";
  }>[];
}>;

export const initialAutomationActionState: AutomationActionState = {
  status: "idle",
  message: "",
};
